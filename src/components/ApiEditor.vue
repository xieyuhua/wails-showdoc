<script setup>
import { ref, computed, watch } from 'vue'
import { callShowdoc, callAI } from '../lib/api.js'
import { parsePage, decodePageContent } from '../lib/exporters.js'
import ParamTable from './ParamTable.vue'

const props = defineProps({
  tree: { type: Object, default: null }, // { catalog, pages }
  config: { type: Object, default: () => ({}) } // { baseUrl, apiKey, apiToken, itemId }
})

const keyword = ref('')
const open = ref(false)
const selectedMeta = ref(null) // 选中的接口元数据 { page_id, page_title, cat_id }
const selected = ref(null) // 含正文的完整页面对象
const parsed = ref(null) // parsePage 解析后的结构化视图
const mode = ref('view') // 'view' | 'edit'
const loading = ref(false)
const msg = ref('')
const saving = ref(false)
const aiBusy = ref(false)

// 编辑态：RunApi(JSON) 用表格编辑，普通 Markdown 用文本框
const isRunApi = ref(false)
const editContent = ref('') // 普通 Markdown 原文
const editJson = ref(null) // RunApi 解码后的 JSON 对象（按引用直接编辑）
const showJson = ref(false) // 是否展示格式化后的 JSON

// 目录 id -> 名称，用于下拉里显示接口归属
const catNameMap = computed(() => {
  const m = {}
  ;(props.tree?.catalog || []).forEach((c) => {
    m[String(c.cat_id)] = c.cat_name
  })
  return m
})

const pages = computed(() => props.tree?.pages || [])

// 下拉搜索：按标题过滤
const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  const list = !q
    ? pages.value
    : pages.value.filter((p) => (p.page_title || '').toLowerCase().includes(q))
  return list.slice(0, 200) // 防止过多时卡顿
})

function catLabel(catId) {
  const id = catId == null || catId === '' || catId === 0 || catId === '0' ? null : String(catId)
  return id ? catNameMap.value[id] || '' : ''
}

function onFocus() {
  open.value = true
}
function onFocusOut(e) {
  if (e.currentTarget.contains(e.relatedTarget)) return
  open.value = false
}

async function selectPage(page) {
  selectedMeta.value = page
  keyword.value = page.page_title
  open.value = false
  mode.value = 'view'
  await loadContent(page)
}

// 确保 JSON 中某路径是数组（不存在则创建）
function ensureArr(root, path) {
  const parts = path.split('.')
  let cur = root
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {}
    cur = cur[parts[i]]
  }
  const last = parts[parts.length - 1]
  if (!Array.isArray(cur[last])) cur[last] = []
  return cur[last]
}

// 归一化 RunApi 结构：补齐缺失数组，并给请求体参数打上 _src 标记（记录来自哪个数组，便于删除定位）
function normalizeRunApi(obj) {
  const params = obj.request?.params
  if (!params) {
    obj.request = obj.request || {}
    obj.request.params = {}
  }
  const mk = (key) => {
    const arr = ensureArr(obj, 'request.params.' + key)
    arr.forEach((r) => (r._src = key))
    return arr
  }
  mk('formdata')
  mk('urlencoded')
  mk('jsonDesc')
  ensureArr(obj, 'request.params.query')
  ensureArr(obj, 'request.params.headers')
  ensureArr(obj, 'response.responseParamsDesc')
  ensureArr(obj, 'response.responseFailParamsDesc')
  if (obj.response) obj.response.responseExample = obj.response.responseExample || ''
  if (!obj.info) obj.info = {}
  return obj
}

async function loadContent(page) {
  loading.value = true
  msg.value = ''
  parsed.value = null
  selected.value = null
  isRunApi.value = false
  editJson.value = null
  editContent.value = ''
  showJson.value = false
  try {
    const data = await callShowdoc('pages', {
      baseUrl: props.config.baseUrl,
      apiKey: props.config.apiKey,
      apiToken: props.config.apiToken,
      pageIds: [String(page.page_id)]
    })
    const p = (data.pages && data.pages[0]) || null
    if (!p) {
      msg.value = '未获取到接口内容'
      return
    }
    if (p._error) {
      msg.value = '拉取内容失败：' + p._error
      return
    }
    selected.value = p
    parsed.value = parsePage(p)
    // 判断是否为 RunApi（page_content 是带 info 的 JSON）
    const decoded = decodePageContent(p.page_content || '')
    try {
      const obj = JSON.parse(decoded)
      if (obj && typeof obj === 'object' && obj.info) {
        isRunApi.value = true
        // 请求方法默认选中之前解析出的方法（避免编辑时方法被清空）
        if (!obj.info.method) {
          obj.info.method = parsed.value.method || 'GET'
        }
        editJson.value = normalizeRunApi(obj)
      } else {
        editContent.value = decoded
      }
    } catch {
      editContent.value = p.page_content || ''
    }
  } catch (e) {
    msg.value = '拉取内容失败：' + (e.message || e)
  } finally {
    loading.value = false
  }
}

