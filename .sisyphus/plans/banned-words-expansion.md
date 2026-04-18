# 违禁词库扩充工作计划

## TL;DR

> **快速摘要**: 扩充淘宝标题生成工具的违禁词库，从现有3类26个词升级为6类专业级词库（每类≥15词），同时修复 `banned-words.js` 中的3个bug（checkBannedWords遗漏分类、正则注入风险、跨类别重复词）。
> 
> **交付物**:
> - 扩充后的 `data/banned-words.json`（6类，每类≥15词，无内部重复）
> - 修复后的 `src/banned-words.js`（动态遍历所有类别、正则转义、checkBannedWords覆盖所有类别）
> 
> **预估工时**: Quick
> **并行执行**: YES - 2个wave
> **关键路径**: Task 1 → Task 2 → Task 3

---

## Context

### Original Request
用户先做第9点改进——违禁词库扩充。参考淘宝标题优化专业方法，当前词库远不够专业需求。

### Interview Summary
**Key Discussions**:
- 当前词库仅3类26个词（limitWords 17个, falseWords 4个, prohibitedWords 5个）
- 淘宝平台违禁词至少包含6大类：极限词、虚假词、医疗声称、权威暗示、误导性词、特殊符号
- `checkBannedWords` 函数有bug：遗漏了 prohibitedWords 类别
- `removeBannedWords` 有正则注入风险

**Research Findings**:
- 淘宝对标题违禁词审核非常严格，极限词、虚假宣传、医疗声称都是重点打击对象
- `new RegExp(word, 'g')` 不转义特殊字符可能导致崩溃
- 现有数据有内部重复词（"顶级"在limitWords中重复，"正品""专柜"跨类别重复）

### Metis Review
**Identified Gaps** (addressed):
- checkBannedWords bug：遗漏了 prohibitedWords 类别 → Task 2 修复
- 正则注入风险：`new RegExp(word, 'g')` 中的词可能包含特殊字符 → Task 2 修复
- 跨类别重复词：现有数据有重复 → Task 1 去重
- 函数硬编码类别名：改为动态遍历所有 JSON key → Task 2 重构
- 短词过度匹配：如"最"会匹配"最近" → 已知限制，记录而非修复

---

## Work Objectives

### Core Objective
将违禁词库从3类26词扩充为6类≥90词的专业级词库，同时修复代码bug使函数健壮可用。

### Concrete Deliverables
- `data/banned-words.json`: 6个类别，每类≥15词，无内部重复
- `src/banned-words.js`: 修复3个bug + 动态遍历重构

### Definition of Done
- [ ] `node -e "const d=require('./data/banned-words.json'); console.log(Object.keys(d).length)"` 输出 ≥ 6
- [ ] 每个类别≥15词
- [ ] 无内部重复词
- [ ] `checkBannedWords('政治敏感测试')` 返回 `{valid: false, words: ['政治敏感']}`
- [ ] `removeBannedWords('最好顶级项链政治敏感')` 不崩溃且正确移除违禁词
- [ ] `node bin/cli.js "纯银项链女高级感"` 正常运行不报错

### Must Have
- 6类违禁词数据（limitWords, falseWords, prohibitedWords, medicalWords, authorityWords, misleadingWords）
- 每类≥15个词
- checkBannedWords 检查所有类别
- removeBannedWords 正则安全
- 无内部重复词

### Must NOT Have (Guardrails)
- ❌ 不改函数签名（保持 `checkBannedWords(title)` 和 `removeBannedWords(title)` 向后兼容）
- ❌ 不加新 npm 依赖
- ❌ 不改 `generate-title.js`、`index.js` 或其他模块
- ❌ 不增加严重级别或替换建议功能
- ❌ 不实现词边界匹配（已知限制，记录不修复）
- ❌ 不加测试框架

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: NO
- **Framework**: None
- **Agent-Executed QA**: ALL tasks verified via `node -e` commands + CLI end-to-end

### QA Policy
每个task都包含 agent-executed QA scenarios，使用 Bash (node -e) 运行验证命令。

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - data first):
└── Task 1: 扩充违禁词词库数据 [quick]

Wave 2 (After Wave 1 - code fix + verify):
├── Task 2: 修复 banned-words.js 代码 [quick]
└── Task 3: 端到端验证 [quick]

