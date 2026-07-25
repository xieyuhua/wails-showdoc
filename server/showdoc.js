import express from 'express'
import { URLSearchParams } from 'node:url'
import { config } from './config.js'

// ──────────────────────────────────────────────────────────────
// ShowDoc 私服对接
//
// 使用 ShowDoc 开放 API（https://www.showdoc.com.cn/help/1380919648553536）
//   - 读取项目接口树：/api/item/info  （部分私服版本也支持 /api/item/show）
//   - 保存/更新接口文档：/api/item/updateApiItem
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
  if (data.error_code && Number(data.error_code) !== 0) {
    // 999 是 ShowDoc 在 api_key/token/item_id 不正确或无权限时的典型「崩溃」错误码
    if (Number(data.error_code) === 999) {
      throw new Error(
        'ShowDoc 拒绝了请求（error_code 999）。这是凭证/项目 ID 不对导致的，请逐项核对：\n' +
        '① item_id 必须是「项目」ID（打开项目后地址栏 ?item_id= 后面的数字），不是某个接口页面的 ID；\n' +
        '② api_key 与 api_token 必须来自「该项目」设置页里的「开放API」密钥对；\n' +
        '③ 三项属于同一个项目；\n' +
        '④ 若仍不行，可能是 ShowDoc 版本过旧，建议升级到最新版（该 999 是旧版已知 bug）。'
      )
    }
    throw new Error(data.error_message || `ShowDoc 返回错误码 ${data.error_code}`)
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
router.post('/showdoc/save', async (req, res) => {
  try {
    const {
      baseUrl,
      apiKey,
      apiToken,
      itemId,
      catId,
      title,
      content,
      pageId
    } = req.body
    if (!itemId) return res.status(400).json({ error: '缺少 item_id' })
    if (!catId) return res.status(400).json({ error: '缺少 cat_id（请选择或新建目录）' })
    if (!title) return res.status(400).json({ error: '缺少接口标题' })

    const data = await post(baseUrl, 'item/updateApiItem', {
      api_key: apiKey,
      api_token: apiToken,
      item_id: itemId,
      cat_id: catId,
      title,
      content: content || '',
      page_id: pageId || ''
    })
    res.json({ ok: true, data: data.data })
  } catch (err) {
    res.status(502).json({ error: `保存到 ShowDoc 失败：${err.message}` })
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
