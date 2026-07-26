import express from 'express'
import { URLSearchParams } from 'node:url'
import { config } from './config.js'

// ──────────────────────────────────────────────────────────────
// ShowDoc 私服对接
//
// 使用 ShowDoc 开放 API（https://www.showdoc.com.cn/help/1380919648553536）
//   - 读取项目接口树：/api/item/info
//   - 保存/更新接口文档：/api/item/page/edit（新版）→ 回退 item/updateByApi（老版通用）
//   - 新建目录：/api/item/insertCatalog
//
// 所有凭证（api_key / api_token / 私服地址）可由前端临时传入，
// 也可通过环境变量预设（见 server/config.js）。
// ──────────────────────────────────────────────────────────────
const router = express.Router()

// 解析并校验私服地址：前端没传则用服务端 .env 默认；非绝对地址直接报错
function resolveBaseUrl(baseUrl) {
  const raw = (baseUrl || '').trim() || config.showdoc.baseUrl
  if (!raw) {
    throw new Error('缺少 ShowDoc 私服地址，请在页面填写「私服地址」（如 http://localhost:5757）')
  }
  let base
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
    base = new URL(withProto).href.replace(/\/+$/, '')
  } catch {
    throw new Error(`私服地址不合法：${raw}（应为完整 URL，如 http://localhost:5757）`)
  }
  return base
}

function apiUrl(baseUrl, path) {
  const base = resolveBaseUrl(baseUrl)
  return `${base}/server/index.php?s=/api/${path}`
}

async function post(baseUrl, path, params) {
  const form = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== '' && v != null) form.set(k, String(v))
  }
  const url = apiUrl(baseUrl, path)
  let resp
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    })
  } catch (e) {
    throw new Error(`无法连接 ShowDoc（${url}）：${e.message}`)
  }
  const text = await resp.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    // 返回的不是 JSON（多半是 HTML 报错页 / 404 / 路径不对），把前 300 字抛出去方便排查
    const snippet = text.slice(0, 300).replace(/\s+/g, ' ')
    // ShowDoc 在 api_key/token/item_id 不正确或无权限时，会返回一段 PHP 致命错误
    // （parseTemplate on null），而不是正常 JSON 错误码
    if (/parseTemplate|Call to a member function|ThinkPHP/i.test(text)) {
      throw new Error(
        'ShowDoc 返回了 PHP 错误页，通常是 api_key / api_token / item_id 不正确，或该密钥没有此项目的访问权限。' +
        '请确认：① item_id 是「项目」ID（看项目设置/地址栏，不是某个接口页面的 ID）；' +
        '② api_key 与 api_token 来自该项目的「开放API」设置页；③ 三项属于同一项目。'
      )
    }
    throw new Error(`ShowDoc 返回的不是 JSON（可能地址/路径不对）。HTTP ${resp.status}，内容片段：${snippet}`)
  }
  if (data.error_code !== undefined && Number(data.error_code) !== 0) {
    const code = Number(data.error_code)
    const msg = data.error_message || `ShowDoc 返回错误码 ${code}`
    // 999 是 ShowDoc 在 api_key/token/item_id 不正确或无权限时的典型「崩溃」错误码
    // 999 + parseTemplate 报错 = 该接口路由在此（老版 ThinkPHP3）私服上不存在，
    // ThinkPHP 找不到方法转去渲染模板导致崩溃，属于「端点不存在」而非凭证错误
    if (code === 999 && /parseTemplate/i.test(msg)) {
      throw new Error(`[error_code=999] 该接口在此 ShowDoc 版本上不存在（${msg.slice(0, 80)}）`)
    }
    // 把 error_code 也带上，便于判断是鉴权失败还是其它错误
    throw new Error(`[error_code=${code}] ${msg}`)
  }
  return data
}

// 从 ShowDoc 返回的任意嵌套结构中，深度扫描提取全部目录(catalog)与页面(pages)。
// 不依赖固定字段层级（兼容 item/info、item/show 及各版本不同包装）。
function extractTree(root) {
  const catalog = []
  const pages = []
  const seenCat = new Set()
  const seenPage = new Set()

  function walk(node) {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (!node || typeof node !== 'object') return

    // 目录：同时具备 cat_id 与 cat_name
    if (node.cat_id !== undefined && node.cat_name !== undefined) {
      const id = String(node.cat_id)
      if (!seenCat.has(id)) {
        seenCat.add(id)
        catalog.push({
          cat_id: node.cat_id,
          cat_name: node.cat_name,
          level: Number(node.level) || 1,
          parent_cat_id: node.parent_cat_id ?? null
        })
      }
    }
    // 页面：同时具备 page_id 与 page_title
    if (node.page_id !== undefined && node.page_title !== undefined) {
      const id = String(node.page_id)
      if (!seenPage.has(id)) {
        seenPage.add(id)
        pages.push(node)
      }
    }
    // 继续向下遍历（跳过原始大字符串，避免无意义扫描）
    for (const k of Object.keys(node)) {
      const v = node[k]
      if (v && typeof v === 'object') walk(v)
    }
  }

  walk(root)
  return { catalog, pages }
}

