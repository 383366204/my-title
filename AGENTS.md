# 项目知识库

**更新日期:** 2026-05-23
**项目名称:** ecom-ai-tools
**技术栈:** Node.js (JavaScript)

---

## 项目概述
电商选品标题生成工具 - 基于 GLM AI + 1688 搜索的多 skill 架构。每个 skill 可独立被 AI agent 引入，也可通过 CLI / MCP Server 统一使用。

---

## 项目结构

```
my-title/
├── bin/
│   ├── cli.js              # CLI 入口（commander）— 编排层，串联各 skill
│   └── mcp-server.mjs      # MCP Server 入口（stdio + HTTP）— 编排层
├── core/                   # 共享基础层
│   ├── glm-client.js       # GLM API 客户端
│   ├── llm-utils.js        # LLM 输出解析与重试
│   ├── banned-words.js     # 违禁词过滤
│   ├── constants.js        # 共享常量（刚性规则文本等）
│   ├── log.js              # 日志
│   └── types.js            # 类型定义
├── skills/
│   ├── alibaba1688/        # Skill: 1688 搜索 + 热榜 + 趋势
│   │   ├── SKILL.md
│   │   ├── index.js        # 公共接口
│   │   ├── mcp-server.mjs  # 独立 MCP 入口
│   │   ├── src/
│   │   │   ├── client.js       # 1688 API 客户端类
│   │   │   ├── rate-limiter.js # API 限流
│   │   │   ├── search-1688.js  # 搜索 + 评分 + 过滤
│   │   │   ├── insights.js     # 热榜 + 趋势
│   │   │   └── score-local.js  # 本地评分算法
│   │   └── test/
│   ├── sycm-research/      # Skill: 生意参谋数据提取
│   │   ├── SKILL.md
│   │   ├── index.js
│   │   ├── mcp-server.mjs
│   │   └── src/
│   │       ├── sycm-cdp-extractor.js  # CDP 数据提取
│   │       └── sycm-browser-helper.js # Chrome 调试辅助
│   ├── title-gen/          # Skill: 标题生成
│   │   ├── SKILL.md
│   │   ├── index.js
│   │   ├── mcp-server.mjs
│   │   ├── src/
│   │   │   ├── index.js    # 主编排器（run 函数）
│   │   │   ├── extract-core.js
│   │   │   ├── generate-title.js
│   │   │   ├── search-taobao.js
│   │   │   ├── search-taobao-image.js
│   │   │   ├── keyword-suggester.js
│   │   │   ├── batch.js
│   │   │   └── ...（title-utils, cache, output-formatter 等）
│   │   └── test/
│   └── taobao-native/      # Skill: 淘宝 CLI 工具文档
│       ├── SKILL.md
│       └── references/
├── data/
│   └── banned-words.json   # 违禁词分类数据
├── test/                   # 集成测试（e2e, cli, smoke）
├── .env.example            # API 密钥模板
└── package.json            # Bin: bin/cli.js
```

### MCP 接入配置

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

---

## 去哪找什么

| 任务 | 位置 | 备注 |
|------|------|------|
| 添加 CLI 命令 | `bin/cli.js` | 使用 commander, 编排各 skill |
| MCP Server | `bin/mcp-server.mjs` | ESM，注册 8 个工具 |
| 修改标题逻辑 | `skills/title-gen/src/generate-title.js` | GLM AI 参考同行标题生成 |
| 修改 1688 搜索 | `skills/alibaba1688/src/search-1688.js` | 搜索 + 评分 + 过滤 |
| 修改淘宝搜索 | `skills/title-gen/src/search-taobao.js` | taobao-native CLI 集成 |
| 修改热榜/趋势 | `skills/alibaba1688/src/insights.js` | opportunities + trend |
| 修改生意参谋 | `skills/sycm-research/src/sycm-cdp-extractor.js` | CDP 提取 |
| 修改违禁词 | `skills/title-gen/data/banned-words.json` + `core/banned-words.js` | 数据 + 逻辑 |
| 添加共享模块 | `core/` | GLM 客户端、工具函数 |
| API 密钥设置 | `.env.example` → `.env` | GLM_API_KEY + ALI_1688_AK |

---

## 代码规范

### 代码风格
- **模块系统**: CommonJS (`require`/`module.exports`)
- **命名规范**: 文件名用 kebab-case，函数用 camelCase，类用 PascalCase
- **JSDoc**: 所有导出函数必须包含 `@param`, `@returns`
- **注释**: 业务逻辑使用中文内联注释
- **错误处理**: 使用 `try/catch` + 自定义降级逻辑

### 项目特有模式
1. **刚性 vs 可选修饰词**: 核心抽象概念
   - `rigid`（刚性）: 材质、颜色、规格、人群（强制过滤）
   - `optional`（可选）: 风格、流行词、季节词（仅描述）

