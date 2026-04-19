## Task 5: GLM相关性评分方法

### 实现总结
- 新增方法: judgeRelevance({ blueOceanWord, coreWord, products, maxProducts = 15 })
- 位置: src/glm-client.js (line 91-166)
- 测试文件: test/glm-client.test.js

### 方法特性
1. **批量评分**: 一次GLM调用评估多个产品
2. **上限限制**: maxProducts=15，防止token超限
3. **温度0.1**: 确定性评分结果
4. **返回格式**: [{productId, score, reason}]
5. **错误处理**: API失败时抛出错误（由调用方处理降级）

### 评分标准
- 10分: 完全匹配核心词和所有关键属性
- 8-9分: 高度匹配，可能缺少次要属性
- 6-7分: 基本匹配，可作为替代选项
- 0-5分: 不匹配或相关性低

### 测试结果
所有5个测试通过:
- Test 1: 返回产品评分列表
- Test 2: 分数≥6表示相关
- Test 3: 批量限制15个产品
- Test 4: API失败抛出错误
- Test 5: 无效JSON抛出错误

### 集成使用
可被 search-1688.js 调用来过滤商品，筛选 score >= 6 的产品作为相关商品。

### 完成时间
2026-04-18 - TDD流程完成，所有测试通过


