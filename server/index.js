import express from 'express'
import cors from 'cors'
import { config } from './config.js'
import showdocRouter from './showdoc.js'

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

// 把后端接口统一挂在 /api 下
app.use('/api', showdocRouter)

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }))

// 返回服务端默认 ShowDoc 私服地址（来自 .env），前端地址为空时可预填
app.get('/api/config', (_req, res) =>
  res.json({ showdocBaseUrl: config.showdoc.baseUrl })
)

app.listen(config.port, () => {
  console.log(`[API DevKit] 后端已启动: http://localhost:${config.port}`)
  console.log(`[API DevKit] ShowDoc 私服默认地址: ${config.showdoc.baseUrl}`)
  console.log(`[API DevKit] 前端请访问: http://localhost:5173`)
})
