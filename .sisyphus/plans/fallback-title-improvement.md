# Fallback 标题构造改进

## TL;DR

> **核心目标**: 改进 fallback 标题构造逻辑，当 GLM 未为产品生成标题时，从 1688 原标题和淘宝同行标题中提取关键词，构造 25-30 字的合格铺货标题，而非仅输出蓝海词本身（如 9 字的"戒指男潮牌高级感痞帅"）。
>
> **交付物**:
> - `src/title-utils.js` 新增 `constructFallbackTitle()` 函数
> - `src/index.js` 第 151-161 行替换为调用新函数
> - `src/generate-title.js` 第 43-54 行降级路径同步修复
> - 真实关键词测试通过
>
> **预估工作量**: Quick（3 个小任务 + 验证）
> **并行执行**: YES - Wave 1（2 任务并行）→ Wave 2（1 任务）→ Final
> **关键路径**: Task 1（title-utils）→ Task 2（index.js）→ Task 3（generate-title.js）→ 测试

---

## Context

### Original Request
用户在真实测试（关键词"戒指男潮牌高级感痞帅"）中发现：8 个产品的 titleMap 未匹配到 GLM 标题，fallback 构造的标题仅 9 字（即蓝海词本身），因为 rigidWords 去重后为空。用户明确要求："标题可以从原标题和淘宝同行的标题中提取"。

### Interview Summary
**Key Discussions**:
- **Fallback 算法**: 蓝海词前置 → 从原标题提取关键词 → 如有淘宝同行标题提取高频词补充 → 截断到 maxLength
- **不依赖淘宝数据**: 淘宝搜索经常返回 0 结果，fallback 必须仅基于原标题也能工作
- **generate-title.js 同样有此问题**: 降级路径使用相同的 rigidWords 拼接逻辑

**Research Findings**:
- `title-utils.js` 已有 cleanTitle、removeBannedWords、ensureBlueOceanPrefix、normalizeLength 等工具函数
- `index.js` fallback 点有 p.title、taobaoTitles、blueOceanWord、coreWord、maxLength 可用
- `generate-title.js` 降级路径有 blueOceanWord、coreWord、modifiers、products 可用，但没有 taobaoTitles

### Self-Review (Metis 替代 — Metis 超时未响应)
**识别的 Gap（自行处理）**:
- ✅ **Edge case: 原标题本身包含蓝海词**: 需移除后提取剩余关键词 — 算法已包含 `replace(blueOceanWord, '')`
- ✅ **Edge case: 淘宝标题为空**: fallback 仅基于原标题 — 算法已处理
- ✅ **Edge case: 原标题为空**: 返回蓝海词 + 核心词 — 需明确
- ✅ **Edge case: 提取的关键词去重**: 避免蓝海词中已有的词重复出现 — 算法已包含
- ✅ **generate-title.js 没有 taobaoTitles**: 降级路径仅基于 products 中第一个产品的标题 — 需处理

---

## Work Objectives

### Core Objective
改进 fallback 标题构造，确保所有产品（包括 GLM 未命中的）都能获得 25-30 字的合格铺货标题。

### Concrete Deliverables
- `src/title-utils.js`: 新增 `constructFallbackTitle(blueOceanWord, originalTitle, taobaoTitles, maxLength)` 函数
- `src/index.js`: 第 151-161 行替换为调用 `constructFallbackTitle`
- `src/generate-title.js`: 第 43-54 行降级路径使用 `constructFallbackTitle`

### Definition of Done
- [ ] `node -e "const {constructFallbackTitle} = require('./src/title-utils'); console.log(constructFallbackTitle('戒指男潮牌高级感痞帅', '简约时尚潮流个性复古不掉色钛钢戒指男', [], 60));"` 输出长度 >= 20 字符
- [ ] `node bin/cli.js "戒指男潮牌高级感痞帅" --length 60` 所有产品的铺货标题长度 >= 20 字符
- [ ] JSON 输出中无 9 字的 fallback 标题