function reload() {
  if (selectedMeta.value) loadContent(selectedMeta.value)
}
function enterEdit() {
  mode.value = 'edit'
  showJson.value = false
}
function cancelEdit() {
  mode.value = 'view'
  if (selected.value) {
    const decoded = decodePageContent(selected.value.page_content || '')
    try {
      const obj = JSON.parse(decoded)
      if (obj && typeof obj === 'object' && obj.info) {
        editJson.value = normalizeRunApi(obj)
      } else {
        editContent.value = decoded
      }
    } catch {
      editContent.value = selected.value.page_content || ''
    }
  }
}

// ── 表格编辑辅助 ──
const P = computed(() => editJson.value?.request?.params || {})
// GET 请求约定无请求体：隐藏「请求体参数」表格，并在切到 GET 时清空已填的请求体参数
const isGet = computed(() => (editJson.value?.info?.method || '').toUpperCase() === 'GET')
function clearBodyParams() {
  const p = editJson.value?.request?.params
  if (!p) return
  ;['formdata', 'urlencoded', 'jsonDesc'].forEach((k) => {
    if (Array.isArray(p[k])) p[k].length = 0
  })
}
watch(isGet, (g) => {
  if (g) clearBodyParams()
})
const bodyRows = computed(() => [...(P.value.formdata || []), ...(P.value.urlencoded || []), ...(P.value.jsonDesc || [])])
const queryRows = computed(() => P.value.query || [])
const headerRows = computed(() => P.value.headers || [])
const respRows = computed(() => editJson.value?.response?.responseParamsDesc || [])
const respFailRows = computed(() => editJson.value?.response?.responseFailParamsDesc || [])

function blankRow(src) {
  return { name: '', type: '', require: '0', remark: '', ...(src ? { _src: src } : {}) }
}
function addBody() {
  P.value.formdata.push(blankRow('formdata'))
}
function delBodyRow(row) {
  const src = P.value[row._src]
  const i = src ? src.indexOf(row) : -1
  if (i >= 0) src.splice(i, 1)
}
function addTo(arr) {
  arr.push(blankRow())
}
function delRef(arr, row) {
  const i = arr.indexOf(row)
  if (i >= 0) arr.splice(i, 1)
}

// 去掉编辑期间打的 _src 标记，返回干净对象
function cleanJson(o) {
  const c = JSON.parse(JSON.stringify(o))
  const strip = (x) => {
    if (Array.isArray(x)) x.forEach(strip)
    else if (x && typeof x === 'object') {
      delete x._src
      Object.values(x).forEach(strip)
    }
  }
  strip(c)
  return c
}
const formattedJson = computed(() => (editJson.value ? JSON.stringify(cleanJson(editJson.value), null, 2) : ''))

async function save() {
  if (!selectedMeta.value) return
  if (!props.config.itemId) {
    msg.value = '请先填写 item_id'
    return
  }
  let content
  if (isRunApi.value && editJson.value) {
    // GET 请求约定无请求体，保存前兜底清空
    if (isGet.value) clearBodyParams()
    content = formattedJson.value
  } else {
    content = editContent.value
  }
  saving.value = true
  msg.value = ''
  try {
    const data = await callShowdoc('update', {
      baseUrl: props.config.baseUrl,
      apiKey: props.config.apiKey,
      apiToken: props.config.apiToken,
      itemId: props.config.itemId,
      pageId: String(selectedMeta.value.page_id),
      catId: String(selectedMeta.value.cat_id || ''),
      pageTitle: selectedMeta.value.page_title,
      pageContent: content
    })
    if (data.error) {
      msg.value = data.error
    } else {
      msg.value = '已更新接口内容 ✓'
      selected.value = { ...selected.value, page_content: content }
      parsed.value = parsePage(selected.value)
      mode.value = 'view'
    }
  } catch (e) {
    msg.value = '更新失败：' + (e.message || e)
  } finally {
    saving.value = false
  }
}

