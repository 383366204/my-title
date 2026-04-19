# 铺货选品流程重构

## TL;DR

> **Quick Summary**: 将现有标题生成工具重构为完整的淘宝无货源铺货选品流程：双重1688搜索（核心词+蓝海词）、GLM语义相关性筛选、蓝海词前置标题生成、完整产品信息输出（表格+JSON灵活切换）。
>
> **Deliverables**:
> - 验证并重构1688 API数据提取（提取stats子对象中的销量、好评率、复购率等字段）
> - 实现双重1688搜索（核心词+蓝海词，3-5秒随机间隔，合并去重）
> - 实现GLM语义相关性评分（替代刚性修饰词过滤）
> - 实现429限流保护和重试机制
> - 重构标题生成（蓝海词前置+1688原标题+淘宝同行标题组合）
> - 重构输出格式（控制台表格+JSON，--format参数切换）
> - 重构主流程编排（新的执行顺序）
> - TDD测试框架（node:test）
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Task 0 → Task 1 → Task 2 → Task 3 → Task 5 → Task 7 → Task 8 → Task 10 → F1-F4

---

## Context

### Original Request
用户要求将现有的电商标题生成工具重构为完整的淘宝无货源铺货选品流程。当前工具只做单次1688搜索+刚性过滤+标题生成，输出仅标题文本。用户需要完整的选品数据输出，包括1688原始标题、产品链接、价格、销量等字段，并且要求蓝海词前置在标题中。

### Interview Summary
**Key Discussions**:
- 用户确认1688搜索返回的字段需要先验证再决定如何处理 → 已从1688-shopkeeper文档确认stats字段存在
- 用户确认缺失字段留空或等API确认后再处理 → API确认返回所有需要字段
- 链接原标题 = 1688原始title → 无需额外处理
- 淘宝搜索关键词 = 蓝海词（用户原输入）→ 搜索用原词
- GLM相关性判断用语义判断（0-10分评分）→ 阈值默认≥6
- 测试策略：TDD（RED-GREEN-REFACTOR）
- 输出格式：灵活切换（--format参数控制表格/JSON/两者）
- 双重搜索：顺序搜索+随机延时3-5秒

**Research Findings**:
- 1688-shopkeeper官方文档确认searchoffer API返回完整stats字段（last30DaysSales, goodRates, repurchaseRate等）
- 当前`alibaba1688-client.js`只用`Object.values(data)`提取，丢失了stats子对象
- taobao-native不支持直接获取好评率/复购率/30天销量
- GLM相关性评分需批处理（批量发给GLM而非逐个调用）以减少延迟和成本

### Metis Review
**Identified Gaps** (addressed):
- 1688 API实际响应结构未验证 → Task 0 验证真实API响应
- 蓝海词定义不明确 → 已明确=用户原始输入
- GLM相关性评分阈值未定义 → 默认≥6分通过
- 合并去重键未指定 → 使用product ID去重
- 执行流程顺序不明确 → 已定义详细流程
- GLM评分失败时的降级方案缺失 → 降级为刚性修饰词过滤
- 产品数量上限未定义 → MAX_PRODUCTS_TO_SCORE=15
- `--count` CLI选项是死代码 → 不在本次范围内
- taobao路径硬编码 → 不在本次范围内（已有.env配置）

---

## Work Objectives

### Core Objective
重构现有标题生成工具为完整的淘宝无货源铺货选品流程：从蓝海词输入到完整产品信息输出的端到端流程。

### Concrete Deliverables
- `test/` 目录下的TDD测试文件
- 重构后的 `src/alibaba1688-client.js`（提取stats字段、429处理、返回类型更新）
- 重构后的 `src/search-1688.js`（双重搜索、限流保护、返回完整产品数据）
- 新增 `src/glm-client.js` 的 `judgeRelevance` 方法
- 重构后的 `src/generate-title.js`（蓝海词前置逻辑）
- 重构后的 `src/index.js`（新流程编排）
- 重构后的 `bin/cli.js`（表格+JSON输出、--format参数）
- 新增 `src/output-formatter.js`（表格+JSON格式化）

### Definition of Done
- [ ] `node --test test/*.test.js` 全部通过
- [ ] `node bin/cli.js "纯银项链女高级感"` 输出包含8字段表格
- [ ] `node bin/cli.js "纯银项链女高级感" --format json` 输出有效JSON
- [ ] 1688双重搜索间有3-5秒随机间隔
- [ ] GLM相关性评分阈值≥6的产品被保留
- [ ] 铺货标题以蓝海词开头
- [ ] 429错误触发重试机制
- [ ] GLM评分失败时降级为刚性修饰词过滤

### Must Have
- 双重1688搜索（核心词+蓝海词，3-5秒随机间隔，合并去重）
- GLM语义相关性评分（≥6分通过，批处理，失败降级为刚性过滤）
- 蓝海词前置在铺货标题开头
- 8字段完整输出：链接原标题、产品链接、铺货标题、商品原价、30天销量、好评率、复购率、蓝海词
- 控制台表格+JSON灵活切换（--format参数）
- 429限流重试机制
- TDD测试覆盖

### Must NOT Have (Guardrails)
- ❌ 不重构taobao-native路径处理（已有.env配置，不在范围）
- ❌ 不添加TypeScript或ESLint（项目明确无代码规范检查）
- ❌ 不修改违禁词数据结构（不在本次需求内）
- ❌ 不添加CI/CD流水线（不在需求内）
- ❌ 不重构Alibaba1688Client构造函数或签名逻辑（只改searchOffers返回类型）
- ❌ 不修改GLM模型或温度设置（不在需求内）
- ❌ 不修复--count CLI死代码（不在需求内）
- ❌ 不做成openclaw skill（只准备JSON格式兼容）
- ❌ AI slop patterns to avoid: 过度注释、过度抽象、generic命名(data/result/item)、空catch块

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: NO (需搭建)
- **Automated tests**: YES (TDD) - RED-GREEN-REFACTOR
- **Framework**: `node:test` (Node.js内置测试框架，零依赖，CommonJS兼容)
- **If TDD**: 每个TODO遵循RED(写失败测试) → GREEN(最小实现) → REFACTOR

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **CLI/Backend**: Use Bash (node commands) - Run commands, parse output, assert fields
- **API**: Use Bash (curl/node scripts) - Send requests, assert response structure
- **Module**: Use Bash (node --test) - Import, call functions, compare output

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - foundation + verification):
├── Task 0: 验证1688 API真实响应结构 [quick]
├── Task 1: 搭建node:test测试框架 [quick]
├── Task 2: 定义产品数据类型接口 [quick]

