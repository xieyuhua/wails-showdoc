<script setup>
import { ref } from 'vue'

const props = defineProps({
  config: { type: Object, required: true },
  projects: { type: Array, default: () => [] }, // [{ name, itemId }]
  tree: { type: Object, default: null },
  message: { type: String, default: '' }
})
const emit = defineEmits([
  'update:config',
  'load-tree',
  'save-project'
])

const projName = ref('')
const showToken = ref(false)
const showAiToken = ref(false)

const AI_PRESETS = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
}

function setConfig(part) {
  emit('update:config', { ...props.config, ...part })
}
// 嵌套更新 ai 配置（保证其余 ai 字段不丢失）
function setAi(part) {
  emit('update:config', { ...props.config, ai: { ...props.config.ai, ...part } })
}
function onAiProvider(e) {
  const p = e.target.value
  const next = { provider: p }
  if (p !== 'custom' && AI_PRESETS[p]) next.baseUrl = AI_PRESETS[p]
  setAi(next)
}

function onSaveProject() {
  emit('save-project', { name: projName.value, itemId: props.config.itemId })
  projName.value = ''
}

function removeProject(itemId) {
  emit('save-project', { name: '', itemId, remove: true })
}
</script>

<template>
  <div class="showdoc">
    <div class="sd-head">
      <div class="sd-title">
        <span class="sd-ico">⚙</span>
        <div>
          <div class="sd-h">ShowDoc 私服配置</div>
          <div class="sd-sub">连接你的私有 ShowDoc，加载接口树</div>
        </div>
      </div>
    </div>

    <div class="sd-form">
      <label class="fld">
        <span class="lbl">私服地址</span>
        <input :value="config.baseUrl" @input="setConfig({ baseUrl: $event.target.value })"
               placeholder="http://your-showdoc/server" spellcheck="false" />
      </label>

      <label class="fld">
        <span class="lbl">api_key</span>
        <input :value="config.apiKey" @input="setConfig({ apiKey: $event.target.value })"
               placeholder="项目设置中的 api_key" spellcheck="false" />
      </label>

      <label class="fld">
        <span class="lbl">api_token（密码）</span>
        <div class="pw">
          <input :type="showToken ? 'text' : 'password'"
                 :value="config.apiToken" @input="setConfig({ apiToken: $event.target.value })"
                 placeholder="项目设置中的 api_token" spellcheck="false" />
          <button type="button" class="pw-toggle" @click="showToken = !showToken">
            {{ showToken ? '隐藏' : '显示' }}
          </button>
        </div>
      </label>

      <label class="fld">
        <span class="lbl">项目 ID (item_id)</span>
        <input :value="config.itemId" @input="setConfig({ itemId: $event.target.value })"
               placeholder="可手动输入，或从下方「我的项目」选择" spellcheck="false" />
      </label>

      <div class="proj">
        <div class="proj-top">
          <select :value="config.itemId" @change="setConfig({ itemId: $event.target.value })">
            <option value="">— 选择我的项目 —</option>
            <option v-for="p in projects" :key="p.itemId" :value="p.itemId">
              {{ p.name }} ({{ p.itemId }})
            </option>
          </select>
          <button class="x" v-if="config.itemId && projects.find(p => p.itemId === config.itemId)"
                  :title="'移除该项目'"
                  @click="removeProject(config.itemId)">✕</button>
        </div>
        <div class="proj-add">
          <input v-model="projName" placeholder="备注名（可留空）" @keyup.enter="onSaveProject" />
          <button class="ghost" @click="onSaveProject">存为项目</button>
        </div>
      </div>

      <button class="primary" @click="$emit('load-tree')">加载接口树</button>
    </div>

    <details class="ai-box">
      <summary>
        <span class="ai-ico">✦</span> AI 智能补全设置
        <span class="ai-state" :class="{ on: config.ai?.enabled }">{{ config.ai?.enabled ? '已开启' : '未开启' }}</span>
      </summary>
      <div class="ai-form">
        <label class="ai-row ai-enable">
          <input type="checkbox" :checked="config.ai?.enabled" @change="setAi({ enabled: $event.target.checked })" />
          <span>启用 AI 一键补全参数说明</span>
        </label>

        <label class="ai-row">
          <span class="lbl">服务商</span>
          <select :value="config.ai?.provider" @change="onAiProvider">
            <option value="openai">OpenAI</option>
            <option value="deepseek">DeepSeek</option>
            <option value="qwen">通义千问</option>
            <option value="custom">自定义（OpenAI 协议）</option>
          </select>
        </label>

        <label class="ai-row">
          <span class="lbl">API Key</span>
          <div class="pw">
            <input :type="showAiToken ? 'text' : 'password'"
                   :value="config.ai?.apiKey" @input="setAi({ apiKey: $event.target.value })"
                   placeholder="sk-..." spellcheck="false" />
            <button type="button" class="pw-toggle" @click="showAiToken = !showAiToken">
              {{ showAiToken ? '隐藏' : '显示' }}
            </button>
          </div>
        </label>

        <label class="ai-row">
          <span class="lbl">模型</span>
          <input :value="config.ai?.model" @input="setAi({ model: $event.target.value })"
                 :placeholder="config.ai?.provider === 'deepseek' ? 'deepseek-chat' : config.ai?.provider === 'qwen' ? 'qwen-plus' : 'gpt-4o-mini'"
                 spellcheck="false" />
        </label>

        <label class="ai-row">
          <span class="lbl">API 地址</span>
          <input :value="config.ai?.baseUrl" @input="setAi({ baseUrl: $event.target.value })"
                 placeholder="https://api.openai.com/v1" spellcheck="false" />
        </label>
        <p class="ai-tip">支持任意 OpenAI 协议接口；密钥仅保存在本地，由后端代理调用，不会写入文档。</p>
      </div>
    </details>

    <transition name="fade">
      <div v-if="message" class="msg" :class="{ ok: message.startsWith('已加载') }">{{ message }}</div>
    </transition>

    <p class="saved-tip">配置自动保存到本地，关闭后下次自动恢复</p>
  </div>
</template>
