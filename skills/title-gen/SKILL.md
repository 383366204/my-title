# title-gen

> 电商选品标题生成工具，支持以图搜图、同行标题分析、关键词推荐、批量处理等功能

## 功能概述
- 核心词提取：使用 GLM 从用户输入中提取核心词和刚性/可选修饰词
- 标题生成：通过 GLM 结合 1688 商品和淘宝同行标题，生成 SEO 优化的铺货标题
- 以图搜图：使用 1688 商品主图在淘宝搜同款，获取同行标题和价格区间
- 关键词推荐：多种策略（人群、场景、趋势、蓝海等）生成候选关键词
- 批量处理：支持一次处理多个关键词，自动去重、利用缓存
- SYCM 数据增强：支持解析生意参谋数据并用于标题生成

## 依赖
- 共享模块：core/glm-client.js, core/banned-words.js
- 环境变量：GLM_API_KEY (必需), GLM_API_BASE (可选), GLM_API_MODEL (可选), RUN_TIMEOUT (可选)
- 外部工具：淘宝桌面版 + taobao-native CLI（可选，用于同行标题搜索和以图搜图）

## 公共 API
### 1. run(blueOceanWord, options)
主函数，处理单个蓝海词，生成标题和商品列表

**参数**：
- `blueOceanWord` (string): 用户输入的蓝海词（必需）
- `options` (object): 配置选项
  - `maxLength` (number): 生成标题的最大长度（默认 60）
  - `peerTitles` (string[]): 手动提供的同行标题（可选，跳过淘宝搜索）
  - `silent` (boolean): 是否静默输出（默认 false）
  - `limit` (number): 处理商品数量上限（可选）
  - `research` (boolean): 是否进行研究模式（可选）
  - `sycmData` (string): 生意参谋数据（可选，用于增强）
  - `sycmAuto` (boolean): 是否自动获取 SYCM 数据（可选）
  - `useImageSearch` (boolean): 是否启用以图搜图（默认 false）
  - `maxImageSearch` (number): 以图搜图的最大商品数（0=不限制）
  - `minPrice` (number): 价格过滤的最低价（默认 0）
  - `maxPrice` (number): 价格过滤的最高价（默认 0）
  - `signal` (AbortSignal): 取消操作的信号（可选）
  - `onProgress` (function): 进度回调函数（可选）
  - `skipFlag` (object): 跳过搜图的标志（可选）
  - `products` (object[]): 外部提供的商品列表（可选，跳过 1688 搜索）
  - `onProductsFound` (function): 商品找到后的回调（可选）

**返回值** (Promise\<object\>):
```javascript
{
  coreWord: string,
  blueOceanWord: string,
  modifiers: Array<{word: string, rigidity: 'rigid'|'optional'}>,
  products: Array<{
    链接原标题: string,
    产品链接: string,
    主图链接: string,
    铺货标题: string,
    商品原价: string,
    30天销量: number,
    好评率: number,
    复购率: number,
    蓝海词: string,
    选品理由: string,
    定价建议: string,
    风险提示: string,
    导购标题: string
  }>,
  filteredCount: number,
  titles: string[],
  stats: object,
  peerTitles: string[],
  overallAdvice: string
}
```

---

### 2. batchRun(keywords, options)
批量处理多个关键词，自动分组去重

**参数**：
- `keywords` (string[]): 蓝海词数组（必需，最多 20 个）
- `options` (object): 配置选项
  - `maxLength` (number): 标题最大长度（默认 60）
  - `silent` (boolean): 静默模式（默认 true）
  - `onProgress` (function): 进度回调 `({completed, total, currentKeyword})`（可选）
  - `signal` (AbortSignal): 取消信号（可选）
  - `limit` (number): 每个关键词处理商品数上限（可选）
  - `sycmAuto` (boolean): 是否自动获取 SYCM（可选）

**返回值** (Promise\<object\>):
```javascript
{
  ok: boolean,
  results: Array<{
    keyword: string,
    coreWord: string,
    titles: string[],
    products: object[],
    filteredCount: number,
    stats: object,
    blueOceanWord: string
  }>,
  failed: Array<{keyword: string, error: string}>,
  summary: {
    total: number,
    success: number,
    failed: number,
    dedupedCoreWords: number
  }
}
```

---

### 3. extractKeywords(source, options)
提取核心词和修饰词的统一入口

**参数**：
- `source` (string): 'keyword' 或 'peerTitles'
- `options` (object):
  - `data` (string | string[]): 输入数据（用户关键词或同行标题数组）

**返回值** (Promise\<object\>):
```javascript
{
  coreWord: string,
  blueOceanWord?: string,
  modifiers: Array<{word: string, rigidity: 'rigid'|'optional'}>
}
```

---

### 4. suggestKeywords(options)
根据策略生成推荐关键词

**参数** (object):
- `strategy` (string): 策略名，参见 VALID_STRATEGIES（必需）
- `input` (string): 用户输入（部分策略可选）
- `maxCandidates` (number): 最大候选词数（默认 5，最大 10）
- `glmClient` (object): 已有的 GLM 客户端（可选）
- `fetchHotData` (function): 获取热榜数据的函数（仅 'trend' 策略，可选）

**返回值** (Promise\<string[]\>): 推荐关键词数组

---

### 5. suggestAndVerify(options)
推荐关键词并进行验证（默认跳过 SYCM 验证）

**参数** (object): 与 suggestKeywords 相同，额外支持：
- `skipSycm` (boolean): 是否跳过 SYCM 验证（默认 true）
- `port` (number): Chrome 调试端口（可选）
- `delay` (number): 查询间隔（可选）
- `filterConditions` (object): 过滤条件（可选）
- `onProgress` (function): 进度回调（可选）

**返回值** (Promise\<object\>):
```javascript
{
  ok: boolean,
  keywords: Array<{
    keyword: string,
    searchPopularity?: number,
    clickRate?: number,
    conversionRate?: number,
    demandSupplyRatio?: number,
    tmallClickShare?: number,
    source: string
  }>,
  verified: number,
  failed: number,
  errors: object[],
  message?: string
}
```

---

### 6. 常量
- `STRATEGIES`: 支持的策略对象（CROWD, SCENE, SEASON, PROBLEM, INDUSTRY, HOLIDAY, GIFT, CROSS, GUOCHAO, TREND, NICHE, EMOTION, PRICE）
- `VALID_STRATEGIES`: 有效策略名称数组

## MCP 工具
参见 skills/title-gen/mcp-server.mjs

## 工作流程
用户输入 → GLM 提取核心词/修饰词 → 并行 1688 搜索 + 淘宝文字搜索 → 价格过滤 → 可选以图搜图 → GLM 选品分析 + 标题生成 → 去违禁词 → 后置处理 → 缓存 → 返回结果

## 降级策略
- GLM API 失败：使用本地规则降级提取核心词
- GLM selectAndGenerate 失败：降级到简化 GLM 生成标题
- GLM 全部失败：使用商品标题直接构造降级标题
- 淘宝搜索失败：使用手动提供的 peerTitles 或跳过同行标题
- 以图搜图不可用：降级到文字搜索或跳过

## 配置
- 环境变量：
  - GLM_API_KEY (必需): 智谱 GLM API Key
  - GLM_API_BASE (可选): API 地址
  - GLM_API_MODEL (可选): 模型名称
  - RUN_TIMEOUT (可选): 超时时间（毫秒，默认 120000）
- 缓存：本地文件缓存，保存在 skills/title-gen/.cache/ 目录
