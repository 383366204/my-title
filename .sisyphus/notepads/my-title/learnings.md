# my-title 项目学习笔记

## Task 6 学习记录 (2026-04-22)

### 降级路径测试方法论
1. **系统性测试**: 8个降级路径全覆盖，确保无遗漏
2. **边界条件**: 测试空值、null、undefined、无效格式等各种边界
3. **Exit Code验证**: 每个测试都验证进程退出码
4. **日志验证**: 确认降级日志正确输出

### 发现的健壮性模式
1. **URL验证层**: search-taobao-image.js 在入口处验证URL格式，提前过滤无效数据
2. **错误隔离**: withRateLimit 中每个worker的错误被捕获，不影响其他任务
3. **默认返回值**: 所有失败路径都返回完整的默认对象结构，而不是null
4. **多层降级**: index.js 中有GLM失败后的本地生成降级，再失败后的简单fallback

### 关键代码位置
- `src/search-taobao-image.js:74-79` - URL验证
- `src/search-taobao-image.js:207-217` - execSync错误处理
- `src/search-taobao-image.js:315-330` - Worker错误捕获
- `src/index.js:103-142` - 图片搜索降级逻辑
- `src/index.js:313-374` - GLM失败的多层降级


## Keyword Suggester 模块创建 (2026-05-17)

### 实现模式
- 遵循项目 CommonJS 规范，导出 `suggestKeywords(options)` 和 `STRATEGIES` 常量
- 五种策略：crowd（人群）、scene（场景）、season（季节）、problem（痛点）、industry（行业）
- 季节策略自动读取 `data/season-data.json`，根据当前月份选择应季品类
- 使用 GLM API 生成候选词，提示词针对不同策略定制
- 候选词归一化：去除所有空格（包括全角空格），基于归一化字符串去重
- 默认返回最多 5 个候选词，最大限制 10 个
- 错误处理：无效策略抛出明确错误，GLM 调用失败降级返回空数组

### 技术细节
- 复用现有 `llm-utils` 的 `parseJsonFromLLM` 和 `retry` 函数
- 直接使用 `axios` 调用 GLM API，兼容 GLMClient 实例或环境变量配置
- 季节数据加载使用同步 `fs.readFileSync`，失败时降级为空数组
- 归一化函数彻底移除空格，确保去重准确性

### 注意事项
- 不修改现有 `run()` 流程，独立模块可单独调用
- 不实现 SYCM 验证（T6 任务）
- 不添加缓存，保持轻量
- 不创建复合评分算法，仅返回 GLM 生成的候选词

### 测试验证
- 语法检查通过
- 模块加载正常，导出正确
- 无效策略错误提示清晰
- 季节数据加载正确（当前五月 → 夏装套装等品类）