Wave FINAL (After ALL tasks — 4 parallel reviews):
├── Task F1: 计划合规审计 (oracle)
├── Task F2: 代码质量审查 (unspecified-high)
├── Task F3: 真实 QA 验证 (unspecified-high)
└── Task F4: 范围忠实度检查 (deep)
-> 展示结果 -> 获取用户确认
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 1 | - | 2, 3 |
| 2 | 1 | 3 |
| 3 | 1, 2 | F1-F4 |

### Agent Dispatch Summary

- **Wave 1**: 1 task - T1 → `quick`
- **Wave 2**: 2 tasks - T2 → `quick`, T3 → `quick`
- **FINAL**: 4 tasks - F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. 扩充违禁词词库数据

  **What to do**:
  - 编辑 `data/banned-words.json`，扩充现有3类并新增3类：
    - `limitWords`（极限词）：从17词扩充至≥20词，移除内部重复词（如"顶级"出现2次），新增"全网最低"、"史无前例"、"绝无仅有"、"前所未有"等
    - `falseWords`（虚假词）：从4词扩充至≥15词，新增"原单"、"原厂"、"外贸尾单"、"假一赔百"、"终身保修"、"真品"、"官方"、"旗舰店同款"、"专柜同款"、"1:1复刻"、"高定"等
    - `prohibitedWords`（违禁词）：从5词扩充至≥15词，新增具体的政治、色情、暴力、赌博、毒品类词汇
    - `medicalWords`（医疗声称词）：新增类别，≥15词，包含"治疗"、"治愈"、"根治"、"疗效"、"处方药"、"临床验证"、"手术"、"诊断"、"减肥药"、"壮阳"、"丰胸"、"美白祛斑"、"减肥瘦身"、"药到病除"、"速效"等
    - `authorityWords`（权威暗示词）：新增类别，≥15词，包含"特供"、"专供"、"国家免检"、"质量免检"、"驰名商标"、"中国名牌"、"国家认证"、"官方推荐"、"权威认证"、"3·15认证"、"免检产品"、"百年品牌"、"传承百年"等
    - `misleadingWords`（误导性词）：新增类别，≥15词，包含"高仿"、"仿真"、"1:1"、"原版"、"复刻"、"同款男"、"山寨"、"A货"、"超A"、"包邮"、"特价"、"促销"、"打折"、"清仓甩卖"、"跳楼价"等
  - 确保每类无内部重复词
  - 确保跨类别也无重复词（如"正品"不应同时出现在 limitWords 和 falseWords）

  **Must NOT do**:
  - 不改代码逻辑，只改数据
  - 不加严重级别或替换建议
  - 不改 JSON 结构（保持 `{ "category": ["word1", "word2"] }` 格式）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (data must exist before code fix)
  - **Parallel Group**: Wave 1 (alone)
  - **Blocks**: Task 2, Task 3
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `data/banned-words.json` - 现有词库结构，新增类别必须遵循此格式
  - `src/banned-words.js:5-8` - `checkBannedWords` 当前仅处理 limitWords + falseWords（代码会修改，但数据格式不变）

  **External References**:
  - 淘宝违禁词规则：极限词（《广告法》禁用）、虚假宣传词、医疗声称词、权威暗示词

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: 词库类别数量正确
    Tool: Bash (node -e)
    Preconditions: data/banned-words.json 已更新
    Steps:
      1. 运行 `node -e "const d=require('./data/banned-words.json'); console.log(Object.keys(d).length)"`
      2. 断言输出 ≥ 6
    Expected Result: 输出数字 ≥ 6
    Failure Indicators: 输出 < 6
    Evidence: .sisyphus/evidence/task-1-category-count.txt

  Scenario: 每类词数≥15
    Tool: Bash (node -e)
    Preconditions: data/banned-words.json 已更新
    Steps:
      1. 运行 `node -e "const d=require('./data/banned-words.json'); Object.entries(d).forEach(([k,v]) => console.log(k, v.length))"`
      2. 验证每行数字 ≥ 15
    Expected Result: 每个类别输出 ≥ 15
    Failure Indicators: 任何类别 < 15
    Evidence: .sisyphus/evidence/task-1-word-counts.txt

  Scenario: 无内部重复词
    Tool: Bash (node -e)
    Preconditions: data/banned-words.json 已更新
    Steps:
      1. 运行 `node -e "const d=require('./data/banned-words.json'); Object.entries(d).forEach(([k,v]) => { const s=new Set(v); if(s.size!==v.length) console.log('DUPLICATES in', k, v.filter((w,i)=>v.indexOf(w)!==i)) })"`
    Expected Result: 无输出（无重复词）
    Failure Indicators: 输出了任何 "DUPLICATES" 行
    Evidence: .sisyphus/evidence/task-1-no-duplicates.txt
  ```

  **Commit**: YES (groups with 2)
  - Message: `feat(banned-words): 扩充违禁词库至6类专业级词库`
  - Files: `data/banned-words.json`
  - Pre-commit: `node -e "const d=require('./data/banned-words.json'); console.log(Object.keys(d).join(', '))"`

- [x] 2. 修复 banned-words.js 代码

  **What to do**:
  - 修复 `src/banned-words.js` 中的3个问题：
    1. **checkBannedWords 遗漏 prohibitedWords**：改为动态遍历所有 JSON 类别而非硬编码 `[...bannedWords.limitWords, ...bannedWords.falseWords]`
    2. **正则注入风险**：在 `removeBannedWords` 中将 `new RegExp(word, 'g')` 改为 `new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')` 以转义特殊字符
    3. **跨类别重复词**：在 `removeBannedWords` 中对合并后的所有违禁词数组先去重再遍历，避免同词多次替换
  - 同时移除硬编码的类别名，改为动态遍历 `Object.values(bannedWords).flat()` 风格

  **Must NOT do**:
  - 不改函数签名（保持 `checkBannedWords(title)` 和 `removeBannedWords(title)` 向后兼容）
  - 不加严重级别或替换建议功能
  - 不实现词边界匹配
  - 不改其他模块

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 1 data)
  - **Parallel Group**: Wave 2 (with Task 3, but Task 2 must come first)
  - **Blocks**: Task 3
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/banned-words.js:1-25` - 当前完整代码，需要修复3处
  - `data/banned-words.json` - 新增类别后的数据结构

  **API/Type References**:
  - `checkBannedWords(title)` 返回 `{valid: boolean, words: string[]}` - 签名不变
  - `removeBannedWords(title)` 返回 `string` - 签名不变

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: checkBannedWords 检查所有类别
    Tool: Bash (node -e)
    Preconditions: Task 1 和 Task 2 已完成
    Steps:
      1. 运行 `node -e "const {checkBannedWords}=require('./src/banned-words'); console.log(checkBannedWords('治疗根治神经病'))"`
      2. 验证返回 valid=false 且 words 包含来自 medicalWords 的词
    Expected Result: { valid: false, words: [...包含治疗/根治...] }
    Failure Indicators: valid=true 或 words 为空
    Evidence: .sisyphus/evidence/task-2-check-all-categories.txt

  Scenario: removeBannedWords 不崩溃并正确移除
    Tool: Bash (node -e)
    Preconditions: Task 1 和 Task 2 已完成
    Steps:
      1. 运行 `node -e "const {removeBannedWords}=require('./src/banned-words'); console.log(removeBannedWords('最好顶级项链治疗正品专柜'))"`
      2. 验证输出不包含'最好'、'顶级'、'治疗'、'正品'、'专柜'
    Expected Result: 输出为干净的标题字符串（无违禁词）
    Failure Indicators: 输出仍包含任何违禁词，或者程序崩溃
    Evidence: .sisyphus/evidence/task-2-remove-safe.txt

  Scenario: 正则特殊字符不会崩溃
    Tool: Bash (node -e)
    Preconditions: Task 2 已完成
    Steps:
      1. 运行 `node -e "const {removeBannedWords}=require('./src/banned-words'); console.log(removeBannedWords('正常标题测试'))"`
      2. 验证程序不崩溃，输出近似原字符串
    Expected Result: '正常标题测试'(或移除了其中命中的违禁词后的结果)
    Failure Indicators: 程序崩溃或抛出异常
    Evidence: .sisyphus/evidence/task-2-no-regex-crash.txt
  ```

  **Commit**: YES (groups with 2)
  - Message: `fix(banned-words): 修复遗漏类别、正则注入风险、跨类别去重`
  - Files: `src/banned-words.js`
  - Pre-commit: `node -e "const {checkBannedWords, removeBannedWords}=require('./src/banned-words'); console.log(checkBannedWords('测试')); console.log(removeBannedWords('测试'))"`

