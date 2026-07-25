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
  }
})
