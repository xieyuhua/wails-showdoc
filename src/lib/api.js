// 统一的 ShowDoc 后端调用封装：
//  - Wails 桌面模式：调用 Go 暴露的 window.go.main.App 方法
//  - 网页模式：fetch /api/showdoc/* （由 node server 提供，兼容原有 dev/preview 流程）
const isPureBrowser = () => typeof window === 'undefined' || !window.go

// Wails 注入 window.go.main.App 需要一点时间，这里轮询等待（桌面端）；
// 纯浏览器环境下 window.go 永远不存在，应立即走网页分支。
function waitWails(timeoutMs = 3000) {
  return new Promise((resolve) => {
    if (window.go && window.go.main && window.go.main.App) return resolve(true)
    const start = Date.now()
    const timer = setInterval(() => {
      if (window.go && window.go.main && window.go.main.App) {
        clearInterval(timer)
        resolve(true)
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer)
        resolve(false)
      }
    }, 50)
  })
}

// 网页模式：用 localStorage 模拟本地存储，其余动作走 node server（并容错空响应）
async function webMode(action, payload) {
  if (action === 'saveConfig') {
    localStorage.setItem('showdoc.config', JSON.stringify(payload))
    return {}
  }
  if (action === 'loadConfigFile') {
    try {
      return JSON.parse(localStorage.getItem('showdoc.config') || '{}')
    } catch {
      return {}
    }
  }
  try {
    const res = await fetch('/api/showdoc/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const text = await res.text()
    if (!text) return {}
    try {
      return JSON.parse(text)
    } catch {
      return { error: 'ShowDoc 服务返回的内容不是 JSON（请确认私服地址/服务是否正常）' }
    }
  } catch (e) {
    return { error: (e && e.message) || String(e) }
  }
}

async function callShowdoc(action, payload) {
  // 纯浏览器：直接走网页分支
  if (isPureBrowser()) return webMode(action, payload)
  // 桌面端：等待绑定就绪，避免过早调用回落到 fetch 导致空响应报错
  if (!window.go.main || !window.go.main.App) {
    await waitWails()
  }
  if (!window.go.main || !window.go.main.App) return webMode(action, payload)

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
    if (action === 'update') {
      return (
        (await App.UpdatePage(
          payload.baseUrl,
          payload.apiKey,
          payload.apiToken,
          payload.itemId,
          payload.pageId,
          payload.catId,
          payload.pageTitle,
          payload.pageContent
        )) || {}
      )
    }
    if (action === 'saveConfig') {
      // 无需返回内容，仅持久化到本地
      await App.SaveConfig(payload)
      return {}
    }
    if (action === 'loadConfigFile') {
      return (await App.LoadConfigFile()) || {}
    }
  } catch (e) {
    return { error: (e && e.message) || String(e) }
  }
  // 未知 action 在桌面端不应发生
  return {}
}

export async function loadConfig() {
  const hasApp = () => window.go && window.go.main && window.go.main.App
  if (hasApp()) {
    try {
      return (await window.go.main.App.GetConfig()) || {}
    } catch {
      return {}
    }
  }
  if (isPureBrowser()) {
    try {
      const r = await fetch('/api/config')
      const t = await r.text()
      return t ? JSON.parse(t) : {}
    } catch {
      return {}
    }
  }
  // Wails 尚未就绪，稍等再试
  await waitWails()
  try {
    return (await window.go.main.App.GetConfig()) || {}
  } catch {
    return {}
  }
}

// AI 一键补全参数说明：
//  - 网页模式：fetch /api/ai/fill（由 node server 调用 OpenAI 协议接口，密钥不落前端）
//  - 桌面模式：尝试调用 Go 暴露的 App.AiFill；若当前打包版本尚未包含该方法，返回友好提示
export async function callAI(payload) {
  if (isPureBrowser()) {
    try {
      const res = await fetch('/api/ai/fill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const text = await res.text()
      if (!text) return { error: 'AI 服务返回为空' }
      try {
        return JSON.parse(text)
      } catch {
        return { error: 'AI 服务返回的内容不是 JSON' }
      }
    } catch (e) {
      return { error: (e && e.message) || String(e) }
    }
  }
  // 桌面端
  try {
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.AiFill) {
      return (await window.go.main.App.AiFill(payload)) || {}
    }
  } catch (e) {
    return { error: (e && e.message) || String(e) }
  }
  return { error: '当前桌面端尚未编译 AI 功能，请使用「网页预览」模式，或重新打包桌面端后再用。' }
}

export { callShowdoc }
