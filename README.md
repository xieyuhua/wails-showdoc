# ShowDoc API 文档导出工具

连接 ShowDoc 私服，加载接口树，按目录层级选择接口，一键导出为
**Markdown / HTML / OpenAPI 3.0 / Postman 2.1** 多种格式。

既可当作网页应用本地运行（Node 代理），也能打包成**独立桌面程序**（Wails + Go，无需 Node 后端）。

---

## 功能特性

- **私服对接**：填写 ShowDoc 私服地址、`api_key`、`api_token`、`item_id`，加载该项目的接口树。
- **层级目录**：完整保留 ShowDoc 的「父目录 / 子目录 / 接口」层级。
  - Markdown / HTML：目录标题带完整路径，深度越大标题级别越深。
  - Postman：生成嵌套 folder。
  - OpenAPI：用目录路径作为 tag 分组。
- **接口选择**：支持目录级「全选 / 半选」与**逐层展开 / 折叠**（点击目录行或箭头均可折叠）。
- **导出格式**
  - `Markdown (.md)`
  - `HTML (.html)`：样式内联，响应示例区块**可折叠**，数据过长时自动收起。
  - `OpenAPI 3.0 (.json)`
  - `Postman 2.1 (.json)`
- **语义修正**
  - `GET` / `HEAD` 等无 body 的请求**不解析 body 参数**（忽略 RunApi 误填的 body）。
  - 仅 `POST` / `PUT` / `PATCH` 等带 body 的请求才解析 body 表单参数。
  - 文档中**响应示例**排在**响应参数**之前，便于先看实际返回结构。

---

## 环境要求

### 网页 / 开发模式

- Node.js 18+

### 桌面应用打包（Windows）

- Go 1.21+
- MinGW（`gcc`）在 `PATH` 中（Wails 编译 CGO 依赖）
- Wails CLI `v2.9.2`（`go install github.com/wailsapp/wails/v2/cmd/wails@v2.9.2`）
- 运行桌面程序需系统已安装 **WebView2 运行时**（Win10/11 通常自带）

---

## 使用方式

### 方式一：网页 / 开发模式（走 Node 代理）

```bash
npm install
npm run dev
```

启动后浏览器打开 Vite 提示的地址（默认 `http://localhost:5173`）。
前端通过 `fetch('/api/showdoc/*')` 调用 `server/` 下的 Node 代理，由代理负责
ShowDoc 私服签名、URL 拼接与正文拉取。

> 私服地址默认预填为 `http://localhost:5757`，可在 `.env` 中通过
> `SHOWDOC_BASE_URL` 覆盖（见 `server/config.js`）。

其他脚本：

```bash
npm run build     # 仅构建前端到 dist/
npm run preview   # 预览构建产物
npm run server    # 单独启动 Node 代理（不启动前端）
```

### 方式二：桌面应用（Wails 打包，无需 Node 后端）

```bash
# 确保 gcc / Go / wails 均在 PATH
wails build
```

构建完成后，单文件桌面程序位于 `build/bin/ShowDocDocExport.exe`
（约 8~9 MB）。双击即可运行，Go 在桌面环境下**完整复刻了 ShowDoc 代理逻辑**
（`app.go` 中的 `GetTree` / `GetPages` / `GetConfig`），不再依赖 Node server。

前端通过 `src/lib/api.js` 自动识别运行环境：桌面模式调用 Go 绑定方法，
网页模式继续走 `fetch` 代理，两种模式共用同一套导出逻辑。

---

## 配置说明

| 配置项 | 说明 |
| --- | --- |
| 私服地址 | ShowDoc 服务端地址，如 `http://your-showdoc/server` |
| api_key | 项目设置中的 `api_key` |
| api_token | 项目设置中的 `api_token`（即密码） |
| 项目 ID (item_id) | ShowDoc 项目 ID，可手动输入或从「我的项目」下拉选择 |
| 备注名 | 将常用 `item_id` 存为本地项目，便于下次快速选择 |

填写后点击「加载接口树」，左侧提示「已加载 X 个目录 / Y 个接口页面」即表示成功。

---

## 导出操作流程

1. 加载接口树。
2. 在「导出接口文档」面板选择导出格式。
3. 在层级列表中勾选需要的接口（目录行可整行点击展开 / 折叠，目录复选框可一键勾选其下全部接口）。
4. 点击「导出」，浏览器 / 桌面程序会下载对应格式文件。

导出时程序会逐页拉取接口正文（ShowDoc 的 item 列表只给元数据），
再解析请求 / 响应参数并生成文档。

---

## 目录结构

```
showdoc-api-devkit/
├── src/                     # 前端（Vue 3 + Vite）
│   ├── App.vue              # 主布局，配置/项目/接口树状态管理
│   ├── components/
│   │   ├── ShowDocPanel.vue # 私服配置、加载接口树
│   │   ├── ExportPanel.vue  # 格式选择、层级勾选（展开/折叠）
│   │   └── TreeView.vue     # 只读目录树组件
│   ├── lib/
│   │   ├── exporters.js     # 多格式导出（Markdown/HTML/OpenAPI/Postman）
│   │   └── api.js           # 统一调用层：自动适配 Wails / 网页模式
│   └── style.css            # 全局样式
├── server/                  # 网页模式 Node 代理（Express）
│   ├── index.js             # 入口，挂载 /api/showdoc 路由
│   ├── showdoc.js           # ShowDoc 私服签名与接口封装
│   └── config.js            # 本地配置（SHOWDOC_BASE_URL 等）
├── app.go                   # Wails 后端：Go 复刻 ShowDoc 代理
├── main.go                  # Wails 入口，嵌入前端并绑定 App
├── wails.json               # Wails 构建配置
├── go.mod / go.sum          # Go 依赖
├── package.json             # 前端依赖与脚本
└── vite.config.js
```

> 建议将 `build/`、`dist/`、`wailsjs/`、`node_modules/` 加入 `.gitignore`，
> 仅提交源码与 `go.mod` / `go.sum`。

---

## 常见问题

**Q：导出 HTML 后响应示例太长？**
A：响应示例已做可折叠处理，数据超过 420px 高度会自动收起，点击标题即可展开。

**Q：GET 接口的 body 参数没出现在文档里？**
A：这是预期行为。按 HTTP 语义，GET / HEAD 没有 body，程序会忽略 RunApi 误填的 body 参数；如需把误填参数当作 query 导出，可修改 `src/lib/exporters.js` 中的 `hasBody` 判断。

**Q：网页模式和桌面模式导出结果一致吗？**
A：一致。两者共用同一套前端与 `exporters.js` 导出逻辑，区别仅在于接口数据来源（Node 代理 vs Go 绑定）。

**Q：打包失败提示找不到 gcc？**
A：Windows 下 Wails 需要 MinGW 的 `gcc`。请安装 MinGW 并将其 `bin` 目录加入 `PATH` 后重试。

---

## 许可证

仅供内部使用与学习。
