# 铺货标题质量修复（4个关键Bug）

## TL;DR

> **Quick Summary**: 修复4个标题质量Bug：逗号/标点残留、标题与原标题相同、蓝海词未前置、字数不稳定。通过创建统一后处理管线 + 优化GLM提示词 + 修复titleMap匹配逻辑解决。
> 
> **Deliverables**:
> - 新模块 `src/title-utils.js`（cleanTitle, ensureBlueOceanPrefix, normalizeLength, postProcessTitle）
> - 更新 `src/glm-client.js`（selectAndGenerate 和 generateTitles 提示词）
> - 更新 `src/index.js`（titleMap匹配 + 两条路径的后处理）
> - 更新 `src/generate-title.js`（使用postProcessTitle + 修复前缀空格）
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: Task 1 → Task 3 → Task 4

---

## Context

### Original Request
用户测试后发现4个标题质量问题：
1. 标题包含逗号等标点符号（正常淘宝标题不应有标点）
2. 很多标题与1688原标题一模一样（titleMap productId不匹配直接fallback）
3. 蓝海词没有放在标题最前面
4. 标题字数不稳定（有的15字，有的35+字），目标约30个中文字（50-60字符）

### Interview Summary
**Key Discussions**:
- 问题1：`removeBannedWords()` 只移除违禁词不移除标点，`index.js:113` 的 `replace(/\s+/g, '')` 只移除空格
- 问题2：`titleMap[productId] || p.title` 当productId不匹配时fallback到原标题，击败了生成标题的目的
- 问题3：`selectAndGenerate` 提示词未要求蓝海词前置，`generateTitles` 有要求但主流程不使用它
- 问题4：`selectAndGenerate` 提示词未提及字数目标，无后处理长度归一化

**Research Findings**:
- **双路径问题**：主路径用 `selectAndGenerate()`，降级路径用 `generateTitles()`，两条路径的后处理不同
- **generate-title.js 未使用**：`index.js` 从不调用 `generate-title.js`，但应保持一致性
- **Metis分析**：需要统一后处理管线，两条路径都必须应用相同的修复

### Metis Review
**Identified Gaps** (addressed):
- 标点移除范围未定义 → 采用白名单方式：保留字母数字和中文字符，移除所有CJK和ASCII标点
- 长度目标含混 → JS中CJK字符长度=1，目标25-30字符，最小20，最大60
- fallback标题构造 → 蓝海词+刚性修饰词拼接，跳过已含在蓝海词中的coreWord
- generate-title.js状态 → 保持一致性更新，尽管主流程未使用
- 后处理顺序 → removeBannedWords → cleanTitle → ensureBlueOceanPrefix → normalizeLength → removeSpaces
- titleMap不应模糊匹配数字ID → 精确匹配+trim归一化

---

## Work Objectives

### Core Objective
修复4个标题质量Bug，使铺货标题：无标点、与原标题不同、蓝海词前置、字数稳定在25-30中文字。

### Concrete Deliverables
- `src/title-utils.js` — 标题后处理管线（cleanTitle, ensureBlueOceanPrefix, normalizeLength, postProcessTitle）
- 更新 `src/glm-client.js` — selectAndGenerate 提示词增加蓝海词前置、字数范围、无标点要求
- 更新 `src/glm-client.js` — generateTitles 提示词增加无标点、最小字数要求
- 更新 `src/index.js` — titleMap归一化匹配 + 构造标题fallback + 两条路径使用postProcessTitle
- 更新 `src/generate-title.js` — 使用postProcessTitle + 去除蓝海词前缀空格

### Definition of Done
- [x] `node -e "const {cleanTitle} = require('./src/title-utils'); console.log(cleanTitle('痞帅潮牌戒指，男！韩版钛钢方钻指环；小众轻奢饰品'))"` → 输出无标点
- [x] `node -e "const {ensureBlueOceanPrefix} = require('./src/title-utils'); console.log(ensureBlueOceanPrefix('韩版钛钢方钻指环小众轻奢饰品', '痞帅潮牌戒指'))"` → 输出以"痞帅潮牌戒指"开头
- [ ] `node bin/cli.js "戒指男潮牌高级感痞帅" --length 60` → 输出标题无逗号/标点、标题≠原标题、蓝海词前置、25-40字符
- [x] 所有修改文件通过 `node -c` 语法检查

