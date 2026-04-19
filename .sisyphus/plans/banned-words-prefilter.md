# 违禁词预过滤修复

## TL;DR

> **核心目标**: 在 GLM 生成标题之前，先对输入的 1688 原标题和淘宝同行标题做违禁词过滤，避免 GLM 从原始标题中学习到违禁词（如"工厂"、"批发"、"直销"等）。
>
> **交付物**:
> - `src/index.js`: 在调 selectAndGenerate 之前，对 batch 产品的 title 做预过滤
> - `src/glm-client.js`: prompt 增加违禁词避免规则
>
> **预估工作量**: Quick（2 个任务 + 验证）
> **关键路径**: index.js 预过滤 → glm-client.js prompt 更新 → 测试

---

## Context

### Problem
当前 GLM 路径的数据流存在顺序问题：

```
1688 原标题（含违禁词如"工厂"、"批发"）──→ 直接喂给 GLM ──→ GLM 可能学来用
                                                                │
                                                    输出后才 removeBannedWords（过滤两次）
```

对比 fallback 路径（已正确）：
```
1688 原标题 ──→ removeBannedWords ──→ cleanTitle ──→ 分词过滤 ──→ 拼接
```

1688 原标题中常见的误导性违禁词（`misleadingWords`）：
- `工厂`、`批发`、`直销`、`厂家`、`生产`、`货源`、`供应链`、`代发`、`1688`、`一件代发`

这些词直接暴露给 GLM，GLM 可能将其用于生成的标题中。

### Solution
1. 在 `index.js` 中，将产品 batch 传给 GLM 前，对每个产品的 `title` 做预过滤
2. 对 `peerTitles` 也做预过滤
3. GLM prompt 增加违禁词避免规则（双重保障）
4. 保留输出端 `removeBannedWords` 作为兜底

---

## Work Objectives

### Concrete Deliverables
- `src/index.js`: 批量产品标题预过滤 + peerTitles 预过滤
- `src/glm-client.js`: generateTitles 和 selectAndGenerate 的 prompt 增加违禁词规则

### Definition of Done
- [ ] GLM 收到的输入中不含 misleadingWords（工厂、批发、直销等）
- [ ] GLM 生成的标题中不含违禁词（`checkBannedWords` 验证）
- [ ] fallback 路径行为不变
- [ ] selectedProducts 的选品分析仍然基于原始标题（不过滤）

### Must Have
- 输入端预过滤：产品 title 和 peerTitles 在传给 GLM 前过滤违禁词
- Prompt 增加违禁词避免规则
- 保留输出端 removeBannedWords 作为兜底

### Must NOT Have
- ❌ 不修改 `banned-words.js` 或 `banned-words.json`
- ❌ 不修改 `title-utils.js`（fallback 路径已正确）
- ❌ 不修改 `search-1688.js`、`search-taobao.js`
- ❌ 不修改 `generate-title.js`（它只调用 GLM，GLM 内部会处理）
- ❌ 不修改 selectedProducts 的选品分析逻辑（GLM 应基于原始标题做选品判断）
- ❌ 不修改原始 products 数组（用副本或映射传给 GLM）

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: None
- **Framework**: none

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **CLI**: Use Bash (node bin/cli.js) - Run command, validate output
- **Module**: Use Bash (node -e) - Import, call functions, compare output

---

## Execution Strategy

```
Wave 1 (2 independent tasks):
├── Task 1: index.js 预过滤 [deep]
└── Task 2: glm-client.js prompt 更新 [deep]

Wave FINAL:
├── F1: Plan compliance [deep]
├── F2: Code quality [deep]
└── F3: Scope fidelity [deep]
```

---

## TODOs

