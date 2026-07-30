<template>
  <div class="imp">
    <div class="hint">
      将 OpenAPI / Swagger 规范导入为
      <b>标准 ShowDoc(RunApi) 接口文档</b>：自动按 <b>tags</b> 生成多级目录（tag 中的
      <code>/</code> 会拆成子目录），每个 path+method 生成一个 RunApi 接口页。
    </div>

    <!-- 配置来源提示 -->
    <div class="cfg" v-if="cfgReady">
      目标项目：<code>{{ config.baseUrl }}</code> · item_id
      <code>{{ config.itemId || '（未填）' }}</code>
    </div>
    <div class="cfg warn" v-else>
      请先在「ShowDoc 配置」中填写私服地址、apiKey / apiToken 与 item_id。
    </div>

    <!-- 输入区 -->
    <div class="field">
      <div class="flabel">OpenAPI / Swagger 内容（JSON）</div>
      <textarea
        v-model="rawText"
        class="ta"
        placeholder='粘贴 OpenAPI 3.x 或 Swagger 2.0 的 JSON，例如：{"openapi":"3.0.0","info":{"title":"示例","version":"1.0"},"paths":{...}}'
      ></textarea>
      <div class="filebar">
        <label class="btn btn-sm">
          选择 .json 文件
          <input type="file" accept=".json,application/json" @change="onFile" hidden />
        </label>
        <span class="muted">或把文件内容粘到上方文本框</span>
        <span style="flex: 1"></span>
        <button class="btn btn-sm" @click="clearAll">清空</button>
        <button class="btn btn-primary btn-sm" :disabled="!rawText.trim()" @click="doParse">
          解析
        </button>
      </div>
      <div class="err" v-if="parseError">{{ parseError }}</div>
    </div>

    <!-- 解析结果预览 -->
    <div class="result" v-if="parsed">
      <div class="stats">
        <div class="stat"><span class="num">{{ parsed.title }}</span><span class="lbl">文档标题</span></div>
        <div class="stat"><span class="num">{{ parsed.version }}</span><span class="lbl">版本</span></div>
        <div class="stat">
          <span class="num">{{ parsed.pages.length }}</span><span class="lbl">接口数</span>
        </div>
        <div class="stat" v-if="parsed.baseUrl">
          <span class="num" :title="parsed.baseUrl">{{ shortUrl(parsed.baseUrl) }}</span
          ><span class="lbl">Base URL</span>
        </div>
      </div>

      <div class="preview-head">
        <span>导入目录结构预览</span>
        <span class="muted">{{ dirCount }} 个目录</span>
      </div>
      <div class="tree">
        <div
          v-for="(row, i) in previewRows"
          :key="i"
          class="trow"
          :style="{ paddingLeft: 12 + row.depth * 18 + 'px' }"
        >
          <template v-if="row.type === 'dir'">
            <span class="ico">📁</span>
            <span class="dir">{{ row.name }}</span>
            <span class="badge dir-badge">{{ row.pageCount }}</span>
          </template>
          <template v-else>
            <span class="ico">📄</span>
            <span class="m-badge" :class="'m-' + row.method.toLowerCase()">{{ row.method }}</span>
            <span class="pname">{{ row.name }}</span>
          </template>
        </div>
      </div>

      <div class="actions">
        <button
          class="btn btn-primary"
          :disabled="!canImport || importing"
          @click="doImport"
        >
          {{ importing ? '导入中…' : '导入到 ShowDoc' }}
        </button>
        <span class="muted" v-if="!canImport && cfgReady">请先解析出接口</span>
        <span class="muted" v-if="!cfgReady">请先在「ShowDoc 配置」填好 item_id</span>
      </div>

      <div class="ok" v-if="result && !result.error">
        导入完成：新建 <b>{{ result.created }}</b> 个接口，失败
        <b>{{ result.failed }}</b> 个（共 {{ result.total }} 个）。
        <button class="btn btn-sm" @click="emit('imported')">刷新左侧目录</button>
      </div>
      <div class="err" v-if="result && result.error">{{ result.error }}</div>
      <div class="err" v-if="result && result.errors && result.errors.length">
        <div>失败明细：</div>
        <div v-for="(e, i) in result.errors" :key="i" class="errline">{{ e }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { parseOpenApi, buildImportPreview } from '../lib/importers'
import { importOpenapi } from '../lib/api'

const props = defineProps({
  config: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['imported'])

const rawText = ref('')
const parsed = ref(null)
const parseError = ref('')
const importing = ref(false)
const result = ref(null)

const config = computed(() => props.config || {})
const cfgReady = computed(
  () => !!(config.value.baseUrl && config.value.apiKey && config.value.apiToken && config.value.itemId)
)
const canImport = computed(() => !!parsed.value && parsed.value.pages.length > 0 && cfgReady.value)

const previewRows = computed(() => {
  if (!parsed.value) return []
  const flat = []
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      flat.push({ type: 'dir', name: n.name, depth, pageCount: n.pages.length })
      for (const p of n.pages) {
        flat.push({ type: 'page', name: p.pageTitle, depth: depth + 1, method: p.method })
      }
      walk(n.children, depth + 1)
    }
  }
  walk(buildImportPreview(parsed.value.pages), 0)
  return flat
})