function copyJson() {
  if (navigator.clipboard) navigator.clipboard.writeText(formattedJson.value).catch(() => {})
}

// ── AI 一键补全参数说明 ──
// 调用后端 /api/ai/fill（网页模式）或 Go App.AiFill（桌面端），返回与入参对齐的说明数组。
function aiEnabled() {
  return !!(props.config.ai && props.config.ai.enabled)
}
async function aiFill(rows) {
  if (!aiEnabled()) {
    msg.value = '请先在右上角「设置 → AI 智能补全设置」中开启并填写 API Key'
    return
  }
  const targets = rows.filter((r) => (r.name || '').trim() && !(r.remark || '').trim())
  if (!targets.length) {
    msg.value = '没有需要补全的空说明（仅补全「有参数名且无说明」的行）'
    return
  }
  const items = targets.map((r) => ({ name: r.name, type: r.type, remark: r.remark }))
  const context = {
    title: parsed.value?.title,
    method: parsed.value?.method,
    url: parsed.value?.url
  }
  aiBusy.value = true
  msg.value = 'AI 补全中…'
  try {
    const res = await callAI({
      ai: {
        baseUrl: props.config.ai.baseUrl,
        apiKey: props.config.ai.apiKey,
        model: props.config.ai.model
      },
      context,
      items
    })
    if (res.error) {
      msg.value = res.error
      return
    }
    const descs = res.descriptions || []
    targets.forEach((r, i) => {
      if (descs[i]) r.remark = descs[i]
    })
    const filled = descs.filter((d) => d && d.trim()).length
    msg.value = `AI 已补全 ${filled} 条说明 ✓`
  } catch (e) {
    msg.value = 'AI 补全失败：' + (e.message || e)
  } finally {
    aiBusy.value = false
  }
}
function onAiFill(row) {
  aiFill([row])
}
function onAiFillAll(rows) {
  aiFill(rows)
}

// 切换项目/接口树时清空
watch(
  () => props.tree,
  () => {
    selectedMeta.value = null
    selected.value = null
    parsed.value = null
    keyword.value = ''
    msg.value = ''
    mode.value = 'view'
  }
)
</script>

