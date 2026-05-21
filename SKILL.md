---
name: my-title
description: 电商选品标题生成工具。当用户需要生成淘宝/1688 商品标题、做电商 SEO 优化、根据关键词生成商品标题、查同行标题、做电商选品时使用。基于 GLM AI 提取核心词 + 1688 实时搜索 + 同行标题参考，输出三段式 SEO 优化标题。
---

# my-title - 电商选品标题生成工具

## 用途

基于 **GLM AI + 1688 + 淘宝** 的电商标题自动生成 CLI 工具。输入一个关键词，输出符合淘宝 SEO 规则的三段式优化标题。

## 何时使用

满足任一条件即调用本 skill：

- 用户要"生成淘宝标题 / 1688 标题 / 商品标题"
- 用户做"电商选品 / SEO 标题优化 / 关键词扩词"
- 用户给一个商品关键词（如"纯银项链女"、"纯棉T恤男"）问怎么写标题
- 用户想"看同行怎么写标题"、"参考 1688 热销商品标题"
- 用户经营淘宝/1688/拼多多店铺需要标题灵感

## 工作流程

```
用户关键词
  ↓ GLM 提取核心词 + 判断修饰词刚性(rigid/optional)
  ↓ 并行调用：1688 AI 版搜索 + 淘宝同行搜索
  ↓ 刚性修饰词过滤（材质/颜色/人群必须匹配）
  ↓ 高频词提取 + 违禁词过滤
  ↓ GLM 三段式生成（核心词前置 → 刚性词 → 高频/可选词）
  ↓ 输出标题（默认 60 字符，可调）
```

## 前置条件

skill 路径：`~/.openclaw/workspace/skills/my-title/`

首次使用需要：

```bash
cd ~/.openclaw/workspace/skills/my-title
npm install
cp .env.example .env
# 编辑 .env，填入 GLM_API_KEY 和 ALI_1688_AK
```

### 必填环境变量

| 变量 | 说明 | 获取方式 |
|------|------|----------|
| `GLM_API_KEY` | 智谱 GLM API 密钥 | https://open.bigmodel.cn |
| `ALI_1688_AK` | 1688 AI 版 Access Key | 1688 开放平台 |

调用前先用 `read` 检查 `.env` 是否存在；不存在就先提示用户去配置。

## 调用方式

### 1. 基础调用（CLI）

```bash
cd ~/.openclaw/workspace/skills/my-title
node bin/cli.js "纯银项链女高级感"
```

### 2. 自定义长度

```bash
node bin/cli.js "纯棉T恤男宽松夏季" --length 60
```

### 3. 生成多条标题

```bash
node bin/cli.js "关键词" --count 3 --length 60
```

### 4. 看帮助

```bash
node bin/cli.js --help
```

### 5. 作为 MCP Server（高级）

OpenClaw / Claude Desktop / Cursor 接入：

```json
{
  "mcpServers": {
    "my-title": {
      "command": "node",
      "args": ["~/.openclaw/workspace/skills/my-title/bin/mcp-server.mjs"],
      "timeout": 180000,
      "trust": "trusted"
    }
  }
}
```

暴露工具：`generate_title(keyword, length)`。

## 输出示例

```
🔍 正在处理: 纯银项链女高级感
📝 提取核心词和修饰词...
  核心词: 项链
  修饰词: 纯银(rigid), 女(rigid), 高级感(optional)
🔎 在 1688 搜索 "项链" 并过滤...
  过滤后剩余 15 个商品
✍️  生成标题...

✅ 处理完成
==================================================
📝 生成的标题:
1. 项链 纯银 女 高级感 锁骨链 女款 简约 百搭 (42 字符)
2. 项链 纯银 女 高级感 925银 韩版 设计感 小众 (40 字符)
3. 项链 纯银 女 锁骨链 生日礼物 送女友 (30 字符)
```

## 关键概念

### 刚性修饰词 vs 可选修饰词

| 类型 | 含义 | 行为 | 示例 |
|------|------|------|------|
| `rigid` | 材质 / 颜色 / 规格 / 人群 | 不匹配则**过滤掉** | `纯银`、`女`、`XL`、`红色` |
| `optional` | 风格 / 流行词 / 时间 | 不强制匹配，仅描述 | `高级感`、`ins风`、`2026新款` |

### 三段式标题结构

```
[核心词前置] + [刚性修饰词] + [高频属性词 / 可选修饰词]
```

## 常见用法示例

| 用户说 | 调用 |
|--------|------|
| "帮我写个淘宝标题，纯银项链女" | `node bin/cli.js "纯银项链女"` |
| "生成 3 条关于纯棉T恤男的标题" | `node bin/cli.js "纯棉T恤男" --count 3` |
| "给我 30 字符以内的简短标题" | `node bin/cli.js "关键词" --length 30` |

## 故障排查

- **没有 .env / 缺密钥** → 先 `cp .env.example .env` 并填值
- **GLM API 报错** → 自动降级到 `fallbackExtract()`，但效果会差
- **1688 搜索失败** → 检查 `ALI_1688_AK` 是否有效
- **依赖未装** → `cd skill 目录 && npm install`

## 项目结构（速查）

```
my-title/
├── bin/
│   ├── cli.js              # CLI 入口 ⭐ 主要使用
│   ├── mcp-server.mjs      # MCP Server（供 agent 调用）
│   └── bot-server.mjs      # 聊天机器人服务器
├── src/
│   ├── index.js            # 主流程编排
│   ├── extract-core.js     # GLM 核心词提取
│   ├── search-1688.js      # 1688 搜索
│   ├── search-taobao.js    # 淘宝同行搜索
│   └── generate-title.js   # 标题生成
├── data/banned-words.json  # 违禁词数据
├── .env.example            # 环境变量模板
└── README.md
```

## 注意事项

- 工具内部已做**违禁词过滤**（参考 `data/banned-words.json`），可直接用于淘宝/1688
- 标题默认 60 字符，符合淘宝主标题规则
- 输出标题前的 emoji 日志会写到 stderr，stdout 只有最终结果，方便管道处理
- 工具是 **CommonJS** 项目（不是 ESM），改代码时注意
