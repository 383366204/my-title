# alibaba1688

> 1688 搜索、商机获取、趋势分析工具

## 功能概述
- 商品搜索：多查询组合搜索 1688 商品，本地评分过滤
- 商机获取：获取多平台爆款商品数据
- 趋势分析：获取搜索词趋势分析
- URL 解析：从 1688 URL 提取 offerId
- 短链接解析：解析 1688 短链接

## 依赖
- 共享模块：无
- 环境变量：ALI_1688_AK (必需)
- 外部工具：无

## 公共 API
### 1. searchAll(coreWord, blueOceanWord, modifiers, semanticGroups)
多查询搜索并本地评分过滤商品

**参数**：
- `coreWord` (string): 核心词（必需）
- `blueOceanWord` (string): 蓝海词（必需）
- `modifiers` (Array\<{word: string, rigidity: 'rigid'|'optional'}\>): 修饰词数组（可选）
- `semanticGroups` (object): 语义组映射（可选，用于同义词匹配）

**返回值** (Promise\<object[]\>): 过滤后的 1688 商品数组

---

### 2. fetchOpportunities(timeout)
获取多平台爆款商机数据

**参数**：
- `timeout` (number): 请求超时时间（毫秒，默认 15000）

**返回值** (Promise\<object\>): 商机数据

---

### 3. fetchTrend(query, timeout)
获取搜索词趋势分析

**参数**：
- `query` (string): 搜索关键词（必需）
- `timeout` (number): 请求超时时间（毫秒，默认 15000）

**返回值** (Promise\<string|object\>): 趋势分析结果

---

### 4. Alibaba1688Client
1688 API 客户端类，构造函数接受 ALI_1688_AK

**静态方法**：
- `parse1688Url(url)`: 从 1688 URL 提取 offerId，返回 { offerId: string } 或 null
- `resolve1688ShortUrl(url, maxRedirects)`: 解析短链接，返回最终 URL 或 null

**错误类型**：
- `RateLimitError`: 速率限制错误

## MCP 工具
参见 skills/alibaba1688/mcp-server.mjs

## 工作流程
构造查询列表 → 并行搜索 → 合并去重 → 本地评分 → 刚性修饰词过滤（降级）→ 返回结果

## 降级策略
- 本地评分失败：降级到刚性修饰词过滤
- 无刚性修饰词：保留全部搜索结果

## 配置
- 环境变量：
  - ALI_1688_AK (必需): 1688 API Access Key
