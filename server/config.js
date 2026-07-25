import dotenv from 'dotenv'

// 加载 .env（若存在）。这样你可以把私服地址 / key / token 放环境变量，
// 而不必每次在前端填写。前端填写的值会覆盖这里的默认值。
dotenv.config()

export const config = {
  port: Number(process.env.PORT) || 3333,

  // ShowDoc 私服配置（可用 .env 覆盖，前端也可临时覆盖）
  showdoc: {
    baseUrl: process.env.SHOWDOC_BASE_URL || 'http://localhost:5757',
    apiKey: process.env.SHOWDOC_API_KEY || '',
    apiToken: process.env.SHOWDOC_API_TOKEN || ''
  }
}
