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