### Must Have
- 所有标题移除CJK和ASCII标点（保留字母、数字、中文字符）
- titleMap不匹配时使用蓝海词+刚性修饰词构造标题，而非原标题
- 每条标题必须以蓝海词开头（后处理强制保证）
- 标题字数目标25-30中文字（最小20，最大60）
- selectAndGenerate提示词明确要求蓝海词前置、字数范围、无标点
- 两条代码路径（主路径+降级路径）使用统一后处理管线

### Must NOT Have (Guardrails)
- ❌ 不修改 `removeBannedWords()` 函数签名或行为（新增 `cleanTitle()` 作为独立函数）
- ❌ 不修改 CLI 接口（`bin/cli.js` 不变）
- ❌ 不修改1688搜索、产品过滤、评分逻辑（`search-1688.js`、`score-local.js` 不变）
- ❌ 不修改 `extract-core.js` 和 `alibaba1688-client.js`
- ❌ 不修改批量处理逻辑（BATCH_SIZE=5 不变）
- ❌ 不使用模糊匹配数字ID（如Levenshtein距离）
- ❌ 不为短标题填充随机词（短于20字符的标题丢弃）
- ❌ 不添加新的npm依赖

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES（node:test, 但使用不充分）
- **Automated tests**: None（项目测试框架简陋，本次不新增测试）
- **Framework**: node:test（已有但不强制）

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **CLI/Module**: Use Bash (`node -c` for syntax, `node -e` for unit test, `node bin/cli.js` for integration)
- **Integration**: Use Bash (end-to-end CLI test with real API keys)

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - foundation):
├── Task 1: Create src/title-utils.js — 后处理管线 [quick]
└── Task 2: Update glm-client.js prompts — 提示词优化 [deep]

Wave 2 (After Wave 1 - integration):
├── Task 3: Fix index.js — titleMap匹配 + 后处理管线 [unspecified-high]
└── Task 4: Fix generate-title.js — 使用postProcessTitle [quick]

Wave FINAL (After ALL tasks — 4 parallel reviews, then user okay):
├── Task F1: 计划合规审计 (oracle)
├── Task F2: 代码质量审查 (unspecified-high)
├── Task F3: 真实手动QA (unspecified-high)
└── Task F4: 范围保真检查 (deep)
→ Present results → Get explicit user okay

Critical Path: Task 1 → Task 3 → Task 4 → F1-F4 → user okay
Parallel Speedup: ~40% faster than sequential
Max Concurrent: 2 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | - | 3, 4 | 1 |
| 2 | - | - | 1 |
| 3 | 1 | F1-F4 | 2 |
| 4 | 1 | F1-F4 | 2 |

### Agent Dispatch Summary