2. **标题结构**: 三段式 SEO 格式
   ```
   [核心词前置] + [刚性修饰词] + [高频属性词/可选修饰词]
   ```

3. **工作流程**:
   ```
   用户输入 → GLM提取核心词 → 1688搜索(评分过滤) + 淘宝搜索(并行) → GLM生成标题
   ```

4. **降级模式**: 
   - `extract-core.js`: `fallbackExtract()` 用于 API 失败时
   - `search-taobao.js`: 无 taobao-native 时降级到手动输入 `--peer-titles`

### API 配置
| 服务 | 默认配置 |
|------|----------|
| GLM | `glm-4-flash`, 温度=0.1, 超时=15000ms |
| 1688 | `https://ainext.1688.com`, 超时=10000ms |

---

## 本项目禁忌（ANTI-PATTERNS）

- ❌ 没有 ESLint/Prettier 配置（项目无代码规范检查）
- ❌ 没有 CI/CD 流水线
- ❌ 没有 TypeScript（纯 JavaScript）
- ✅ 有 `node:test` 单元测试（skills 和 core 下）

---

## 常用命令

```bash
npm install

# CLI
node bin/cli.js "纯银项链女高级感"
node bin/cli.js "关键词" --length 60 --count 3
node bin/cli.js opportunities --json
node bin/cli.js trend "项链" --json
node bin/cli.js sycm "关键词" --mode blue

# 测试
node --test skills/alibaba1688/test/
node --test skills/title-gen/test/
node --test core/test/

# 初始设置
cp .env.example .env
# 编辑 .env 填入 GLM_API_KEY 和 ALI_1688_AK
```

---

## 注意事项

- **依赖项**: commander, axios, dotenv
- **入口**: CLI 通过 `bin/cli.js`，MCP 通过 `bin/mcp-server.mjs`
- **环境变量**: 需要 GLM_API_KEY 和 ALI_1688_AK
- **Skill 独立性**: 每个 skill 有自己的 index.js 和 mcp-server.mjs，可独立使用
- **编排层**: bin/ 是 thin shell，负责串联 skills/ 和 core/

---

## MCP 工具详细说明

### 工具列表

| 工具名 | 功能 | 核心参数 |
|--------|------|---------|
| `generate_title` | 标题生成（含 research 模式） | `keyword`, `length`, `keyword_data`, `research`, `use_image_search`, `min_price`, `max_price` |
| `generate_title_from_image` | 1688 链接以图搜图生成标题 | `image_url`, `length` |
| `batch_generate_titles` | 批量生成（1-20 个关键词） | `keywords[]`, `length` |
| `opportunities` | 1688/淘宝/小红书商机热榜 | 无参数 |
| `trend` | 品类趋势洞察 | `query` |
| `sycm_query` | 生意参谋搜索分析数据 | `keyword`, `mode`, `port`, `maxPages` |
| `sycm_status` | 生意参谋数据缓存状态 | `keyword`(可选) |
| `suggest_keywords` | 自动选词（13 种策略） | `strategy`, `input`, `max_candidates`, `sycm_verify` |

### generate_title 返回结构

```json
{
  "ok": true,
  "coreWord": "项链",
  "blueOceanWord": "纯银项链",
  "modifiers": [{ "word": "纯银", "rigidity": "rigid" }],
  "filteredCount": 25,
  "titles": ["标题1", "标题2"],
  "products": [{
    "链接原标题": "原1688商品标题",
    "产品链接": "https://detail.1688.com/offer/xxx.html",
    "主图链接": "https://...",
    "铺货标题": "AI生成的淘宝SEO标题",
    "商品原价": "15.80",
    "30天销量": 1200,
    "好评率": 0.96,
    "复购率": 0.12,
    "蓝海词": "纯银项链",
    "选品理由": "搜索量大、竞争适中",
    "定价建议": "建议售价39-59元",
    "风险提示": "注意材质标注",
    "导购标题": "截断展示标题"
  }],
  "stats": { "coreWord": "项链", "trace": {...} }
}
```

### 执行时间

- `generate_title`: 约 60-120 秒（GLM API + 1688 搜索）
- `generate_title`（含图搜）: 约 3-10 分钟
- `batch_generate_titles`: 关键词数 × 120 秒
- `opportunities` / `trend`: 约 5-10 秒
- `sycm_query`: 约 30-60 秒/页
- `suggest_keywords`: 约 10 秒（无验证），每词 +45 秒（含验证）

### 推荐工作流

```
1. generate_title(research=true) → 获取推荐关键词
2. 用户去生意参谋查数据 → 把数据通过 keyword_data 传回
3. generate_title(keyword_data=...) → 获得更精准的标题
```
