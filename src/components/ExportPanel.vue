<script setup>
import { reactive, ref, computed, watch } from 'vue'
import { parsePage, toMarkdown, toHtml, toOpenApi, toPostman, download, buildCatTree, groupPagesByCat } from '../lib/exporters.js'
import { callShowdoc } from '../lib/api.js'

const props = defineProps({
  tree: { type: Object, default: null }, // { catalog, pages }
  config: { type: Object, default: () => ({}) } // { baseUrl, apiKey, apiToken }
})

const FORMATS = [
  { v: 'markdown', label: 'Markdown (.md)', file: 'showdoc-api.md', mime: 'text/markdown' },
  { v: 'html', label: 'HTML 网页 (.html)', file: 'showdoc-api.html', mime: 'text/html' },
  { v: 'openapi', label: 'OpenAPI 3.0 (.json)', file: 'openapi.json', mime: 'application/json' },
  { v: 'postman', label: 'Postman 2.1 (.json)', file: 'postman.json', mime: 'application/json' }
]

const format = ref('markdown')
const selected = reactive({}) // { [pageId]: true }
const msg = ref('')

watch(
  () => props.tree,
  (t) => {
    Object.keys(selected).forEach((k) => delete selected[k])
    ;(t?.pages || []).forEach((p) => (selected[p.page_id] = true))
    msg.value = ''
  },
  { immediate: true }
)

const allSelected = computed(
  () => !!props.tree && props.tree.pages.length > 0 && props.tree.pages.every((p) => selected[p.page_id])
)

// 折叠状态：存已折叠的目录 cat_id（默认全部展开）
const collapsed = reactive(new Set())
function toggleCollapse(catId) {
  const id = String(catId)
  if (collapsed.has(id)) collapsed.delete(id)
  else collapsed.add(id)
}

// 按目录层级分组展示：复用 exporters 的 buildCatTree / groupPagesByCat，避免重复实现
const grouped = computed(() => {
  const catTree = buildCatTree(props.tree?.catalog || [])
  const groups = groupPagesByCat(props.tree?.pages || [])
  const pagesByCat = new Map()
  for (const [k, v] of Object.entries(groups)) {
    pagesByCat.set(k === 'null' ? null : k, v)
  }
  return { catTree, pagesByCat }
})

// 收集某目录节点下（含所有子目录）的全部 page_id
function collectPageIds(node) {
  const { pagesByCat } = grouped.value
  let ids = (pagesByCat.get(String(node.cat_id)) || []).map((p) => p.page_id)
  ;(node.children || []).forEach((c) => {
    ids = ids.concat(collectPageIds(c))
  })
  return ids
}

// 把目录树 + 页面拍平成带缩进深度的可见行（受折叠状态约束），支持任意层级
const flatRows = computed(() => {
  const { catTree, pagesByCat } = grouped.value
  const rows = []
  // 未归入任何目录的顶层页面
  ;(pagesByCat.get(null) || []).forEach((p) => rows.push({ type: 'page', page: p, depth: 0 }))
  const walk = (nodes, depth) => {
    nodes.forEach((node) => {
      const isCollapsed = collapsed.has(String(node.cat_id))
      const childPages = pagesByCat.get(String(node.cat_id)) || []
      rows.push({
        type: 'cat',
        cat: node,
        depth,
        pageIds: collectPageIds(node),
        collapsed: isCollapsed,
        hasChildren: childPages.length > 0 || (node.children || []).length > 0
      })
      // 折叠时不再渲染该目录下的页面与子目录
      if (!isCollapsed) {
        childPages.forEach((p) => rows.push({ type: 'page', page: p, depth: depth + 1 }))
        walk(node.children || [], depth + 1)
      }
    })
  }
  walk(catTree, 0)
  return rows
})

function isChecked(id) {
  return !!selected[id]
}
function toggle(id) {
  selected[id] = !selected[id]
}
function toggleAll() {
  const v = !allSelected.value
  props.tree.pages.forEach((p) => (selected[p.page_id] = v))
}

// 目录级勾选：全选中 / 半选 / 一键切换其下所有接口
function catChecked(ids) {
  return ids.length > 0 && ids.every((id) => selected[id])
}
function catIndeterminate(ids) {
  const n = ids.filter((id) => selected[id]).length
  return n > 0 && n < ids.length
}
function toggleCat(ids) {
  const v = !catChecked(ids)
  ids.forEach((id) => (selected[id] = v))
}