- **Wave 1**: 2 tasks — T1 → `quick`, T2 → `deep`
- **Wave 2**: 2 tasks — T3 → `unspecified-high`, T4 → `quick`
- **FINAL**: 4 tasks — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Create `src/title-utils.js` — 标题后处理管线

  **What to do**:
  - 创建新模块 `src/title-utils.js`
  - 实现 `cleanTitle(title)` 函数：
    - 移除所有CJK标点：`，。！？；：、""''【】《》「」·…—`
    - 移除所有ASCII标点：`,\.!?;:\"'()[]{}`
    - 保留：字母(a-zA-Z)、数字(0-9)、中文字符(\u4e00-\u9fa5)、空格（后续单独处理）
    - 使用正则表达式，白名单方式（只保留允许的字符）
  - 实现 `ensureBlueOceanPrefix(title, blueOceanWord)` 函数：
    - 检查标题是否以蓝海词开头
    - 如果已以蓝海词开头，直接返回（避免重复如"纯银项链纯银项链女..."）
    - 如果不以蓝海词开头，移除标题开头到蓝海词之间的内容，然后添加蓝海词前缀
    - 如果标题中包含蓝海词但不在开头，移除蓝海词出现的位置并在开头添加
    - 不加空格：`blueOceanWord + title`（不是 `blueOceanWord + ' ' + title`）
  - 实现 `normalizeLength(title, minLength, maxLength)` 函数：
    - 默认参数：minLength=20, maxLength=60
    - 如果 title.length < minLength，返回 null（过短标题丢弃）
    - 如果 title.length > maxLength，截断到maxLength（尽量在完整词语边界截断）
    - 否则返回原标题
    - 截断逻辑：从maxLength位置向前查找最后一个中文字符的位置（避免截断在英文字母中间）
  - 实现 `postProcessTitle(title, blueOceanWord, minLength, maxLength)` 函数：
    - 按顺序调用管线：`removeBannedWords()` → `cleanTitle()` → `ensureBlueOceanPrefix()` → `normalizeLength()` → `replace(/\s+/g, '')` → 去重检查
    - 导入 `removeBannedWords` 从 `./banned-words`
    - 最终去重检查：如果结果与原标题完全相同（删除前后比较），console.warn 提示
    - 如果 normalizeLength 返回 null，console.warn 提示标题过短被丢弃，返回 null
    - 返回处理后的标题字符串，或 null（如果被丢弃）
  - 遵循项目代码规范：CommonJS, JSDoc `@param` `@returns`, 中文内联注释
  - 导出：`cleanTitle`, `ensureBlueOceanPrefix`, `normalizeLength`, `postProcessTitle`

  **Must NOT do**:
  - 不修改 `banned-words.js` 或 `data/banned-words.json`
  - 不添加新的npm依赖
  - 不修改 `cleanTitle` 的行为使其移除字母或数字
  - 不在 `ensureBlueOceanPrefix` 中添加空格

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 纯函数实现，逻辑明确，无外部依赖变更
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Tasks 3, 4
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/banned-words.js:11-19` — `removeBannedWords()` 函数的实现模式：遍历词表 + 正则替换 + 空格处理
  - `src/index.js:110-116` — 当前标题后处理逻辑：空格移除 `t.title.replace(/\s+/g, '')`
  - `src/generate-title.js:36-49` — 当前蓝海词前缀验证逻辑

  **WHY Each Reference Matters**:
  - banned-words.js 规定了代码风格和错误处理模式
  - index.js 的当前后处理逻辑是需要被替换的目标
  - generate-title.js 的蓝海词验证逻辑是需要被改进的目标

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 模块语法检查通过
    Tool: Bash
    Preconditions: src/title-utils.js 已创建
    Steps:
      1. 运行 `node -c src/title-utils.js`
    Expected Result: 无输出（语法正确）
    Failure Indicators: SyntaxError
    Evidence: .sisyphus/evidence/task-1-syntax-check.txt

  Scenario: cleanTitle移除所有标点保留字母数字中文
    Tool: Bash
    Preconditions: src/title-utils.js 已创建
    Steps:
      1. 运行 `node -e "const {cleanTitle} = require('./src/title-utils'); console.log(cleanTitle('痞帅潮牌戒指，男！韩版钛钢方钻指环；小众轻奢饰品'))"`
      2. 运行 `node -e "const {cleanTitle} = require('./src/title-utils'); console.log(cleanTitle('925纯银项链女，韩版简约百搭'))"`
      3. 运行 `node -e "const {cleanTitle} = require('./src/title-utils'); console.log(cleanTitle('A款韩版戒指（XL码）'))"`
    Expected Result: 
      1. 痞帅潮牌戒指男韩版钛钢方钻指环小众轻奢饰品（无逗号感叹号分号）
      2. 925纯银项链女韩版简约百搭（保留数字925，无逗号）
      3. A款韩版戒指XL码（保留字母A和XL，无括号）
    Failure Indicators: 输出仍包含标点，或数字/字母被移除
    Evidence: .sisyphus/evidence/task-1-clean-title.txt

  Scenario: ensureBlueOceanPrefix正确添加前缀
    Tool: Bash
    Preconditions: src/title-utils.js 已创建
    Steps:
      1. 运行 `node -e "const {ensureBlueOceanPrefix} = require('./src/title-utils'); console.log(ensureBlueOceanPrefix('韩版钛钢方钻指环小众轻奢饰品', '痞帅潮牌戒指'))"`
      2. 运行 `node -e "const {ensureBlueOceanPrefix} = require('./src/title-utils'); console.log(ensureBlueOceanPrefix('痞帅潮牌戒指韩版钛钢', '痞帅潮牌戒指'))"`
      3. 运行 `node -e "const {ensureBlueOceanPrefix} = require('./src/title-utils'); console.log(ensureBlueOceanPrefix('小众轻奢痞帅潮牌戒指饰品', '痞帅潮牌戒指'))"`
    Expected Result:
      1. 痞帅潮牌戒指韩版钛钢方钻指环小众轻奢饰品（添加前缀，无空格）
      2. 痞帅潮牌戒指韩版钛钢（不重复添加）
      3. 痞帅潮牌戒指小众轻奢饰品（移除中间出现并前置）
    Failure Indicators: 蓝海词未前置，或蓝海词重复
    Evidence: .sisyphus/evidence/task-1-prefix.txt

  Scenario: normalizeLength正确处理长度
    Tool: Bash
    Preconditions: src/title-utils.js 已创建
    Steps:
      1. 运行 `node -e "const {normalizeLength} = require('./src/title-utils'); console.log(normalizeLength('短标题', 20, 60))"`
      2. 运行 `node -e "const {normalizeLength} = require('./src/title-utils'); console.log(normalizeLength('痞帅潮牌戒指男韩版钛钢方钻指环小众轻奢饰品925银', 20, 30))"`
      3. 运行 `node -e "const {normalizeLength} = require('./src/title-utils'); const t = '适中标题长度测试'; console.log(t.length); console.log(normalizeLength(t, 10, 60)?.length)"`
    Expected Result:
      1. null（短于20字符被丢弃）
      2. 截断后不超过30字符
      3. 原标题长度不变
    Failure Indicators: 短标题未被丢弃，长标题未被截断，正常标题被修改
    Evidence: .sisyphus/evidence/task-1-length.txt

  Scenario: postProcessTitle完整管线测试
    Tool: Bash
    Preconditions: src/title-utils.js 已创建
    Steps:
      1. 运行 `node -e "const {postProcessTitle} = require('./src/title-utils'); console.log(postProcessTitle('韩版钛钢，方钻指环！小众轻奢；饰品', '痞帅潮牌戒指', 20, 60))"`
    Expected Result: 痞帅潮牌戒指韩版钛钢方钻指环小众轻奢饰品（无标点、蓝海词前置、20-60字符）
    Failure Indicators: 标点残留、蓝海词未前置、长度不符
    Evidence: .sisyphus/evidence/task-1-pipeline.txt
  ```

  **Commit**: YES
  - Message: `feat(title): add title post-processing utility module`
  - Files: `src/title-utils.js`
  - Pre-commit: `node -c src/title-utils.js`

