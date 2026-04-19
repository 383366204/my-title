# GLM 调用健壮性改进

## TL;DR

> **核心目标**: 提升 GLM API 调用的健壮性 — JSON 解析容错、自动重试、prompt 规则去重。不引入框架，只用 2 个工具函数 + 1 个常量。
>
> **交付物**:
> - `src/llm-utils.js`: 新增 `parseJsonFromLLM()` 和 `retry()` 工具函数
> - `src/glm-client.js`: 提取公共 prompt 规则常量，替换 4 处手动 JSON 解析为 `parseJsonFromLLM()`，为关键调用加 `retry()`
>
> **预估工作量**: Quick（2 个任务 + 验证）
> **关键路径**: llm-utils 工具函数 → glm-client.js 替换调用

---

## Context

### Problem
`glm-client.js` 中有 4 处几乎相同的 GLM 响应解析代码：
```javascript
content = content.replace(/^```json\n?/, '').replace(/\n?```$/, '');
const result = JSON.parse(content);
```

这段代码只处理了最简单的 markdown 包裹情况。GLM 实际返回中常见的格式问题还包括：
- JSON 前后有额外文字（"好的，这是结果：{...}"）
- JSON 中有尾逗号（`"titles": ["a", "b",]`）
- 返回了 ```json\n{...}\n``` 但带换行符变体

另外，两个 prompt（generateTitles 和 selectAndGenerate）有 3 条完全相同的规则（无标点、无空格、禁违禁词），每次都要写两遍。

### Solution
1. 新建 `src/llm-utils.js`，提供 `parseJsonFromLLM()` 和 `retry()` 两个工具函数
2. 在 `glm-client.js` 中提取公共 prompt 规则为常量，用工具函数替换重复代码

---

## Work Objectives

### Concrete Deliverables
- `src/llm-utils.js`: 新文件，导出 `parseJsonFromLLM` 和 `retry`
- `src/glm-client.js`: 提取 `COMMON_TITLE_RULES` 常量，替换 4 处 JSON 解析，为 selectAndGenerate 加 retry

### Definition of Done
- [ ] `parseJsonFromLLM('好的，这是结果：\n```json\n{"titles":["a"]}\n```')` 返回正确的 object
- [ ] `parseJsonFromLLM('{"titles":["a",]}')` 能处理尾逗号
- [ ] `retry` 在失败时自动重试最多 N 次
- [ ] glm-client.js 中 4 处 JSON.parse 都替换为 parseJsonFromLLM
- [ ] 两个 prompt 中相同的规则来自同一个常量

### Must Have
- `parseJsonFromLLM`: 处理 markdown 包裹、前后多余文字、尾逗号
- `retry`: 简单的固定延迟重试（不指数退避）
- `COMMON_TITLE_RULES`: 无标点、无空格、禁违禁词三条公共规则
- 保持现有行为不变（只更健壮，不改功能）

### Must NOT Have
- ❌ 不引入任何外部依赖
- ❌ 不修改 glm-client.js 以外的文件（index.js、title-utils.js 等不动）
- ❌ 不改变 API 调用参数（temperature、timeout 等不变）
- ❌ 不改变 GLMClient 类的接口

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Automated tests**: None（项目无测试框架）
- **QA**: agent 执行 node -e 单元测试 + CLI 端到端测试

---

## Execution Strategy

```
Wave 1 (2 independent tasks):
├── Task 1: 新建 llm-utils.js [deep]
└── Task 2: glm-client.js 重构 [deep]

Wave FINAL:
├── F1: Plan compliance [deep]
├── F2: Code quality [deep]
└── F3: Scope fidelity [deep]
```

---

## TODOs

- [x] 1. 新建 `src/llm-utils.js` — parseJsonFromLLM + retry

  **What to do**:

  新建文件 `src/llm-utils.js`，包含两个导出函数：

  **parseJsonFromLLM(content)**:
  ```javascript
  function parseJsonFromLLM(content) {
    if (typeof content !== 'string') throw new Error('Expected string input');
    let text = content.trim();
    // 1. 移除 markdown 代码块包裹（```json ... ```）
    text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?\s*```$/);
    // 2. 如果仍然不是以 { 或 [ 开头，尝试从中提取 JSON
    if (!text.startsWith('{') && !text.startsWith('[')) {
      const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (jsonMatch) text = jsonMatch[0];
    }
    // 3. 移除尾逗号（JSON 标准不允许，但 LLM 经常输出）
    text = text.replace(/,\s*([}\]])/g, '$1');
    // 4. 解析
    return JSON.parse(text);
  }
  ```

  **retry(fn, maxRetries = 2, delayMs = 1000)**:
  ```javascript
  async function retry(fn, maxRetries = 2, delayMs = 1000) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }
    throw lastError;
  }
  ```

  JSDoc 注释：每个函数都要有中文 `@param`/`@returns`。

  **Must NOT do**:
  - 不引入外部依赖
  - 不使用正则以外的解析方式

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 2)
  - **Parallel Group**: Wave 1
  - **Blocks**: F1-F3
  - **Blocked By**: None

  **References**:
  - `src/glm-client.js:74-77` — 当前的手动 JSON 解析（4 处之一），新函数要替代这个模式
  - 项目代码规范：CommonJS、JSDoc、中文注释

  **QA Scenarios:**

  ```
  Scenario: parseJsonFromLLM 正常 JSON
    Tool: Bash (node -e)
    Steps:
      1. node -e "const {parseJsonFromLLM} = require('./src/llm-utils'); console.log(parseJsonFromLLM('{\"a\":1}'));"
    Expected Result: { a: 1 }
    Evidence: .sisyphus/evidence/task-1-normal.txt

  Scenario: parseJsonFromLLM markdown 包裹
    Tool: Bash (node -e)
    Steps:
      1. node -e "const {parseJsonFromLLM} = require('./src/llm-utils'); console.log(parseJsonFromLLM('\`\`\`json\n{\"a\":1}\n\`\`\`'));"
    Expected Result: { a: 1 }
    Evidence: .sisyphus/evidence/task-1-markdown.txt

  Scenario: parseJsonFromLLM 前后多余文字
    Tool: Bash (node -e)
    Steps:
      1. node -e "const {parseJsonFromLLM} = require('./src/llm-utils'); console.log(parseJsonFromLLM('好的，这是结果：{\"a\":1}'));"
    Expected Result: { a: 1 }
    Evidence: .sisyphus/evidence/task-1-extra-text.txt

  Scenario: parseJsonFromLLM 尾逗号
    Tool: Bash (node -e)
    Steps:
      1. node -e "const {parseJsonFromLLM} = require('./src/llm-utils'); console.log(parseJsonFromLLM('{\"arr\":[1,2,]}'));"
    Expected Result: { arr: [1, 2] }
    Evidence: .sisyphus/evidence/task-1-trailing-comma.txt

  Scenario: retry 成功
    Tool: Bash (node -e)
    Steps:
      1. node -e "const {retry} = require('./src/llm-utils'); let i=0; retry(async()=>{i++;if(i<2)throw new Error('fail');return 'ok';},2,100).then(r=>console.log(r,i));"
    Expected Result: ok 2
    Evidence: .sisyphus/evidence/task-1-retry.txt

  Scenario: retry 全部失败
    Tool: Bash (node -e)
    Steps:
      1. node -e "const {retry} = require('./src/llm-utils'); retry(async()=>{throw new Error('fail');},1,100).catch(e=>console.log(e.message));"
    Expected Result: fail
    Evidence: .sisyphus/evidence/task-1-retry-fail.txt
  ```

  **Commit**: YES (groups with Task 2)
  - Message: `refactor(glm): extract JSON parser, retry, and shared prompt rules`
  - Files: `src/llm-utils.js`, `src/glm-client.js`

- [x] 2. `glm-client.js` 重构 — 提取常量 + 替换调用

  **What to do**:

  **Step 1: 在 glm-client.js 顶部导入新工具**
  ```javascript
  const { parseJsonFromLLM, retry } = require('./llm-utils');
  ```

  **Step 2: 提取公共 prompt 规则常量**

  在 `class GLMClient` 之前添加：
  ```javascript
  const BANNED_WORDS_LIST = '最、第一、顶级、正品、专柜、原厂、工厂、批发、直销、厂家、生产、货源、代发、高仿、仿真、同款、包邮、特价、促销、打折、清仓、出厂价、批发价、成本价';

  const COMMON_TITLE_RULES = [
    '标题中不允许出现任何标点符号（包括逗号、句号、感叹号、分号、冒号、顿号、括号、引号等中英文标点）',
    '标题中不要有空格，所有词语连续书写',
    `标题中严禁使用以下违禁词：${BANNED_WORDS_LIST}`,
  ].map((rule, i) => `${i + 1}. ${rule}`).join('\n');
  ```

  注意：这个常量在两个 prompt 之间共享，但规则编号需要适配各自的上下文。

  实际实现中，更好的方式是提取规则文本但不带编号，让各自的 prompt 自己编号：
  ```javascript
  const COMMON_TITLE_RULES_TEXT = `标题中不允许出现任何标点符号（包括逗号、句号、感叹号、分号、冒号、顿号、括号、引号等中英文标点）
标题中不要有空格，所有词语连续书写
标题中严禁使用以下违禁词：${BANNED_WORDS_LIST}`;
  ```

  然后在 generateTitles 和 selectAndGenerate 的 prompt 中用变量插入。

  **Step 3: 替换 4 处 JSON 解析**

  在 glm-client.js 中找到所有：
  ```javascript
  content = content.replace(/^```json\n?/, '').replace(/\n?```$/, '');
  const result = JSON.parse(content);
  ```
  替换为：
  ```javascript
  const result = parseJsonFromLLM(content);
  ```

  共 4 处（行 76-77, 152-153, 222-223, 298-299）。

  **Step 4: 为 selectAndGenerate 加 retry**

  在 selectAndGenerate 方法中，将 API 调用包在 retry 中：
  ```javascript
  const response = await retry(async () => {
    return await axios.post(...);
  }, 1, 2000);
  ```

  只为 selectAndGenerate 加（这是最关键的调用，处理整批产品），其他方法不加（extractCore 和 scoreProducts 失败有降级逻辑，不需要重试）。

  **Must NOT do**:
  - 不改变 GLMClient 类的构造函数和接口
  - 不改变 temperature、timeout 等调用参数
  - 不修改 glm-client.js 以外的文件
  - 不删除 removeBannedWords 兜底逻辑

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 1)
  - **Parallel Group**: Wave 1
  - **Blocks**: F1-F3
  - **Blocked By**: None

  **References**:
  - `src/glm-client.js:74-77` — JSON 解析位置 1（extractCoreAndModifiers）
  - `src/glm-client.js:152-153` — JSON 解析位置 2（scoreProducts）
  - `src/glm-client.js:222-223` — JSON 解析位置 3（generateTitles）
  - `src/glm-client.js:298-299` — JSON 解析位置 4（selectAndGenerate）
  - `src/glm-client.js:183-191` — generateTitles prompt 规则
  - `src/glm-client.js:260-267` — selectAndGenerate prompt 规则
  - 两个 prompt 共享的规则：无标点、无空格、禁违禁词

  **QA Scenarios:**

  ```
  Scenario: 语法检查
    Tool: Bash (node -c)
    Steps:
      1. node -c src/llm-utils.js
      2. node -c src/glm-client.js
    Expected Result: 无输出（通过）
    Evidence: .sisyphus/evidence/task-2-syntax.txt

  Scenario: 模块导入正常
    Tool: Bash (node -e)
    Steps:
      1. node -e "const {parseJsonFromLLM, retry} = require('./src/llm-utils'); console.log(typeof parseJsonFromLLM, typeof retry);"
    Expected Result: function function
    Evidence: .sisyphus/evidence/task-2-import.txt

  Scenario: 公共规则常量存在
    Tool: Bash (node -e)
    Steps:
      1. node -e "const fs = require('fs'); const c = fs.readFileSync('src/glm-client.js', 'utf8'); console.log('has BANNED:', c.includes('BANNED_WORDS')); console.log('has COMMON:', c.includes('COMMON_TITLE_RULES'));"
    Expected Result: true true
    Evidence: .sisyphus/evidence/task-2-constants.txt

  Scenario: 4 处 JSON.parse 都已替换
    Tool: Bash (node -e)
    Steps:
      1. node -e "const fs = require('fs'); const c = fs.readFileSync('src/glm-client.js', 'utf8'); const old = (c.match(/content\.replace\(\//g) || []).length; const newFn = (c.match(/parseJsonFromLLM/g) || []).length; console.log('old pattern:', old, 'new calls:', newFn);"
    Expected Result: old pattern: 0, new calls: 4
    Evidence: .sisyphus/evidence/task-2-replace-check.txt

  Scenario: selectAndGenerate 有 retry
    Tool: Bash (node -e)
    Steps:
      1. node -e "const fs = require('fs'); const c = fs.readFileSync('src/glm-client.js', 'utf8'); console.log('has retry in selectAndGenerate:', c.includes('retry('));"
    Expected Result: true
    Evidence: .sisyphus/evidence/task-2-retry-check.txt
  ```

  **Commit**: YES (groups with Task 1)
  - Message: `refactor(glm): extract JSON parser, retry, and shared prompt rules`
  - Files: `src/llm-utils.js`, `src/glm-client.js`

---

## Final Verification Wave

- [x] F1. **Plan Compliance** — deep
- [x] F2. **Code Quality** — deep
- [x] F3. **Scope Fidelity** — deep
  只修改 glm-client.js + 新增 llm-utils.js。其他文件零 diff。
  Output: `Tasks [N/N compliant] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Single commit**: `refactor(glm): extract JSON parser, retry, and shared prompt rules`

---

## Success Criteria

```bash
# 1. 工具函数测试
node -e "const {parseJsonFromLLM} = require('./src/llm-utils'); console.log(parseJsonFromLLM('\`\`\`json\n{\"a\":1}\n\`\`\`'));"
# Expected: { a: 1 }

# 2. 语法检查
node -c src/llm-utils.js && node -c src/glm-client.js
# Expected: 无输出

# 3. CLI 端到端
node bin/cli.js "戒指男潮牌高级感痞帅" --length 60
# Expected: 正常输出标题
```
