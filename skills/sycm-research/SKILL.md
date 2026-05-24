# sycm-research

> 生意参谋 (SYCM) 数据提取工具，通过 Chrome DevTools Protocol 直接从页面提取

## 功能概述
- 自动导航到生意参谋搜索分析页面
- 自动勾选指标（搜索人气、点击率、转化率等）
- 蓝海词/热搜词模式切换
- 过滤条件设置（蓝海词模式）
- 多页数据提取和去重
- 类目分析和推荐
- Chrome 调试模式自动启动
- 人工登录态复用（管理员先登录一次，后续使用固定 Chrome profile 缓存）

## 依赖
- 共享模块：无
- 环境变量：SYCM_LOGIN_MODE (可选), SYCM_CHROME_PROFILE_DIR (可选), SYCM_REMOTE_DEBUGGING_PORT (可选)
- 外部工具：Chrome 浏览器（必需，需要以调试模式启动）
- npm 依赖：ws (WebSocket 客户端)

## 公共 API
### 1. extractSycmData(keyword, options)
提取生意参谋搜索分析数据

**参数**：
- `keyword` (string): 搜索关键词（必需）
- `options` (object): 配置选项
  - `port` (number): Chrome 调试端口（默认 9222）
  - `maxPages` (number): 最大提取页数（默认 1）
  - `mode` (string): 查询模式，'hot'=相关热搜词或 'blue'=相关蓝海词（默认 'blue'）
  - `loginMode` (string): 登录模式，目前仅支持 'manual'，复用人工登录态
  - `chromeProfileDir` (string): Chrome 登录态目录，默认读取 `SYCM_CHROME_PROFILE_DIR`
  - `pageFilters` (object): 页面级筛选参数
    - `compareType` (string): 'cycle'（环比）或 'yearSync'（年同比，默认 'cycle'）
    - `timePeriod` (string): '7d', '30d', 'day', 'week', 'month'（默认 '7d'）
  - `filterConditions` (object): 蓝海词过滤条件
    - `demandSupplyRatio` (number): 需求供给比（默认 1）
    - `searchPopularity` (number): 搜索人气（默认 50）
    - `conversionRate` (number): 支付转化率（默认 0）
    - `buyerCount` (number): 支付买家数（默认 0）
    - `referencePrice` (number): 关键词推广参考价（默认 0）
  - `onProgress` (function): 进度回调函数 `fn(stepMsg)`（可选）

**返回值** (Promise\<object\>):
```javascript
{
  keyword: string,
  source: string,
  extractedAt: string (ISO 8601),
  method: string,
  mode: string,
  filterApplied: boolean|string,
  pageFiltersApplied: {
    compareType: string,
    timePeriod: string
  },
  maxPages: number,
  totalPages: number,
  currentPage: number,
  headers: string[],
  totalCount: number,
  data: Array<{
    keyword: string,
    searchPopularity?: number,
    clickRate?: number,
    conversionRate?: number,
    buyerCount?: number,
    demandSupplyRatio?: number,
    tmallClickShare?: number,
    [key]_trend?: string
  }>,
  categoryAnalysis?: {
    data: object,
    recommendation: {
      recommended: object|null,
      ranking: object[],
      reason: string
    }
  }
}
```

---

### 2. isChromeDevToolsAvailable(port)
检查 Chrome DevTools Protocol 是否可用

**参数**：
- `port` (number): 调试端口（默认 9222）

**返回值** (Promise\<boolean\>): 是否可用

---

### 3. autoLaunchChrome(port, options)
自动启动 Chrome 调试模式并等待就绪

**参数**：
- `port` (number): 调试端口（默认 9222）
- `options` (object):
  - `waitTimeout` (number): 等待超时时间（毫秒，默认 30000）
  - `pollInterval` (number): 检测间隔（毫秒，默认 1000）
  - `userDataDir` (string): 用户数据目录（可选）

**返回值** (Promise\<object\>):
```javascript
{
  success: boolean,
  message: string
}
```

---

### 4. 常量
- `DEFAULT_PORT` (number): 默认调试端口 9222
- `DEFAULT_MAX_PAGES` (number): 默认最大页数 1
- `DEFAULT_FILTER_CONDITIONS` (object): 默认过滤条件
- `DEFAULT_PAGE_FILTERS` (object): 默认页面筛选参数
- `VALID_COMPARE_TYPES` (string[]): 有效对比类型数组 ['cycle', 'yearSync']
- `VALID_PERIODS` (string[]): 有效时间周期数组 ['7d', '30d', 'day', 'week', 'month']

## MCP 工具
参见 skills/sycm-research/mcp-server.mjs

## 工作流程
1. 连接到 Chrome DevTools Protocol
2. 导航到生意参谋搜索分析页面（根据参数构造 URL）
3. 检查登录状态，如未登录返回 `login_required`
4. 切换到目标模式（蓝海词/热搜词）
5. 勾选全部指标
6. （可选）应用过滤条件（蓝海词模式）
7. 检测总页数，遍历提取数据
8. （可选）提取类目分析和推荐
9. 关闭连接，返回结果

## 降级策略
- Chrome 未运行：提供启动命令提示或使用 autoLaunchChrome 启动
- 登录态失效：返回 `login_required`，提示管理员使用固定 Chrome profile 人工登录
- 滑块/验证码：不再自动处理，由管理员在浏览器中完成一次登录后缓存
- 关键词校验失败：强制刷新重试
- 指标未完全加载：继续提取可用数据
- 类目分析失败：继续返回搜索分析数据

## 配置
- 环境变量：
  - SYCM_LOGIN_MODE (可选): manual，默认 manual
  - SYCM_CHROME_PROFILE_DIR (可选): Chrome 登录态目录，云服务器建议使用持久化目录 `/data/ecom-ai-tools/chrome-profile/sycm`
  - SYCM_REMOTE_DEBUGGING_PORT (可选): Chrome 调试端口，默认 9222
- Chrome 启动命令（手动启动）：
  ```bash
  # Windows
  "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\Users\YourUsername\AppData\Local\ecom-ai-tools-chrome"
  ```
