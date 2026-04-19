# 项目知识库

**生成日期:** 2026-04-17
**项目名称:** my-title
**技术栈:** Node.js (JavaScript)

---

## 项目概述
电商选品标题生成工具 - 一个基于 GLM AI + 1688 搜索的 CLI 工具。接收用户关键词，通过 AI 提取核心词，搜索 1688 商品，按相关性过滤，输出 SEO 优化的标题。

---

## 项目结构

```
my-title/
├── bin/
│   ├── cli.js              # CLI 入口（使用 commander）
│   └── mcp-server.mjs      # MCP Server 入口（stdio 传输，供 agent 调用）
├── src/
│   ├── index.js            # 主流程编排器（run 函数）
│   ├── extract-core.js     # GLM AI 集成 + 降级方案
│   ├── search-1688.js      # 1688 API 搜索与过滤
│   ├── search-taobao.js    # 淘宝同行标题搜索（新增）
│   ├── generate-title.js   # 标题生成逻辑（GLM AI）
│   ├── glm-client.js       # GLM API 客户端类
│   ├── alibaba1688-client.js # 1688 API 客户端类
│   └── banned-words.js     # 平台合规性过滤
├── data/
│   └── banned-words.json   # 违禁词分类数据
├── taobao-native/          # taobao-native skill 文档（本地）
│   ├── SKILL.md            # 完整功能文档
│   └── references/
├── docs/superpowers/       # 计划/规范文档（非标准命名）
├── .sisyphus/              # 任务规划与追踪
│   ├── plans/              # 项目计划
│   ├── notepads/           # 学习笔记
│   └── evidence/           # 验证结果
├── .env.example            # API 密钥模板
├── TAOBAO_SETUP.md         # 淘宝配置指南
├── setup-taobao.sh         # 淘宝环境安装脚本
└── package.json            # Main: src/index.js, Bin: bin/cli.js
```

### MCP 接入配置

任何支持 MCP 的客户端（OpenClaw、Claude Desktop、Cursor 等）添加以下配置即可接入：

```json
{
  "mcpServers": {
    "my-title": {
      "command": "node",
      "args": ["/absolute/path/to/my-title/bin/mcp-server.mjs"]
    }
  }
}
```

暴露工具：`generate_title(keyword, length)` — 返回含铺货标题、选品理由、定价建议的商品列表。

---

## 去哪找什么

| 任务 | 位置 | 备注 |
|------|------|------|
| 添加 CLI 命令 | `bin/cli.js` | 使用 commander, dotenv |
| MCP Server | `bin/mcp-server.mjs` | ESM，注册 generate_title 工具 |
| 添加 API 客户端 | `src/*-client.js` | 遵循 PascalCase 类命名模式 |
| 添加工作流步骤 | `src/index.js` | 在 extract/search/generate 之间插入 |
| 修改标题逻辑 | `src/generate-title.js` | GLM AI 参考同行标题生成 |
| 修改淘宝搜索 | `src/search-taobao.js` | taobao-native CLI 集成 |
| 修改违禁词 | `data/banned-words.json` | JSON 数组格式 |
| API 密钥设置 | `.env.example` | 复制到 `.env` |
| 淘宝配置指南 | `TAOBAO_SETUP.md` | 安装和配置说明 |
| 项目计划 | `.sisyphus/plans/` | Sisyphus 工作流计划 |

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

3. **新工作流程** (并行搜索):
   ```
   用户输入 → GLM提取核心词 → parallel(1688搜索 + 淘宝搜索) → GLM生成标题
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
- ❌ 没有测试框架（package.json 中的 test 只是占位符）
- ❌ 没有 CI/CD 流水线
- ❌ 没有 TypeScript（纯 JavaScript）

---

## 常用命令

```bash
# 安装依赖
npm install

# 运行 CLI
node bin/cli.js "纯银项链女高级感"
node bin/cli.js "关键词" --length 60 --count 3

# 初始设置（首次使用必须）
cp .env.example .env
# 编辑 .env 填入 GLM_API_KEY 和 ALI_1688_AK
```

---

## 注意事项

- **依赖项**: commander, axios, dotenv
- **入口**: CLI 通过 `bin/cli.js`，MCP 通过 `bin/mcp-server.mjs`，库通过 `src/index.js`
- **环境变量**: 需要 GLM_API_KEY 和 ALI_1688_AK
- **docs/superpowers/**: 计划/规范文档的非标准目录命名
- **数据冗余**: `data/banned-words.json` 与 `src/banned-words.js` 逻辑重复
