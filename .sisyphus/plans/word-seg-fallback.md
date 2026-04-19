# Fallback 标题分词改进

## TL;DR

> **核心目标**: 在 `constructFallbackTitle()` 中引入 nodejieba 中文分词库，实现词级别的去重过滤，替代当前的字符级过滤（解决"男士"→"士"、"食指"→"食"等词组断裂问题）。
>
> **交付物**:
> - 安装 nodejieba 依赖
> - `src/title-utils.js` 的 `constructFallbackTitle` 改用词级过滤
>
> **预估工作量**: Quick（1 个任务 + 验证）
> **关键路径**: 安装依赖 → 修改算法 → 测试

---

## Context

### Problem
当前 `constructFallbackTitle` 使用字符级过滤（从原标题中移除蓝海词中的每个字符），导致中文词组被截断：
- "男士" → 移除"男" → 残留"士"（无意义）
- "食指" → 移除"指" → 残留"食"（无意义）
- "男女" → 移除"男" → 残留"女"

### Solution
用 nodejieba 对原标题和蓝海词都做分词，然后在**词级别**去重：保留原标题中不在蓝海词词集中的完整词。

---

## Work Objectives

### Concrete Deliverables
- `package.json`: 新增 nodejieba 依赖
- `src/title-utils.js`: constructFallbackTitle 改用 nodejieba.cut() 分词

### Definition of Done
- [ ] `npm install nodejieba` 成功
- [ ] `constructFallbackTitle('戒指男潮牌高级感痞帅', '简约高级感男士戒指女开口轻奢重工食指戒潮流个性复古不掉色手饰', [], 60)` 输出无断词（如无孤立的"士"、"食"）
- [ ] 所有标题 >= 20 字符
- [ ] 蓝海词前置

### Must Have
- 词级去重（完整词保留或移除，不拆词）
- 蓝海词前置
- 兼容 CommonJS（require）
- nodejieba 惰性加载（首次调用时加载词典，不影响其他函数）

### Must NOT Have
- ❌ 不修改 cleanTitle、ensureBlueOceanPrefix、normalizeLength、postProcessTitle
- ❌ 不修改 index.js、generate-title.js（它们只调用 constructFallbackTitle，接口不变）
- ❌ 不修改 glm-client.js、banned-words.js、search-1688.js、search-taobao.js

---

## Execution Strategy

```
Wave 1 (单任务):
└── Task 1: 安装 nodejieba + 重写 constructFallbackTitle [deep]

Wave FINAL:
├── F1: Plan compliance [quick]
├── F2: Code quality [quick]
└── F3: Scope fidelity [quick]
```

---

## TODOs