- [x] 2. Update `glm-client.js` prompts — selectAndGenerate + generateTitles

  **What to do**:
  - 更新 `src/glm-client.js` 中 `selectAndGenerate` 方法的系统提示词（第255-262行附近）
  - 在现有提示词基础上增加以下明确约束（保持JSON输出格式不变）：
    1. 每个标题必须以蓝海词开头（蓝海词是最重要的SEO关键词）
    2. 标题长度目标25-30个中文字符（对应50-60字节），最短不少于20字，最长不超过60字
    3. 标题中不允许出现任何标点符号（包括逗号、句号、感叹号、分号、冒号、顿号、括号等中英文标点）
    4. 标题用词应参考同行标题和刚性修饰词
    5. 每个标题必须与原商品标题不同（重新组织用词，不能照搬原文）
    6. 标题之间不要有空格，连续书写
  - 保持提示词中的JSON输出格式定义不变
  - 更新 `generateTitles` 方法的系统提示词（第181-192行附近）
  - 增加以下约束：
    1. 标题中不允许出现任何标点符号
    2. 标题最短不少于20字
    3. 标题之间不要有空格，连续书写
  - 保持现有方法签名和返回格式不变

  **Must NOT do**:
  - 不修改JSON输出格式定义
  - 不修改方法签名或参数
  - 不修改 `extractCoreAndModifiers` 或 `judgeRelevance` 方法
  - 不修改temperature或timeout配置
  - 不移除已有的提示词内容（仅在基础上添加）

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 提示词工程需要精心设计，约束需要精确表达以确保GLM理解
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: None（提示词独立于代码改动）
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/glm-client.js:255-262` — `selectAndGenerate` 当前系统提示词（仅描述JSON格式，缺少质量约束）
  - `src/glm-client.js:181-192` — `generateTitles` 当前系统提示词（有蓝海词前置和长度，但无标点和字数下限）
  - `src/glm-client.js:265-267` — 用户消息构建方式 `JSON.stringify({blueOceanWord, coreWord, modifiers, peerTitles, maxLength, products})`

  **WHY Each Reference Matters**:
  - 两个提示词是需要修改的直接目标
  - JSON输出格式必须保持不变
  - 用户消息构建方式决定GLM接收的数据结构

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 模块语法检查通过
    Tool: Bash
    Preconditions: src/glm-client.js 已修改
    Steps:
      1. 运行 `node -c src/glm-client.js`
    Expected Result: 无输出（语法正确）
    Failure Indicators: SyntaxError
    Evidence: .sisyphus/evidence/task-2-syntax-check.txt

  Scenario: selectAndGenerate提示词包含所有新增约束
    Tool: Bash
    Preconditions: src/glm-client.js 已修改
    Steps:
      1. 在 glm-client.js 中搜索 "蓝海词" 和 "开头"
      2. 在 glm-client.js 中搜索 "标点" 或 "逗号"
      3. 在 glm-client.js 中搜索 "25" 和 "30"（字数范围）
      4. 在 glm-client.js 中搜索 "不同"（标题与原标题不同）
    Expected Result: selectAndGenerate 的 systemPrompt 包含上述所有关键词
    Failure Indicators: 缺少任何一个关键词
    Evidence: .sisyphus/evidence/task-2-prompt-check.txt

  Scenario: generateTitles提示词包含新增约束
    Tool: Bash
    Preconditions: src/glm-client.js 已修改
    Steps:
      1. 在 glm-client.js 的 generateTitles 方法中搜索 "标点"
      2. 在 generateTitles 方法中搜索 "20"（最短字数）
    Expected Result: generateTitles 的 systemPrompt 包含这两个关键词
    Failure Indicators: 缺少关键词
    Evidence: .sisyphus/evidence/task-2-prompt2-check.txt

  Scenario: 方法签名未被修改
    Tool: Bash
    Preconditions: src/glm-client.js 已修改
    Steps:
      1. 运行 `node -e "const GLMClient = require('./src/glm-client.js'); const c = new GLMClient({apiKey:'test'}); console.log(typeof c.selectAndGenerate, typeof c.generateTitles, typeof c.extractCoreAndModifiers)"`
    Expected Result: 输出 "function function function"（三个方法都存在）
    Failure Indicators: 输出 "undefined" 或报错
    Evidence: .sisyphus/evidence/task-2-method-check.txt
  ```

  **Commit**: YES
  - Message: `fix(glm): improve selectAndGenerate and generateTitles prompts`
  - Files: `src/glm-client.js`
  - Pre-commit: `node -c src/glm-client.js`

