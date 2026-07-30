// ──────────────────────────────────────────────────────────────
// 把 OpenAPI / Swagger 规范解析成「标准化 ShowDoc(RunApi) 接口文档」
//
// 目标：
//  1. 规范格式：每个 path+method 转成一个 RunApi 风格页面（info/request/response），
//     参数、请求体、响应结构都落到 RunApi 约定的字段里，可直接回写 ShowDoc。
//  2. 规范目录：用 OpenAPI 的 tags 作为目录层级（tag 里的 "/" 拆成多级目录），
//     没有 tag 时回退到 path 第一段作为目录，保证接口一定挂在目录下面。
//
// 输入：解析后的 OpenAPI 对象（openapi 3.x 或 swagger 2.0）
// 输出：{ title, version, baseUrl, pages:[{ pageTitle, method, url, catPath, pageContent }] }
//   - catPath：目录路径数组，如 ['用户管理', '账号']
//   - pageContent：RunApi 的 JSON 字符串
// ──────────────────────────────────────────────────────────────

function stripSlash(s) {
  return String(s || '').replace(/\/+$/, '')
}

// OpenAPI 类型 → ShowDoc(RunApi) 参数类型字符串
function mapType(t) {
  const s = (t || '').toLowerCase()
  if (/int|number|float|double|long|digit/.test(s)) return 'number'
  if (/bool/.test(s)) return 'boolean'
  if (/array|list|\[\]/.test(s)) return 'array'
  if (/object|map|json/.test(s)) return 'object'
  if (/file|binary|upload|image|filepath|file_path/.test(s)) return 'file'
  return 'string'
}

// 按 schema 生成一个示例值（用于响应示例）
function defaultSample(schema) {
  if (!schema || typeof schema !== 'object') return null
  if (schema.example !== undefined) return schema.example
  if (schema.default !== undefined) return schema.default
  const t = mapType(schema.type)
  if (t === 'number') return schema.minimum !== undefined ? schema.minimum : 0
  if (t === 'boolean') return false
  if (t === 'array') {
    const it = schema.items || {}
    const one = defaultSample(it)
    return one === null || one === undefined ? [] : [one]
  }
  if (t === 'object') {
    const obj = {}
    const props = schema.properties || {}
    for (const k of Object.keys(props)) obj[k] = defaultSample(props[k])
    return obj
  }
  return ''
}

// 把 schema.properties 展平成 RunApi 参数行（对象/数组嵌套用点号展开）
function flattenSchema(schema, required, prefix) {
  const rows = []
  const props = (schema && schema.properties) || {}
  const req = new Set(required || [])
  for (const name of Object.keys(props)) {
    const p = props[name] || {}
    const full = prefix ? `${prefix}.${name}` : name
    const t = mapType(p.type)
    rows.push({
      name: full,
      type: t,
      require: req.has(name) ? '1' : '0',
      remark: p.description || ''
    })
    if (p.properties) {
      rows.push(...flattenSchema(p, p.required || [], full))
    } else if (t === 'array' && p.items && p.items.properties) {
      rows.push(...flattenSchema(p.items, p.items.required || [], `${full}[]`))
    }
  }
  return rows
}

function toRow(pr, kind) {
  return {
    name: pr.name || '',
    type: mapType(pr.type),
    require: pr.required ? '1' : '0',
    remark: pr.description || ''
  }
}

function buildOperationParts(op, isV3) {
  const query = []
  const headers = []
  const pathParams = []
  let jsonRows = []
  let formRows = []
  let urlRows = []

  for (const pr of op.parameters || []) {
    if (pr.in === 'query') query.push(toRow(pr, 'query'))
    else if (pr.in === 'header') headers.push(toRow(pr, 'header'))
    else if (pr.in === 'path') pathParams.push(toRow(pr, 'query'))
    else if (pr.in === 'formData') formRows.push(toRow(pr, 'formdata'))
    else if (pr.in === 'body') {
      // swagger 2.0 的 body 参数
      const schema = pr.schema || {}
      jsonRows = flattenSchema(schema, schema.required || [], '')
    }
  }

  if (isV3 && op.requestBody && op.requestBody.content) {
    const content = op.requestBody.content
    if (content['application/json'] && content['application/json'].schema) {
      const s = content['application/json'].schema
      jsonRows = flattenSchema(s, s.required || [], '')
    } else if (content['multipart/form-data'] && content['multipart/form-data'].schema) {
      const s = content['multipart/form-data'].schema
      formRows = flattenSchema(s, s.required || [], '')
    } else if (content['application/x-www-form-urlencoded'] && content['application/x-www-form-urlencoded'].schema) {
      const s = content['application/x-www-form-urlencoded'].schema
      urlRows = flattenSchema(s, s.required || [], '')
    }
  }

  // 路径参数：放进 query 行并标注（ShowDoc RunApi 无独立的 path 类型）
  pathParams.forEach((r) => {
    r.require = '1'
    r.remark = (r.remark ? r.remark + '；' : '') + '(路径参数)'
    query.push(r)
  })

  return { query, headers, jsonRows, formRows, urlRows }
}

