<script setup>
import { reactive, ref, watch } from 'vue'
import ShowDocPanel from './components/ShowDocPanel.vue'
import ExportPanel from './components/ExportPanel.vue'
import ApiEditor from './components/ApiEditor.vue'
import OpenApiImport from './components/OpenApiImport.vue'
import { callShowdoc, loadConfig } from './lib/api.js'

const sdConfig = reactive({
  baseUrl: '',
  apiKey: '',
  apiToken: '',
  itemId: '',
  // AI 智能补全配置（单独设置项）
  ai: {
    enabled: false,
    provider: 'openai', // openai | deepseek | qwen | custom
    baseUrl: '',
    apiKey: '',
    model: ''
  }
})

// 本地「我的项目」清单：ShowDoc 开放 API 没有「列出我全部项目」的接口，
// 所以把常用的 item_id + 备注名存在本地，做成下拉选择。
const projects = ref([])

// 启动后从本地配置文件读取上次保存的内容（桌面端走 Go 写文件，网页端走 localStorage）
async function initConfig() {
  let saved = {}
  try {
    saved = (await callShowdoc('loadConfigFile', {})) || {}
  } catch {
    /* ignore */
  }
  // 兼容升级前的旧数据：若文件读取为空（例如尚未用新版本打包），
  // 回退读取浏览器 localStorage 里旧版保存的配置，避免用户之前填写的凭证丢失。
  if (!saved || (typeof saved === 'object' && !saved.baseUrl && !saved.apiKey && !saved.itemId)) {
    try {
      const legacy = JSON.parse(localStorage.getItem('showdoc.config') || 'null')
      if (legacy && typeof legacy === 'object') saved = legacy
      const legacyProj = JSON.parse(localStorage.getItem('showdoc.projects') || '[]')
      if (Array.isArray(legacyProj) && (!saved.projects || !saved.projects.length)) {
        saved.projects = legacyProj
      }
    } catch {
      /* ignore */
    }
  }
  if (saved && typeof saved === 'object') {
    Object.assign(sdConfig, saved)
    if (Array.isArray(saved.projects)) projects.value = saved.projects
  }
  // 私服地址仍为空时，从后端预填默认地址（如本地 PC 客户端 http://localhost:5757）
  if (!sdConfig.baseUrl) {
    loadConfig()
      .then((c) => { if (c.showdocBaseUrl) sdConfig.baseUrl = c.showdocBaseUrl })
      .catch(() => {})
  }
}
initConfig()

// 默认使用明亮主题（覆盖历史 localStorage 中可能存的暗色）
document.documentElement.setAttribute('data-theme', 'light')

// 任何改动都自动持久化到本地（配置文件 / localStorage）
function persist() {
  callShowdoc('saveConfig', {
    baseUrl: sdConfig.baseUrl,
    apiKey: sdConfig.apiKey,
    apiToken: sdConfig.apiToken,
    itemId: sdConfig.itemId,
    ai: sdConfig.ai,
    projects: projects.value
  }).catch(() => {})
}
watch([sdConfig, projects], persist, { deep: true })

// ShowDocPanel 通过事件回传配置增量，这里合并到响应式对象
function applyConfig(part) {
  Object.assign(sdConfig, part)
}

function addProject({ name, itemId, remove }) {
  if (!itemId) return
  const id = String(itemId)
  const idx = projects.value.findIndex((p) => p.itemId === id)
  if (remove) {
    if (idx >= 0) projects.value.splice(idx, 1)
    return
  }
  if (idx >= 0) {
    if (name) projects.value[idx].name = name
  } else {
    projects.value.push({ name: name || `项目 ${id}`, itemId: id })
  }
}

const tree = ref(null)
const sdMessage = ref('')
// 主栏选项卡：导出文档 / 接口查看编辑
const mainTab = ref('export')
// 右上角设置面板开关
const settingsOpen = ref(false)
function toggleSettings() {
  settingsOpen.value = !settingsOpen.value
}

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

      <div class="settings-wrap">
        <button class="settings-btn" :class="{ active: settingsOpen }" @click="toggleSettings">
          <span class="gear">⚙</span> 设置
        </button>
        <transition name="pop">
          <div v-if="settingsOpen" class="settings-pop">
            <ShowDocPanel
              :config="sdConfig"
              :projects="projects"
              :tree="tree"
              :message="sdMessage"
              @update:config="applyConfig"
              @load-tree="loadTree"
              @save-project="addProject"
            />
          </div>
        </transition>
      </div>
    </header>
    <!-- 点击遮罩关闭设置 -->
    <div v-if="settingsOpen" class="pop-overlay" @click="settingsOpen = false"></div>

    <main class="layout">
      <section class="main-col">
        <div class="tabs">
          <button :class="{ active: mainTab === 'export' }" @click="mainTab = 'export'">导出文档</button>
          <button :class="{ active: mainTab === 'editor' }" @click="mainTab = 'editor'">接口查看 / 编辑</button>
          <button :class="{ active: mainTab === 'import' }" @click="mainTab = 'import'">导入 OpenAPI</button>
        </div>

        <ExportPanel v-show="mainTab === 'export'" :tree="tree" :config="sdConfig" />
        <ApiEditor v-if="mainTab === 'editor'" :tree="tree" :config="sdConfig" />
        <OpenApiImport v-if="mainTab === 'import'" :config="sdConfig" @imported="loadTree" />
      </section>
    </main>
  </div>
</template>