// 全部展开 / 折叠：遍历当前目录树收集所有 cat_id
function collapseAll(fold) {
  const { catTree } = grouped.value
  const walk = (nodes) => {
    nodes.forEach((n) => {
      const id = String(n.cat_id)
      if (fold) collapsed.add(id)
      else collapsed.delete(id)
      walk(n.children || [])
    })
  }
  walk(catTree)
}

async function doExport() {
  if (!props.tree) {
    msg.value = '请先「加载接口树」'
    return
  }
  const pages = props.tree.pages.filter((p) => selected[p.page_id])
  if (!pages.length) {
    msg.value = '请至少勾选一个接口'
    return
  }

  // 拉取选中页的正文（ShowDoc 的 item/info 只给元数据，正文需逐页 getItemPageContent）
  let fullPages = pages
  try {
    const data = await callShowdoc('pages', {
      baseUrl: props.config.baseUrl,
      apiKey: props.config.apiKey,
      apiToken: props.config.apiToken,
      pageIds: pages.map((p) => p.page_id)
    })
    if (data.pages) {
      const contentMap = {}
      let failed = 0
      for (const p of data.pages) {
        if (p._error) failed++
        else contentMap[String(p.page_id)] = p.page_content || ''
      }
      fullPages = pages.map((p) => ({
        ...p,
        page_content: contentMap[String(p.page_id)] || ''
      }))
      if (failed) msg.value = `有 ${failed} 个页面正文拉取失败，已尽量导出其余内容`
    }
  } catch (e) {
    msg.value = '拉取正文失败，将仅导出标题：' + e.message
  }

  const parsed = fullPages.map(parsePage)
  const f = FORMATS.find((x) => x.v === format.value)
  let content
  if (format.value === 'markdown') content = toMarkdown(parsed, props.tree.catalog)
  else if (format.value === 'html') content = toHtml(parsed, props.tree.catalog)
  else if (format.value === 'openapi') content = JSON.stringify(toOpenApi(parsed, props.tree.catalog), null, 2)
  else content = JSON.stringify(toPostman(parsed, props.tree.catalog), null, 2)

  download(f.file, content, f.mime)
  if (!msg.value) msg.value = `已导出 ${pages.length} 个接口 → ${f.file}`
}
</script>

<template>
  <div class="panel export">
    <h3>导出接口文档</h3>

    <p v-if="!tree" class="hint">先在上方「加载接口树」，再选择导出格式。</p>

    <template v-else>
      <div class="sub">导出格式</div>
      <div class="fmt">
        <label v-for="f in FORMATS" :key="f.v">
          <input type="radio" :value="f.v" v-model="format" />
          {{ f.label }}
        </label>
      </div>

      <div class="sub">
        选择接口
        <label class="all"><input type="checkbox" :checked="allSelected" @change="toggleAll" /> 全选</label>
        <span class="fold-actions">
          <button type="button" class="link" @click="collapseAll(true)">全部折叠</button>
          <button type="button" class="link" @click="collapseAll(false)">全部展开</button>
        </span>
      </div>
      <ul class="exp-list">
        <template v-for="(row, i) in flatRows" :key="i">
          <!-- 目录行：整行可点击折叠/展开；复选框独立用于勾选其下全部接口（含子目录） -->
          <li
            v-if="row.type === 'cat'"
            class="cat-head"
            :class="{ collapsed: row.collapsed, empty: !row.hasChildren }"
            :style="{ paddingLeft: 8 + row.depth * 16 + 'px' }"
            @click="row.hasChildren && toggleCollapse(row.cat.cat_id)"
          >
            <span class="fold-btn" :class="{ empty: !row.hasChildren }">{{ row.collapsed ? '▸' : '▾' }}</span>
            <input
              type="checkbox"
              class="cat-chk"
              :checked="catChecked(row.pageIds)"
              :indeterminate.prop="catIndeterminate(row.pageIds)"
              @change.stop="toggleCat(row.pageIds)"
            />
            <span class="cat-name">📁 {{ row.cat.cat_name }}</span>
            <span class="cnt">{{ row.pageIds.length }}</span>
          </li>
          <!-- 接口行 -->
          <li v-else class="cat-group" :style="{ paddingLeft: 8 + row.depth * 16 + 'px' }">
            <label>
              <input type="checkbox" :checked="isChecked(row.page.page_id)" @change="toggle(row.page.page_id)" />
              <span class="pg-title">{{ row.page.page_title }}</span>
            </label>
          </li>
        </template>

        <li v-if="!tree.pages.length" class="hint">该项目下暂无接口页面</li>
      </ul>

      <button class="primary" @click="doExport">导出为 {{ FORMATS.find(x=>x.v===format).label }}</button>
    </template>

    <p v-if="msg" class="msg">{{ msg }}</p>
  </div>
</template>
