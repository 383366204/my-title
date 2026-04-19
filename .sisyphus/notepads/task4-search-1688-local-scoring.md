# Task 4: 修改search-1688用本地评分预筛 + 测试

## 完成内容
- 修改 `src/search-1688.js`，使用 `scoreLocally` 替代 `judgeRelevance` 进行商品预筛选
- 保留 `filterRelevantProducts` 作为三级降级的第三级
- 更新测试文件 `test/search-1688.test.js`，添加新行为的测试用例

## 关键变更

### src/search-1688.js
1. 移除 `GLMClient` 导入（不再使用AI评分）
2. 添加 `scoreLocally` 从 `./score-local` 导入
3. 移除 `searchAll` 函数的 `glmClient` 参数
4. 使用本地评分过滤（>=40分），失败时降级到刚性修饰词过滤

### test/search-1688.test.js
新增三个测试用例：
1. `searchAll uses scoreLocally for pre-filtering products` - 验证使用本地评分
2. `searchAll returns products with score >= 40 from local scoring` - 验证评分>=40才通过
3. `GLM timeout falls back to filterRelevantProducts` - 验证三级降级

## 三级降级策略
1. 本地评分（scoreLocally）- 主要过滤方式
2. 刚性修饰词过滤（filterRelevantProducts）- 本地评分失败时降级

## 测试状态
全部81个测试通过 ✅

## 学习记录
- 本地评分算法：核心词30分 + 蓝海词20分 + 每个刚性修饰词10分 + 销量>100加15分 + 好评率>95%加5分
- 测试期望需要根据实际评分逻辑计算，不能凭直觉
