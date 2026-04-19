# GLM选品顾问改进方案

## TL;DR

> **Quick Summary**: 将GLM从"打分器"升级为"选品顾问"——合并评分+标题生成为一次调用，增加超时到30秒，新增本地评分算法兜底，输出增加选品理由/定价建议/风险提示
> 
> **Deliverables**:
> - 新增 `selectAndGenerate` 方法（GLM选品顾问，替代judgeRelevance+generateTitles两次调用）
> - 新增 `scoreLocally` 本地评分算法（核心词30分+修饰词10分+蓝海词20分+销量15分+好评5分，≥40分通过）
> - 三层降级：AI选品顾问 → 本地评分 → 刚性修饰词过滤
> - 超时从15秒增加到30秒
> - 输出新增3个字段：选品理由、定价建议、风险提示
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves

---

## Context

### Original Request
GLM评分接口（judgeRelevance）15秒超时率极高，且只返回0-10分，价值太低。用户每天铺货<100个产品，需要快速、稳定、有价值的选品建议。

### User Decisions
- **输出格式**: 完整版（筛选+理由+定价+风险）
- **本地评分阈值**: ≥40分通过（满分100）
- **降级策略**: 三层（AI→本地评分→刚性过滤）

### Current GLM Call Chain (Problems)
```
用户输入 → extractCore(15s) → searchAll(+judgeRelevance 15s ← 超时!) → searchTaobao → generateTitles(20s) → 输出
```

**问题**:
1. judgeRelevance 15秒超时率极高（15个产品批量评分）
2. 只返回0-10分，没有选品理由
3. 评分和标题生成是两次独立调用，效率低
4. Prompt太大（15个产品完整信息）

### Improved Flow
```
用户输入 → extractCore(15s) → searchAll(+本地评分预筛) → searchTaobao → selectAndGenerate(30s, 一次完成) → 输出
```

**改进**:
1. 本地评分先预筛（毫秒级），减少GLM输入量
2. 合并评分+标题生成为一次调用
3. 超时增加到30秒
4. 输出增加选品理由、定价建议、风险提示
5. 三层降级保证稳定性

---

## Work Objectives

### Core Objective
将GLM从"打分器"升级为"选品顾问"，一次调用完成筛选+标题生成+选品分析。

### Concrete Deliverables
- `src/glm-client.js`: 新增 `selectAndGenerate` 方法，删除 `judgeRelevance`
- `src/score-local.js`: 新建本地评分算法模块
- `src/search-1688.js`: 改用本地评分预筛，删除GLM评分调用
- `src/index.js`: 调用 `selectAndGenerate` 替代原来的两次GLM调用
- `src/types.js`: 新增选品结果类型定义
- `test/`: 对应的测试文件

### Definition of Done
- [ ] `node --test test/*.test.js` 全部通过
- [ ] `node bin/cli.js "手链ins韩系"` 输出包含选品理由、定价建议
- [ ] GLM超时时自动降级到本地评分
- [ ] 本地评分≥40分的产品被保留
- [ ] 总耗时从5-15分钟/关键词降到30秒-1分钟

### Must Have
- selectAndGenerate一次调用完成筛选+标题+分析
- 本地评分算法（核心词30+修饰词10/个+蓝海词20+销量15+好评5）
- 三层降级：AI→本地评分→刚性过滤
- 30秒超时
- 输出新增：选品理由、定价建议、风险提示

### Must NOT Have (Guardrails)
- ❌ 不改变extractCoreAndModifiers（稳定工作）
- ❌ 不改变1688搜索逻辑（已正常）
- ❌ 不改变淘宝搜索逻辑（已正常）
- ❌ 不改变CLI输出格式（表格+JSON）
- ❌ 不删除现有test文件
- ❌ AI slop: 过度注释、过度抽象、generic命名

---

## Verification Strategy

- **Infrastructure exists**: YES (node:test)
- **Automated tests**: YES (TDD)
- **Framework**: node:test
- **QA Policy**: 每个task包含agent-executed QA scenarios

---

## Execution Strategy

```
Wave 1 (Start Immediately - foundation):
├── Task 1: 新建本地评分算法 score-local.js + 测试 [quick]
├── Task 2: 类型定义扩展 + 测试 [quick]

Wave 2 (After Wave 1 - core implementation):
├── Task 3: 新增selectAndGenerate方法 + 测试 [deep]
├── Task 4: 修改search-1688用本地评分预筛 + 测试 [unspecified-high]

Wave 3 (After Wave 2 - integration):
├── Task 5: 重构index.js用selectAndGenerate + 测试 [deep]
├── Task 6: 端到端验证（真实API调用） [quick]

Wave FINAL:
├── F1: Plan compliance audit
├── F2: Code quality review
├── F3: Real manual QA
└── F4: Scope fidelity check
```

---

## TODOs

