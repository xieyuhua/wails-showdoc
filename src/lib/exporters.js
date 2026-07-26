import { marked } from 'marked'

// ──────────────────────────────────────────────────────────────
// 把 ShowDoc（RunApi）接口文档导出为多格式
//   输入：从 /api/showdoc/tree 拿到的 pages（含 page_content 的 Markdown）
//   输出：Markdown / HTML / OpenAPI 3.0 / Postman 2.1
//
// ShowDoc 的 API 页面内容本质是「Markdown 模板」，这里用一套宽容的解析器
// 把 method / url / 参数表 抽出来，再重新序列化到各格式。
// ──────────────────────────────────────────────────────────────

function decodeHtml(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

// 解析 ShowDoc(RunApi) 导出的接口 JSON。
// 注意：page/info 返回的 page_content 是一段「被 HTML 转义」的 JSON 字符串
// （双引号被转成 &quot;），所以这里先解码再做 JSON.parse。
function parseRunApi(decoded) {
  let obj
  try {
    obj = JSON.parse(decoded)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object' || !obj.info) return null

  const info = obj.info || {}
  const req = obj.request || {}
  const pb = req.params || {}
  const resp = obj.response || {}
  // RunApi 不同版本里 formdata/urlencoded/query/headers 可能是数组，
  // 也可能是对象（{key:{...}}）或字符串/空，这里统一安全转成数组，避免 .filter 崩溃。
  const toArr = (v) => {
    if (Array.isArray(v)) return v
    if (v && typeof v === 'object') return Object.values(v)
    return []
  }
  const toRow = (p, kind) => ({
    name: p.name || '',
    required: p.require === '1' || p.require === 'true' || p.require === true,
    type: p.type || '',
    desc: p.remark || p.description || '',
    kind
  })
  // 过滤：跳过被禁用行(disable==1)以及 RunApi 自带的空占位行(name 为空)
  const pick = (v, kind) =>
    toArr(v)
      .filter((p) => p && typeof p === 'object' && p.disable !== '1' && (p.name || '').trim() !== '')
      .map((p) => toRow(p, kind))

  // 计算请求方法，用于判断是否需要 body 参数
  const method = (info.method || '').toUpperCase()
  // GET / HEAD 等无 body 的请求不取 body 参数（RunApi 里 GET 误填的 body 会被忽略）；
  // 仅 POST / PUT / PATCH 等带 body 的请求才解析 body 表单参数。
  const hasBody = method !== 'GET' && method !== 'HEAD'
  const body = hasBody
    ? [...pick(pb.formdata, 'body'), ...pick(pb.urlencoded, 'body'), ...pick(pb.jsonDesc, 'body')]
    : []
  // 请求参数（body + query）与请求头
  const query = pick(req.query, 'query')
  const headers = pick(req.headers, 'header')
  const reqParams = [...body, ...query]

  // 响应参数（成功 / 失败）—— 严格来自 response.*，不与请求混用
  const respParams = pick(resp.responseParamsDesc, 'response')
  const respFailParams = pick(resp.responseFailParamsDesc, 'response')
  const respExample = resp.responseExample || resp.responseText || ''

  const url = info.url || ''
  const title = (info.title || info.page_title || obj.page_title || '').trim()
  const description = info.description || info.remark || ''
  const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  let md = ''
  // remark / 描述：用 <pre> 原样输出（保留换行与缩进，不走 Markdown 渲染），避免格式走样
  if (description) md += `<pre class="remark">${escHtml(description)}</pre>\n\n`
  md += `**请求方法**：${method}\n\n`
  md += `**请求地址**：${url}\n\n`
  const table = (rows, label) => {
    if (!rows.length) return ''
    let s = `**${label}**\n\n| 名称 | 必选 | 类型 | 说明 |\n| --- | --- | --- | --- |\n`
    rows.forEach((r) => {
      s += `| ${r.name} | ${r.required ? '是' : '否'} | ${r.type} | ${r.desc} |\n`
    })
    return s + '\n'
  }
  // 响应参数表不显示"必选"列
  const respTable = (rows, label) => {
    if (!rows.length) return ''
    let s = `**${label}**\n\n| 名称 | 类型 | 说明 |\n| --- | --- | --- |\n`
    rows.forEach((r) => {
      s += `| ${r.name} | ${r.type} | ${r.desc} |\n`
    })
    return s + '\n'
  }
  md += table(reqParams, '请求参数')
  md += table(headers, '请求头')
  // 响应示例放在响应参数前面，便于先看实际返回结构再对照字段说明
  if (respExample) {
    md += `**响应示例**\n\n\`\`\`json\n${respExample}\n\`\`\`\n\n`
  }
  md += respTable(respParams, '响应参数')
  md += respTable(respFailParams, '失败响应参数')

  return {
    method,
    url,
    title,
    params: reqParams,
    headers,
    respParams,
    respFailParams,
    respExample,
    markdown: md
  }
}

// 把页面原始内容转成「可编辑」文本：若是 RunApi 的 JSON（被 HTML 转义），则解码成
// 可读 JSON；否则原样返回（普通 Markdown）。编辑后再回传 ShowDoc 时会重新转义。
export function decodePageContent(raw) {
  const decoded = decodeHtml(String(raw || ''))
  try {
    JSON.parse(decoded)
    return decoded
  } catch {
    return raw || ''
  }
}

// 把一页 ShowDoc 内容解析成结构化对象
export function parsePage(page) {
  const raw = page.page_content || ''

  // 优先按 RunApi JSON 解析（page_content 为 HTML 转义的 JSON 字符串）
  const runapi = parseRunApi(decodeHtml(raw))
  if (runapi) {
    return {
      id: page.page_id,
      catId: page.cat_id,
      title: (runapi.title || page.page_title || '').trim(),
      method: runapi.method,
      url: runapi.url,
      params: runapi.params,
      headers: runapi.headers,
      respParams: runapi.respParams,
      respFailParams: runapi.respFailParams,
      respExample: runapi.respExample,
      markdown: runapi.markdown
    }
  }

  // 否则按普通 Markdown 文档解析
  const md = raw
  const text = md

  // 请求方法
  const m =
    text.match(/(?:请求方式|请求方法|method)[^\n]*?[:：]\s*(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)/i) ||
    text.match(/>\s*(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/i) ||
    text.match(/\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+https?:\/\//i)
  const method = m ? m[1].toUpperCase() : ''

  // 请求地址
  const u =
    text.match(/(?:请求URL|请求地址|url)[^\n]*?`([^`]+)`/i) ||
    text.match(/`(https?:\/\/[^\s`]+)`/) ||
    text.match(/(https?:\/\/[^\s`]+)/)
  const url = u ? u[1] : ''

  return {
    id: page.page_id,
    catId: page.cat_id,
    title: (page.page_title || '').trim(),
    method,
    url,
    params: parseParamsTable(md),
    markdown: md
  }
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((s) => s.trim())
}

function parseTables(md) {
  const lines = md.split(/\r?\n/)
  const tables = []
  let i = 0
  while (i < lines.length) {
    if (lines[i].trim().startsWith('|')) {
      const header = splitRow(lines[i])
      const sep = lines[i + 1] || ''
      if (/^\s*\|?[\s:|-]+\|?$/.test(sep) && sep.includes('-')) {
        const rows = []
        let j = i + 2
        while (j < lines.length && lines[j].trim().startsWith('|')) {
          rows.push(splitRow(lines[j]))
          j++
        }
        tables.push({ headers: header, rows })
        i = j
      } else {
        i++
      }
    } else {
      i++
    }
  }
  return tables
}

function parseParamsTable(md) {
  const tables = parseTables(md)
  // 优先选「请求参数」表，排除「返回参数」
  let t = tables.find((tb) => {
    const h = tb.headers.join(' ').toLowerCase()
    return (h.includes('参数') || h.includes('名称') || h.includes('字段')) && !h.includes('返回')
  })
  if (!t) t = tables[0]
  if (!t) return []

  const idxName = Math.max(0, t.headers.findIndex((h) => /参数名|名称|字段|key|name/i.test(h)))
  const idxReq = t.headers.findIndex((h) => /必选|必填|required/i.test(h))
  const idxType = t.headers.findIndex((h) => /类型|type/i.test(h))
  const idxDesc = t.headers.findIndex((h) => /说明|描述|desc|备注|注释/i.test(h))

  return t.rows
    .map((r) => ({
      name: r[idxName] || '',
      required: idxReq >= 0 ? /是|true|1|required|yes/i.test(r[idxReq] || '') : false,
      type: idxType >= 0 ? r[idxType] || '' : '',
      desc: idxDesc >= 0 ? r[idxDesc] || '' : ''
    }))
    .filter((p) => p.name)
}

// ── 各格式生成 ──

// 把扁平 catalog（含 parent_cat_id）构建成带 children 的层级树
export function buildCatTree(catalog) {
  const cats = catalog || []
  const byParent = new Map()
  cats.forEach((c) => {
    const pid =
      c.parent_cat_id == null || c.parent_cat_id === '' || c.parent_cat_id === 0 || c.parent_cat_id === '0'
        ? null
        : String(c.parent_cat_id)
    if (!byParent.has(pid)) byParent.set(pid, [])
    byParent.get(pid).push(c)
  })
  const build = (pid) => (byParent.get(pid) || []).map((c) => ({ ...c, children: build(String(c.cat_id)) }))
  return build(null)
}

// 页面按 cat_id 分组（null/空/0 归到 null）
export function groupPagesByCat(pages) {
  const groups = {}
  pages.forEach((p) => {
    const cid = p.catId == null || p.catId === '' || p.catId === 0 || p.catId === '0' ? null : String(p.catId)
    ;(groups[cid] = groups[cid] || []).push(p)
  })
  return groups
}

// 返回 cat_id -> 该目录的完整路径数组（如 ['用户管理','账号']）
function buildCatPaths(catalog) {
  const catTree = buildCatTree(catalog)
  const pathOf = {}
  const walk = (node, path) => {
    const cur = [...path, node.cat_name]
    pathOf[String(node.cat_id)] = cur
    ;(node.children || []).forEach((c) => walk(c, cur))
  }
  catTree.forEach((n) => walk(n, []))
  return pathOf
}

export function toMarkdown(pages, catalog) {
  const groups = groupPagesByCat(pages)
  const catTree = buildCatTree(catalog)
  let out = '# ShowDoc 接口文档\n\n'

  // 递归渲染目录树：目录标题含完整路径以保留层级，深度越大标题级别越深（封顶 6 级）
  const renderCat = (node, depth, path) => {
    const curPath = [...path, node.cat_name]
    const label = curPath.join(' / ')
    const level = Math.min(2 + depth, 6)
    out += `${'#'.repeat(level)} ${label}\n\n`
    ;(groups[String(node.cat_id)] || []).forEach((p) => {
      out += `${'#'.repeat(Math.min(level + 1, 6))} ${p.title}\n\n${p.markdown || ''}\n\n`
    })
    ;(node.children || []).forEach((child) => renderCat(child, depth + 1, curPath))
  }
  catTree.forEach((n) => renderCat(n, 0, []))

  // 未归类页面（catId 为空或不在 catalog 中）
  const catIds = new Set((catalog || []).map((c) => String(c.cat_id)))
  const orphans = pages.filter((p) => {
    const cid = p.catId == null || p.catId === '' || p.catId === 0 || p.catId === '0' ? null : String(p.catId)
    return cid === null || !catIds.has(cid)
  })
  if (orphans.length) {
    out += `## 未分类\n\n`
    orphans.forEach((p) => {
      out += `### ${p.title}\n\n${p.markdown || ''}\n\n`
    })
  }
  return out
}

export function toHtml(pages, catalog) {
  const md = toMarkdown(pages, catalog)
  const rawBody = marked.parse(md)
  // 1) 把「响应示例」代码块包裹为可折叠的 <details>：默认展开，点击 summary 可折叠；
  //    数据过长（>420px）时由末尾脚本自动折叠，避免长 JSON 撑爆页面。
  const wrapped = rawBody.replace(
    /(<p>)?<strong>响应示例<\/strong>(<\/p>)?\s*<pre>([\s\S]*?)<\/pre>/g,
    '<details class="resp-example" open><summary>响应示例<span class="toggle-hint">（点击折叠 / 展开）</span></summary><pre>$3</pre></details>'
  )
  // 2) 给所有标题加锚点 id，并收集生成目录 TOC（含目录层级与接口）
  const toc = []
  let sec = 0
  const body = wrapped.replace(/<h([2-6])>([\s\S]*?)<\/h\1>/g, (m, level, text) => {
    const plain = text.replace(/<[^>]+>/g, '').trim()
    const id = 'sec-' + ++sec
    const lvl = parseInt(level, 10)
    if (lvl >= 2) toc.push({ level: lvl, id, text: plain })
    return `<h${level} id="${id}">${text}</h${level}>`
  })
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const tocHtml = toc.length
    ? `<nav class="toc"><div class="toc-title">目录</div><input id="toc-search" class="toc-search" type="text" placeholder="搜索接口…" /><ul>${toc
        .map((t) => `<li class="toc-l${t.level}"><a href="#${t.id}">${esc(t.text)}</a></li>`)
        .join('')}</ul></nav>`
    : ''
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>ShowDoc 接口文档</title>
<style>
  html{scroll-behavior:smooth}
  body{font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;color:#1b2233;line-height:1.7;margin:0}
  .layout{display:flex;align-items:flex-start}
  /* 左侧目录预览：吸顶、可滚动、点击跳转 */
  .toc{position:sticky;top:0;align-self:flex-start;width:240px;max-height:100vh;overflow:auto;flex:none;border-right:1px solid #e3e8f0;padding:20px 14px;background:#fafbfe;font-size:13px}
  .toc-title{font-weight:700;color:#2f6fed;margin-bottom:10px}
  .toc ul{list-style:none;margin:0;padding:0}
  .toc-search{width:100%;box-sizing:border-box;margin:0 0 12px;padding:6px 9px;border:1px solid #cdd6e6;border-radius:6px;font-size:13px;outline:none}
  .toc-search:focus{border-color:#4f8cff}
  .toc li{margin:1px 0}
  .toc a{display:block;color:#3a4a63;text-decoration:none;padding:3px 8px;border-radius:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .toc a:hover{background:#e7eefc;color:#2f6fed}
  .toc .toc-l2{font-weight:600;color:#2f6fed}
  .toc .toc-l3{padding-left:18px}
  .toc .toc-l4{padding-left:34px}
  .toc .toc-l5{padding-left:50px}
  .toc .toc-l6{padding-left:66px}
  .content{flex:1;min-width:0;max-width:920px;margin:40px auto;padding:0 20px}
  h1{border-bottom:2px solid #4f8cff;padding-bottom:8px}
  h2{margin-top:40px;color:#2f6fed}
  h3{margin-top:28px;color:#1b2233}
  .content :target{background:#fff5e6;border-radius:6px;scroll-margin-top:12px}
  table{border-collapse:collapse;width:100%;margin:12px 0}
  th,td{border:1px solid #d8deea;padding:8px 10px;text-align:left}
  th{background:#eef1f7}
  code{background:#eef1f7;padding:2px 6px;border-radius:4px}
  pre{background:#0b0e18;color:#e6e9f0;padding:14px;border-radius:8px;overflow:auto}
  pre code{background:none;padding:0}
  /* 响应示例：可折叠容器 */
  details.resp-example{border:1px solid #d8deea;border-radius:8px;margin:14px 0;overflow:hidden;background:#fff}
  details.resp-example>summary{cursor:pointer;padding:10px 14px;background:#eef1f7;font-weight:600;color:#2f6fed;list-style:none;user-select:none}
  details.resp-example>summary::-webkit-details-marker{display:none}
  details.resp-example>summary .toggle-hint{font-weight:400;font-size:12px;color:#7a8295;margin-left:6px}
  details.resp-example>pre{margin:0;border-radius:0}
  details.resp-example.auto-collapsed>summary{background:#fff5e6;color:#b26a00}
  /* remark / 描述：原样输出，浅色可读，保留换行与缩进 */
  pre.remark{background:#f6f8fc;border:1px solid #e3e8f0;color:#1b2233;white-space:pre-wrap;word-break:break-word;font-family:inherit}
</style></head>
<body>
<div class="layout">
${tocHtml}
<div class="content">
${body}
</div>
</div>
<script>
document.querySelectorAll('details.resp-example').forEach(function(d){
  var pre=d.querySelector('pre');
  if(pre && pre.scrollHeight>420){ d.open=false; d.classList.add('auto-collapsed'); }
});
// 目录搜索：按接口名实时过滤
var tocBox=document.getElementById('toc-search');
if(tocBox){
  tocBox.addEventListener('input',function(){
    var q=this.value.trim().toLowerCase();
    document.querySelectorAll('.toc li').forEach(function(li){
      var a=li.querySelector('a');
      var t=a?a.textContent.toLowerCase():'';
      li.style.display=(!q||t.indexOf(q)>=0)?'':'none';
    });
  });
}
</script>
</body></html>`
}

function mapType(t) {
  const s = (t || '').toLowerCase()
  if (/int|number|float|double|long|digit/.test(s)) return 'number'
  if (/bool/.test(s)) return 'boolean'
  if (/array|list|\[\]/.test(s)) return 'array'
  if (/object|map|json/.test(s)) return 'object'
  return 'string'
}

export function toOpenApi(pages, catalog) {
  const paths = {}
  const catPaths = buildCatPaths(catalog)
  pages.forEach((p) => {
    let path = p.url || '/'
    try {
      const x = new URL(p.url)
      path = x.pathname || '/'
    } catch {
      /* keep raw */
    }
    const method = (p.method || 'GET').toLowerCase()
    if (!paths[path]) paths[path] = {}
    // 响应参数（来自 response.responseParamsDesc）单独构建 200 响应 schema
    const respProps = {}
    ;(p.respParams || []).forEach((pr) => {
      if (pr.name) respProps[pr.name] = { type: mapType(pr.type), description: pr.desc }
    })
    const okResponse = { description: 'OK' }
    if (Object.keys(respProps).length) {
      okResponse.content = {
        'application/json': { schema: { type: 'object', properties: respProps } }
      }
    }
    const catPathArr = catPaths[String(p.id)] || []
    paths[path][method] = {
      summary: p.title,
      operationId: String(p.id),
      ...(catPathArr.length ? { tags: [catPathArr.join(' / ')] } : {}),
      parameters: (p.params || [])
        .filter((pr) => (pr.kind || 'query') === 'query')
        .map((pr) => ({
          name: pr.name,
          in: 'query',
          required: !!pr.required,
          description: pr.desc,
          schema: { type: mapType(pr.type) }
        })),
      responses: { '200': okResponse }
    }
    // body 参数（非 query）放入 requestBody
    const bodyParams = (p.params || []).filter((pr) => (pr.kind || 'query') !== 'query')
    if (bodyParams.length) {
      const props = {}
      const required = []
      bodyParams.forEach((pr) => {
        if (!pr.name) return
        props[pr.name] = { type: mapType(pr.type), description: pr.desc }
        if (pr.required) required.push(pr.name)
      })
      paths[path][method].requestBody = {
        content: {
          'application/json': {
            schema: { type: 'object', properties: props, ...(required.length ? { required } : {}) }
          }
        }
      }
    }
  })
  return {
    openapi: '3.0.0',
    info: { title: 'ShowDoc API', version: '1.0.0' },
    paths
  }
}

export function toPostman(pages, catalog) {
  const groups = groupPagesByCat(pages)
  const catTree = buildCatTree(catalog)

  const toItem = (p) => ({
    name: p.title,
    request: {
      method: p.method || 'GET',
      url: p.url || '',
      description: (p.params || []).map((x) => `${x.name}: ${x.desc}`).join('\n')
    },
    response: p.respExample
      ? [
          {
            name: '示例响应',
            body: p.respExample,
            _postman_previewlanguage: 'json'
          }
        ]
      : []
  })

  // 递归渲染目录树为 Postman folder（item 嵌套），保留层级
  const renderCat = (node) => ({
    name: node.cat_name,
    item: [
      ...(groups[String(node.cat_id)] || []).map(toItem),
      ...(node.children || []).map(renderCat)
    ]
  })
  const items = catTree.map(renderCat)

  // 未归类页面（catId 为空或不在 catalog 中）
  const catIds = new Set((catalog || []).map((c) => String(c.cat_id)))
  const orphans = pages.filter((p) => {
    const cid = p.catId == null || p.catId === '' || p.catId === 0 || p.catId === '0' ? null : String(p.catId)
    return cid === null || !catIds.has(cid)
  })
  items.push(...orphans.map(toItem))

  return {
    info: {
      name: 'ShowDoc API',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    item: items
  }
}

// 浏览器下载
export function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime || 'text/plain' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(a.href)
}