const dirCount = computed(() => previewRows.value.filter((r) => r.type === 'dir').length)

function shortUrl(u) {
  return u.length > 28 ? u.slice(0, 25) + '…' : u
}

function onFile(e) {
  const f = e.target.files && e.target.files[0]
  if (!f) return
  const reader = new FileReader()
  reader.onload = () => {
    rawText.value = String(reader.result || '')
  }
  reader.readAsText(f)
  e.target.value = ''
}

function clearAll() {
  rawText.value = ''
  parsed.value = null
  parseError.value = ''
  result.value = null
}

function doParse() {
  parseError.value = ''
  result.value = null
  try {
    const spec = JSON.parse(rawText.value)
    parsed.value = parseOpenApi(spec)
  } catch (err) {
    parsed.value = null
    parseError.value = err.message || String(err)
  }
}

async function doImport() {
  if (!canImport.value) return
  importing.value = true
  result.value = null
  try {
    const r = await importOpenapi({
      baseUrl: config.value.baseUrl,
      apiKey: config.value.apiKey,
      apiToken: config.value.apiToken,
      itemId: config.value.itemId,
      pages: parsed.value.pages
    })
    result.value = r
  } catch (err) {
    result.value = { error: (err && err.message) || String(err) }
  } finally {
    importing.value = false
  }
}
</script>

<style scoped>
.imp {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.hint {
  font-size: 13px;
  color: #475569;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 12px;
  line-height: 1.6;
}
.hint code,
.cfg code,
.m-badge.small {
  background: #e2e8f0;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
}
.cfg {
  font-size: 13px;
  color: #334155;
}
.cfg.warn {
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  padding: 8px 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.flabel {
  font-size: 13px;
  font-weight: 600;
  color: #334155;
}
.ta {
  width: 100%;
  min-height: 180px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.5;
  padding: 10px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  box-sizing: border-box;
  outline: none;
}
.ta:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}
.filebar {
  display: flex;
  align-items: center;
  gap: 10px;
}
.muted {
  color: #94a3b8;
  font-size: 12px;
}
.btn {
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #334155;
  padding: 7px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
}
.btn:hover {
  background: #f8fafc;
}
.btn-sm {
  padding: 6px 12px;
  font-size: 12.5px;
}
.btn-primary {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}
.btn-primary:hover {
  background: #1d4ed8;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.err {
  color: #b91c1c;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12.5px;
  line-height: 1.5;
}
.errline {
  padding-left: 8px;
}
.result {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.stats {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.stat {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 10px 14px;
  min-width: 92px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.stat .num {
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
}
.stat .lbl {
  font-size: 11.5px;
  color: #94a3b8;
}
.preview-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  color: #334155;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 6px;
}
.tree {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  padding: 6px 4px;
  max-height: 320px;
  overflow: auto;
}
.trow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 13px;
}
.trow:hover {
  background: #f8fafc;
}
.ico {
  font-size: 13px;
}
.dir {
  font-weight: 600;
  color: #334155;
}
.badge {
  margin-left: auto;
  font-size: 11px;
  background: #e2e8f0;
  color: #475569;
  padding: 1px 8px;
  border-radius: 999px;
}
.pname {
  color: #475569;
}
.m-badge {
  font-size: 10.5px;
  font-weight: 700;
  color: #fff;
  padding: 2px 6px;
  border-radius: 4px;
  min-width: 44px;
  text-align: center;
}
.m-get {
  background: #16a34a;
}
.m-post {
  background: #2563eb;
}
.m-put {
  background: #d97706;
}
.m-delete {
  background: #dc2626;
}
.m-patch {
  background: #7c3aed;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ok {
  color: #166534;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
</style>