- [x] 1. 安装 nodejieba + 重写 `constructFallbackTitle` 词级过滤

  **What to do**:

  **Step 1: 安装依赖**
  ```bash
  npm install nodejieba
  ```

  **Step 2: 修改 `src/title-utils.js`**

  在文件顶部添加 nodejieba 惰性加载：
  ```javascript
  // 惰性加载 nodejieba（仅 constructFallbackTitle 使用，避免影响其他函数的加载速度）
  let _nodejieba = null;
  function getNodejieba() {
    if (!_nodejieba) {
      _nodejieba = require('nodejieba');
    }
    return _nodejieba;
  }
  ```

  重写 `constructFallbackTitle` 函数，核心算法改为：
  1. 用 nodejieba.cut() 对蓝海词分词 → 得到蓝海词词集（Set）
  2. 清理原标题（removeBannedWords + cleanTitle）
  3. 移除原标题中的蓝海词整串
  4. 用 nodejieba.cut() 对清理后的原标题分词 → 得到词数组
  5. 过滤掉与蓝海词词集重叠的词（精确匹配）
  6. 将过滤后的词用 join('') 拼接
  7. 如有 taobaoTitles，对每个淘宝标题分词后提取不在结果中的词补充
  8. 蓝海词前置 + 过滤后的词 + 淘宝补充词
  9. 截断到 maxLength

  新函数签名不变（保持向后兼容）：
  ```javascript
  function constructFallbackTitle(blueOceanWord, originalTitle, taobaoTitles = [], maxLength = 60)
  ```

  算法伪代码：
  ```javascript
  function constructFallbackTitle(blueOceanWord, originalTitle, taobaoTitles = [], maxLength = 60) {
    if (typeof blueOceanWord !== 'string' || !blueOceanWord) return '';
    
    const jieba = getNodejieba();
    
    // 1. 蓝海词分词，构建词集
    const blueWords = new Set(jieba.cut(blueOceanWord));
    // 例如 "戒指男潮牌高级感痞帅" → Set{"戒指", "男", "潮牌", "高级", "感", "痞帅"}
    
    // 2. 清理原标题
    let cleaned = cleanTitle(removeBannedWords(originalTitle || ''));
    
    // 3. 移除蓝海词整串（如果原标题包含完整蓝海词）
    cleaned = cleaned.replace(blueOceanWord, '');
    
    // 4. 对清理后的原标题分词
    const titleWords = jieba.cut(cleaned);
    // 例如 "简约高级感男士戒指女开口..." → ["简约", "高级感", "男士", "戒指", "女", "开口", ...]
    
    // 5. 过滤掉蓝海词词集中的词
    const filteredWords = titleWords.filter(w => !blueWords.has(w));
    // 例如过滤掉 "高级感"(如果 blueWords 包含)、"戒指"、"男" 等
    // 保留 "简约"、"男士"、"女"、"开口" 等完整词
    
    // 6. 拼接
    let result = blueOceanWord + filteredWords.join('');
    
    // 7. 淘宝同行标题补充（词级别）
    if (Array.isArray(taobaoTitles) && taobaoTitles.length > 0) {
      const resultWordSet = new Set(jieba.cut(result));
      for (const t of taobaoTitles) {
        if (typeof t !== 'string') continue;
        let tClean = cleanTitle(removeBannedWords(t));
        const tWords = jieba.cut(tClean);
        for (const w of tWords) {
          if (!blueWords.has(w) && !resultWordSet.has(w) && w.length > 0) {
            result += w;
            resultWordSet.add(w);
            if (result.length >= maxLength) break;
          }
        }
        if (result.length >= maxLength) break;
      }
    }
    
    // 8. 截断
    if (result.length > maxLength) result = result.substring(0, maxLength);
    
    return result.replace(/\s+/g, '');
  }
  ```

  **Step 3: 验证**
  ```bash
  node -c src/title-utils.js
  node -e "
  const {constructFallbackTitle} = require('./src/title-utils');
  const r = constructFallbackTitle('戒指男潮牌高级感痞帅', '简约高级感男士戒指女开口轻奢重工食指戒潮流个性复古不掉色手饰', [], 60);
  console.log(r);
  console.log('len:', r.length);
  // 预期：'男士'、'食指' 等词保持完整，不被截断
  // 预期：长度 >= 20
  "
  ```

  **Must NOT do**:
  - 不修改其他函数（cleanTitle, ensureBlueOceanPrefix, normalizeLength, postProcessTitle）
  - 不修改 module.exports 结构
  - 不修改 index.js 或 generate-title.js（接口不变）

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (single task)
  - **Blocks**: F1-F3
  - **Blocked By**: None

  **References**:
  - `src/title-utils.js` — 当前文件，需要修改 constructFallbackTitle 函数（第 47-90 行）
  - nodejieba API: `require('nodejieba').cut('中文文本')` → 返回 `string[]`
  - nodejieba 首次调用会自动加载默认词典（约 1-2 秒）
  - 注意：nodejieba.cut() 返回的词可能包含单字，如 ["简约", "高", "级", "感", "男士", "戒指", "女"]

  **QA Scenarios:**

  ```
  Scenario: 词组完整性 — "男士"不被截断
    Tool: Bash (node -e)
    Steps:
      1. 运行: node -e "const {constructFallbackTitle} = require('./src/title-utils'); const r = constructFallbackTitle('戒指男潮牌高级感痞帅', '简约高级感男士戒指女开口轻奢重工食指戒潮流个性复古不掉色手饰', [], 60); console.log(r); console.log('len:', r.length);"
      2. 检查 "男士" 完整出现在结果中（而非 "士" 孤字）
      3. 检查长度 >= 20
    Expected Result: 包含完整 "男士"、"食指" 等词组，长度 >= 20
    Evidence: .sisyphus/evidence/word-seg-normal.txt

  Scenario: 空原标题
    Tool: Bash (node -e)
    Steps:
      1. 运行: node -e "const {constructFallbackTitle} = require('./src/title-utils'); const r = constructFallbackTitle('戒指男潮牌高级感痞帅', '', [], 60); console.log(r); console.log('len:', r.length);"
    Expected Result: 返回 "戒指男潮牌高级感痞帅"
    Evidence: .sisyphus/evidence/word-seg-empty.txt

  Scenario: 带淘宝同行标题
    Tool: Bash (node -e)
    Steps:
      1. 运行: node -e "const {constructFallbackTitle} = require('./src/title-utils'); const r = constructFallbackTitle('戒指男潮牌高级感痞帅', '简约戒指男', ['潮牌戒指男士个性复古不掉色', '戒指男潮牌高级感钛钢'], 60); console.log(r); console.log('len:', r.length);"
    Expected Result: 长度 >= 20
    Evidence: .sisyphus/evidence/word-seg-taobao.txt

  Scenario: 端到端 CLI 测试
    Tool: Bash
    Steps:
      1. 运行: node bin/cli.js "戒指男潮牌高级感痞帅" --length 60
      2. 检查 fallback 标题无孤字（"士"、"食" 等不在标题中）
    Expected Result: 所有 fallback 标题词组完整
    Evidence: .sisyphus/evidence/word-seg-e2e.txt
  ```

  **Commit**: YES
  - Message: `feat(title): use nodejieba for word-level segmentation in fallback title`
  - Files: `src/title-utils.js`, `package.json`, `package-lock.json`

---

## Final Verification Wave

- [x] F1. **Plan Compliance** — quick
- [x] F2. **Code Quality** — quick
- [x] F3. **Scope Fidelity** — quick

---

## Commit Strategy

- **Single commit**: `feat(title): use nodejieba for word-level segmentation in fallback title`

---

## Success Criteria

```bash
# 1. nodejieba 安装成功
node -e "require('nodejieba'); console.log('OK');"
# Expected: OK

# 2. 词组完整性验证
node -e "const {constructFallbackTitle} = require('./src/title-utils'); const r = constructFallbackTitle('戒指男潮牌高级感痞帅', '简约高级感男士戒指女开口轻奢重工食指戒潮流个性复古不掉色手饰', [], 60); console.log(r);"
# Expected: "男士" 完整保留，无孤字

# 3. CLI 端到端测试
node bin/cli.js "戒指男潮牌高级感痞帅" --length 60
# Expected: 所有 fallback 标题词组完整
```