// 读取接口树：目录(catalog) + 页面(pages)
router.post('/showdoc/tree', async (req, res) => {
  try {
    const {
      baseUrl,
      apiKey,
      apiToken,
      itemId
    } = req.body
    if (!itemId) return res.status(400).json({ error: '缺少 item_id（ShowDoc 项目 ID）' })

    const data = await post(baseUrl, 'item/info', {
      api_key: apiKey,
      api_token: apiToken,
      item_id: itemId
    })

    // 从 ShowDoc 返回的任意嵌套结构中，提取全部目录与页面（兼容 info/show/各种包装）
    const { catalog, pages } = extractTree(data)

    if (catalog.length === 0 && pages.length === 0) {
      // 能连通但解析为空，把原始 data 回传便于排查结构
      return res.json({ catalog, pages, raw: data })
    }
    res.json({ catalog, pages })
  } catch (err) {
    res.status(502).json({ error: `读取 ShowDoc 接口树失败：${err.message}` })
  }
})

// 批量获取页面正文（用于导出）。
// 不同 ShowDoc 版本取单页正文的 action 名不同：先试 item/getPage，失败再试 api/page/info
// （均为 POST，参数 api_key / api_token / page_id，返回含 page_content 字段）
router.post('/showdoc/pages', async (req, res) => {
  try {
    const { baseUrl, apiKey, apiToken, pageIds } = req.body
    if (!Array.isArray(pageIds) || !pageIds.length) {
      return res.status(400).json({ error: '缺少 pageIds' })
    }
    // 注意：apiUrl 已经拼了 /api/，所以这里的 path 只需写控制器/方法，
    // 不能写成 api/page/info（会变成 /api/api/page/info 找不到控制器）
    const actions = ['item/getPage', 'page/info']
    const results = await Promise.all(
      pageIds.map(async (pid) => {
        let lastErr
        for (const act of actions) {
          try {
            const d = await post(baseUrl, act, {
              api_key: apiKey,
              api_token: apiToken,
              page_id: pid
            })
            return { ...(d.data || d), page_id: String(pid) }
          } catch (e) {
            lastErr = e
          }
        }
        return { page_id: String(pid), _error: lastErr ? lastErr.message : '未知错误' }
      })
    )
    res.json({ pages: results })
  } catch (err) {
    res.status(502).json({ error: `读取页面正文失败：${err.message}` })
  }
})

// 保存接口到 ShowDoc（pageId 缺省则新建）
// 同时注册 /showdoc/save 与 /showdoc/update 两个路径：
// 前端 web 模式调用 action='update'（对应桌面端 App.UpdatePage），
// 旧版/部分调用使用 'save'，这里统一复用同一处理函数，避免 404。
async function handleSave(req, res) {
  try {
    const b = req.body || {}
    const { baseUrl, apiKey, apiToken, itemId, pageId } = b
    // 兼容前端两套字段名：web save() 发的是 pageTitle/pageContent，
    // 旧调用/桌面协议用 title/content。任取其一，避免字段错位导致「缺少接口标题」。
    const catId = b.catId || b.cat_id || ''
    const title = b.title || b.pageTitle || ''
    const content = b.content != null ? b.content : (b.pageContent != null ? b.pageContent : '')

    if (!itemId) return res.status(400).json({ error: '缺少 item_id' })
    if (!title) return res.status(400).json({ error: '缺少接口标题' })
    // 更新已有页面（带 page_id）时 cat_id 可缺省；仅新建接口时必须指定目录
    if (!pageId && !catId) return res.status(400).json({ error: '缺少 cat_id（请选择或新建目录）' })

    // 候选保存接口：不同私服版本开放 API 端点名不同，自动尝试并报告各自结果。
    // ① item/page/edit（新版，与桌面端 Go 一致）
    // ② item/updateApiItem（部分版本）
    // ③ item/updateByApi（官方 showdoc_api.sh 用的全版本通用接口，老版 ThinkPHP3 私服
    //    只有这个可用；按 cat_name + page_title 定位页面，需先把 cat_id 解析成目录路径名）
    const errors = []
    const byIdCandidates = [
      { path: 'item/page/edit', params: { page_title: title, page_content: content || '' } },
      { path: 'item/updateApiItem', params: { title, content: content || '' } }
    ]
    for (const c of byIdCandidates) {
      try {
        const data = await post(baseUrl, c.path, {
          api_key: apiKey,
          api_token: apiToken,
          item_id: itemId,
          page_id: pageId || '',
          cat_id: catId,
          ...c.params
        })
        return res.json({ ok: true, data: data.data, used: c.path })
      } catch (e) {
        errors.push(`• ${c.path}：${e.message}`)
      }
    }

    // 回退：item/updateByApi。需要 cat_name（目录名路径，多级用 "/" 分隔）。
    try {
      let catName = ''
      let effectiveCatId = catId
      // 通过 item/info 拉取目录树（该接口在此私服上已验证可用）
      const info = await post(baseUrl, 'item/info', {
        api_key: apiKey,
        api_token: apiToken,
        item_id: itemId
      })
      const { catalog, pages } = extractTree(info)
      // 只传了 page_id 没传 cat_id 时，从页面列表反查其所属目录
      if (!effectiveCatId && pageId) {
        const p = pages.find((x) => String(x.page_id) === String(pageId))
        if (p && p.cat_id != null) effectiveCatId = p.cat_id
      }
      if (effectiveCatId) {
        const byId = new Map(catalog.map((c) => [String(c.cat_id), c]))
        const parts = []
        let cur = byId.get(String(effectiveCatId))
        while (cur) {
          parts.unshift(cur.cat_name)
          const pid = cur.parent_cat_id
          cur = pid == null || String(pid) === '0' || pid === '' ? null : byId.get(String(pid))
        }
        catName = parts.join('/')
      }
      const data = await post(baseUrl, 'item/updateByApi', {
        api_key: apiKey,
        api_token: apiToken,
        cat_name: catName,
        page_title: title,
        page_content: content || ''
      })
      return res.json({ ok: true, data: data.data, used: 'item/updateByApi' })
    } catch (e) {
      errors.push(`• item/updateByApi：${e.message}`)
    }
    throw new Error('所有候选保存接口均失败：\n' + errors.join('\n'))
  } catch (err) {
    res.status(502).json({ error: `保存到 ShowDoc 失败：${err.message}` })
  }
}
router.post('/showdoc/save', handleSave)
router.post('/showdoc/update', handleSave)

