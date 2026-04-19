# my-title 使用指南

电商选品标题生成工具。输入商品关键词，通过 GLM AI 提取核心词，搜索 1688 商品，生成 SEO 优化的淘宝标题。

## CLI 命令行

### 交互模式（人类使用）

```bash
node bin/cli.js "戒指男潮牌高级感痞帅" --length 60
```

输出带进度的格式化结果（表格 + 标题列表）。

### JSON 模式（程序调用）

```bash
node bin/cli.js "戒指男潮牌高级感痞帅" --length 60 --json
```

静默所有进度信息，stdout 只输出纯 JSON：

```json
{
  "ok": true,
  "coreWord": "戒指",
  "blueOceanWord": "戒指男潮牌高级感痞帅",
  "modifiers": [
    { "word": "男", "rigidity": "rigid" },
    { "word": "潮牌", "rigidity": "optional" },
    { "word": "高级感", "rigidity": "optional" },
    { "word": "痞帅", "rigidity": "optional" }
  ],
  "filteredCount": 25,
  "titles": ["标题1", "标题2"],
  "products": [
    {
      "链接原标题": "原1688商品标题",
      "产品链接": "https://detail.1688.com/offer/xxx.html",
      "主图链接": "https://...",
      "铺货标题": "AI生成的淘宝SEO标题",
      "商品原价": "15.80",
      "30天销量": 1200,
      "好评率": 0.96,
      "复购率": 0.12,
      "蓝海词": "戒指男潮牌高级感痞帅",
      "选品理由": "搜索量大、竞争适中...",
      "定价建议": "建议售价39-59元...",
      "风险提示": "注意材质标注..."
    }
  ]
}
```

### 参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `<keywords>` | string | 必填 | 商品关键词，如"纯银项链女高级感" |
| `-l, --length` | number | 60 | 标题最大长度（1汉字=2字符） |
| `-c, --count` | number | 3 | 候选标题数量 |
| `-p, --peer-titles` | string | - | 手动提供淘宝同行标题，逗号分隔 |
| `-f, --peer-titles-file` | path | - | 从文件读取淘宝同行标题，每行一个 |
| `--json` | flag | - | 纯 JSON 输出，适合程序调用 |
| `--format` | string | both | 输出格式：table / json / both |

### 前置条件

1. `npm install`
2. 复制 `.env.example` 为 `.env`，填入：
   - `GLM_API_KEY` — 智谱 GLM API 密钥
   - `ALI_1688_AK` — 1688 API 密钥

---

## MCP Server（供 AI Agent 调用）

### 暴露工具

`generate_title(keyword, length)` — 返回含铺货标题、选品理由、定价建议的商品列表。

### 接入配置

任何支持 MCP 的客户端，添加以下配置：

```json
{
  "mcp": {
    "servers": {
      "my-title": {
        "command": "node",
        "args": ["/absolute/path/to/my-title/bin/mcp-server.mjs"],
        "timeout": 180000,
        "trust": "trusted"
      }
    }
  }
}
```

OpenClaw 一行命令添加：

```bash
openclaw mcp set my-title '{"command":"node","args":["/absolute/path/to/my-title/bin/mcp-server.mjs"],"timeout":180000,"trust":"trusted"}'
```

| 字段 | 说明 |
|------|------|
| `command` | Node.js 可执行文件 |
| `args` | MCP Server 入口文件绝对路径 |
| `timeout` | 工具调用超时（毫秒），建议 180000（3 分钟） |
| `trust` | 信任级别，`trusted` 允许工具直接执行 |

### 工具参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `keyword` | string | 是 | 商品关键词，如"戒指男潮牌高级感痞帅" |
| `length` | number | 否 | 标题最大字符数（1汉字=2字符），默认 60 |

### 返回结构

成功时 `isError: false`，content.text 为 JSON 字符串，结构与 CLI `--json` 模式一致。

失败时 `isError: true`，content.text 为 `{"ok": false, "error": "错误信息"}`。

### 注意事项

- 工具执行时间约 60-120 秒（多次 GLM API 调用 + 1688 搜索）
- 配置 `timeout: 180000`（3 分钟）避免超时
- 日志输出到 stderr，查看方式：`openclaw logs --follow`，过滤 `[my-title]`

---

## 通过 exec 调用（OpenClaw 推荐）

由于 generate_title 执行时间较长（60-120秒），部分 MCP 客户端可能超时。OpenClaw 可通过 exec 工具直接调用 CLI：

```
node /absolute/path/to/my-title/bin/cli.js "关键词" --length 60 --json
```

在 OpenClaw 的 AGENTS.md 或 TOOLS.md 中添加以下指引即可：

```
当用户需要生成电商选品标题时，使用 exec 工具执行：
node /absolute/path/to/my-title/bin/cli.js "<关键词>" --length 60 --json
参数：
- <关键词>: 用户输入的商品关键词（必填）
- --length: 标题最大字符数，默认 60（可选）
- --json: 固定参数，返回纯 JSON
返回：JSON 含 products[]（铺货标题、产品链接、选品理由、定价建议、风险提示）
执行时间约 60-120 秒，请等待完成。
```