- [x] 3. 端到端验证

  **What to do**:
  - 运行 CLI 端到端测试，确保整体工作流不被破坏
  - 验证各场景下违禁词被正确过滤

  **Must NOT do**:
  - 不改代码，只验证

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 1 and Task 2)
  - **Parallel Group**: Wave 2 (after Task 2)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 1, Task 2

  **References**:

  **Pattern References**:
  - `bin/cli.js` - CLI 入口
  - `src/index.js` - 主工作流

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: CLI 正常运行不报错
    Tool: Bash
    Preconditions: 所有改动已保存
    Steps:
      1. 运行 `node -e "const {removeBannedWords}=require('./src/banned-words'); console.log(removeBannedWords('纯银项链女高级感'))"`
      2. 验证输出不为空且不崩溃
    Expected Result: 输出类似 '纯银项链女高级感'（原词无违禁词则保持不变）
    Failure Indicators: 抛出异常或输出为空
    Evidence: .sisyphus/evidence/task-3-e2e-normal.txt

  Scenario: 违禁词被正确过滤
    Tool: Bash (node -e)
    Preconditions: 所有改动已保存
    Steps:
      1. 运行 `node -e "const {removeBannedWords}=require('./src/banned-words'); console.log(removeBannedWords('全网最低价纯银项链女治疗失眠正品'))"`
      2. 验证 '全网最低价'、'治疗'、'正品' 被移除
    Expected Result: 输出为 '纯银项链女失眠' 或类似（违禁词被去除）
    Failure Indicators: 输出仍包含任何违禁词
    Evidence: .sisyphus/evidence/task-3-banned-remove.txt

  Scenario: 词频统计依然正常工作
    Tool: Bash (node -e)
    Preconditions: 所有改动已保存
    Steps:
      1. 运行 `node -e "const {generateTitles} = require('./src/generate-title'); console.log(typeof generateTitles)"`
      2. 验证 generateTitles 函数仍然存在且类型为 function
    Expected Result: 输出 'function'
    Failure Indicators: 输出 'undefined' 或抛出异常
    Evidence: .sisyphus/evidence/task-3-imports-work.txt
  ```

  **Commit**: NO (验证任务不提交)

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Review `src/banned-words.js` and `data/banned-words.json` for: regex safety, no infinite loops, correct JSDoc, no console.log in production, no hardcoded category names, proper module.exports. Check for duplicates in word lists. Verify dynamic category iteration in both functions.
  Output: `Build [PASS/FAIL] | Lint [N/A] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test edge cases: empty string, very long string, string with all banned words, string with no banned words, string with regex special chars.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT Have" compliance. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **1+2**: `feat(banned-words): 扩充违禁词库至6类专业级词库并修复代码bug` - data/banned-words.json, src/banned-words.js
  - Pre-commit: `node -e "const d=require('./data/banned-words.json'); console.log(Object.keys(d).join(', ')); const {checkBannedWords, removeBannedWords}=require('./src/banned-words'); console.log(checkBannedWords('测试')); console.log(removeBannedWords('测试'))"`

