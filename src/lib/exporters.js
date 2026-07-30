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
    // RunApi 字段可能带 value / default（示例值）；优先 value 再 default
    value: p.value != null && p.value !== '' ? p.value : p.default != null ? p.default : '',
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
  const bodyForm = hasBody ? pick(pb.formdata, 'body') : []
  const bodyUrl = hasBody ? pick(pb.urlencoded, 'body') : []
  const bodyJson = hasBody ? pick(pb.jsonDesc, 'body') : []
  const body = [...bodyForm, ...bodyUrl, ...bodyJson]
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
    bodyForm,
    bodyUrl,
    bodyJson,
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
      bodyForm: runapi.bodyForm,
      bodyUrl: runapi.bodyUrl,
      bodyJson: runapi.bodyJson,
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

// 统一读取页面的目录 ID：兼容 ShowDoc 原始字段 cat_id 与解析后的 catId
export function getCatId(p) {
  const cid = p.catId != null ? p.catId : p.cat_id
  return cid == null || cid === '' || cid === 0 || cid === '0' ? null : String(cid)
}

// 页面按 cat_id 分组（null/空/0 归到 null）
export function groupPagesByCat(pages) {
  const groups = {}
  pages.forEach((p) => {
    const cid = getCatId(p)
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
    const cid = getCatId(p)
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
  if (/file|binary|upload|image|filepath|file_path/.test(s)) return 'file'
  return 'string'
}

// 把 RunApi 字段的「字符串值」按 schema 类型强制转换成对应 JS 类型，
// 使导出的 example 与 type 严格匹配（如 type=number 时 example 应为数字 18，而非 "18"）。
function coerceExample(value, type) {
  if (value === '' || value == null) return undefined
  if (type === 'number') {
    const n = Number(value)
    return Number.isNaN(n) ? value : n
  }
  if (type === 'boolean') {
    if (value === 'true' || value === true || value === 1 || value === '1') return true
    if (value === 'false' || value === false || value === 0 || value === '0') return false
    return value
  }
  if (type === 'array') {
    try {
      const a = JSON.parse(value)
      return Array.isArray(a) ? a : value
    } catch {
      return value
    }
  }
  if (type === 'object') {
    try {
      const o = JSON.parse(value)
      return o && typeof o === 'object' ? o : value
    } catch {
      return value
    }
  }
  return value // string 原样返回
}

// 单个参数的 schema。OpenAPI 要求 array 必须带 items、object 必须带 properties，
// 否则校验不过；file 类型按 multipart 的 string(binary) 处理。
// 同时把字段的「值」（RunApi 的 value/default）作为 example 写进 schema，
// 这样导出的 OpenAPI 既含「字段 + 类型」，也含「示例值」，且 example 类型与 type 一致。
function toSchema(pr) {
  const desc = pr.desc || pr.description || ''
  const base = desc ? { description: desc } : {}
  const type = mapType(pr.type)
  // 字段示例值：优先参数自带的 value/default
  let raw = pr.value
  if (raw === '' || raw == null) {
    const ex = pr['x-example'] || pr.example
    if (ex != null && ex !== '') raw = ex
  }
  // 没有值（或未填写）时，统一给默认空字符串 ""，保证文档中每个字段都有示例占位，
  // 避免 Swagger UI 等工具里字段缺失 example 而显示为空。
  const example = raw !== '' && raw != null ? coerceExample(raw, type) : ''
  base.example = example
  if (type === 'array') {
    // items 的类型优先沿用数组元素类型提示（如 int[] 取 int），否则 string
    const itemType = (pr.type || '').replace(/\[\]$/, '').trim()
    const it = itemType ? mapType(itemType) : 'string'
    const items = { type: it === 'array' ? 'string' : it }
    // items 示例：取数组示例的首个元素（如 [1,2] -> 1），与 itemType 匹配
    if (Array.isArray(example) && example.length) items.example = example[0]
    return { ...base, type: 'array', items }
  }
  if (type === 'object') {
    return { ...base, type: 'object', properties: {} }
  }
  if (type === 'file') {
    return { ...base, type: 'string', format: 'binary' }
  }
  return { ...base, type: type || 'string' }
}

// 把 ShowDoc 的 URL 规范化成 OpenAPI 的 (path, server)：
//  - 完整 URL 提取 origin 作为 server，path 取 pathname
//  - 模板 URL（ShowDoc 常见，如 {{host}}/v2_api/... 或 {host}/...）开头的环境变量
//    占位符原样保留（如 '{{host}}'）作为 server，剩余部分作为 path，避免被误转成 {host}
//  - :param 风格（RunApi 常见）转成 {param}（OpenAPI 标准路径参数语法）
function normalizeUrl(urlStr) {
  const raw = urlStr || '/'
  let server = null
  let path = raw
  try {
    const u = new URL(raw)
    server = u.origin // 如 https://api.example.com
    path = u.pathname
  } catch {
    // 模板 URL：开头为变量占位符（{{var}} 或 {var}）时，原样保留为 server，
    // 剩余路径部分继续走 :param 规范化。
    const m = raw.match(/^(\{+[A-Za-z_][A-Za-z0-9_]*\}+)(.*)$/)
    if (m) {
      server = m[1] // 保留原样，如 '{{host}}'
      path = m[2] || '/'
    }
  }
  path = path.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, '{$1}')
  if (!path) path = '/'
  return { path, server }
}

function buildParameter(pr, loc) {
  const schema = toSchema(pr)
  const p = {
    name: pr.name,
    in: loc,
    schema
  }
  // OpenAPI 3.0 规范：参数示例应放在 Parameter 顶层（与 schema 平级），
  // 而非塞进 schema 内部；故把 example 从 schema 上移到参数层。
  if (schema.example !== undefined) {
    p.example = schema.example
    delete schema.example
  }
  if (loc !== 'path' && pr.required) p.required = true
  if (pr.desc || pr.description) p.description = pr.desc || pr.description
  return p
}

function tryJson(value) {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function makeOperationId(p) {
  const slug = (p.title || p.url || 'op')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'op'}-${p.id || Math.random().toString(36).slice(2, 8)}`
}

// 生成符合 OpenAPI 3.0.3 标准的文档。
// options: { title, version, servers }，未提供时从页面 URL 自动推断 server。
export function toOpenApi(pages, catalog, options) {
  const opts = options || {}
  const paths = {}
  const catPaths = buildCatPaths(catalog)

  // 推断 server：
  //  - 完整 URL 提取 origin（仅当所有接口同源才使用，避免多域名强行合并）
  //  - 模板 URL（如 {{host}}/...）开头的占位符原样保留为 server url，不转成 {host}
  const originSet = new Set()
  const templateServers = new Set()
  pages.forEach((p) => {
    const { server } = normalizeUrl(p.url)
    if (!server) return
    if (server.startsWith('{')) templateServers.add(server)
    else originSet.add(server)
  })
  let servers = []
  if (opts.servers && opts.servers.length) {
    servers = opts.servers
  } else if (templateServers.size) {
    // 模板占位符（如 {{host}}）原样输出为 server，保留 ShowDoc 环境变量写法（优先于完整 URL）
    servers = [...templateServers].map((url) => ({ url }))
  } else if (originSet.size === 1) {
    servers = [{ url: [...originSet][0] }]
  }

  pages.forEach((p) => {
    const { path } = normalizeUrl(p.url)
    const method = (p.method || 'GET').toLowerCase()
    if (!paths[path]) paths[path] = {}
    if (paths[path][method]) return // 同 path+method 已存在则跳过，避免覆盖

    // ── parameters：query + header + path ──
    const parameters = []
    // query 参数（来自 params 中 kind==='query'）
    ;(p.params || []).forEach((pr) => {
      // 无 kind（普通 Markdown 文档）默认按 query 处理，避免参数被整体丢弃
      if ((!pr.kind || pr.kind === 'query') && pr.name) parameters.push(buildParameter(pr, 'query'))
    })
    // header 参数（之前被完全忽略，这里补上）
    ;(p.headers || []).forEach((pr) => {
      if (pr.name) parameters.push(buildParameter(pr, 'header'))
    })
    // path 参数：从 URL 模板里的 {xxx} 推导，必须 required。
    // 注意 ShowDoc 里 Host 等变量常写成「双花括号」{{host}}，故用 replace 剥掉所有
    // 包裹的花括号（而不是 slice(1,-1) 只去一层），避免残留多余的 { 或 }。
    const pathNames = (path.match(/\{[^}]+\}/g) || [])
      .map((s) => s.replace(/[{}]/g, '').trim())
      .filter(Boolean)
    pathNames.forEach((name) => {
      parameters.push({ name, in: 'path', required: true, schema: { type: 'string', example: '' } })
    })

    // ── requestBody：按原始类型区分 content-type ──
    const form = p.bodyForm || []
    const urlenc = p.bodyUrl || []
    const json = p.bodyJson || []
    // 优先 json，其次 form-data，再 urlencoded
    let contentType = null
    let src = []
    if (json.length) {
      contentType = 'application/json'
      src = json
    } else if (form.length) {
      contentType = 'multipart/form-data'
      src = form
    } else if (urlenc.length) {
      contentType = 'application/x-www-form-urlencoded'
      src = urlenc
    }
    if (!src.length && p.params) {
      // 兼容普通 Markdown 文档：没有分类 body 时，把 kind==='body' 的当作 JSON
      const fallback = p.params.filter((x) => x.kind === 'body')
      if (fallback.length) {
        contentType = 'application/json'
        src = fallback
      }
    }
    let requestBody
    if (src.length && contentType) {
      const props = {}
      const required = []
      src.forEach((pr) => {
        if (!pr.name) return
        props[pr.name] = toSchema(pr)
        if (pr.required) required.push(pr.name)
      })
      // OpenAPI 规范：requestBody 有 required 字段（缺省 false）。
      // 存在必填 body 字段时显式标记为 true，更贴合标准。
      requestBody = {
        ...(required.length ? { required: true } : {}),
        content: {
          [contentType]: {
            schema: {
              type: 'object',
              properties: props,
              ...(required.length ? { required } : {})
            }
          }
        }
      }
    }

    // ── responses ──
    const respProps = {}
    ;(p.respParams || []).forEach((pr) => {
      if (pr.name) respProps[pr.name] = toSchema(pr)
    })
    const okResponse = { description: '成功' }
    if (Object.keys(respProps).length) {
      okResponse.content = {
        'application/json': { schema: { type: 'object', properties: respProps } }
      }
    }
    if (p.respExample) {
      okResponse.content = okResponse.content || {
        'application/json': { schema: { type: 'object' } }
      }
      okResponse.content['application/json'].example = tryJson(p.respExample)
    }
    const responses = { '200': okResponse }
    if ((p.respFailParams || []).length) {
      const failProps = {}
      p.respFailParams.forEach((pr) => {
        if (pr.name) failProps[pr.name] = toSchema(pr)
      })
      responses['400'] = {
        description: '失败响应',
        content: { 'application/json': { schema: { type: 'object', properties: failProps } } }
      }
    }

    // ── operation 组装 ──
    const catPathArr = catPaths[getCatId(p)] || []
    const op = {
      operationId: makeOperationId(p),
      summary: p.title,
      ...(catPathArr.length ? { tags: [catPathArr.join(' / ')] } : {}),
      ...(parameters.length ? { parameters } : {}),
      ...(requestBody ? { requestBody } : {}),
      responses
    }
    // 清理 undefined 字段，保证产物干净
    Object.keys(op).forEach((k) => op[k] === undefined && delete op[k])

    paths[path][method] = op
  })

  const doc = {
    openapi: '3.0.3',
    info: { title: opts.title || 'ShowDoc API', version: opts.version || '1.0.0' },
    paths
  }
  if (servers.length) doc.servers = servers
  return doc
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
    const cid = getCatId(p)
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
