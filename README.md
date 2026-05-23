# ecom-ai-tools - 电商选品AI工具箱

> 基于 GLM AI + 1688 搜索的电商标题自动生成工具，支持 CLI、MCP Server、独立 Skill 三种接入方式

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

## 安装

```bash
git clone <repo-url>
cd my-title
npm install
cp .env.example .env
# 编辑 .env，填入 GLM_API_KEY 和 ALI_1688_AK
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

## Skill 架构

每个 skill 可独立引入，也可通过统一 MCP Server 使用：

| Skill | 目录 | 功能 |
|-------|------|------|
| **alibaba1688** | `skills/alibaba1688/` | 1688 搜索、评分过滤、热榜、趋势 |
| **sycm-research** | `skills/sycm-research/` | 生意参谋 CDP 数据提取 |
| **title-gen** | `skills/title-gen/` | 标题生成、批量处理、智能选词 |
| **taobao-native** | `skills/taobao-native/` | 淘宝 CLI 工具文档 |

共享基础层 `core/`：GLM 客户端、1688 客户端、违禁词过滤、限流、日志

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `GLM_API_KEY` | 是 | 智谱 GLM API 密钥 |
| `GLM_API_BASE` | 否 | GLM API 地址，默认官方 |
| `ALI_1688_AK` | 是 | 1688 AI 版 Access Key |

## 测试

```bash
node --test skills/alibaba1688/test/
node --test skills/title-gen/test/
node --test core/test/
```

## 许可
MIT
