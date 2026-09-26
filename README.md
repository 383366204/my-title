# ecom-ai-tools - 电商全流程运营工具箱

> 以 Workflow 编排电商运营全流程，当前已覆盖自动选品、同行分析、标题生成与铺货复核，并将持续扩展好店跟踪、关键词表现监控、单店月度净利润核算、节令活动日历、运营表单、授权素材批处理、异常中心、统一任务中心和运营 SOP，支持 CLI、MCP Server、Web UI、独立 Skill 四种接入方式。

## 功能

- **全流程运营**: 把选品、分析、上架、监控、单店月净利润、表单、素材和任务处理编排成可追踪、可恢复、可人工复核的运营 Workflow
- 🤖 **AI 提取**: LLM 自动提取核心词 + 判断修饰词刚性程度
- 🔍 **1688 搜索**: 调用 1688 AI 版 API 搜索热门商品，本地评分过滤
- 🎯 **相关性过滤**: 只保留匹配刚性修饰词的商品（材质/颜色/人群）
- ✨ **SEO 优化**: 三段式结构，核心词前置，符合淘宝搜索规则
- 📏 **长度控制**: 默认 60 字符，支持自定义
- 📊 **市场洞察**: 1688 商机热榜 + 趋势分析
- 📈 **关键词表现监控方向**: 跟踪排名、展现、点击与转化，生成标题优化建议
- 🧮 **单店月净利润方向**: 按店铺和自然月汇总收入、退款、变动成本与固定费用，输出经营净利润和净利润率
- 🗓️ **节令活动日历方向**: 按备货、素材和投放周期倒推运营任务
- 🚨 **异常与任务中心方向**: 统一收集运营异常，生成可追溯的处理任务
- 📘 **运营 SOP 方向**: 用检查清单和执行记录沉淀标准流程
- 🧲 **同行分析**: 提取和对比同行商品、标题、价格与属性，辅助选品决策
- 🏬 **好店跟踪方向**: 建立 1688 好店池与快照模型，持续跟踪商品、价格和销量变化
- 📋 **运营表单**: 支持订单执行表、评价跟踪表等运营资产的生成、复核和导出
- 🖼️ **素材批处理**: 面向用户拥有合法处理权的素材，批量处理、命名和归档
- 🔬 **生意参谋**: 自动提取搜索分析数据（蓝海词/热搜词）
- 💡 **智能选词**: 13 种策略自动推荐候选关键词
- 🔄 **批量生成**: 支持一次处理多个关键词
- 🖥️ **Web UI**: 以 React 流水线画布为唯一工作区，在节点上完成参数、产物、阻塞处理和铺货复核
- 🧭 **动态灵感选词**: 每天从新闻源、字典、日历和趋势发现商品词根，并通过生意参谋关联词验证
- 🧩 **Workflow 编排**: 内置 workflow registry、validator、scheduler、run-store 和 SSE 实时日志
- 🛡️ **平台访问保护**: 对 1688、淘宝、SYCM 的登录/滑块/限流状态做结构化拦截与人工动作提示
- ⚖️ **合规边界**: 只支持真实订单与真实评价跟踪，不做刷单、刷评价或绕过平台风控；素材处理要求合法授权

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
npm start
```

访问：

```text
http://127.0.0.1:3000/
```

Web UI 只有一个主操作入口：React 流水线画布。当前提供每日动态选品、精确关键词和人工词货源模板；参数、进度、暂停/继续/重试、节点产物和铺货复核都在同一画布中处理。后续运营模板会复用同一 Workflow 运行时接入同行分析、好店跟踪、关键词监控、单店月度净利润核算、活动日历、运营表单、素材批处理、异常中心和统一任务中心。

每日模板默认使用动态灵感模式：`灵感选词 -> 人工筛词 -> 生意参谋校验 -> 货源选品 -> 标题生成 -> 铺货复核 -> 完成`。灵感选词节点会展示来源、商品词根、候选词和未采用原因。新闻 RSS/Atom 源可通过 `INSPIRATION_NEWS_FEEDS` 配置；未配置时使用字典和日历灵感。

真实每日流程的数据源是 `skills/pipeline-flow` 写入的 `data/pipeline/runs/<runId>/` 文件。浏览器 IndexedDB 只作为本机操作历史，不是后端 canonical 状态。

### 种子词数据

`data/keyword-mining/seeds.example.json` 是纳入 Git 的初始词库，不包含历史使用统计。首次读取种子池时，如果同目录下没有 `seeds.json`，系统会从模板初始化。已有文件（包括空词库和暂停状态）不会被模板覆盖。

实际 `data/keyword-mining/seeds.json` 是本地运行数据，已排除版本管理，请单独备份。自定义数据目录仅在该目录提供 `seeds.example.json` 时自动初始化，否则保持空种子池。纯灵感模式不依赖默认种子模板。

旧安装更新到停止跟踪该文件的提交前，应先备份自己的 `seeds.json`；Git 更新可能移除旧版本跟踪的文件。更新后可恢复备份，避免重新初始化丢失历史状态。

开发模式：

```bash
npm run dev
```

Web UI 位于 `apps/web/`，后端 API 入口位于 `bin/server.js`。所有常用命令都在项目根目录运行：

| 命令 | 用途 |
|------|------|
| `npm start` | 正常使用：先构建最新前端，再启动完整工具 |
| `npm run dev` | 开发：同时启动后端与 React 热更新页面，默认访问 5173 |
| `npm run build` | 只构建前端到 `apps/web/dist`，不启动服务 |
| `npm run serve` | 启动后端和已构建页面，不重新构建；首次使用先运行 build |

后端默认使用 3000，端口占用时会自动寻找空闲端口，以终端输出地址为准。`dev` 自动将 API 请求转发到它本次启动的后端，不会固定连接旧的 3000 服务。可通过 `UI_PORT` 指定后端起始端口、`WEB_PORT` 指定开发页面起始端口。按 Ctrl+C 同时退出前后端；修改后端代码后需要重启 `npm run dev`。

旧命令已移除：`ui:react` 改为 `start`，`ui` 改为 `serve`，`web:dev` 改为 `dev`，`web:build` 改为 `build`。不再提供根目录 `web:preview`，预览完整工具请运行 `serve`。

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

## Workbench / Workflow API

每日工作台 API 复用 `skills/pipeline-flow` 和 `data/pipeline/runs/*`：

| API | 功能 |
|-----|------|
| `GET /api/workbench/runs` | 查看最近 pipeline run 摘要 |
| `GET /api/workbench/runs/:runId` | 查看单次 pipeline run 详情、预览和下一步动作 |
| `POST /api/workbench/run` | 后台启动 `flow daily` 或 `flow keyword`，同一时间只允许一个工作台流程 |
| `GET /api/workflow/batches` | 兼容旧 dashboard 的铺货复核批次摘要 |

React 节点实验 API 提供模板、校验、运行、取消、历史记录和 SSE 日志：

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

共享基础层 `core/`：LLM 客户端、1688 客户端、违禁词过滤、限流、日志、平台访问保护和 workflow 基础模块。

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

测试统一放在 `test/` 下，并按 `unit/core`、`unit/skills`、`unit/web`、`integration` 和 `browser` 分类。日常执行 `npm test`，完整回归执行 `npm run test:all`；不要把目录路径直接传给 `node --test`。

## 平台状态诊断

```bash
node bin/cli.js doctor --json
node bin/cli.js sycm-status --json
node bin/cli.js title-gen-preflight --json
```

SYCM、淘宝桌面版和 1688 页面能力可能返回 `login_required`、`slider_required`、`sycm_feature_required`、`captcha_required` 或 `rate_limited`。这些状态需要人工处理后重试，工具不会自动输入密码、验证码或拖动滑块。

## 许可

MIT
