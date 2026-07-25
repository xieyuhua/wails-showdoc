<script setup>
import { computed } from 'vue'

const props = defineProps({
  catalog: { type: Array, default: () => [] }, // [{ cat_id, cat_name, level, parent_cat_id }]
  pages: { type: Array, default: () => [] } // [{ page_id, page_title, cat_id }]
})

// 按 parent_cat_id 把目录构建成层级树（根节点 parent 为空/0/null）
const tree = computed(() => {
  const cats = props.catalog || []
  const byParent = new Map()
  cats.forEach((c) => {
    const pid = c.parent_cat_id == null || c.parent_cat_id === '' || c.parent_cat_id === 0 || c.parent_cat_id === '0'
      ? null
      : String(c.parent_cat_id)
    if (!byParent.has(pid)) byParent.set(pid, [])
    byParent.get(pid).push(c)
  })
  const build = (pid) =>
    (byParent.get(pid) || []).map((c) => ({
      ...c,
      children: build(String(c.cat_id))
    }))
  return build(null)
})

// 每个目录下的页面（cat_id 匹配，未归类归到 null）
const pagesByCat = computed(() => {
  const m = new Map()
  m.set(null, [])
  ;(props.pages || []).forEach((p) => {
    const cid = p.cat_id == null || p.cat_id === '' || p.cat_id === 0 || p.cat_id === '0' ? null : String(p.cat_id)
    if (!m.has(cid)) m.set(cid, [])
    m.get(cid).push(p)
  })
  return m
})
</script>

<template>
  <ul class="tree">
    <li v-if="!catalog.length && !pagesByCat.get(null)?.length" class="empty">该项目下暂无目录与接口</li>

    <!-- 没有归入任何目录的页面（顶层） -->
    <li
      v-for="p in pagesByCat.get(null) || []"
      :key="'top-' + p.page_id"
      class="node page top"
    >
      <span class="ico">📄</span><span class="name">{{ p.page_title }}</span>
    </li>

    <!-- 目录层级树 -->
    <template v-for="node in tree" :key="node.cat_id">
      <li class="node cat" :style="{ paddingLeft: 8 + (Number(node.level) || 1) * 14 + 'px' }">
        <span class="ico">📁</span>
        <span class="name">{{ node.cat_name }}</span>
        <span class="cnt">{{ (pagesByCat.get(String(node.cat_id)) || []).length }}</span>
      </li>
      <li
        v-for="p in pagesByCat.get(String(node.cat_id)) || []"
        :key="node.cat_id + '-' + p.page_id"
        class="node page"
        :style="{ paddingLeft: 8 + ((Number(node.level) || 1) + 1) * 14 + 'px' }"
      >
        <span class="ico">📄</span><span class="name">{{ p.page_title }}</span>
      </li>
      <!-- 子目录递归 -->
      <template v-for="child in node.children" :key="child.cat_id">
        <li class="node cat" :style="{ paddingLeft: 8 + (Number(child.level) || 1) * 14 + 'px' }">
          <span class="ico">📁</span>
          <span class="name">{{ child.cat_name }}</span>
          <span class="cnt">{{ (pagesByCat.get(String(child.cat_id)) || []).length }}</span>
        </li>
        <li
          v-for="p in pagesByCat.get(String(child.cat_id)) || []"
          :key="child.cat_id + '-' + p.page_id"
          class="node page"
          :style="{ paddingLeft: 8 + ((Number(child.level) || 1) + 1) * 14 + 'px' }"
        >
          <span class="ico">📄</span><span class="name">{{ p.page_title }}</span>
        </li>
      </template>
    </template>
  </ul>
</template>

<style scoped>
.tree {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
}
.node {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
}
.node:last-child {
  border-bottom: none;
}
.node.cat {
  font-weight: 600;
  background: rgba(79, 140, 255, 0.08);
}
.node.page .ico {
  opacity: 0.75;
}
.ico {
  flex: none;
  font-size: 12px;
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cnt {
  flex: none;
  font-size: 11px;
  color: var(--muted);
  background: var(--panel);
  border-radius: 10px;
  padding: 0 7px;
}
.empty {
  padding: 12px;
  color: var(--muted);
}
</style>