- [x] 3. Fix `index.js` — titleMap匹配 + 后处理管线集成

  **What to do**:
  - 在 `src/index.js` 顶部添加 `const { postProcessTitle } = require('./title-utils');`
  - **修复titleMap匹配**（当前第127-132行）：
    - 构建titleMap时，使用归一化的productId：`String(t.productId || t.product_id || '').trim()`
    - 查找titleMap时，使用相同的归一化key：`String(p.id || p.offerId || p.productId || '').trim()`
  - **修复主路径标题后处理**（当前第110-116行）：
    - 替换 `t.title = t.title.replace(/\s+/g, '')` 为 `postProcessTitle(t.title, blueOceanWord, 20, maxLength)`
    - postProcessTitle已经包含removeBannedWords（在glm-client.js:306中调用），但为避免双重调用，检查是否需要在index.js中再次调用
    - 注意：glm-client.js:306 已经调用了 `removeBannedWords(t.title)`，所以titleMap中存储的已经是经过removeBannedWords处理的标题
    - 因此在index.js中只需调用 postProcessTitle 对titleMap中的值做cleanTitle + ensureBlueOceanPrefix + normalizeLength + removeSpaces处理
    - 为避免重复调用removeBannedWords，可以使用一个轻量版本或直接调用子函数
    - **最佳方案**：在index.js中对titleMap中的标题调用 `postProcessTitle` 但传入已经removeBannedWords处理过的标题，postProcessTitle内部会再次调用removeBannedWords但因为是幂等的所以无副作用
  - **修复fallback标题构造**（当前第147行 `titleMap[productId] || p.title`）：
    - 将 `p.title` fallback 替换为构造的标题
    - 构造逻辑：取 `blueOceanWord` + 拼接 `modifiers` 中刚性修饰词（`rigidity === 'rigid'`）
    - 去重：如果 `coreWord` 已包含在 `blueOceanWord` 中，则跳过 `coreWord`
    - 如果构造标题过短（<20字符），仍然使用 `p.title` 作为最后兜底但打印 console.warn
  - **修复降级路径**（当前第170-222行）：
    - 在 `glmClient.generateTitles()` 后（第175行），对生成的标题调用 `postProcessTitle`
    - 在最终降级路径（第200-220行），对fallback标题也调用 `postProcessTitle`
  - 确保 `products` 数组中的每个产品都有经过完整后处理的铺货标题

  **Must NOT do**:
  - 不修改 `removeBannedWords` 的调用位置（保持glm-client.js中的调用）
  - 不修改批量处理逻辑（BATCH_SIZE=5不变）
  - 不修改1688搜索、淘宝搜索的调用逻辑
  - 不修改CLI接口

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 修改主流程文件，需要确保titleMap匹配逻辑和多路径后处理都正确
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (sequential)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 1 (需要title-utils.js)

  **References**:

  **Pattern References**:
  - `src/index.js:1-225` — 完整主流程文件，包含所有需要修改的代码
  - `src/index.js:86-132` — 批量GLM处理和titleMap构建逻辑
  - `src/index.js:136-158` — 产品enriched组装逻辑（包含fallback到p.title）
  - `src/index.js:170-222` — 降级路径（generateTitles fallback）

  **API/Type References**:
  - `src/title-utils.js` (Task 1 创建) — `postProcessTitle(title, blueOceanWord, minLength, maxLength)` 签名
  - `src/banned-words.js:removeBannedWords` — 已经在glm-client.js:306调用，postProcessTitle也会调用

  **WHY Each Reference Matters**:
  - index.js 是主要修改文件，理解当前逻辑结构至关重要
  - titleMap匹配和fallback是Bug 2的核心
  - 降级路径也需要与主路径使用相同的后处理管线
  - postProcessTitle的调用时机需要避免双重removeBannedWords（但幂等性保证安全）

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 模块语法检查通过
    Tool: Bash
    Preconditions: src/index.js 已修改
    Steps:
      1. 运行 `node -c src/index.js`
    Expected Result: 无输出（语法正确）
    Failure Indicators: SyntaxError
    Evidence: .sisyphus/evidence/task-3-syntax-check.txt

  Scenario: titleMap使用归一化productId
    Tool: Bash
    Preconditions: src/index.js 已修改
    Steps:
      1. 在 index.js 中搜索 String(.*).trim() 模式的productId归一化
      2. 确认titleMap构建和查找都使用了归一化key
    Expected Result: 找到至少2处归一化代码（构建+查找）
    Failure Indicators: 未找到归一化代码
    Evidence: .sisyphus/evidence/task-3-titlemap-check.txt

  Scenario: 主路径使用postProcessTitle
    Tool: Bash
    Preconditions: src/index.js 已修改
    Steps:
      1. 在 index.js 中搜索 postProcessTitle
      2. 确认至少在主路径和降级路径中都有调用
    Expected Result: 找到3处以上调用（主路径titleMap构建、enriched组装、降级路径）
    Failure Indicators: 少于3处调用
    Evidence: .sisyphus/evidence/task-3-postprocess-check.txt

  Scenario: fallback不使用p.title作为首选
    Tool: Bash
    Preconditions: src/index.js 已修改
    Steps:
      1. 在 index.js 中搜索 p.title 用作铺货标题的位置
      2. 确认 p.title 只作为最终兜底（在构造标题失败时），而非首选
    Expected Result: p.title 的使用有 console.warn 伴随，且仅在构造标题失败时使用
    Failure Indicators: p.title 直接用作首选fallback
    Evidence: .sisyphus/evidence/task-3-fallback-check.txt

  Scenario: 集成测试（需要有效API keys）
    Tool: Bash
    Preconditions: .env 配置有效 API keys
    Steps:
      1. 运行 `node bin/cli.js "戒指男潮牌高级感痞帅" --length 60 2>&1 | head -50`
      2. 检查输出中的铺货标题
    Expected Result: 铺货标题无逗号/标点、蓝海词（戒指男潮牌高级感痞帅或其子集）前置、与链接原标题不同、25-40字符范围
    Failure Indicators: 标题含标点、蓝海词未前置、标题与原标题相同、极端长度
    Evidence: .sisyphus/evidence/task-3-integration.txt
  ```

  **Commit**: YES
  - Message: `fix(title): fix titleMap matching and integrate postProcessTitle in index.js`
  - Files: `src/index.js`
  - Pre-commit: `node -c src/index.js`

- [x] 4. Fix `generate-title.js` — 使用postProcessTitle + 去除前缀空格

  **What to do**:
  - 在 `src/generate-title.js` 顶部添加 `const { postProcessTitle } = require('./title-utils');`
  - 修改 `generateTitles` 函数中蓝海词前缀验证逻辑（当前第36-41行）：
    - 删除现有的手动前缀验证代码：
      ```javascript
      const validatedTitles = glmTitles.map(title => {
        if (!title.startsWith(blueOceanWord)) {
          return blueOceanWord + ' ' + title;  // 移除这里的空格
        }
        return title;
      });
      ```
    - 替换为使用 `postProcessTitle` 管线：
      ```javascript
      const processedTitles = glmTitles
        .map(title => postProcessTitle(title, blueOceanWord, 20, maxLength))
        .filter(title => title !== null);  // 过滤过短标题
      ```
  - 修改 `generateTitles` 函数去重逻辑（当前第44-49行）：
    - 替换现有的去重和过滤逻辑：
      ```javascript
      const filtered = validatedTitles
        .map(t => removeBannedWords(t))
        .filter(t => typeof t === 'string' && t.trim().length > 0 && t.length >= 10);
      const unique = Array.from(new Set(filtered));
      return unique.slice(0, 5);
      ```
    - 简化为（postProcessTitle已包含removeBannedWords、长度检查、标点移除）：
      ```javascript
      const unique = Array.from(new Set(processedTitles));
      return unique.slice(0, 5);
      ```
  - 降级路径（当前第51-61行）的标题构造也需要去除空格：
    - 修改 `blueOceanWord + ' ' + suffix` 为 `blueOceanWord + suffix`（第58行）
    - 修改 `degraded += ' ' + coreWord` 为 `degraded + coreWord`（第59行）
    - 对降级结果也应用 `postProcessTitle`
  - 移除旧的 `removeBannedWords` 导入（如果postProcessTitle已经包含它），但保留导入以防其他地方使用... 实际上 generate-title.js 只在 `filtered.map(t => removeBannedWords(t))` 中使用 removeBannedWords，如果替换为 postProcessTitle，则可以移除导入
  - 更新 JSDoc 注释（如有必要）

  **Must NOT do**:
  - 不改变函数签名 `generateTitles(blueOceanWord, coreWord, modifiers, peerTitles, products, maxLength)`
  - 不修改 `GLMClient.generateTitles()` 方法（那是 Task 2 的范围）
  - 不在蓝海词和标题之间添加空格
  - 不移除降级逻辑

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 简单替换逻辑，使用已有的 postProcessTitle 管线
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES（与Task 3独立修改不同文件）
  - **Parallel Group**: Wave 2 (with Task 3)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 1 (需要title-utils.js)

  **References**:

  **Pattern References**:
  - `src/generate-title.js:1-65` — 当前完整实现，包括蓝海词前缀验证和去重逻辑
  - `src/generate-title.js:36-41` — 当前蓝海词前缀验证代码（需要替换）
  - `src/generate-title.js:44-49` — 当前过滤和去重逻辑（需要简化）
  - `src/generate-title.js:56-60` — 降级路径中的空格拼接（需要去除）

  **API/Type References**:
  - `src/title-utils.js` (Task 1 创建) — `postProcessTitle(title, blueOceanWord, minLength, maxLength)` 签名

  **WHY Each Reference Matters**:
  - generate-title.js 是需要修改的完整文件
  - 第36-41行是有bug的前缀验证代码（添加了多余空格）
  - 第44-49行是需要简化的过滤逻辑
  - 第56-60行是有空格的降级逻辑

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 模块语法检查通过
    Tool: Bash
    Preconditions: src/generate-title.js 已修改
    Steps:
      1. 运行 `node -c src/generate-title.js`
    Expected Result: 无输出（语法正确）
    Failure Indicators: SyntaxError
    Evidence: .sisyphus/evidence/task-4-syntax-check.txt

  Scenario: 蓝海词前缀无空格
    Tool: Bash
    Preconditions: src/generate-title.js 已修改
    Steps:
      1. 在 generate-title.js 中搜索 "blueOceanWord + ' '" 模式
      2. 确认没有在蓝海词和标题之间添加空格的逻辑
    Expected Result: 无匹配结果（空格已移除）
    Failure Indicators: 仍发现有空格拼接代码
    Evidence: .sisyphus/evidence/task-4-no-space.txt

  Scenario: 使用postProcessTitle管线
    Tool: Bash
    Preconditions: src/generate-title.js 已修改
    Steps:
      1. 在 generate-title.js 中搜索 "postProcessTitle"
      2. 确认至少存在一处调用
    Expected Result: 找到 postProcessTitle 调用
    Failure Indicators: 未使用 postProcessTitle
    Evidence: .sisyphus/evidence/task-4-postprocess.txt

  Scenario: 无手动removeBannedWords调用
    Tool: Bash
    Preconditions: src/generate-title.js 已修改
    Steps:
      1. 在 generate-title.js 中搜索 "removeBannedWords"
      2. 确认不再直接调用（postProcessTitle已经包含）
    Expected Result: 不存在直接调用（可能仅剩import行）
    Failure Indicators: 仍存在手动 removeBannedWords 调用
    Evidence: .sisyphus/evidence/task-4-no-manual-banned.txt
  ```

  **Commit**: YES
  - Message: `fix(title): update generate-title.js to use postProcessTitle pipeline`
  - Files: `src/generate-title.js`
  - Pre-commit: `node -c src/generate-title.js`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **计划合规审计** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **代码质量审查** — `unspecified-high`
  Run `node -c` on all modified files. Review all changed files for: `as any`, empty catches, console.log in prod (console.warn is OK), unused imports/variables. Check AI slop: excessive comments, over-abstraction, generic names. Verify CommonJS pattern consistency. Verify JSDoc on all exports. Verify Chinese comments on business logic.