Wave 2 (After Wave 1 - core data layer):
├── Task 3: 重构alibaba1688-client数据提取+429处理 (depends: 0, 2) [deep]
├── Task 4: 重构search-1688双重搜索+限流 (depends: 3) [unspecified-high]
├── Task 5: 新增GLM相关性评分方法 (depends: 2) [unspecified-high]

Wave 3 (After Wave 2 - generation + output):
├── Task 6: 重构generate-title蓝海词前置逻辑 (depends: 2) [unspecified-high]
├── Task 7: 新增output-formatter表格+JSON模块 (depends: 2) [visual-engineering]
├── Task 8: 重构index.js主流程编排 (depends: 4, 5, 6, 7) [deep]

Wave 4 (After Wave 3 - CLI + integration):
├── Task 9: 重构cli.js输出格式+参数 (depends: 7, 8) [quick]
├── Task 10: 端到端集成测试 (depends: 8, 9) [unspecified-high]

Wave FINAL (After ALL tasks — 4 parallel reviews):
├── F1: Plan compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Real manual QA (unspecified-high)
└── F4: Scope fidelity check (deep)
→ Present results → Get explicit user okay

Critical Path: Task 0 → Task 3 → Task 4 → Task 8 → Task 10 → F1-F4
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 3 (Wave 1 & 3)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 0 | - | 3 | 1 |
| 1 | - | all tests | 1 |
| 2 | - | 3,4,5,6,7 | 1 |
| 3 | 0, 2 | 4 | 2 |
| 4 | 3 | 8 | 2 |
| 5 | 2 | 8 | 2 |
| 6 | 2 | 8 | 3 |
| 7 | 2 | 8, 9 | 3 |
| 8 | 4, 5, 6, 7 | 9, 10 | 3 |
| 9 | 7, 8 | 10 | 4 |
| 10 | 8, 9 | F1-F4 | 4 |

### Agent Dispatch Summary

- **Wave 1**: 3 tasks - T0 → `quick`, T1 → `quick`, T2 → `quick`
- **Wave 2**: 3 tasks - T3 → `deep`, T4 → `unspecified-high`, T5 → `unspecified-high`
- **Wave 3**: 3 tasks - T6 → `unspecified-high`, T7 → `visual-engineering`, T8 → `deep`
- **Wave 4**: 2 tasks - T9 → `quick`, T10 → `unspecified-high`
- **FINAL**: 4 tasks - F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 0. 验证1688 API真实响应结构

  **What to do**:
  - 编写一个临时脚本 `scripts/verify-1688-api.js`，使用现有`Alibaba1688Client`调用searchoffer接口
  - 输入关键词"项链"，打印完整JSON响应结构（`JSON.stringify(response.data, null, 2)`）
  - 重点确认：`response.data.model.data`的结构（是对象还是数组）、products数组的字段名（id/title/price/url/stats）、stats子对象的字段名和类型
  - 将完整API响应示例保存到 `.sisyphus/evidence/api-1688-response-sample.json`
  - 根据实际响应更新任务2的类型定义和任务3的数据提取逻辑

  **Must NOT do**:
  - 不修改任何现有源代码
  - 不添加API调用到生产代码中
  - 只做验证和记录，后续任务再改代码

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单次API调用+记录结果，不涉及复杂逻辑
  - **Skills**: []
    - 无需额外skill

  **Parallelization**:
  - **Can Run In Parallel**: YES (与Task 1, 2并行)
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 3
  - **Blocked By**: None (可立即开始)

  **References** (CRITICAL):

  **Pattern References**:
  - `src/alibaba1688-client.js:112-129` - 当前searchOffers方法，需验证response.data.model?.data的实际结构

  **API/Type References**:
  - `src/alibaba1688-client.js:4-26` - AK构造函数和签名逻辑
  - 1688-shopkeeper官方文档搜索响应结构（已确认有stats子对象）

  **External References**:
  - 1688-shopkeeper search reference: `https://github.com/next-1688/1688-shopkeeper/blob/main/references/capabilities/search.md` - 完整的products[].stats字段定义

  **WHY Each Reference Matters**:
  - `alibaba1688-client.js:112-129`: 这是需要验证的核心代码——`Object.values(data)`是否正确提取了products数组，以及stats字段是否存在于每个product中
  - 1688-shopkeeper search.md: 这是文档中的字段结构，需要与实际API响应对比验证

  **Acceptance Criteria**:

  **If TDD (tests enabled)**:
  - [ ] 测试文件创建: test/verify-1688.test.js（验证脚本可执行）

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: 1688 API响应验证 - 确认数据结构
    Tool: Bash (node)
    Preconditions: .env中配置了有效的ALI_1688_AK
    Steps:
      1. 执行 `node scripts/verify-1688-api.js`
      2. 检查输出包含products数组
      3. 检查products[0]包含title字段
      4. 检查products[0]包含stats子对象
      5. 检查stats包含last30DaysSales字段
    Expected Result: 完整API响应保存到.sisyphus/evidence/api-1688-response-sample.json，包含所有预期字段
    Failure Indicators: products数组为空，stats子对象不存在，字段名与文档不符
    Evidence: .sisyphus/evidence/task-0-api-verification.json

  Scenario: 1688 API响应验证 - 字段类型检查
    Tool: Bash (node)
    Preconditions: API响应已保存
    Steps:
      1. 读取保存的JSON响应
      2. 验证price字段为字符串或数字
      3. 验证stats.goodRates为0~1之间的小数
      4. 验证stats.last30DaysSales为整数
    Expected Result: 所有字段类型与文档一致
    Failure Indicators: 字段类型不匹配，stats子对象不存在
    Evidence: .sisyphus/evidence/task-0-field-types.json
  ```

  **Commit**: YES (groups with Task 1, 2)
  - Message: `chore(verify): verify 1688 API response structure`
  - Files: `scripts/verify-1688-api.js`, `.sisyphus/evidence/api-1688-response-sample.json`

- [x] 1. 搭建node:test测试框架

  **What to do**:
  - 在项目根目录创建 `test/` 目录
  - 创建 `test/setup.test.js` 验证test框架正常工作
  - 更新 `package.json` 添加 test 脚本: `"test": "node --test test/*.test.js"`
  - 创建测试工具模块 `test/helpers/mock-data.js` 提供1688 API模拟响应数据（基于Task 0验证结果）
  - 确认 `node --test test/setup.test.js` 通过

  **Must NOT do**:
  - 不引入任何npm测试依赖（只用node:test+node:assert）
  - 不修改现有源代码
  - 不添加ESLint或TypeScript

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 简单的目录+配置+验证脚本，无需复杂逻辑
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (与Task 0, 2并行)
  - **Parallel Group**: Wave 1
  - **Blocks**: 所有后续测试任务
  - **Blocked By**: None (可立即开始)

  **References**:

  **Pattern References**:
  - `package.json` - 当前test脚本为占位符
  - Node.js test runner文档: `https://nodejs.org/api/test.html`

  **WHY Each Reference Matters**:
  - `package.json`: 需要更新test脚本从占位符到有效的node:test命令
  - Node.js test runner: 确保使用正确的import语法（`node:test`和`node:assert`）

  **Acceptance Criteria**:

  **If TDD**:
  - [ ] test/setup.test.js 创建并通过
  - [ ] `node --test test/setup.test.js` → PASS

  **QA Scenarios**:

  ```
  Scenario: 测试框架验证
    Tool: Bash
    Preconditions: test/目录和package.json已更新
    Steps:
      1. 运行 `node --test test/setup.test.js`
      2. 检查输出包含 "passed"
    Expected Result: 1 test passed, 0 failures
    Failure Indicators: 测试未运行，import错误，找不到模块
    Evidence: .sisyphus/evidence/task-1-test-framework.txt

  Scenario: package.json test脚本验证
    Tool: Bash
    Steps:
      1. 运行 `npm test`
      2. 检查输出包含 "passed"
    Expected Result: npm test成功运行所有测试
    Failure Indicators: npm test失败，脚本未找到
    Evidence: .sisyphus/evidence/task-1-npm-test.txt
  ```

  **Commit**: YES (groups with Task 0, 2)
  - Message: `feat(test): add node:test framework and mock data helpers`
  - Files: `test/setup.test.js`, `test/helpers/mock-data.js`, `package.json`

