<script setup>
// 可编辑参数表：直接通过对象引用修改外部传入的 rows（名称/类型/必选/说明）。
// 删除时把整行对象回传给父组件，由父组件在正确的源数组中定位删除（请求体参数可能合并自多个数组）。
// aiEnabled=true 时，每个「说明」单元格旁显示 AI 按钮，可一键补全；表头提供「AI 补全全部」。
import { computed } from 'vue'

const props = defineProps({
  title: { type: String, required: true },
  rows: { type: Array, default: () => [] },
  requiredCol: { type: Boolean, default: true },
  aiEnabled: { type: Boolean, default: false },
  aiBusy: { type: Boolean, default: false }
})
const emit = defineEmits(['add', 'remove', 'ai', 'aiAll'])

// 常见字段类型（下拉候选，同时允许自由输入自定义类型）
const COMMON_TYPES = [
  'String', 'Integer', 'Long', 'Number', 'Float', 'Double',
  'Boolean', 'Object', 'Array', 'List', 'Map', 'File', 'Date', 'text', 'json'
]

// 当前已存在的类型若不在候选里，补到列表最前，保证下拉能正确回显
const typeOptions = computed(() => {
  const set = new Set(COMMON_TYPES)
  const extra = []
  props.rows.forEach((r) => {
    const t = r.type
    if (t && !set.has(t)) {
      extra.push(t)
      set.add(t)
    }
  })
  return [...extra, ...COMMON_TYPES]
})
</script>

<template>
  <section class="edit-sec">
    <div class="sec-head">
      <h4>{{ title }}</h4>
      <div class="sec-actions">
        <button v-if="aiEnabled" class="mini ai" type="button" :disabled="aiBusy"
                @click="emit('aiAll', rows)">AI 补全全部</button>
        <button class="mini" type="button" @click="emit('add')">+ 添加一行</button>
      </div>
    </div>
    <table class="edit-table">
      <thead>
        <tr>
          <th>名称</th>
          <th>类型</th>
          <th v-if="requiredCol" class="ctr">必选</th>
          <th>说明</th>
          <th v-if="aiEnabled" class="ctr">AI</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(r, i) in rows" :key="i">
          <td><input v-model="r.name" placeholder="参数名" /></td>
          <td>
            <input v-model="r.type" list="ft-types" class="type-input" placeholder="类型" />
          </td>
          <td v-if="requiredCol" class="ctr">
            <input
              type="checkbox"
              :checked="r.require === '1' || r.require === true"
              @change="r.require = $event.target.checked ? '1' : '0'"
            />
          </td>
          <td class="desc-cell">
            <input v-model="r.remark" placeholder="说明" />
            <button v-if="aiEnabled" class="mini ai sm" type="button" :disabled="aiBusy"
                    :title="'用 AI 补全说明'" @click="emit('ai', r)">AI</button>
          </td>
          <td v-if="aiEnabled" class="ctr"></td>
          <td><button class="mini del" type="button" @click="emit('remove', r)">删除</button></td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="aiEnabled ? (requiredCol ? 6 : 5) : (requiredCol ? 5 : 4)" class="empty">暂无数据</td>
        </tr>
      </tbody>
    </table>
    <datalist id="ft-types">
      <option v-for="t in typeOptions" :key="t" :value="t"></option>
    </datalist>
  </section>
</template>

<style scoped>
.edit-sec {
  margin-top: 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--panel);
}
.sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.sec-head h4 {
  margin: 0;
  font-size: 13px;
  color: var(--text);
}
.sec-actions {
  display: flex;
  gap: 8px;
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
.mini:disabled {
  opacity: .5;
  cursor: not-allowed;
}
.mini.del:hover {
  border-color: var(--danger);
  color: var(--danger);
}
.mini.ai {
  color: var(--accent);
  border-color: var(--accent);
}
.mini.ai.sm {
  padding: 2px 8px;
  font-size: 11px;
}
.edit-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.edit-table th,
.edit-table td {
  border: 1px solid var(--border);
  padding: 5px 6px;
  text-align: left;
  color: var(--text);
  vertical-align: middle;
}
.edit-table th {
  background: var(--panel-2);
  color: var(--muted);
  font-weight: 600;
}
.edit-table td.ctr {
  text-align: center;
}
.edit-table input {
  width: 100%;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 5px 7px;
  color: var(--text);
  font-size: 13px;
}
.edit-table .desc-cell {
  display: flex;
  gap: 6px;
  align-items: center;
}
.edit-table .desc-cell input {
  flex: 1;
  min-width: 0;
}
.edit-table .empty {
  color: var(--muted);
  text-align: center;
  padding: 10px;
}
</style>