### Must Have
- 蓝海词必须前置
- 标题无空格、无标点
- 从原标题提取关键词补充长度
- 淘宝同行标题可用时提取高频词进一步补充
- 不依赖淘宝数据（淘宝为空时仍能工作）
- generate-title.js 降级路径同步修复

### Must NOT Have (Guardrails)
- ❌ 不修改 glm-client.js（提示词已优化完毕）
- ❌ 不修改 banned-words.js 或 banned-words.json
- ❌ 不修改 search-1688.js 或 search-taobao.js
- ❌ 不引入新依赖（使用纯字符串操作，不引入分词库）
- ❌ 不修改 postProcessTitle 管线逻辑
- ❌ 不在 fallback 中调用 GLM API（fallback 就是 API 失败的兜底）

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: NO（项目无测试框架）
- **Automated tests**: NO（纯 JavaScript 验证）
- **Framework**: none

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Library/Module**: Use Bash (node REPL) - Import, call functions, compare output
- **CLI**: Use Bash - Run CLI, check JSON output, assert field values

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - 2 independent tasks):
├── Task 1: 新增 constructFallbackTitle 函数到 title-utils.js [deep]
└── Task 2: 修复 generate-title.js 降级路径 [deep]

Wave 2 (After Wave 1 - depends on Task 1):
└── Task 3: 替换 index.js fallback 逻辑 + 端到端测试 [deep]

Wave FINAL (After ALL tasks — 3 parallel reviews):
├── F1: Plan compliance audit [oracle]
├── F2: Code quality review [unspecified-high]
└── F3: Scope fidelity check [deep]
→ Present results → Get explicit user okay

Critical Path: Task 1 → Task 3 → Final
Parallel Speedup: Task 1 + Task 2 并行 → ~30% faster
Max Concurrent: 2 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | - | 3 | 1 |
| 2 | - | - | 1 |
| 3 | 1 | F1-F3 | 2 |
| F1 | 3 | user okay | Final |
| F2 | 3 | user okay | Final |
| F3 | 3 | user okay | Final |

### Agent Dispatch Summary

- **Wave 1**: **2** - T1 → `deep`, T2 → `deep`
- **Wave 2**: **1** - T3 → `deep`
- **FINAL**: **3** - F1 → `oracle`, F2 → `unspecified-high`, F3 → `deep`

---

## TODOs