function buildResponseParts(responses) {
  const respParams = []
  let respExample = ''
  const failParams = []
  if (!responses) return { respParams, respExample, failParams }

  const ok = responses['200'] || responses['201'] || responses['2xx'] || responses['default']
  if (ok) {
    const schema =
      (ok.content && (ok.content['application/json'] || ok.content['application/*+json']))?.schema ||
      ok.schema // swagger 2.0
    if (schema) {
      respParams.push(...flattenSchema(schema, schema.required || [], ''))
      try {
        respExample = JSON.stringify(defaultSample(schema), null, 2)
      } catch {
        respExample = ''
      }
      if (ok.example !== undefined) {
        try {
          respExample = JSON.stringify(ok.example, null, 2)
        } catch {
          /* ignore */
        }
      }
    } else if (ok.example !== undefined) {
      try {
        respExample = JSON.stringify(ok.example, null, 2)
      } catch {
        /* ignore */
      }
    }
  }

  // 失败响应：优先 400 / 4xx
  const failKey = Object.keys(responses).find((k) => /^4\d\d$/.test(k)) || '400'
  const fail = responses[failKey]
  if (fail) {
    const schema =
      (fail.content && (fail.content['application/json'] || fail.content['application/*+json']))?.schema ||
      fail.schema
    if (schema) failParams.push(...flattenSchema(schema, schema.required || [], ''))
  }
  return { respParams, respExample, failParams }
}

// 由 operation 生成单个 ShowDoc 页面所需字段
function buildPage(method, path, op, baseUrl, isV3) {
  const info = op.info || op
  const summary = op.summary || op.operationId || ''
  const description = op.description || ''
  const pageTitle = (summary || `${method.toUpperCase()} ${path}`).trim()

  // 目录：优先用 tags（tag 内 "/" 拆成多级目录），否则回退 path 第一段
  let catPath = []
  if (Array.isArray(op.tags) && op.tags.length) {
    catPath = op.tags[0]
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  if (!catPath.length) {
    const seg = String(path).split('/').filter(Boolean)[0]
    if (seg) catPath = [seg]
  }

  const { query, headers, jsonRows, formRows, urlRows } = buildOperationParts(op, isV3)

  // 组装 RunApi 标准结构
  const runapi = {
    info: {
      method: method.toUpperCase(),
      url: (baseUrl ? stripSlash(baseUrl) : '') + path,
      title: pageTitle,
      description
    },
    request: {
      params: {
        query,
        headers,
        formdata: formRows,
        urlencoded: urlRows,
        jsonDesc: jsonRows
      }
    },
    response: {
      responseParamsDesc: [],
      responseFailParamsDesc: [],
      responseExample: ''
    }
  }
  const { respParams, respExample, failParams } = buildResponseParts(op.responses)
  runapi.response.responseParamsDesc = respParams
  runapi.response.responseFailParamsDesc = failParams
  runapi.response.responseExample = respExample

  return {
    method: method.toUpperCase(),
    url: runapi.info.url,
    pageTitle,
    catPath,
    pageContent: JSON.stringify(runapi)
  }
}

// 主入口：解析 OpenAPI 规范
export function parseOpenApi(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('OpenAPI 内容为空或不是合法的 JSON 对象')
  }
  const isV3 = !!spec.openapi
  const isV2 = !!spec.swagger && String(spec.swagger).startsWith('2')
  if (!isV3 && !isV2) {
    throw new Error('未识别为 OpenAPI/Swagger 规范（缺少 openapi 或 swagger 字段）')
  }

  const info = spec.info || {}
  const title = info.title || 'OpenAPI 文档'
  const version = info.version || '1.0.0'

  // 推断 baseUrl（用于拼接请求地址）
  let baseUrl = ''
  if (isV3 && spec.servers && spec.servers[0] && spec.servers[0].url) {
    baseUrl = stripSlash(spec.servers[0].url)
  } else if (isV2 && spec.host) {
    const scheme = (spec.schemes && spec.schemes[0]) || 'https'
    baseUrl = stripSlash(`${scheme}://${spec.host}${spec.basePath || ''}`)
  }

  const paths = spec.paths || {}
  const pages = []
  const methods = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options']
  for (const path of Object.keys(paths)) {
    const pathItem = paths[path] || {}
    // path 级别的公共参数（如公共 header）
    for (const method of methods) {
      const op = pathItem[method]
      if (!op || typeof op !== 'object') continue
      const page = buildPage(method, path, op, baseUrl, isV3)
      pages.push(page)
    }
  }

  if (!pages.length) {
    throw new Error('规范中没有解析到任何接口（paths 为空或格式异常）')
  }

  return { title, version, baseUrl, pages }
}

// 把导入解析出的 pages 重新组织成「目录 → 页面」的预览树，便于 UI 展示
export function buildImportPreview(pages) {
  const root = { name: '', children: {}, pages: [] }
  const walk = (parts) => {
    let node = root
    for (const seg of parts) {
      if (!node.children[seg]) node.children[seg] = { name: seg, children: {}, pages: [] }
      node = node.children[seg]
    }
    return node
  }
  pages.forEach((pg, idx) => {
    const parts = pg.catPath && pg.catPath.length ? pg.catPath : ['(未分类)']
    walk(parts).pages.push({ ...pg, _idx: idx })
  })
  const toArray = (node) =>
    Object.keys(node.children)
      .sort()
      .map((k) => {
        const n = node.children[k]
        return { name: n.name, children: toArray(n), pages: n.pages }
      })
  return toArray(root)
}