- [x] F3. **真实手动QA** — `unspecified-high`
  Start from clean state. Execute: 1) `node bin/cli.js "戒指男潮牌高级感痞帅" --length 60` — verify: 标题无逗号/标点、蓝海词前置、字数25-40、标题与原标题不同. 2) `node -e "const {cleanTitle} = require('./src/title-utils'); console.log(cleanTitle('测试，标题！带标点'))"` — verify: 无标点输出. 3) `node -e "const {postProcessTitle} = require('./src/title-utils'); console.log(postProcessTitle('韩版钛钢戒指', '痞帅潮牌', 20, 60))"` — verify: 以"痞帅潮牌"开头. Save all output to evidence.

- [x] F4. **范围保真检查** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance. Verify `bin/cli.js`, `search-1688.js`, `score-local.js`, `extract-core.js`, `alibaba1688-client.js` are UNCHANGED. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Task 1**: `feat(title): add title post-processing utility module` — `src/title-utils.js`
- **Task 2**: `fix(glm): improve selectAndGenerate and generateTitles prompts` — `src/glm-client.js`
- **Task 3**: `fix(title): fix titleMap matching and integrate postProcessTitle in index.js` — `src/index.js`
- **Task 4**: `fix(title): update generate-title.js to use postProcessTitle` — `src/generate-title.js`