- [x] 2. 定义产品数据类型接口

  **What to do**:
  - 创建 `src/types.js` 定义数据接口（使用JSDoc + 对象模板，非TypeScript）
  - 定义 `Product` 接口模板：id, title, price, url, stats (包含last30DaysSales, goodRates, repurchaseRate, downstreamOffer, totalSales, remarkCnt, categoryListName, earliestListingTime)
  - 定义 `RelevanceResult` 接口模板：productId, score, reason
  - 定义 `SelectionResult` 接口模板：蓝海词, products (包含铺货标题等完整输出字段)
  - 定义 `SearchResult` 接口模板：products数组, totalCount, dataId
  - 所有接口使用JSDoc `@typedef` 格式，供其他模块引用
  - TDD: 创建 `test/types.test.js` 验证类型模板对象的字段完整性

  **Must NOT do**:
  - 不使用TypeScript（项目明确无TypeScript）
  - 不添加运行时类型检查库（只用JSDoc注释+对象模板）
  - 不在types.js中引入任何依赖

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 定义数据接口模板，纯结构设计
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (与Task 0, 1并行)
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 3, 4, 5, 6, 7
  - **Blocked By**: None (可立即开始，但Task 0的结果可能微调字段名)

  **References**:

  **Pattern References**:
  - `src/search-1688.js` - 当前产品数据使用方式（product.subject, product.description）
  - `src/glm-client.js:25-89` - 当前GLM响应格式定义

  **API/Type References**:
  - 1688-shopkeeper search.md: products[].stats字段定义（last30DaysSales, goodRates, repurchaseRate等）

  **WHY Each Reference Matters**:
  - `search-1688.js`: 需要理解当前代码如何消费产品数据，确保新接口向后兼容
  - 1688-shopkeeper: stats字段是核心数据结构的权威参考

  **Acceptance Criteria**:

  **If TDD**:
  - [ ] test/types.test.js 创建并通过
  - [ ] `node --test test/types.test.js` → PASS

  **QA Scenarios**:

  ```
  Scenario: 类型完整性验证
    Tool: Bash (node --test)
    Steps:
      1. 运行 `node --test test/types.test.js`
      2. 验证Product模板包含所有8个输出字段
      3. 验证Stats子对象包含last30DaysSales, goodRates, repurchaseRate
    Expected Result: 所有类型模板字段完整，测试通过
    Evidence: .sisyphus/evidence/task-2-types-test.txt

  Scenario: 类型模板可被其他模块引用
    Tool: Bash (node)
    Steps:
      1. 执行 `node -e "const t = require('./src/types'); console.log(Object.keys(t.PRODUCT_TEMPLATE))"`
      2. 验证输出包含id, title, price, url, stats
    Expected Result: 输出包含所有预期字段名
    Evidence: .sisyphus/evidence/task-2-types-import.txt
  ```

  **Commit**: YES (groups with Task 0, 1)
  - Message: `feat(types): define product and selection data type templates`
  - Files: `src/types.js`, `test/types.test.js`