---

## Success Criteria

### Verification Commands
```bash
# 类别数量
node -e "const d=require('./data/banned-words.json'); console.log(Object.keys(d).length)"
# Expected: 6

# 每类词数
node -e "const d=require('./data/banned-words.json'); Object.entries(d).forEach(([k,v]) => console.log(k, v.length))"
# Expected: 每行 ≥ 15

# 无重复词
node -e "const d=require('./data/banned-words.json'); Object.entries(d).forEach(([k,v]) => { const s=new Set(v); if(s.size!==v.length) console.log('DUPLICATES in', k) })"
# Expected: 无输出

# checkBannedWords 覆盖所有类别
node -e "const {checkBannedWords}=require('./src/banned-words'); console.log(checkBannedWords('政治敏感治疗特供'))"
# Expected: { valid: false, words: [...] } 包含来自 prohibitedWords, medicalWords, authorityWords 的词

# removeBannedWords 正则安全
node -e "const {removeBannedWords}=require('./src/banned-words'); console.log(removeBannedWords('全网最低价纯银项链女治疗失眠正品专柜特供高仿'))"
# Expected: 违禁词被移除的干净标题

# 现有功能不破坏
node -e "const {removeBannedWords}=require('./src/banned-words'); console.log(removeBannedWords('纯银项链女高级感'))"
# Expected: 纯银项链女高级感（无违禁词则保持不变）
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] CLI 端到端正常工作