- [x] 1. 新增 `constructFallbackTitle()` 函数到 `src/title-utils.js`

  **What to do**:
  - 在 `src/title-utils.js` 中新增 `constructFallbackTitle(blueOceanWord, originalTitle, taobaoTitles = [], maxLength = 60)` 函数
  - 算法步骤：
    1. 蓝海词作为前缀：`let result = blueOceanWord`
    2. 清理原标题：`let cleaned = cleanTitle(removeBannedWords(originalTitle))`
    3. 从清理后的原标题移除蓝海词本身：`cleaned = cleaned.replace(blueOceanWord, '')`
    4. 提取原标题剩余关键词（按 2 字一组滑动窗口统计高频词，或直接使用剩余字符串去重后的部分）
    5. 如果有 `taobaoTitles` 且非空，从同行标题中提取高频 2 字词组（出现 >= 2 次的）补充
    6. 将提取的关键词追加到 result 后面，去除已在蓝海词中出现过的词
    7. 截断到 maxLength
    8. 如果结果 < 20 字符，保留蓝海词 + 核心词作为最低保障
  - 添加 JSDoc：`@param {string} blueOceanWord`, `@param {string} originalTitle`, `@param {string[]} [taobaoTitles]`, `@param {number} [maxLength]`, `@returns {string}`
  - 在 `module.exports` 中导出 `constructFallbackTitle`
  - 使用中文内联注释

  **Must NOT do**:
  - 不修改已有的 cleanTitle、ensureBlueOceanPrefix、normalizeLength、postProcessTitle 函数
  - 不引入外部依赖（纯字符串操作）
  - 不调用任何 API

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 包含算法逻辑（高频词提取、去重、截断），需要精确实现
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Task 3
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References** (existing code to follow):
  - `src/title-utils.js:1-74` — 完整的 title-utils.js 文件。新函数应遵循相同的代码风格（JSDoc、中文注释、纯函数）。已有的 `cleanTitle`、`removeBannedWords`（从 banned-words.js 导入）可直接复用
  - `src/title-utils.js:8-12` — `cleanTitle()` 白名单过滤模式，新函数需要调用它
  - `src/title-utils.js:40-45` — `normalizeLength()` 长度截断模式，参考但不要直接调用（fallback 有不同的最短处理逻辑）

  **API/Type References**:
  - `src/banned-words.js:removeBannedWords(title)` — 返回移除违禁词后的标题字符串，已在 title-utils.js 第 1 行导入

  **WHY Each Reference Matters**:
  - title-utils.js 全文件：理解现有工具函数的风格和可复用部分
  - cleanTitle：新函数需要调用它清理原标题中的标点
  - removeBannedWords：新函数需要调用它过滤违禁词

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 正常 fallback — 原标题有关键词可提取
    Tool: Bash (node -e)
    Preconditions: title-utils.js 可正常加载
    Steps:
      1. 运行: node -e "const {constructFallbackTitle} = require('./src/title-utils'); const r = constructFallbackTitle('戒指男潮牌高级感痞帅', '简约时尚潮流个性复古不掉色钛钢戒指男', [], 60); console.log(r); console.log('len:', r.length);"
      2. 检查输出以"戒指男潮牌高级感痞帅"开头
      3. 检查长度 >= 20
      4. 检查无空格、无标点
    Expected Result: 标题以"戒指男潮牌高级感痞帅"开头，包含原标题提取的关键词，长度 20-60
    Failure Indicators: 长度 < 20，包含空格/标点，不以蓝海词开头
    Evidence: .sisyphus/evidence/task-1-normal-fallback.txt

  Scenario: 原标题 + 淘宝同行标题补充
    Tool: Bash (node -e)
    Preconditions: title-utils.js 可正常加载
    Steps:
      1. 运行: node -e "const {constructFallbackTitle} = require('./src/title-utils'); const r = constructFallbackTitle('戒指男潮牌高级感痞帅', '简约时尚戒指男', ['潮牌戒指男士简约时尚个性复古', '戒指男潮牌高级感钛钢不掉色'], 60); console.log(r); console.log('len:', r.length);"
      2. 检查输出以"戒指男潮牌高级感痞帅"开头
      3. 检查长度 >= 20
      4. 检查标题中有来自淘宝同行标题的关键词补充
    Expected Result: 标题长度 >= 20，包含淘宝高频词补充
    Failure Indicators: 长度 < 20，无淘宝关键词补充
    Evidence: .sisyphus/evidence/task-1-with-taobao.txt

  Scenario: 原标题为空 — 最低保障
    Tool: Bash (node -e)
    Preconditions: title-utils.js 可正常加载
    Steps:
      1. 运行: node -e "const {constructFallbackTitle} = require('./src/title-utils'); const r = constructFallbackTitle('戒指男潮牌高级感痞帅', '', [], 60); console.log(r); console.log('len:', r.length);"
      2. 检查输出以"戒指男潮牌高级感痞帅"开头
    Expected Result: 至少返回蓝海词本身（9字），不会 crash
    Failure Indicators: 抛出异常，返回 undefined/null
    Evidence: .sisyphus/evidence/task-1-empty-title.txt

  Scenario: 生成的标题与原标题不同
    Tool: Bash (node -e)
    Preconditions: title-utils.js 可正常加载
    Steps:
      1. 运行: node -e "const {constructFallbackTitle} = require('./src/title-utils'); const orig = '简约时尚潮流个性复古不掉色钛钢戒指男'; const r = constructFallbackTitle('戒指男潮牌高级感痞帅', orig, [], 60); console.log('orig:', orig); console.log('result:', r); console.log('different:', r !== orig);"
      2. 检查 r !== orig
    Expected Result: 结果标题与原标题不同（蓝海词前置确保了不同）
    Failure Indicators: r === orig
    Evidence: .sisyphus/evidence/task-1-different-from-orig.txt
  ```

  **Commit**: YES (groups with Task 2)
  - Message: `fix(title): add constructFallbackTitle and fix generate-title fallback`
  - Files: `src/title-utils.js`, `src/generate-title.js`
  - Pre-commit: `node -c src/title-utils.js && node -c src/generate-title.js`

- [x] 2. 修复 `src/generate-title.js` 降级路径

  **What to do**:
  - 在 `src/generate-title.js` 顶部添加 `const { constructFallbackTitle } = require('./title-utils');` 导入
  - 替换第 43-54 行的 catch 块中的降级逻辑：
    - **旧逻辑**（第 45-54 行）：手动拼接 `blueOceanWord + rigidWords + coreWord`
    - **新逻辑**：使用 `constructFallbackTitle(blueOceanWord, products.length > 0 && products[0].title ? products[0].title : '', [], maxLength)` 从第一个产品的原标题提取关键词
  - 如果 products 为空，回退到蓝海词 + 核心词
  - 保留 postProcessTitle 最终处理
  - 使用中文注释

  **Must NOT do**:
  - 不修改 try 块中的 GLM 调用逻辑
  - 不修改函数签名
  - 不引入外部依赖

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 需要理解现有降级逻辑并正确替换
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: None (Task 3 会处理 index.js)
  - **Blocked By**: None (can start immediately，但需要 Task 1 完成后 constructFallbackTitle 才存在；实际执行时 Wave 1 的两个任务由同一个 agent 按顺序处理)

  **References**:

  **Pattern References**:
  - `src/generate-title.js:43-54` — 当前的降级逻辑（catch 块）。需要替换第 45-54 行的手动拼接
  - `src/generate-title.js:1-2` — 现有导入，需要添加 constructFallbackTitle
  - `src/generate-title.js:16` — 函数签名 `generateTitles(blueOceanWord, coreWord, modifiers, peerTitles, products, maxLength)`，products 参数可用

  **WHY Each Reference Matters**:
  - 第 43-54 行：这是要替换的目标代码
  - 第 1-2 行：需要在这里添加新导入
  - 第 16 行：确认函数参数中 products 可用

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: generate-title.js 降级路径语法正确
    Tool: Bash
    Preconditions: src/generate-title.js 已修改
    Steps:
      1. 运行: node -c src/generate-title.js
    Expected Result: 无语法错误
    Failure Indicators: SyntaxError
    Evidence: .sisyphus/evidence/task-2-syntax-check.txt

  Scenario: 导入 constructFallbackTitle 成功
    Tool: Bash (node -e)
    Preconditions: title-utils.js 已导出 constructFallbackTitle
    Steps:
      1. 运行: node -e "const gen = require('./src/generate-title'); console.log(typeof gen.generateTitles);"
      2. 检查输出为 "function"
    Expected Result: "function"（模块正常加载）
    Failure Indicators: 抛出异常（说明导入失败）
    Evidence: .sisyphus/evidence/task-2-module-load.txt
  ```

  **Commit**: YES (groups with Task 1)
  - Message: `fix(title): add constructFallbackTitle and fix generate-title fallback`
  - Files: `src/title-utils.js`, `src/generate-title.js`
  - Pre-commit: `node -c src/title-utils.js && node -c src/generate-title.js`