- [x] 3. 重构alibaba1688-client数据提取+429处理

  **What to do**:
  - **RED**: 先写测试 `test/alibaba1688-client.test.js`
    - 测试1: searchOffers正确返回products数组（使用mock响应数据）
    - 测试2: searchOffers正确提取stats子对象（last30DaysSales, goodRates, repurchaseRate等）
    - 测试3: 429状态码触发重试机制（mock axios返回429）
    - 测试4: 重试3次后仍429则抛出错误
    - 测试5: 网络超时触发重试
  - **GREEN**: 修改 `src/alibaba1688-client.js`
    - 修改`searchOffers`返回类型：从`Object.values(data)`改为正确提取`products`数组和`stats`子对象
    - 根据Task 0验证的实际API响应结构调整数据提取逻辑
    - 添加429重试机制：收到429时指数退避重试（初始1秒，最大3次，随机抖动）
    - 添加请求间延迟：每次请求前随机等待3-5秒（供双重搜索调用时使用）
    - 保留现有签名逻辑不变
  - **REFACTOR**: 确保返回的Product对象结构符合`src/types.js`定义的模板
  - 使用`test/helpers/mock-data.js`中的模拟数据

  **Must NOT do**:
  - 不修改构造函数或签名逻辑
  - 不修改AK编码解码逻辑
  - 不添加npm依赖（使用内置crypto和已有的axios）

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 涉及API响应解析、重试逻辑、类型映射，需要深入理解
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 0, 2)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 4
  - **Blocked By**: Task 0 (API响应验证), Task 2 (类型定义)

  **References**:

  **Pattern References**:
  - `src/alibaba1688-client.js:112-129` - 当前searchOffers方法，`Object.values(data)`需改为正确提取
  - `src/alibaba1688-client.js:60-104` - 签名逻辑（不改）

  **API/Type References**:
  - `src/types.js` (Task 2创建) - Product接口模板，需对齐返回值结构
  - 1688-shopkeeper search.md的products数组结构 - 权威字段定义

  **Test References**:
  - `test/helpers/mock-data.js` (Task 1创建) - 模拟1688 API响应数据

  **WHY Each Reference Matters**:
  - `alibaba1688-client.js:112-129`: 这是核心修改点——从错误的数据提取改为正确的products+stats提取
  - `src/types.js`: 返回值必须符合Product类型模板
  - 1688-shopkeeper: 权威参考，确认字段名和嵌套结构

  **Acceptance Criteria**:

  **If TDD**:
  - [ ] test/alibaba1688-client.test.js 创建（RED - 所有测试先失败）
  - [ ] `node --test test/alibaba1688-client.test.js` → PASS (GREEN)

  **QA Scenarios**:

  ```
  Scenario: 1688数据提取正确性
    Tool: Bash (node --test)
    Preconditions: mock数据包含完整stats子对象
    Steps:
      1. 运行 `node --test test/alibaba1688-client.test.js`
      2. 检查products数组正确提取
      3. 检查stats.last30DaysSales正确映射
      4. 检查stats.goodRates为0~1小数
    Expected Result: 5个测试全部通过
    Failure Indicators: 数据提取返回空数组，stats字段缺失，字段类型错误
    Evidence: .sisyphus/evidence/task-3-data-extraction.txt

  Scenario: 429重试机制验证
    Tool: Bash (node --test)
    Steps:
      1. mock axios返回429状态码
      2. 验证重试3次后抛出错误
      3. mock axios第2次返回200
      4. 验证成功返回数据
    Expected Result: 重试逻辑正确触发，429最终失败抛错，重试成功返回数据
    Failure Indicators: 429直接报错不重试，重试次数不对，重试成功但数据丢失
    Evidence: .sisyphus/evidence/task-3-retry-429.txt
  ```

  **Commit**: YES
  - Message: `refactor(1688): extract stats fields and add 429 retry logic`
  - Files: `src/alibaba1688-client.js`, `test/alibaba1688-client.test.js`

- [x] 4. 重构search-1688双重搜索+限流

  **What to do**:
  - **RED**: 先写测试 `test/search-1688.test.js`
    - 测试1: searchAll正确执行双重搜索（核心词+蓝海词），返回合并去重结果
    - 测试2: 两次搜索间有3-5秒随机间隔（验证延迟调用）
    - 测试3: 相同product ID的产品只保留一份（去重逻辑）
    - 测试4: GLM相关性评分会被调用（使用mock，评分≥6通过）
    - 测试5: GLM评分失败时降级为刚性修饰词过滤
    - 测试6: 空搜索结果返回空数组
  - **GREEN**: 重构 `src/search-1688.js`
    - 新增 `searchAll(coreWord, blueOceanWord, modifiers)` 函数执行双重搜索
    - 第一搜：用coreWord搜索1688
    - 等待3-5秒随机间隔（使用alibaba1688-client的新增延迟功能）
    - 第二搜：用blueOceanWord搜索1688
    - 合并去重（基于product.id）
    - 调用GLM相关性评分过滤（批量发给GLM，非逐个）
    - GLM失败降级为刚性修饰词过滤
    - 保留 `filterRelevantProducts()` 作为GLM降级备选
    - 保留 `searchAndFilter()` 作为兼容接口（内部调用新函数）
    - MAX_PRODUCTS_TO_SCORE = 15 常量（超过15个产品时只评分前15个）
  - **REFACTOR**: 确保所有函数有JSDoc，业务逻辑有中文注释

  **Must NOT do**:
  - 不删除 `searchAndFilter` 和 `filterRelevantProducts`（作为GLM降级备选保留）
  - 不修改 `alibaba1688-client.js`（Task 3已完成）
  - 不在搜索函数中硬编码延迟（使用client的延迟功能）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 双重搜索+限流+GLM评分+降级逻辑，多处复杂交互
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 3)
  - **Parallel Group**: Wave 2 (与Task 5可部分并行，但依赖Task 3)
  - **Blocks**: Task 8
  - **Blocked By**: Task 3 (alibaba1688-client重构)

  **References**:

  **Pattern References**:
  - `src/search-1688.js` - 当前searchAndFilter函数（需重构）
  - `src/glm-client.js:25-89` - extractCoreAndModifiers方法（GLM调用模式参考）
  - `src/banned-words.js` - 降级模式参考

  **API/Type References**:
  - `src/types.js` (Task 2) - Product, SearchResult, RelevanceResult类型
  - `src/alibaba1688-client.js` (Task 3修改后) - 新的searchOffers返回类型

  **WHY Each Reference Matters**:
  - `search-1688.js`: 核心修改文件，需理解当前过滤逻辑以便保留为降级方案
  - `glm-client.js`: GLM调用模式参考（axios请求+JSON解析+降级）
  - `types.js`: 新增函数的输入输出必须符合类型定义

  **Acceptance Criteria**:

  **If TDD**:
  - [ ] test/search-1688.test.js 创建（RED）
  - [ ] `node --test test/search-1688.test.js` → PASS (GREEN)

  **QA Scenarios**:

  ```
  Scenario: 双重搜索合并去重
    Tool: Bash (node --test)
    Steps:
      1. mock两次1688搜索返回有重叠的产品（相同id）
      2. 调用searchAll("项链", "纯银项链女高级感", modifiers)
      3. 验证结果中相同id只出现一次
      4. 验证延迟函数被调用2次（一次搜索前+一次间隔）
    Expected Result: 去重后产品数量 ≤ 两次搜索结果总数
    Failure Indicators: 重复产品未去重，延迟未执行
    Evidence: .sisyphus/evidence/task-4-dual-search.txt

  Scenario: GLM评分降级验证
    Tool: Bash (node --test)
    Steps:
      1. mock GLM评分方法抛出错误
      2. 调用searchAll
      3. 验证结果仍返回产品（降级为刚性过滤）
      4. 验证console.warn输出了降级警告
    Expected Result: GLM失败后仍返回过滤结果
    Failure Indicators: GLM失败导致整个搜索失败无结果
    Evidence: .sisyphus/evidence/task-4-glm-fallback.txt
  ```

  **Commit**: YES
  - Message: `feat(search): dual 1688 search with rate limiting and GLM relevance`
  - Files: `src/search-1688.js`, `test/search-1688.test.js`

