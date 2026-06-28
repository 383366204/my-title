# ecom-ai-tools - 电商选品AI工具箱

> 基于 GLM AI + 1688 搜索的电商标题自动生成工具，支持 CLI、MCP Server、Web UI、独立 Skill 四种接入方式。

## 功能

- 🤖 **AI 提取**: GLM 自动提取核心词 + 判断修饰词刚性程度
- 🔍 **1688 搜索**: 调用 1688 AI 版 API 搜索热门商品，本地评分过滤
- 🎯 **相关性过滤**: 只保留匹配刚性修饰词的商品（材质/颜色/人群）
- ✨ **SEO 优化**: 三段式结构，核心词前置，符合淘宝搜索规则
- 📏 **长度控制**: 默认 60 字符，支持自定义
- 📊 **市场洞察**: 1688 商机热榜 + 趋势分析
- 🔬 **生意参谋**: 自动提取搜索分析数据（蓝海词/热搜词）
- 💡 **智能选词**: 13 种策略自动推荐候选关键词
- 🔄 **批量生成**: 支持一次处理多个关键词
- 🖥️ **Web UI**: React + Vite 工作流画布，支持从浏览器发起标题生成与工作流运行
- 🧩 **Workflow 编排**: 内置 workflow registry、validator、scheduler、run-store 和 SSE 实时日志
- 🛡️ **平台访问保护**: 对 1688、淘宝、SYCM 的登录/滑块/限流状态做结构化拦截与人工动作提示

## 安装

```bash
git clone <repo-url>
cd my-title
npm install
cp .env.example .env
# 编辑 .env，填入 GLM_API_KEY 和 ALI_1688_AK
```

Web UI 依赖位于 `apps/web/`：

```bash
npm install --prefix apps/web
```

## 使用

```bash
# 生成标题
node bin/cli.js "纯银项链女高级感"

# 自定义长度，JSON 输出
node bin/cli.js "纯棉T恤男宽松夏季" --length 60 --json

# 批量生成
node bin/cli.js --keywords "纯银项链,925银手链,钛钢戒指" --json

# 自动选词（13 种策略）
node bin/cli.js --suggest --strategy season --json

# 1688 商机热榜
node bin/cli.js opportunities --json

# 趋势洞察
node bin/cli.js trend "项链" --json

# 生意参谋查询（需 Chrome 调试模式）
node bin/cli.js sycm "项链" --mode blue --json

# 查看帮助
node bin/cli.js --help
```

## Workflow UI / Web UI

```bash
npm run ui:react
```

访问：

```text
http://localhost:3000/workflow/
```

开发模式：

```bash
npm run web:dev
```

Web UI 位于 `apps/web/`，后端 API 和 SSE 入口位于 `bin/server.js`。生产运行时 `npm run ui:react` 会先构建前端，再启动 Express 服务。

## MCP Server

供 AI Agent 调用（Claude Desktop / Cursor 等）：

```json
{
  "mcpServers": {
    "ecom-ai-tools": {
      "command": "node",
      "args": ["/absolute/path/to/my-title/bin/mcp-server.mjs"],
      "timeout": 180000,
      "trust": "trusted"
    }
  }
}
```

暴露工具：`generate_title`, `generate_title_from_image`, `batch_generate_titles`, `opportunities`, `trend`, `sycm_query`, `sycm_status`, `suggest_keywords`

## Workflow API

后端提供工作流模板、校验、运行、取消、历史记录和 SSE 日志：

| API | 功能 |
|-----|------|
| `GET /api/workflows/templates` | 获取内置工作流模板 |
| `POST /api/workflows/validate` | 校验工作流节点和连线 |
| `POST /api/workflows/run` | 启动工作流 |
| `GET /api/workflows/runs` | 查看运行历史 |
| `GET /api/workflows/runs/:runId` | 查看单次运行状态和日志 |
| `POST /api/workflows/runs/:runId/cancel` | 取消运行 |
| `GET /api/workflows/runs/:runId/events` | SSE 实时事件流 |

## Skill 架构

每个 skill 可独立引入，也可通过统一 MCP Server 使用：

| Skill | 目录 | 功能 |
|-------|------|------|
| **alibaba1688** | `skills/alibaba1688/` | 1688 搜索、评分过滤、热榜、趋势 |
| **sycm-research** | `skills/sycm-research/` | 生意参谋 CDP 数据提取 |
| **title-gen** | `skills/title-gen/` | 标题生成、批量处理、智能选词 |
| **taobao-native** | `skills/taobao-native/` | 淘宝 CLI 工具文档 |

共享基础层 `core/`：GLM 客户端、1688 客户端、违禁词过滤、限流、日志、平台访问保护和 workflow 基础模块。

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `GLM_API_KEY` | 是 | 智谱 GLM API 密钥 |
| `GLM_API_BASE` | 否 | GLM API 地址，默认官方 |
| `GLM_API_MODEL` | 否 | GLM 模型名称，默认 `glm-4-flash` |
| `ALI_1688_AK` | 是 | 1688 AI 版 Access Key |
| `LLM_PROVIDER` | 否 | 标题生成 LLM 提供方：`glm`、`minimax`、`deepseek`、`openai-compatible` |
| `MINIMAX_API_KEY` | 否 | `LLM_PROVIDER=minimax` 时使用 |
| `DEEPSEEK_API_KEY` | 否 | `LLM_PROVIDER=deepseek` 时使用 |
| `TAOBAO_NATIVE_PATH` | 否 | taobao-native CLI 路径，用于淘宝同行标题和图搜 |
| `SYCM_LOGIN_MODE` | 否 | 当前仅支持 `manual`，复用人工登录态 |
| `SYCM_CHROME_PROFILE_DIR` | 否 | 生意参谋 Chrome profile 目录 |
| `SYCM_REMOTE_DEBUGGING_PORT` | 否 | Chrome CDP 端口，默认 `9222` |
| `TAOBAO_OPC_URL` | 否 | 淘宝图片优化 MCP 网关地址 |

## 测试

```bash
# 根集成测试
npm test

# core + skill 单元测试
npm run test:core-skills

# 完整本地验证：根测试 + core/skill 测试 + Web 构建
npm run test:all
```

不要使用 `node --test core/test/` 目录形式；当前 Node 26 会把目录当作模块入口。请使用显式 glob，例如 `node --test core/test/*.js`。

## 平台状态诊断

```bash
node bin/cli.js doctor --json
node bin/cli.js sycm-status --json
node bin/cli.js title-gen-preflight --json
```

SYCM、淘宝桌面版和 1688 页面能力可能返回 `login_required`、`slider_required`、`sycm_feature_required`、`captcha_required` 或 `rate_limited`。这些状态需要人工处理后重试，工具不会自动输入密码、验证码或拖动滑块。

## 许可

MIT