- [x] 3. 替换 `src/index.js` fallback 逻辑 + 端到端测试

  **What to do**:
  - 确认 `src/index.js` 第 5 行已导入 `postProcessTitle`（需要新增导入 `constructFallbackTitle`）
  - 修改第 5 行为：`const { postProcessTitle, constructFallbackTitle } = require('./title-utils');`
  - 替换第 150-162 行的 fallback 逻辑：
    ```javascript
    // 旧代码（第 150-161 行）：
    let shopTitle = titleMap[normalizedId];
    if (!shopTitle) {
      const rigidWords = modifiers
        .filter(m => m.rigidity === 'rigid')
        .map(m => m.word)
        .filter(w => w && !blueOceanWord.includes(w));
      shopTitle = blueOceanWord + rigidWords.join('');
      if (coreWord && !blueOceanWord.includes(coreWord)) {
        shopTitle += coreWord;
      }
      console.warn(`⚠️ 产品 ${normalizedId} 无GLM标题，使用构造标题: ${shopTitle}`);
    }
    ```
    替换为：
    ```javascript
    let shopTitle = titleMap[normalizedId];
    if (!shopTitle) {
      shopTitle = constructFallbackTitle(blueOceanWord, p.title || '', taobaoTitles || [], maxLength);
      console.warn(`⚠️ 产品 ${normalizedId} 无GLM标题，使用构造标题: ${shopTitle}`);
    }
    ```
  - 使用中文注释
  - 运行端到端测试验证

  **Must NOT do**:
  - 不修改 titleMap 构建逻辑（第 122-138 行）
  - 不修改 GLM batch 处理逻辑（第 87-117 行）
  - 不修改淘宝搜索逻辑（第 65-77 行）
  - 不修改返回值结构

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 需要精确替换特定行范围 + 运行端到端测试
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (sequential, after Task 1)
  - **Blocks**: F1-F3
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/index.js:5` — 现有导入行 `const { postProcessTitle } = require('./title-utils');`，需要扩展
  - `src/index.js:142-180` — 完整的 `enriched` map 回调，包含要替换的 fallback 逻辑
  - `src/index.js:150-161` — 精确的 fallback 代码块（6 行替换为 3 行）
  - `src/index.js:67` — `taobaoTitles` 变量在此初始化，在 fallback 点可用
  - `src/index.js:25` — `maxLength` 解构参数，在 fallback 点可用
  - `src/index.js:145-146` — `productId` 和 `detailUrl` 构建方式，不修改

  **WHY Each Reference Matters**:
  - 第 5 行：需要添加 constructFallbackTitle 导入
  - 第 150-161 行：这是要替换的精确代码块
  - 第 67 行：确认 taobaoTitles 在 fallback 点可用
  - 第 25 行：确认 maxLength 在 fallback 点可用
  - 第 142-180 行：理解 enriched map 的完整上下文，避免误改

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 语法检查通过
    Tool: Bash
    Preconditions: src/index.js 已修改
    Steps:
      1. 运行: node -c src/index.js
    Expected Result: 无语法错误
    Failure Indicators: SyntaxError
    Evidence: .sisyphus/evidence/task-3-syntax-check.txt

  Scenario: 模块正常加载
    Tool: Bash (node -e)
    Preconditions: 所有文件已修改
    Steps:
      1. 运行: node -e "const {run} = require('./src/index'); console.log(typeof run);"
      2. 检查输出为 "function"
    Expected Result: "function"
    Failure Indicators: 抛出异常
    Evidence: .sisyphus/evidence/task-3-module-load.txt

  Scenario: 端到端 CLI 测试（需要 API keys）
    Tool: Bash
    Preconditions: .env 已配置 GLM_API_KEY 和 ALI_1688_AK
    Steps:
      1. 运行: node bin/cli.js "戒指男潮牌高级感痞帅" --length 60
      2. 等待执行完成（可能需要 1-2 分钟）
      3. 检查输出 JSON 中所有 "铺货标题" 字段
      4. 确认没有标题等于 "戒指男潮牌高级感痞帅"（9字，即纯蓝海词）
      5. 确认所有标题 >= 20 字符
      6. 确认所有标题以 "戒指男潮牌高级感痞帅" 开头
      7. 确认所有标题无空格、无标点
    Expected Result: 所有铺货标题 20-60 字符，蓝海词前置，无空格标点
    Failure Indicators: 存在 9 字标题，存在空格/标点，蓝海词未前置
    Evidence: .sisyphus/evidence/task-3-e2e-test.json

  Scenario: constructFallbackTitle 单元验证
    Tool: Bash (node -e)
    Preconditions: title-utils.js 已更新
    Steps:
      1. 运行: node -e "
const {constructFallbackTitle} = require('./src/title-utils');
// 测试1: 正常情况
const r1 = constructFallbackTitle('戒指男潮牌高级感痞帅', '简约时尚潮流个性复古不掉色钛钢戒指男', [], 60);
console.log('Test1:', r1, 'len:', r1.length);
console.assert(r1.startsWith('戒指男潮牌高级感痞帅'), 'Must start with blue ocean word');
console.assert(r1.length >= 20, 'Must be >= 20 chars');
console.assert(!/[^a-zA-Z0-9\u4e00-\u9fa5]/.test(r1.replace('戒指男潮牌高级感痞帅', '')), 'No special chars after prefix');

// 测试2: 空原标题
const r2 = constructFallbackTitle('戒指男潮牌高级感痞帅', '', [], 60);
console.log('Test2:', r2, 'len:', r2.length);
console.assert(r2 === '戒指男潮牌高级感痞帅', 'Should be blue ocean word only');

// 测试3: 带淘宝标题
const r3 = constructFallbackTitle('戒指男潮牌高级感痞帅', '简约戒指男', ['潮牌戒指男士个性复古不掉色', '戒指男潮牌高级感钛钢'], 60);
console.log('Test3:', r3, 'len:', r3.length);
console.assert(r3.length >= 20, 'With taobao should be >= 20');
"
    Expected Result: 所有 console.assert 通过，无 AssertionError
    Failure Indicators: AssertionError 抛出
    Evidence: .sisyphus/evidence/task-3-unit-tests.txt
  ```

  **Commit**: YES
  - Message: `fix(title): replace index.js fallback with constructFallbackTitle`
  - Files: `src/index.js`
  - Pre-commit: `node -c src/index.js`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 3 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `node -c src/title-utils.js` + `node -c src/index.js` + `node -c src/generate-title.js` to check syntax. Review changed files for: syntax errors, unused imports, missing JSDoc, Chinese comments. Check the new function has proper @param/@returns. Verify no regression in existing functions.
  Output: `Syntax [PASS/FAIL] | JSDoc [N/N] | Regression [CLEAN/N issues] | VERDICT`