- [x] 5. 新增GLM相关性评分方法

  **What to do**:
  - **RED**: 先写测试 `test/glm-client.test.js`（追加到现有测试文件）
    - 测试1: judgeRelevance正确返回产品评分列表
    - 测试2: 评分≥6的产品标记为relevant
    - 测试3: 批量评分时产品数量不超过MAX_PRODUCTS
    - 测试4: GLM API失败时抛出错误（由调用方处理降级）
    - 测试5: 评分JSON格式错误时抛出错误
  - **GREEN**: 修改 `src/glm-client.js`
    - 新增 `judgeRelevance({ blueOceanWord, coreWord, products, maxProducts = 15 })` 方法
    - 构建systemPrompt: "你是电商选品助手，评估产品与搜索意图的相关性，评分0-10"
    - 构建userPrompt: 包含蓝海词、核心词、产品列表（标题+价格+销量）
    - temperature: 0.1（评分需要确定性）
    - 限制maxProducts：超过15个产品时截取前15个
    - GLM返回JSON格式：`[{productId, score, reason}]`
    - 评分阈值≥6标记为relevant
    - API失败直接抛出错误（由search-1688处理降级）
  - **REFACTOR**: 确保JSDoc注释完整

  **Must NOT do**:
  - 不修改 extractCoreAndModifiers 方法
  - 不修改 generateTitles 方法
  - 不修改默认模型和温度设置

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 新增GLM API方法需设计prompt、解析逻辑和错误处理
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (与Task 4并行，但与Task 6共享glm-client.js)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 8
  - **Blocked By**: Task 2 (类型定义)

  **References**:

  **Pattern References**:
  - `src/glm-client.js:25-89` - extractCoreAndModifiers方法（GLM调用模式参考）
  - `src/glm-client.js:102-148` - generateTitles方法（prompt设计参考）

  **API/Type References**:
  - `src/types.js` (Task 2) - RelevanceResult类型模板

  **WHY Each Reference Matters**:
  - `extractCoreAndModifiers`: 这个方法展示了如何构建system prompt、调用GLM API、解析JSON响应、处理降级的完整模式
  - `generateTitles`: temperature 0.7的模式，但评分需要0.1的确定性温度

  **Acceptance Criteria**:

  **If TDD**:
  - [ ] test/glm-client.test.js 追加新测试（RED）
  - [ ] `node --test test/glm-client.test.js` → PASS (GREEN)

  **QA Scenarios**:

  ```
  Scenario: GLM相关性评分正确性
    Tool: Bash (node --test)
    Steps:
      1. mock GLM返回评分JSON
      2. 调用judgeRelevance({blueOceanWord: "纯银项链女高级感", coreWord: "项链", products: mockProducts})
      3. 验证返回RelevanceResult数组
      4. 验证score≥6的标记为relevant
    Expected Result: 评分结果正确解析，阈值过滤正确
    Failure Indicators: JSON解析失败，评分阈值判断错误
    Evidence: .sisyphus/evidence/task-5-relevance-score.txt

  Scenario: GLM评分失败错误处理
    Tool: Bash (node --test)
    Steps:
      1. mock GLM API返回HTTP错误
      2. 调用judgeRelevance
      3. 验证抛出错误（非静默吞没）
    Expected Result: 错误被正确抛出，调用方可捕获处理降级
    Failure Indicators: 错误被静默吞没返回空结果
    Evidence: .sisyphus/evidence/task-5-glm-error.txt
  ```

  **Commit**: YES
  - Message: `feat(glm): add relevance scoring method for product filtering`
  - Files: `src/glm-client.js`, `test/glm-client.test.js`

- [x] 6. 重构generate-title蓝海词前置逻辑

  **What to do**:
  - **RED**: 先写测试 `test/generate-title.test.js`
    - 测试1: 铺货标题以蓝海词开头
    - 测试2: 铺货标题包含1688原标题和淘宝同行标题的组合元素
    - 测试3: 标题长度不超过maxLength
    - 测试4: 违禁词被过滤
    - 测试5: GLM失败时降级标题仍以蓝海词开头
    - 测试6: 空同行标题列表时仍能生成标题
  - **GREEN**: 重构 `src/generate-title.js`
    - 修改 `generateTitles` 函数签名：新增 `blueOceanWord` 参数（蓝海词=用户原输入）
    - 修改GLM prompt：明确要求"标题必须以【蓝海词】开头，后续词从1688原标题和淘宝同行标题中组合"
    - 降级逻辑：蓝海词 + 刚性修饰词 + 核心词拼接
    - 验证所有返回标题以蓝海词开头（.startsWith(blueOceanWord)）
    - 保留违禁词过滤
  - **REFACTOR**: 更新JSDoc，确保函数签名清晰

  **Must NOT do**:
  - 不修改 `removeBannedWords` 逻辑
  - 不修改 `GLMClient` 类的温度设置
  - 不删除降级逻辑

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 重构GLM prompt设计+降级逻辑+标题验证
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (与Task 5独立修改不同文件)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 8
  - **Blocked By**: Task 2 (类型定义)

  **References**:

  **Pattern References**:
  - `src/generate-title.js:15-51` - 当前generateTitles函数（需重构）
  - `src/banned-words.js` - 违禁词过滤（保留使用）

  **API/Type References**:
  - `src/types.js` (Task 2) - 铺货标题生成接口定义

  **WHY Each Reference Matters**:
  - `generate-title.js`: 核心修改文件——需要添加blueOceanWord参数和前置逻辑
  - `banned-words.js`: 必须保留违禁词过滤功能

  **Acceptance Criteria**:

  **If TDD**:
  - [ ] test/generate-title.test.js 创建（RED）
  - [ ] `node --test test/generate-title.test.js` → PASS (GREEN)

  **QA Scenarios**:

  ```
  Scenario: 蓝海词前置验证
    Tool: Bash (node --test)
    Steps:
      1. 调用generateTitles("纯银项链女高级感", coreWord, modifiers, peerTitles, products, 60)
      2. 验证每个返回标题以"纯银项链女高级感"开头
      3. 验证标题长度≤60字符
    Expected Result: 所有标题以蓝海词开头
    Failure Indicators: 标题不以蓝海词开头，标题超长
    Evidence: .sisyphus/evidence/task-6-blue-ocean-first.txt

  Scenario: GLM失败降级标题验证
    Tool: Bash (node --test)
    Steps:
      1. mock GLM generateTitles抛出错误
      2. 调用generateTitles("纯银项链女高级感", ...)
      3. 验证降级标题仍以蓝海词开头
    Expected Result: 降级标题格式为"蓝海词+刚性修饰词+核心词"
    Failure Indicators: 降级标题不以蓝海词开头，或降级逻辑抛出错误
    Evidence: .sisyphus/evidence/task-6-fallback-title.txt
  ```

  **Commit**: YES
  - Message: `refactor(title): blue-ocean keyword first placement in generated titles`
  - Files: `src/generate-title.js`, `test/generate-title.test.js`