- [x] 1. 新建本地评分算法 score-local.js + 测试

  **What to do**:
  - 创建 `src/score-local.js` 本地评分算法模块
  - 实现 `scoreLocally(products, coreWord, blueOceanWord, modifiers)` 函数
  - 评分规则：核心词在标题中+30分，刚性修饰词每匹配+10分，蓝海词在标题中+20分，30天销量>100+15分，好评率>95%+5分
  - 阈值：≥40分通过
  - 返回 `[{product, score, passed}]`
  - TDD: 先写测试再实现
  - 创建 `test/score-local.test.js`

  **Must NOT do**: 不引入任何外部依赖

  **Acceptance Criteria**:
  - `node --test test/score-local.test.js` 通过
  - scoreLocally返回包含score和passed字段的结果
  - 核心词匹配30分、刚性修饰词10分/个、蓝海词20分、销量15分、好评5分

- [x] 2. 类型定义扩展 + 测试

  **What to do**:
  - 在 `src/types.js` 新增 SelectionAdvice 类型模板
  - 包含：productId, reason, priceAdvice, riskLevel, suggestedTitle
  - 更新 SELECTION_PRODUCT_TEMPLATE 新增字段：选品理由、定价建议、风险提示
  - 创建 `test/types.test.js` 追加新类型测试

  **Acceptance Criteria**:
  - 类型模板包含新增字段
  - `node --test test/types.test.js` 通过

- [x] 3. 新增selectAndGenerate方法 + 测试

  **What to do**:
  - 在 `src/glm-client.js` 新增 `selectAndGenerate` 方法
  - 合并原来 judgeRelevance + generateTitles 的功能为一次调用
  - 精简prompt：只传5-10个关键字段（id, title, price）
  - 超时从15秒增加到30秒
  - 输出JSON格式：{selectedProducts: [{id, score, reason, priceAdvice, risk}], titles: [{productId, title}], overallAdvice: "总结"}
  - TDD: 先写测试再实现
  - 保留原 judgeRelevance 方法（标记deprecated但保留向后兼容）
  - 保留原 generateTitles 方法（同样保留向后兼容）

  **Must NOT do**: 不删除原方法，只新增新方法

  **Acceptance Criteria**:
  - `node --test test/glm-client.test.js` 通过
  - selectAndGenerate 返回 selectedProducts + titles + overallAdvice
  - 超时设置为30秒

- [x] 4. 修改search-1688用本地评分预筛 + 测试

  **What to do**:
  - 修改 `src/search-1688.js` 的 `searchAll` 函数
  - 删除 judgeRelevance 调用
  - 改用 `scoreLocally` 预筛产品（≥40分通过）
  - 保留刚性修饰词过滤作为第三层降级
  - 返回所有通过预筛的产品（不再在searchAll中做GLM评分）
  - TDD: 更新测试

  **Must NOT do**: 不删除 filterRelevantProducts（保留为降级）

  **Acceptance Criteria**:
  - `node --test test/search-1688.test.js` 通过
  - searchAll 使用本地评分预筛
  - 本地评分≥40分的产品保留

- [x] 5. 重构index.js用selectAndGenerate + 测试

  **What to do**:
  - 修改 `src/index.js` 的 `run` 函数
  - 删除原来的 generateTitles 独立调用
  - 改为调用 selectAndGenerate（一次性完成筛选+标题生成）
  - 先用本地评分预筛产品，减少传入GLM的数量
  - 组装输出时增加3个新字段：选品理由、定价建议、风险提示
  - 三层降级：selectAndGenerate失败→scoreLocally+generateTitles→刚性过滤+generateTitles
  - 更新 `src/output-formatter.js` 支持3个新字段
  - TDD: 更新测试

  **Must NOT do**: 不改变CLI参数和输出基本格式

  **Acceptance Criteria**:
  - `node --test test/index.test.js` 通过
  - `node --test test/e2e.test.js` 通过
  - run() 返回增加选品理由、定价建议、风险提示字段
  - 降级流程正确

- [x] 6. 端到端验证（真实API调用）

  **What to do**:
  - 运行 `node bin/cli.js "手链ins韩系"` 验证完整流程
  - 检查GLM调用是否成功（30秒内）
  - 检查输出是否包含选品理由、定价建议
  - 检查降级路径是否正常工作
  - 保存证据到 `.sisyphus/evidence/`

  **Acceptance Criteria**:
  - 真实API调用成功
  - 输出包含8+3个字段
  - 总耗时<60秒

---

## Final Verification Wave

- [x] F1. Plan Compliance Audit — `oracle`
- [x] F2. Code Quality Review — `unspecified-high`
- [x] F3. Real Manual QA — `unspecified-high`
- [x] F4. Scope Fidelity Check — `deep`

---

## Commit Strategy

- **1**: `feat(score): add local scoring algorithm for product relevance`
- **2**: `feat(types): add SelectionAdvice type definitions`
- **3**: `feat(glm): add selectAndGenerate method for AI selection advisor`
- **4**: `refactor(search): use local scoring instead of GLM judgeRelevance`
- **5**: `refactor(flow): integrate selectAndGenerate into main pipeline`
- **6**: `test(e2e): verify real API call with selection advisor`

## Success Criteria

### Verification Commands
```bash
node --test test/*.test.js   # Expected: all pass
node bin/cli.js "手链ins韩系"  # Expected: output with 选品理由/定价建议/风险提示
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] Real API call succeeds within 60 seconds
- [ ] GLM timeout falls back to local scoring
- [ ] Local scoring ≥40 works correctly