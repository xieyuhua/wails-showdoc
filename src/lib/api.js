// 统一的 ShowDoc 后端调用封装：
//  - Wails 桌面模式：调用 Go 暴露的 window.go.main.App 方法
//  - 网页模式：fetch /api/showdoc/* （由 node server 提供，兼容原有 dev/preview 流程）
const isWails = () => !!(window.go && window.go.main && window.go.main.App)

async function callShowdoc(action, payload) {
  if (isWails()) {
    const App = window.go.main.App
    try {
      if (action === 'tree') {
        return (await App.GetTree(payload.baseUrl, payload.apiKey, payload.apiToken, payload.itemId)) || {}
      }
      if (action === 'pages') {
        return (
          (await App.GetPages(payload.baseUrl, payload.apiKey, payload.apiToken, payload.pageIds)) || {}
        )
      }
    } catch (e) {
      return { error: (e && e.message) || String(e) }
    }
  }
  const res = await fetch('/api/showdoc/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  return res.json()
}

export async function loadConfig() {
  if (isWails()) {
    try {
      return (await window.go.main.App.GetConfig()) || {}
    } catch {
      return {}
    }
  }
  try {
    const r = await fetch('/api/config')
    return await r.json()
  } catch {
    return {}
  }
}

export { callShowdoc, isWails }