- [x] 7. 新增output-formatter表格+JSON模块

  **What to do**:
  - **RED**: 先写测试 `test/output-formatter.test.js`
    - 测试1: `formatTable(results)` 返回中文对齐的表格字符串
    - 测试2: `formatJSON(results)` 返回格式化的JSON字符串
    - 测试3: 中文字符宽度计算正确（CJK双宽字符）
    - 测试4: 空结果返回友好提示
    - 测试5: 长标题截断显示（超过列宽时截断+省略号）
    - 测试6: 统计数据格式化（好评率96.2%而非0.962，30天销量12,680而非12680）
  - **GREEN**: 创建 `src/output-formatter.js`
    - 实现 `formatTable(results, options)` 函数
      - 表头：序号、链接原标题、产品链接、铺货标题、原价、30天销量、好评率、复购率、蓝海词
      - 中文字符宽度处理（CJK字符=2宽度）
      - 长字段截断+省略号
      - 数字格式化（千分位、百分比）
    - 实现 `formatJSON(results, options)` 函数
      - 输出JSON数组，每个元素包含8个字段
      - 好评率和复购率转换为百分比字符串或保留小数
    - 实现 `formatResult(results, format = 'both')` 函数
      - format='table' → 仅表格
      - format='json' → 仅JSON
      - format='both' (默认) → 表格 + JSON
      - 支持输出到文件：JSON写入 `output/{keyword}_{timestamp}.json`
  - **REFACTOR**: 确保模块可独立导入使用（为后续openclaw skill化准备）

  **Must NOT do**:
  - 不引入终端颜色库（使用纯文本格式）
  - 不写入数据库或外部存储
  - 不修改现有模块

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: 表格布局+中文字符宽度+数字格式化需要精细化处理
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (与Task 5, 6独立修改不同文件)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 8, 9
  - **Blocked By**: Task 2 (类型定义)

  **References**:

  **Pattern References**:
  - `bin/cli.js:38-53` - 当前CLI输出逻辑（简单console.log，需替换为格式化输出）

  **API/Type References**:
  - `src/types.js` (Task 2) - SelectionResult类型（8字段定义）

  **Test References**:
  - 无直接测试参考，需按JSDoc模式新建测试

  **WHY Each Reference Matters**:
  - `bin/cli.js`: 当前输出逻辑，需要理解输出格式以便替换
  - `types.js`: 输出的8字段定义是格式化模块的数据契约

  **Acceptance Criteria**:

  **If TDD**:
  - [ ] test/output-formatter.test.js 创建（RED）
  - [ ] `node --test test/output-formatter.test.js` → PASS (GREEN)

  **QA Scenarios**:

  ```
  Scenario: 表格格式化验证
    Tool: Bash (node)
    Steps:
      1. 调用formatTable(mockResults)
      2. 验证表头包含所有8列名
      3. 验证每行数据与mockResults对应
      4. 验证好评率显示为百分比格式（96.2%）
      5. 验证30天销量显示千分位（12,680）
    Expected Result: 格式化的中英文混排表格，数字格式正确
    Failure Indicators: 列对齐错误，中文字符宽度计算错误，数字格式错误
    Evidence: .sisyphus/evidence/task-7-table-format.txt

  Scenario: JSON格式化验证
    Tool: Bash (node)
    Steps:
      1. 调用formatJSON(mockResults)
      2. 验证输出为有效JSON
      3. 验证每个对象包含8个字段
      4. 验证字段名与类型定义一致
    Expected Result: 格式化的JSON数组，字段完整
    Failure Indicators: JSON无效，字段缺失或多余
    Evidence: .sisyphus/evidence/task-7-json-format.txt
  ```

  **Commit**: YES
  - Message: `feat(output): add table and JSON format module`
  - Files: `src/output-formatter.js`, `test/output-formatter.test.js`