// ──────────────────────────────────────────────────────────────
// AI 一键补全参数说明
// 兼容 OpenAI / DeepSeek / 通义千问 等 OpenAI 协议接口。
// 入参：{ ai:{ baseUrl, apiKey, model }, context:{ title, method, url }, items:[{name,type}] }
// 返回：{ descriptions:[ "说明1", "说明2", ... ] }（顺序与 items 对齐）
// ──────────────────────────────────────────────────────────────
router.post('/ai/fill', async (req, res) => {
  try {
    const { ai, context, items } = req.body || {}
    if (!ai || !ai.apiKey) return res.status(400).json({ error: '缺少 AI API Key（请在设置中填写）' })
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: '缺少待补全的参数' })

    const base = (ai.baseUrl || '').trim().replace(/\/+$/, '') || 'https://api.openai.com/v1'
    const model = ai.model || 'gpt-4o-mini'

    const ctxLines = []
    if (context?.title) ctxLines.push(`接口：${context.title}`)
    if (context?.method) ctxLines.push(`请求方法：${context.method}`)
    if (context?.url) ctxLines.push(`请求地址：${context.url}`)
    const ctx = ctxLines.join('；')

    const list = items
      .map((it, i) => `${i + 1}. 参数名=${it.name || '-'} 类型=${it.type || '-'}`)
      .join('\n')

    const userMsg =
      `请为以下 API 参数生成简洁的中文「说明/描述」，每行一条，用 JSON 数组返回（顺序与输入一致，纯字符串，不要包含 markdown、不要编号）。\n` +
      (ctx ? `接口上下文：${ctx}\n` : '') +
      `参数列表：\n${list}`

    let resp
    try {
      resp = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + ai.apiKey
        },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          messages: [
            { role: 'system', content: '你是 API 文档助手，擅长用一句话中文描述接口参数的含义与用途。只输出 JSON 数组，不要任何额外解释。' },
            { role: 'user', content: userMsg }
          ]
        })
      })
    } catch (e) {
      throw new Error(`无法连接 AI 服务（${base}）：${e.message}`)
    }
    const text = await resp.text()
    let j
    try {
      j = JSON.parse(text)
    } catch {
      throw new Error(`AI 服务返回非 JSON（HTTP ${resp.status}）：${text.slice(0, 200)}`)
    }
    const contentText = (j?.choices?.[0]?.message?.content || '').trim()
    const m = contentText.match(/\[[\s\S]*\]/)
    let arr = []
    if (m) {
      try {
        arr = JSON.parse(m[0])
      } catch {
        /* ignore */
      }
    }
    if (!Array.isArray(arr) || !arr.length) {
      throw new Error('AI 返回结果无法解析为说明数组')
    }
    const descriptions = arr.map((s) => String(s).replace(/\s+/g, ' ').trim())
    res.json({ descriptions })
  } catch (err) {
    res.status(502).json({ error: `AI 补全失败：${err.message}` })
  }
})

// 新建目录，返回新 cat_id
router.post('/showdoc/catalog', async (req, res) => {
  try {
    const { baseUrl, apiKey, apiToken, itemId, catName, parentCatId } = req.body
    if (!itemId) return res.status(400).json({ error: '缺少 item_id' })
    if (!catName) return res.status(400).json({ error: '缺少目录名称' })

    const data = await post(baseUrl, 'item/insertCatalog', {
      api_key: apiKey,
      api_token: apiToken,
      item_id: itemId,
      cat_name: catName,
      parent_cat_id: parentCatId || 0
    })
    res.json({ ok: true, catId: data.data && data.data.cat_id })
  } catch (err) {
    res.status(502).json({ error: `新建目录失败：${err.message}` })
  }
})

export default router