<template>
  <div class="panel api-editor">
    <h3>接口查看 / 编辑</h3>

    <p v-if="!tree" class="hint">先在左侧「加载接口树」，再选择接口。</p>

    <template v-else>
      <!-- 下拉搜索选择 -->
      <div class="combobox" @focusout="onFocusOut">
        <input
          class="combo-input"
          :value="keyword"
          @input="(e) => { keyword = e.target.value; open = true }"
          @focus="onFocus"
          placeholder="搜索接口名称…"
          autocomplete="off"
        />
        <ul v-if="open && filtered.length" class="combo-list">
          <li
            v-for="p in filtered"
            :key="p.page_id"
            class="combo-item"
            :class="{ active: selectedMeta && String(selectedMeta.page_id) === String(p.page_id) }"
            @mousedown.prevent="selectPage(p)"
          >
            <span class="ci-title">{{ p.page_title }}</span>
            <span v-if="catLabel(p.cat_id)" class="ci-cat">{{ catLabel(p.cat_id) }}</span>
          </li>
        </ul>
        <div v-else-if="open" class="combo-empty">没有匹配的接口</div>
      </div>

      <p v-if="msg" class="msg" :class="{ err: msg.includes('失败') }">{{ msg }}</p>

      <div v-if="loading" class="hint">加载中…</div>

      <template v-if="selected && parsed">
        <!-- 基本信息 -->
        <div class="api-basic">
          <span class="method" :class="(parsed.method || '').toLowerCase()">{{ parsed.method || '—' }}</span>
          <span class="url">{{ parsed.url || '（无地址）' }}</span>
        </div>

        <!-- 操作按钮 -->
        <div class="api-actions">
          <button class="link" @click="reload">重新加载</button>
          <button v-if="mode === 'view'" class="link" @click="enterEdit">编辑</button>
        </div>

        <!-- 查看模式 -->
        <div v-if="mode === 'view'" class="api-view">
          <section v-if="parsed.params && parsed.params.length">
            <h4>请求参数</h4>
            <table class="kv-table">
              <thead><tr><th>名称</th><th>必选</th><th>类型</th><th>位置</th><th>说明</th></tr></thead>
              <tbody>
                <tr v-for="(r, i) in parsed.params" :key="i">
                  <td>{{ r.name }}</td>
                  <td>{{ r.required ? '是' : '否' }}</td>
                  <td>{{ r.type }}</td>
                  <td>{{ r.kind || 'query' }}</td>
                  <td>{{ r.desc }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section v-if="parsed.headers && parsed.headers.length">
            <h4>请求头</h4>
            <table class="kv-table">
              <thead><tr><th>名称</th><th>必选</th><th>类型</th><th>说明</th></tr></thead>
              <tbody>
                <tr v-for="(r, i) in parsed.headers" :key="i">
                  <td>{{ r.name }}</td>
                  <td>{{ r.required ? '是' : '否' }}</td>
                  <td>{{ r.type }}</td>
                  <td>{{ r.desc }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section v-if="parsed.respParams && parsed.respParams.length">
            <h4>响应参数</h4>
            <table class="kv-table">
              <thead><tr><th>名称</th><th>类型</th><th>说明</th></tr></thead>
              <tbody>
                <tr v-for="(r, i) in parsed.respParams" :key="i">
                  <td>{{ r.name }}</td>
                  <td>{{ r.type }}</td>
                  <td>{{ r.desc }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section v-if="parsed.respFailParams && parsed.respFailParams.length">
            <h4>失败响应参数</h4>
            <table class="kv-table">
              <thead><tr><th>名称</th><th>类型</th><th>说明</th></tr></thead>
              <tbody>
                <tr v-for="(r, i) in parsed.respFailParams" :key="i">
                  <td>{{ r.name }}</td>
                  <td>{{ r.type }}</td>
                  <td>{{ r.desc }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section v-if="parsed.respExample">
            <h4>响应示例</h4>
            <pre class="code">{{ parsed.respExample }}</pre>
          </section>

          <section v-if="!parsed.params?.length && !parsed.headers?.length && !parsed.respParams?.length && !parsed.respExample">
            <p class="hint">该接口无结构化参数（普通 Markdown 文档）。可点击「编辑」查看/修改原始内容。</p>
          </section>
        </div>

        <!-- 编辑模式：RunApi 表格编辑 -->
        <div v-else-if="isRunApi && editJson" class="api-edit">
          <div class="edit-basic">
            <label>接口标题<input v-model="editJson.info.title" placeholder="接口标题" /></label>
            <label class="method-label">请求方法
              <select v-model="editJson.info.method">
                <option v-for="m in ['GET','POST','PUT','DELETE','PATCH','HEAD','OPTIONS']" :key="m" :value="m">{{ m }}</option>
              </select>
            </label>
            <label class="url-label">请求地址<input v-model="editJson.info.url" placeholder="https://..." /></label>
            <label class="desc-label">描述
              <textarea class="body-text sm" v-model="editJson.info.description" placeholder="接口说明（可选）"></textarea>
            </label>
          </div>

          <ParamTable v-if="!isGet" title="请求体参数" :rows="bodyRows" :ai-enabled="aiEnabled()" :ai-busy="aiBusy" @add="addBody" @remove="delBodyRow" @ai="onAiFill" @ai-all="onAiFillAll" />
          <p v-else class="hint body-empty">GET 请求无请求体，参数请填写在「查询参数」中。</p>
          <ParamTable title="查询参数" :rows="queryRows" :ai-enabled="aiEnabled()" :ai-busy="aiBusy" @add="addTo(P.query)" @remove="(r) => delRef(P.query, r)" @ai="onAiFill" @ai-all="onAiFillAll" />
          <ParamTable title="请求头" :rows="headerRows" :ai-enabled="aiEnabled()" :ai-busy="aiBusy" @add="addTo(P.headers)" @remove="(r) => delRef(P.headers, r)" @ai="onAiFill" @ai-all="onAiFillAll" />
          <ParamTable title="响应参数" :rows="respRows" :required-col="false" :ai-enabled="aiEnabled()" :ai-busy="aiBusy" @add="addTo(editJson.response.responseParamsDesc)" @remove="(r) => delRef(editJson.response.responseParamsDesc, r)" @ai="onAiFill" @ai-all="onAiFillAll" />
          <ParamTable title="失败响应参数" :rows="respFailRows" :required-col="false" :ai-enabled="aiEnabled()" :ai-busy="aiBusy" @add="addTo(editJson.response.responseFailParamsDesc)" @remove="(r) => delRef(editJson.response.responseFailParamsDesc, r)" @ai="onAiFill" @ai-all="onAiFillAll" />

          <section class="edit-sec">
            <h4>响应示例</h4>
            <textarea class="body-text" v-model="editJson.response.responseExample" placeholder="成功响应示例（JSON 等）"></textarea>
          </section>

          <div class="api-actions">
            <button class="mini" type="button" @click="showJson = !showJson">
              {{ showJson ? '隐藏格式化 JSON' : '查看格式化 JSON' }}
            </button>
            <button class="mini" type="button" @click="copyJson">复制 JSON</button>
          </div>
          <pre v-if="showJson" class="code">{{ formattedJson }}</pre>

          <div class="api-actions save-row">
            <button class="primary" :disabled="saving" @click="save">
              {{ saving ? '保存中…' : '保存更新' }}
            </button>
            <button class="link" @click="cancelEdit">取消</button>
          </div>
        </div>

        <!-- 编辑模式：普通 Markdown 文本框 -->
        <div v-else class="api-edit">
          <label class="edit-label">页面内容（ShowDoc 原始内容）
            <textarea class="body-text" v-model="editContent"></textarea>
          </label>
          <div class="api-actions save-row">
            <button class="primary" :disabled="saving" @click="save">
              {{ saving ? '保存中…' : '保存更新' }}
            </button>
            <button class="link" @click="cancelEdit">取消</button>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.combobox {
  position: relative;
}
.combo-input {
  width: 100%;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  color: var(--text);
  font-size: 13px;
}
.combo-list {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 240px;
  overflow: auto;
  list-style: none;
  margin: 0;
  padding: 4px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
}
.combo-item {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 9px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text);
}
.combo-item:hover,
.combo-item.active {
  background: var(--panel-2);
}
.ci-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ci-cat {
  flex: none;
  font-size: 11px;
  color: var(--muted);
  background: var(--panel-2);
  border-radius: 10px;
  padding: 0 7px;
}
.combo-empty {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  padding: 10px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--muted);
  font-size: 13px;
}
.api-basic {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 14px 0 8px;
  flex-wrap: wrap;
}
.method {
  font-weight: 700;
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 6px;
  background: var(--panel-2);
  color: var(--accent);
}
.method.get { color: var(--accent-2); }
.method.post { color: var(--warn); }
.method.put { color: #ff8fab; }
.method.delete { color: var(--danger); }
.url {
  color: var(--text);
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 13px;
  word-break: break-all;
}
.api-actions {
  display: flex;
  gap: 12px;
  margin: 8px 0;
  align-items: center;
}
.api-actions .link {
  border: none;
  background: none;
  color: var(--accent);
  cursor: pointer;
  padding: 0;
  font-size: 13px;
}
.api-actions .link:hover {
  text-decoration: underline;
}
.api-actions.save-row {
  margin-top: 14px;
}
.api-view h4 {
  margin: 16px 0 6px;
  color: var(--text);
  font-size: 13px;
}
.kv-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.kv-table th,
.kv-table td {
  border: 1px solid var(--border);
  padding: 6px 8px;
  text-align: left;
  color: var(--text);
  vertical-align: top;
}
.kv-table th {
  background: var(--panel-2);
  color: var(--muted);
  font-weight: 600;
}
/* 编辑：基础信息 */
.edit-basic {
  display: grid;
  grid-template-columns: 1fr 120px;
  gap: 10px;
  margin-top: 12px;
}
.edit-basic label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--muted);
  font-size: 12px;
}
.edit-basic input,
.edit-basic select {
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 7px 9px;
  color: var(--text);
  font-size: 13px;
}
.edit-basic .url-label,
.edit-basic .desc-label {
  grid-column: 1 / -1;
}
.edit-basic .desc-label .body-text {
  min-height: 64px;
}
.body-text.sm {
  min-height: 56px;
  resize: vertical;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  color: var(--text);
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 13px;
}
.mini {
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--text);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.mini:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.edit-label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--muted);
  font-size: 12px;
  margin-top: 8px;
}
.msg.err {
  color: var(--danger);
}
</style>
