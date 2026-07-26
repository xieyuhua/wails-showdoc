import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 前端跑在 5173，所有 /api 请求由 Vite 代理到本地后端 3333，
// 这样前端永远只跟同源的 /api 打交道，跨域问题在后端解决。
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3333',
        changeOrigin: true
      }
    }
  },
  // preview（vite preview，默认 4173）默认不继承 server.proxy，
  // 会导致 /api 请求无法转发到 Express 后端而返回 500。这里显式补上。
  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://localhost:3333',
        changeOrigin: true
      }
    }
  }
})