---

## Success Criteria

### Verification Commands
```bash
# 语法检查
node -c src/title-utils.js && node -c src/glm-client.js && node -c src/index.js && node -c src/generate-title.js
# Expected: 无输出（全部通过）

# 标题后处理单元测试
node -e "const {cleanTitle} = require('./src/title-utils'); console.log(cleanTitle('痞帅潮牌戒指，男！韩版钛钢方钻指环；小众轻奢饰品'))"
# Expected: 痞帅潮牌戒指男韩版钛钢方钻指环小众轻奢饰品（无标点，无空格）

node -e "const {ensureBlueOceanPrefix} = require('./src/title-utils'); console.log(ensureBlueOceanPrefix('韩版钛钢方钻指环小众轻奢饰品', '痞帅潮牌戒指'))"
# Expected: 痞帅潮牌戒指韩版钛钢方钻指环小众轻奢饰品

node -e "const {postProcessTitle} = require('./src/title-utils'); console.log(postProcessTitle('短标题', '蓝海词', 20, 60))"
# Expected: 空字符串或null（短于20字符被丢弃），并有console.warn

# 集成测试（需要有效API keys）
node bin/cli.js "戒指男潮牌高级感痞帅" --length 60
# Expected: 输出标题满足: 无标点、蓝海词前置、25-40字、与原标题不同
```

### Final Checklist
- [x] All "Must Have" present
- [x] All "Must NOT Have" absent
- [x] `cleanTitle()` removes CJK punctuation (，。！？；：、""''【】《》「」·…—) and ASCII punctuation (,.!?;:\"'()[]{})
- [x] `cleanTitle()` preserves alphanumeric characters (0-9, a-zA-Z) and CJK characters
- [x] `postProcessTitle()` applies: removeBannedWords → cleanTitle → ensureBlueOceanPrefix → normalizeLength → removeSpaces
- [x] `selectAndGenerate` prompt includes: 蓝海词前置、25-30字目标、无标点
- [x] `generateTitles` prompt includes: 无标点、最小20字
- [x] titleMap uses normalized productId matching (`String(id).trim()`)
- [x] titleMap fallback constructs title from blueOceanWord + rigidWords (not p.title)
- [x] Both code paths in index.js use postProcessTitle
- [x] generate-title.js uses postProcessTitle and has no space between blueOceanWord and title