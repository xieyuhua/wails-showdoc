<script setup>
import { ref } from 'vue'

const props = defineProps({
  config: { type: Object, required: true },
  projects: { type: Array, default: () => [] }, // [{ name, itemId }]
  tree: { type: Object, default: null }, // { catalog, pages }
  message: { type: String, default: '' }
})
const emit = defineEmits([
  'update:config',
  'load-tree',
  'save-project'
])

const projName = ref('')

function setConfig(part) {
  emit('update:config', { ...props.config, ...part })
}

function onSaveProject() {
  emit('save-project', { name: projName.value, itemId: props.config.itemId })
  projName.value = ''
}
</script>

<template>
  <div class="showdoc">
    <h3>ShowDoc 私服</h3>

    <div class="sd-form">
      <label>私服地址
        <input :value="config.baseUrl" @input="setConfig({ baseUrl: $event.target.value })"
               placeholder="http://your-showdoc/server" />
      </label>
      <label>api_key
        <input :value="config.apiKey" @input="setConfig({ apiKey: $event.target.value })"
               placeholder="项目设置中的 api_key" />
      </label>
      <label>api_token（密码）
        <input :value="config.apiToken" @input="setConfig({ apiToken: $event.target.value })"
               placeholder="项目设置中的 api_token" type="password" />
      </label>
      <label>项目 ID (item_id)
        <input :value="config.itemId" @input="setConfig({ itemId: $event.target.value })"
               placeholder="可手动输入，或从下方「我的项目」选择" />
      </label>
      <div class="proj-row">
        <select :value="config.itemId" @change="setConfig({ itemId: $event.target.value })">
          <option value="">— 我的项目 —</option>
          <option v-for="p in projects" :key="p.itemId" :value="p.itemId">
            {{ p.name }} ({{ p.itemId }})
          </option>
        </select>
        <input v-model="projName" class="proj-name" placeholder="备注名" />
        <button class="ghost" @click="onSaveProject">存为项目</button>
      </div>
      <button class="primary" @click="$emit('load-tree')">加载接口树</button>
    </div>

    <p v-if="message" class="msg">{{ message }}</p>
  </div>
</template>