- [x] F3. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Verify glm-client.js, banned-words.js, search-1688.js, search-taobao.js were NOT modified.
  Output: `Tasks [N/N compliant] | Forbidden Files [CLEAN/N modified] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `fix(title): add constructFallbackTitle to title-utils and fix generate-title fallback` - src/title-utils.js, src/generate-title.js
- **Wave 2**: `fix(title): replace index.js fallback logic with constructFallbackTitle` - src/index.js
- Pre-commit: `node -c src/title-utils.js && node -c src/index.js && node -c src/generate-title.js`

---

## Success Criteria

### Verification Commands
```bash
# 1. 函数单元验证
node -e "const {constructFallbackTitle} = require('./src/title-utils'); const r = constructFallbackTitle('戒指男潮牌高级感痞帅', '简约时尚潮流个性复古不掉色钛钢戒指男', [], 60); console.log(r); console.log('长度:', r.length);"
# Expected: 标题以"戒指男潮牌高级感痞帅"开头，长度 >= 20，无空格无标点

# 2. 端到端 CLI 测试（需要 live API keys）
node bin/cli.js "戒指男潮牌高级感痞帅" --length 60
# Expected: 所有铺货标题 >= 20 字符，无 9 字 fallback

# 3. 语法检查
node -c src/title-utils.js && node -c src/index.js && node -c src/generate-title.js
# Expected: 无错误
```

### Final Checklist
- [ ] constructFallbackTitle 函数已添加到 title-utils.js 并导出
- [ ] index.js 第 151-161 行已替换
- [ ] generate-title.js 降级路径已修复
- [ ] 所有 "Must NOT Have" 文件未被修改
- [ ] 真实测试所有标题 >= 20 字符