- [x] 8. 重构index.js主流程编排

  **What to do**:
  - **RED**: 先写测试 `test/index.test.js`
    - 测试1: 完整流程：蓝海词→提取核心词→双重1688搜索→GLM评分→淘宝搜索→标题生成→返回结果
    - 测试2: 双重搜索间有3-5秒延迟（验证延迟调用）
    - 测试3: GLM评分降级时仍返回结果（使用刚性过滤）
    - 测试4: 淘宝搜索失败时仍生成标题（降级为无同行标题）
    - 测试5: 1688搜索全部为空时返回空结果
    - 测试6: 返回结果包含8个必要字段
  - **GREEN**: 重构 `src/index.js`
    - 新的 `run(blueOceanWord, options)` 函数签名（blueOceanWord=用户原输入=蓝海词）
    - 新流程：
      1. `extractCoreAndModifiers(blueOceanWord)` → 获取coreWord和modifiers
      2. `searchAll(coreWord, blueOceanWord, modifiers)` → 双重1688搜索+合并去重+GLM评分
      3. 与步骤2并行：`searchTaobaoTitles(blueOceanWord)` → 淘宝同行标题（用蓝海词搜索）
      4. 步骤2和3完成后：`generateTitles(blueOceanWord, coreWord, modifiers, taobaoTitles, products, maxLength)`
      5. 组装SelectionResult数组（8字段完整产品信息）
      6. 返回 `{ coreWord, blueOceanWord, modifiers, products: SelectionResult[], filteredCount }`
    - 1688并行搜索：核心词搜索完等3-5秒后再搜索蓝海词（顺序搜索，非并行）
    - 淘宝搜索与1688搜索的**第二次搜索并行**：蓝海词1688搜索和淘宝搜索可以同时开始
    - 错误处理：任何步骤失败都有降级方案
  - **REFACTOR**: 更新JSDoc，确保函数签名完整

  **Must NOT do**:
  - 不删除对 `banned-words.js` 的引用
  - 不修改 `extract-core.js`（提取逻辑不变）
  - 不修改 `search-taobao.js`（搜索逻辑不变）

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 主流程编排涉及所有模块集成，流程逻辑复杂，并发控制重要
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 4, 5, 6, 7)
  - **Parallel Group**: Wave 3 (必须在所有Wave 2完成后)
  - **Blocks**: Task 9, 10
  - **Blocked By**: Task 4 (search重构), Task 5 (GLM评分), Task 6 (标题重构), Task 7 (输出格式)

  **References**:

  **Pattern References**:
  - `src/index.js:19-64` - 当前run函数（需重构整个流程）
  - `src/index.js:30-37` - 当前并行搜索模式（需改为顺序1688+混合并行）

  **API/Type References**:
  - `src/search-1688.js` (Task 4修改后) - 新的searchAll函数
  - `src/glm-client.js` (Task 5修改后) - 新的judgeRelevance方法
  - `src/generate-title.js` (Task 6修改后) - 新的blueOceanWord参数
  - `src/output-formatter.js` (Task 7创建) - 格式化函数
  - `src/types.js` (Task 2) - SelectionResult类型

  **WHY Each Reference Matters**:
  - `index.js`: 核心修改文件——整个流程编排从此处控制
  - 各模块接口：run函数需要正确调用各模块的新/修改接口
  - types.js: 返回值必须符合SelectionResult类型

  **Acceptance Criteria**:

  **If TDD**:
  - [ ] test/index.test.js 创建（RED）
  - [ ] `node --test test/index.test.js` → PASS (GREEN)

  **QA Scenarios**:

  ```
  Scenario: 完整流程集成验证
    Tool: Bash (node --test)
    Steps:
      1. mock所有外部依赖（GLM、1688、淘宝）
      2. 调用run("纯银项链女高级感", {maxLength: 60, format: 'both'})
      3. 验证返回结果包含coreWord、blueOceanWord、products数组
      4. 验证每个product包含8个字段
      5. 验证products数组中每个铺货标题以蓝海词开头
    Expected Result: 完整的SelectionResult结构，所有字段填充
    Failure Indicators: 流程中断，字段缺失，蓝海词未前置
    Evidence: .sisyphus/evidence/task-8-integration.txt

  Scenario: 降级流程验证
    Tool: Bash (node --test)
    Steps:
      1. mock GLM评分失败
      2. mock 淘宝搜索失败
      3. 调用run("纯银项链女高级感")
      4. 验证仍返回结果（降级为刚性过滤+无同行标题）
    Expected Result: 降级流程仍能完成，不中断
    Failure Indicators: 任何降级场景导致流程崩溃
    Evidence: .sisyphus/evidence/task-8-fallback.txt
  ```

  **Commit**: YES
  - Message: `refactor(flow): restructure main pipeline for selection workflow`
  - Files: `src/index.js`, `test/index.test.js`

- [x] 9. 重构cli.js输出格式+参数

  **What to do**:
  - **RED**: 先写测试 `test/cli.test.js`
    - 测试1: 默认输出包含表格
    - 测试2: `--format json` 只输出JSON
    - 测试3: `--format table` 只输出表格
    - 测试4: `--format both` 输出表格+JSON
    - 测试5: 缺少环境变量时显示错误信息
  - **GREEN**: 重构 `bin/cli.js`
    - 新增 `--format <type>` 选项：table / json / both（默认both）
    - 更新 `run()` 调用：传入 `blueOceanWord` 作为新参数
    - 更新输出逻辑：使用 `output-formatter.js` 的 `formatResult()` 函数
    - 移除旧的 console.log 标题输出逻辑
    - 保留错误处理和退出码
    - 当 `--format json` 时，JSON同时写入 `output/{keyword}_{timestamp}.json` 文件
  - **REFACTOR**: 确保 CLI 参数有完整的帮助文本

  **Must NOT do**:
  - 不删除 `--length` 和 `--peer-titles` 等现有选项
  - 不修改 `--count` 死代码（不在范围内）
  - 不引入新的CLI依赖

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 简单的CLI参数更新和输出替换
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 7, 8)
  - **Parallel Group**: Wave 4
  - **Blocks**: Task 10
  - **Blocked By**: Task 7 (output-formatter), Task 8 (index.js重构)

  **References**:

  **Pattern References**:
  - `bin/cli.js:1-60` - 当前CLI入口，需替换输出逻辑

  **API/Type References**:
  - `src/output-formatter.js` (Task 7创建) - formatResult函数

  **WHY Each Reference Matters**:
  - `cli.js`: 核心修改文件——输出逻辑和参数定义
  - `output-formatter.js`: CLI需调用此模块进行格式化输出

  **Acceptance Criteria**:

  **If TDD**:
  - [ ] test/cli.test.js 创建（RED）
  - [ ] `node --test test/cli.test.js` → PASS (GREEN)

  **QA Scenarios**:

  ```
  Scenario: CLI --format参数验证
    Tool: Bash
    Steps:
      1. 运行 `node bin/cli.js "纯银项链女高级感" --format table --help`（仅验证参数解析）
      2. 验证--format参数被正确解析
      3. 验证帮助文本包含format选项说明
    Expected Result: 参数解析正确，帮助文本完整
    Failure Indicators: 参数不识别，帮助文本缺失
    Evidence: .sisyphus/evidence/task-9-cli-format.txt

  Scenario: CLI输出格式切换
    Tool: Bash (node --test with mock)
    Steps:
      1. 调用CLI输出函数with format='json'
      2. 验证输出为JSON数组
      3. 调用CLI输出函数with format='table'
      4. 验证输出为表格格式
      5. 调用CLI输出函数with format='both'
      6. 验证输出包含表格和JSON
    Expected Result: 每种格式正确切换，JSON文件同时写入
    Failure Indicators: 格式切换失败，JSON文件未创建
    Evidence: .sisyphus/evidence/task-9-format-switch.txt
  ```

  **Commit**: YES
  - Message: `feat(cli): add --format parameter and restructure output`
  - Files: `bin/cli.js`, `test/cli.test.js`