- [x] 1. `index.js` 批量产品标题预过滤 + peerTitles 预过滤

  **What to do**:

  **Step 1: 导入 removeBannedWords 和 cleanTitle**

  在 `src/index.js` 顶部的 require 区域添加：
  ```javascript
  const { removeBannedWords } = require('./banned-words');
  const { cleanTitle } = require('./title-utils');
  ```

  **Step 2: 在 selectAndGenerate 调用前，对 batch 做预过滤**

  当前代码（index.js 第 93-105 行）：
  ```javascript
  const batch = products.slice(i, i + BATCH_SIZE);
  // ... batch 直接传给 selectAndGenerate
  ```

  修改为：创建 batch 的副本，对每个产品的 `title` 做预过滤，但保留原始 `title` 用于选品分析：
  ```javascript
  const batch = products.slice(i, i + BATCH_SIZE);
  // 预过滤：对产品标题清洗违禁词，避免 GLM 学习违禁词
  const cleanedBatch = batch.map(p => ({
    ...p,
    title: cleanTitle(removeBannedWords(p.title || ''))
  }));
  ```

  然后将 `cleanedBatch` 传给 `selectAndGenerate`（替代原来的 `batch`）。

  **Step 3: 对 peerTitles 做预过滤**

  当前代码（index.js 第 102 行）直接传 `peerTitles`：
  ```javascript
  peerTitles,
  ```

  修改为：
  ```javascript
  peerTitles: (peerTitles || []).map(t => cleanTitle(removeBannedWords(t || ''))).filter(Boolean),
  ```

  注意：这里用局部变量更好，避免每次循环都重新 map：
  ```javascript
  // 在循环之前（第 89 行之前）做一次
  const cleanedPeerTitles = (peerTitles || []).map(t => cleanTitle(removeBannedWords(t || ''))).filter(Boolean);
  ```

  然后循环内用 `cleanedPeerTitles` 替代 `peerTitles`。

  **Step 4: 确保原始 products 数组不被修改**

  `enriched` 的构建（index.js 第 142 行起）仍然使用原始 `products` 数组，`p.title` 仍然是原始未过滤的标题，用于 `'链接原标题'` 字段。这是正确的——用户需要看到原始标题。

  **Must NOT do**:
  - 不修改原始 `products` 数组（用 `map` 创建副本）
  - 不修改 `selectedProducts` 的选品逻辑
  - 不修改 fallback 路径（index.js 第 153 行的 constructFallbackTitle 调用）

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 2)
  - **Parallel Group**: Wave 1
  - **Blocks**: F1-F3
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/title-utils.js:64-66` — constructFallbackTitle 中的预过滤模式（removeBannedWords + cleanTitle），这是正确的参考模式
  - `src/title-utils.js:85-87` — 淘宝标题的预过滤模式

  **API/Type References**:
  - `src/banned-words.js:removeBannedWords(title)` — 输入 string，返回去掉违禁词后的 string
  - `src/title-utils.js:cleanTitle(title)` — 输入 string，去掉所有非字母数字中文字符

  **Context References**:
  - `src/index.js:93-105` — 当前的 batch 处理循环，需要在这里插入预过滤
  - `src/index.js:142-173` — enriched 构建，确认这里使用原始 products 不受影响

  **QA Scenarios:**

  ```
  Scenario: 端到端 — GLM 生成的标题不含违禁词
    Tool: Bash (node bin/cli.js)
    Preconditions: .env 已配置，GLM API 可用
    Steps:
      1. 运行: node bin/cli.js "藏地王菩萨佛像" --length 60 --format json
      2. 在 JSON 输出中，检查所有"铺货标题"字段
      3. 用 checkBannedWords 验证每个铺货标题
    Expected Result: 所有铺货标题 checkBannedWords 返回 valid=true
    Failure Indicators: 任何铺货标题包含"工厂"、"批发"、"直销"等 misleadingWords
    Evidence: .sisyphus/evidence/task-1-e2e-banned-check.txt

  Scenario: 原始标题保留 — "链接原标题"字段仍含违禁词
    Tool: Bash (node bin/cli.js)
    Steps:
      1. 运行同上
      2. 检查"链接原标题"字段，确认有些标题仍含"工厂"等词
    Expected Result: "链接原标题"保留原始值（含违禁词），"铺货标题"不含
    Failure Indicators: "链接原标题"中的违禁词被错误过滤
    Evidence: .sisyphus/evidence/task-1-original-preserved.txt
  ```

  **Commit**: YES (groups with Task 2)
  - Message: `fix(title): pre-filter banned words before GLM generation and update prompts`
  - Files: `src/index.js`, `src/glm-client.js`

- [x] 2. `glm-client.js` prompt 增加违禁词避免规则

  **What to do**:

  **Step 1: 在 `generateTitles` 的 systemPrompt 中增加违禁词规则**

  当前 `src/glm-client.js:181-195` 的 prompt 有 7 条规则。在规则 5 之后插入新规则：

  ```javascript
  6. 标题中严禁使用以下违禁词（这些词在淘宝标题中违规）：最、第一、顶级、正品、专柜、原厂、工厂、批发、直销、厂家、生产、货源、代发、高仿、仿真、同款、包邮、特价、促销、打折、清仓、出厂价、批发价、成本价
  ```

  原规则 6、7 顺延为 7、8。

  **Step 2: 在 `selectAndGenerate` 的 systemPrompt 中增加同样的规则**

  当前 `src/glm-client.js:258-271` 的 prompt 有 6 条规则。在规则 5 之后插入新规则：

  ```javascript
  7. 标题中严禁使用以下违禁词：最、第一、顶级、正品、专柜、原厂、工厂、批发、直销、厂家、生产、货源、代发、高仿、仿真、同款、包邮、特价、促销、打折、清仓、出厂价、批发价、成本价
  ```

  **Step 3: 确认 `selectAndGenerate` 输出端的 `removeBannedWords` 保留**

  `src/glm-client.js:315` 的 `removeBannedWords(t.title)` 保留不动，作为安全兜底。

  **Must NOT do**:
  - 不删除 `removeBannedWords` 兜底逻辑
  - 不修改 `removeBannedWords` 函数本身
  - 不修改 `banned-words.json`

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 1)
  - **Parallel Group**: Wave 1
  - **Blocks**: F1-F3
  - **Blocked By**: None

  **References**:

  **Context References**:
  - `src/glm-client.js:181-195` — generateTitles 的 systemPrompt，需要增加违禁词规则
  - `src/glm-client.js:258-271` — selectAndGenerate 的 systemPrompt，同样需要增加
  - `src/glm-client.js:315` — 输出端 removeBannedWords 兜底，保留不动

  **External References**:
  - `data/banned-words.json:limitWords` — 极限词（最、第一、顶级等）
  - `data/banned-words.json:falseWords` — 虚假词（正品、专柜、原厂等）
  - `data/banned-words.json:misleadingWords` — 误导词（工厂、批发、直销等），**最关键的一组**

  **QA Scenarios:**

  ```
  Scenario: prompt 包含违禁词规则
    Tool: Bash (node -e)
    Steps:
      1. 运行: node -e "const fs = require('fs'); const c = fs.readFileSync('src/glm-client.js', 'utf8'); console.log('generateTitles has 违禁:', c.includes('违禁词')); console.log('selectAndGenerate has 违禁:', c.includes('严禁使用')); console.log('removeBannedWords retained:', c.includes('removeBannedWords(t.title)'));"
    Expected Result: 三个检查均为 true
    Evidence: .sisyphus/evidence/task-2-prompt-check.txt

  Scenario: 语法检查
    Tool: Bash (node -c)
    Steps:
      1. node -c src/glm-client.js
    Expected Result: 无输出（通过）
    Evidence: .sisyphus/evidence/task-2-syntax.txt
  ```

  **Commit**: YES (groups with Task 1)
  - Message: `fix(title): pre-filter banned words before GLM generation and update prompts`
  - Files: `src/glm-client.js`

---

## Final Verification Wave

- [x] F1. **Plan Compliance** — deep
- [x] F2. **Code Quality** — deep
- [x] F3. **Scope Fidelity** — deep
  For each task: read "What to do", read actual diff. Verify only planned files were modified. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Single commit**: `fix(title): pre-filter banned words before GLM generation and update prompts`

---

## Success Criteria

```bash
# 1. 语法检查
node -c src/index.js
node -c src/glm-client.js
# Expected: 无输出（通过）

# 2. 端到端测试
node bin/cli.js "藏地王菩萨佛像" --length 60
# Expected: 所有标题不含违禁词（工厂、批发、直销等）

# 3. 验证原始 products 不被修改
node -e "
const { run } = require('./src');
// ... 检查 products 输出中原始标题仍含违禁词，但铺货标题不含
"
```
