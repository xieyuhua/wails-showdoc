<script setup>
import { reactive, ref, watch } from 'vue'
import ShowDocPanel from './components/ShowDocPanel.vue'
import ExportPanel from './components/ExportPanel.vue'
import { callShowdoc, loadConfig } from './lib/api.js'

const sdConfig = reactive({
  baseUrl: '',
  apiKey: '',
  apiToken: '',
  itemId: ''
})

// 从浏览器本地读取上次填写的 ShowDoc 配置（避免每次刷新重填 / 不必改配置文件）
try {
  const saved = JSON.parse(localStorage.getItem('showdoc.config') || 'null')
  if (saved && typeof saved === 'object') Object.assign(sdConfig, saved)
} catch {
  /* ignore */
}
// 任何改动都自动存回本地
watch(
  sdConfig,
  (v) => localStorage.setItem('showdoc.config', JSON.stringify(v)),
  { deep: true }
)

// 页面私服地址为空时，从后端预填默认地址（如本地 PC 客户端 http://localhost:5757）
if (!sdConfig.baseUrl) {
  loadConfig()
    .then((c) => { if (c.showdocBaseUrl) sdConfig.baseUrl = c.showdocBaseUrl })
    .catch(() => {})
}

// 默认使用明亮主题（覆盖历史 localStorage 中可能存的暗色）
document.documentElement.setAttribute('data-theme', 'light')

// ShowDocPanel 通过事件回传配置增量，这里合并到响应式对象
function applyConfig(part) {
  Object.assign(sdConfig, part)
}

// 本地「我的项目」清单：ShowDoc 开放 API 没有「列出我全部项目」的接口，
// 所以把常用的 item_id + 备注名存在本地，做成下拉选择。
const projects = ref([])
try {
  const p = JSON.parse(localStorage.getItem('showdoc.projects') || '[]')
  if (Array.isArray(p)) projects.value = p
} catch {
  /* ignore */
}
function addProject({ name, itemId }) {
  if (!itemId) return
  const id = String(itemId)
  const found = projects.value.find((p) => p.itemId === id)
  if (found) {
    if (name) found.name = name
  } else {
    projects.value.push({ name: name || `项目 ${id}`, itemId: id })
    localStorage.setItem('showdoc.projects', JSON.stringify(projects.value))
  }
}

const tree = ref(null)
const sdMessage = ref('')

async function loadTree() {
  sdMessage.value = ''
  if (!sdConfig.itemId) {
    sdMessage.value = '请先填写 item_id'
    return
  }
  if (!sdConfig.baseUrl) {
    sdMessage.value = '请先填写 ShowDoc 私服地址'
    return
  }
  try {
    const data = await callShowdoc('tree', { ...sdConfig })
    if (data.error) {
      sdMessage.value = data.error
    } else if (data.raw) {
      // 能连通但没解析出接口：把原始结构提示给用户
      tree.value = data
      sdMessage.value =
        '已连通 ShowDoc，但未解析到接口页面（返回结构可能不是预期格式）。请确认 item_id 是否正确，或在浏览器控制台查看返回结构。'
      console.warn('[ShowDoc] 原始返回：', data.raw)
    } else {
      tree.value = data
      sdMessage.value = `已加载 ${data.catalog.length} 个目录 / ${data.pages.length} 个接口页面`
    }
  } catch (e) {
    sdMessage.value = '加载失败：' + e.message
  }
}
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="logo">ShowDoc 文档导出</div>
      <div class="tagline">连接私服 · 加载接口树 · 一键导出多格式文档</div>
    </header>

    <main class="layout">
      <aside class="side-col">
        <ShowDocPanel
          :config="sdConfig"
          :projects="projects"
          :tree="tree"
          :message="sdMessage"
          @update:config="applyConfig"
          @load-tree="loadTree"
          @save-project="addProject"
        />
      </aside>

      <section class="main-col">
        <ExportPanel :tree="tree" :config="sdConfig" />
      </section>
    </main>
  </div>
</template>