- [x] 10. 端到端集成测试

  **What to do**:
  - 创建 `test/e2e.test.js`，使用完整mock模拟端到端流程
  - 测试场景1: 完整流程（正常路径）——蓝海词输入→提取核心词→双重1688搜索→GLM评分→淘宝搜索→标题生成→格式化输出
  - 测试场景2: 1688搜索为空→返回空结果
  - 测试场景3: GLM评分失败→降级为刚性过滤
  - 测试场景4: 淘宝搜索失败→降级为无同行标题
  - 测试场景5: 所有外部依赖失败→仍返回有意义的结果或明确错误信息
  - 测试场景6: 格式切换（table/json/both）
  - 确保所有测试使用mock，不需要真实API密钥

  **Must NOT do**:
  - 不调用真实API（只用mock）
  - 不添加新的功能代码

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 端到端测试需要理解所有模块交互，模拟复杂场景
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 8, 9)
  - **Parallel Group**: Wave 4
  - **Blocks**: F1-F4
  - **Blocked By**: Task 8 (主流程重构), Task 9 (CLI重构)

  **References**:

  **Pattern References**:
  - `test/search-1688.test.js` (Task 4) - mock模式参考
  - `test/glm-client.test.js` (Task 5) - GLM mock参考

  **API/Type References**:
  - `src/index.js` (Task 8修改后) - run函数新签名和返回类型
  - `bin/cli.js` (Task 9修改后) - CLI新参数

  **WHY Each Reference Matters**:
  - 其他测试文件: 端到端测试需要复用相同的mock模式
  - `index.js`: E2E测试的核心对象
  - `cli.js`: 最终用户交互入口

  **Acceptance Criteria**:

  **If TDD**:
  - [ ] test/e2e.test.js 创建
  - [ ] `node --test test/e2e.test.js` → PASS

  **QA Scenarios**:

  ```
  Scenario: 完整端到端流程（正常路径）
    Tool: Bash (node --test)
    Steps:
      1. mock GLM extractCoreAndModifiers → {coreWord: "项链", modifiers: [...]}
      2. mock 1688 search → 返回3个产品
      3. mock GLM judgeRelevance → 返回评分(8, 6, 3)
      4. mock 淘宝搜索 → 返回5个同行标题
      5. mock GLM generateTitles → 返回3个标题
      6. 调用run("纯银项链女高级感", {format: 'both'})
      7. 验证返回结果包含3个产品（评分≥6）
      8. 验证每个铺货标题以蓝海词开头
      9. 验证每个产品包含8个字段
    Expected Result: 完整的端到端流程成功执行
    Failure Indicators: 任何环节出错，字段缺失，蓝海词未前置
    Evidence: .sisyphus/evidence/task-10-e2e-normal.txt

  Scenario: 全降级流程（所有外部依赖失败）
    Tool: Bash (node --test)
    Steps:
      1. mock GLM extractCoreAndModifiers → 返回降级结果
      2. mock 1688搜索成功但GLM评分失败 → 降级为刚性过滤
      3. mock 淘宝搜索失败 → 降级为无同行标题
      4. mock GLM generateTitles失败 → 降级为简单拼接
      5. 验证仍返回有效结果（即使质量较低）
    Expected Result: 全降级流程不崩溃，返回有意义的结果
    Failure Indicators: 任何降级场景导致流程崩溃或抛出未捕获异常
    Evidence: .sisyphus/evidence/task-10-e2e-degraded.txt
  ```

  **Commit**: YES
  - Message: `test(e2e): add end-to-end integration tests`
  - Files: `test/e2e.test.js`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `node --test test/*.test.js`. Review all changed files for: CommonJS compliance, JSDoc on all exports, Chinese comments on business logic, try/catch+降级 patterns, `as any` equivalents, empty catches, console.log in prod (console.warn OK), unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Run `node bin/cli.js "纯银项链女高级感"` — verify 8-field table output. Run with `--format json` — verify JSON output. Run with `--format table` — verify table only. Check 1688 delay between searches (observe console timestamps). Verify 蓝海词 appears at start of every 铺货标题.
  Output: `Scenarios [N/N pass] | Integration [N/N] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | VERDICT`

---

## Commit Strategy

- **Task 0+1+2**: `feat(test): add test framework and type interfaces` - test/setup.test.js, src/types.js, package.json
- **Task 3**: `refactor(1688): extract stats fields and add 429 retry logic` - src/alibaba1688-client.js, test/alibaba1688-client.test.js
- **Task 4**: `feat(search): dual 1688 search with rate limiting` - src/search-1688.js, test/search-1688.test.js
- **Task 5**: `feat(glm): add relevance scoring method` - src/glm-client.js, test/glm-client.test.js
- **Task 6**: `refactor(title): blue-ocean keyword first placement` - src/generate-title.js, test/generate-title.test.js
- **Task 7**: `feat(output): table and JSON format module` - src/output-formatter.js, test/output-formatter.test.js
- **Task 8**: `refactor(flow): restructure main pipeline for selection workflow` - src/index.js, test/index.test.js
- **Task 9**: `feat(cli): add --format parameter and new output format` - bin/cli.js, test/cli.test.js
- **Task 10**: `test(e2e): end-to-end integration tests` - test/e2e.test.js

---

## Success Criteria

### Verification Commands
```bash
# 所有测试通过
node --test test/*.test.js   # Expected: all pass, 0 failures

# CLI基本功能
node bin/cli.js "纯银项链女高级感"           # Expected: 8字段表格输出
node bin/cli.js "纯银项链女高级感" --format json  # Expected: JSON数组输出
node bin/cli.js "纯银项链女高级感" --format table  # Expected: 仅表格输出

# 模块单元测试
node --test test/search-1688.test.js    # Expected: dual search, dedup, rate limit tests pass
node --test test/glm-client.test.js      # Expected: relevance scoring tests pass
node --test test/output-formatter.test.js # Expected: table and JSON format tests pass
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass