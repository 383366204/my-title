# 标题生成逻辑重构 + 淘宝数据源新增

## TL;DR

> **Quick Summary**: 重构标题生成逻辑，从当前失效的中文空格分词+高频词统计方式，改为 GLM AI 参考淘宝同行标题重写的方式。新增 taobao-native CLI 搜索模块获取淘宝同行标题数据，同时保留手动输入降级方案。
> 
> **Deliverables**:
> - 新模块 `src/search-taobao.js`（taobao-native CLI 集成 + 手动输入降级）
> - 重写 `src/generate-title.js`（GLM AI 参考同行标题生成）
> - 扩展 `src/glm-client.js`（新增 `generateTitles` 方法）
> - 更新 `src/index.js`（新增淘宝搜索步骤，并行执行）
> - 更新 `bin/cli.js`（新增 `--peer-titles` 选项）
> - 更新 `.env.example`（新增淘宝相关配置说明）
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 → Task 4 → Task 6 → Task 7

---

## Context

### Original Request
用户要求重构标题生成逻辑。当前 `generate-title.js` 中的 `countWordFrequency` 按空格分词对中文完全失效，整个做标题的方式有根本性问题。正确流程应为：蓝海词 → 1688 选品验证 → 淘宝同行标题参考 → GLM AI 生成降维打击标题。

### Interview Summary
**Key Discussions**:
- 数据源：用户选择通过虾评Skill平台的淘宝官方skill（taobao-native CLI）获取淘宝同行标题数据
- 生成算法：用户选择 GLM AI 参考同行标题重写方式（而非规则提取+拼装或混合方案）
- 范围：标题生成逻辑重构 + 新增淘宝数据源模块
- 用户明确拒绝中文分词方案（本地规则和AI分词都认为整个逻辑有问题）

**Research Findings**:
- 虾评Skill平台是Agent技能分享平台，taobao-native CLI需要本地安装淘宝桌面版
- taobao-native CLI支持：商品搜索、浏览、加购、订单管理等操作
- 当前 `countWordFrequency` 对中文标题完全无效（按空格分词）
- 当前项目无测试框架，package.json test是占位符
- 项目使用CommonJS模块规范

### Metis Review
**Identified Gaps** (addressed):
- taobao-native CLI接口未知 → 已添加研究任务（Task 1）
- 1688数据在新流程中的角色 → 已明确：仅用于选品验证（刚性过滤），不再用于标题生成
- GLM标题生成的prompt设计 → 已确定：temperature 0.7，5-10条同行标题作为参考
- 手动输入格式 → 已确定：`--peer-titles` 逗号分隔，或 `--peer-titles-file` 读取文件
- 双源不可用时的降级 → 已确定：使用GLM仅基于coreWord+modifiers生成（非旧方法）

---

## Work Objectives

### Core Objective
重构标题生成逻辑：从失效的中文空格分词+高频词统计，改为 GLM AI 参考淘宝同行标题重写。新增淘宝搜索数据源模块，保留1688选品验证功能。

### Concrete Deliverables
- `src/search-taobao.js` — 淘宝同行标题搜索模块（taobao-native CLI + 手动输入降级）
- `src/generate-title.js` — 完全重写为GLM AI参考同行标题生成
- `src/glm-client.js` — 新增 `generateTitles` 方法
- `src/index.js` — 新流程编排（并行搜索 + GLM生成）
- `bin/cli.js` — 新增 `--peer-titles` 和 `--peer-titles-file` 选项
- `.env.example` — 淘宝相关配置说明

### Definition of Done
- [ ] `node bin/cli.js --help` 显示 `--peer-titles` 和 `--peer-titles-file` 选项
- [ ] `node bin/cli.js "纯银项链女高级感" --peer-titles "925纯银项链女锁骨链,韩版项链女简约百搭"` 能生成合理标题
- [ ] 无 taobao-native 时自动降级到手动输入模式，不崩溃
- [ ] `countWordFrequency` 函数已从代码中完全移除
- [ ] GLM 客户端新增 `generateTitles` 方法（temperature 0.7）
- [ ] 1688搜索和淘宝搜索可并行执行
- [ ] 所有修改文件通过 `node -c` 语法检查
- [ ] 保留所有现有功能（extract-core, search-1688, banned-words 不变）

### Must Have
- taobao-native CLI 集成，能获取淘宝同行标题
- 无 taobao-native 时优雅降级到手动输入模式
- GLM AI 参考同行标题生成SEO优化标题
- 1688搜索继续用于选品验证（刚性过滤）
- 三段式规则（核心词前置）融入GLM提示词
- 违禁词过滤继续应用于生成结果
- 保持现有 CLI 基本接口 `node bin/cli.js "关键词"`

### Must NOT Have (Guardrails)
- ❌ 不修改 `src/extract-core.js`（保持原样）
- ❌ 不修改 `src/search-1688.js`（保持原样）
- ❌ 不修改 `src/alibaba1688-client.js`（保持原样）
- ❌ 不修改 `src/banned-words.js` 或 `data/banned-words.json`（保持原样）
- ❌ 不添加测试框架（本次范围外）
- ❌ 不添加 TypeScript（本次范围外）
- ❌ 不添加 ESLint/Prettier（本次范围外）
- ❌ 不回退到旧的 `countWordFrequency` 方式作为降级
- ❌ 不为数据源创建抽象接口/基类（简单直接实现即可）
- ❌ 不修改 `Alibaba1688Client` 的签名机制
- ❌ 不在标题中添加空格分隔（中文标题不使用空格）

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: None (project has no test framework, not adding one)
- **Framework**: none
- **If TDD**: N/A

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **CLI/Module**: Use Bash (`node -c` for syntax, `node bin/cli.js` for functional)
- **API**: Use Bash (curl or node script for GLM API calls)
- **Integration**: Use Bash (end-to-end CLI test)

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - research + method design):
├── Task 1: 研究 taobao-native CLI 接口 [quick]
├── Task 2: GLM 客户端新增 generateTitles 方法 [deep]
└── Task 3: 更新 .env.example [quick]

Wave 2 (After Wave 1 - 核心模块重写, MAX PARALLEL):
├── Task 4: 创建 src/search-taobao.js [deep, depends: 1]
└── Task 5: 重写 src/generate-title.js [deep, depends: 2]

Wave 3 (After Wave 2 - 集成):
├── Task 6: 更新 src/index.js 新流程编排 [unspecified-high, depends: 4, 5]
└── Task 7: 更新 bin/cli.js 新增选项 [quick, depends: 6]

Wave FINAL (After ALL tasks — 4 parallel reviews, then user okay):
├── Task F1: 计划合规审计 (oracle)
├── Task F2: 代码质量审查 (unspecified-high)
├── Task F3: 真实手动QA (unspecified-high)
└── Task F4: 范围保真检查 (deep)
→ Present results → Get explicit user okay

Critical Path: Task 1 → Task 4 → Task 6 → Task 7 → F1-F4 → user okay
Parallel Speedup: ~45% faster than sequential
Max Concurrent: 3 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | - | 4 | 1 |
| 2 | - | 5 | 1 |
| 3 | - | - | 1 |
| 4 | 1 | 6 | 2 |
| 5 | 2 | 6 | 2 |
| 6 | 4, 5 | 7 | 3 |
| 7 | 6 | - | 3 |

### Agent Dispatch Summary

- **Wave 1**: 3 tasks — T1 → `quick`, T2 → `deep`, T3 → `quick`
- **Wave 2**: 2 tasks — T4 → `deep`, T5 → `deep`
- **Wave 3**: 2 tasks — T6 → `unspecified-high`, T7 → `quick`
- **FINAL**: 4 tasks — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. 研究 taobao-native CLI 接口

  **What to do**:
  - 下载并安装虾评Skill平台的淘宝官方skill（ID: 5d2b024b-8ffe-4f66-a6df-1626a2e8f0b1）
  - 研究taobao-native CLI的搜索命令格式、参数、输出格式
  - 确定如何检测taobao-native是否已安装（`which taobao-native` 或类似命令）
  - 测试搜索淘宝商品并获取同行标题的完整流程
  - 记录CLI的输出格式（JSON结构、字段名、结果数量限制）
  - 记录错误处理行为（超时、无结果、认证失败等）

  **Must NOT do**:
  - 不编写任何项目代码
  - 不修改任何现有文件
  - 不注册虾评Skill平台的付费服务（只做研究）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 研究任务，主要是文档分析和CLI测试
  - **Skills**: `[]`
    - 无需特殊技能

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Task 4
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - 虾评Skill平台: https://xiaping.coze.site — 技能分享平台主页
  - 淘宝官方skill详情: https://xiaping.coze.site/skill/5d2b024b-8ffe-4f66-a6df-1626a2e8f0b1 — skill详情页

  **API/Type References**:
  - 虾评Skill API: `https://xiaping.coze.site/api/skills/5d2b024b-8ffe-4f66-a6df-1626a2e8f0b1` — skill元数据（已获取，记录在研究草稿中）

  **WHY Each Reference Matters**:
  - 虾评平台文档包含taobao-native CLI的安装指南和API说明
  - skill详情页包含功能描述、支持的操作类型（商品搜索、浏览等）
  - 这些信息决定search-taobao.js的接口设计

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: taobao-native CLI研究完成
    Tool: Bash
    Preconditions: 研究草稿文件存在
    Steps:
      1. 检查研究草稿是否包含以下信息：
         - CLI搜索命令格式
         - 输出格式（JSON结构）
         - 安装检测方法
         - 错误处理行为
      2. 验证信息完整度
    Expected Result: 研究草稿包含所有必要信息，足以设计search-taobao.js接口
    Failure Indicators: 缺少关键信息（命令格式、输出格式、检测方法中的任何一个）
    Evidence: .sisyphus/evidence/task-1-research-complete.md
  ```

  **Commit**: NO（研究任务，无代码变更）

- [x] 2. GLM 客户端新增 generateTitles 方法

  **What to do**:
  - 在 `src/glm-client.js` 中新增 `generateTitles` 方法
  - 方法签名：`async generateTitles({ coreWord, modifiers, peerTitles, products, maxLength })`
  - 设计GLM提示词：参考同行标题 + 核心词 + 修饰词 → 生成3-5个SEO优化标题
  - 提示词关键要求：
    - 核心词必须前置（SEO权重最高）
    - 参考同行标题的用词模式和结构
    - 标题长度不超过maxLength（默认60字符）
    - 去除重复词
    - 三段式结构：核心词 + 刚性修饰词 + 高频属性词/可选修饰词
    - 不使用空格分隔（中文标题连续书写）
    - 输出严格JSON格式
  - temperature设为0.7（比提取核心词高，需要创造性）
  - 超时设为20000ms（生成多标题需要更多时间）
  - 添加降级逻辑：当无同行标题时，仅基于核心词+修饰词生成
  - 保留现有 `extractCoreAndModifiers` 方法不变

  **Must NOT do**:
  - 不修改现有 `extractCoreAndModifiers` 方法
  - 不删除任何现有代码
  - 不添加新的npm依赖（axios已存在）

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 需要精心设计提示词和错误处理，逻辑复杂
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Task 5
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/glm-client.js:1-92` — 现有GLM客户端，遵循PascalCase类+JSDoc+中文注释模式

  **API/Type References**:
  - `src/extract-core.js` — 调用GLM客户端的方式，`extractCoreAndModifiers(input)` 的降级模式
  - `src/generate-title.js:27-33` — 当前 `generateTitles` 函数签名，新方法应保持兼容或扩展

  **Test References**:
  - 无现有测试（项目无测试框架）

  **WHY Each Reference Matters**:
  - glm-client.js规定了代码风格（类方法、JSDoc、中文注释、错误处理模式）
  - extract-core.js展示了降级逻辑的实现模式（try/catch + fallback）
  - 当前generate-title.js的函数签名决定了新方法的输入参数设计

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: GLM客户端语法检查通过
    Tool: Bash
    Preconditions: src/glm-client.js 已修改
    Steps:
      1. 运行 `node -c src/glm-client.js`
    Expected Result: 无输出（语法正确）
    Failure Indicators: 输出SyntaxError
    Evidence: .sisyphus/evidence/task-2-syntax-check.txt

  Scenario: generateTitles方法存在且参数正确
    Tool: Bash
    Preconditions: src/glm-client.js 已修改
    Steps:
      1. 运行 `node -e "const GLMClient = require('./src/glm-client.js'); const c = new GLMClient({apiKey:'test'}); console.log(typeof c.generateTitles)"`
    Expected Result: 输出 "function"
    Failure Indicators: 输出 "undefined" 或报错
    Evidence: .sisyphus/evidence/task-2-method-exists.txt

  Scenario: extractCoreAndModifiers方法未被修改
    Tool: Bash
    Preconditions: src/glm-client.js 已修改
    Steps:
      1. 运行 `node -e "const GLMClient = require('./src/glm-client.js'); const c = new GLMClient({apiKey:'test'}); console.log(typeof c.extractCoreAndModifiers)"`
    Expected Result: 输出 "function"（方法仍然存在）
    Failure Indicators: 输出 "undefined"
    Evidence: .sisyphus/evidence/task-2-existing-method-preserved.txt
  ```

  **Commit**: YES (groups with Task 3)
  - Message: `feat(glm): add generateTitles method to GLM client`
  - Files: `src/glm-client.js`
  - Pre-commit: `node -c src/glm-client.js`

- [x] 3. 更新 .env.example

  **What to do**:
  - 在 `.env.example` 中新增淘宝相关配置说明
  - 添加 `TAOBAO_NATIVE_PATH` 环境变量（taobao-native CLI路径，可选）
  - 添加 `TAOBAO_NATIVE_TIMEOUT` 环境变量（超时时间，默认10000ms）
  - 保留现有 `GLM_API_KEY`、`GLM_API_BASE`、`ALI_1688_AK` 不变
  - 添加注释说明：taobao-native 为可选依赖，未安装时使用手动输入模式

  **Must NOT do**:
  - 不修改现有环境变量的名称或说明
  - 不添加强制性的新环境变量（taobao-native是可选的）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 简单的配置文件更新
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: None
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `.env.example` — 现有环境变量模板

  **WHY Each Reference Matters**:
  - 确保新增配置与现有格式一致

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: .env.example包含新配置
    Tool: Bash
    Preconditions: .env.example 已修改
    Steps:
      1. 运行 `grep "TAOBAO_NATIVE" .env.example`
    Expected Result: 输出包含 TAOBAO_NATIVE_PATH 和 TAOBAO_NATIVE_TIMEOUT 的配置行
    Failure Indicators: grep返回空或报错
    Evidence: .sisyphus/evidence/task-3-env-config.txt
  ```

  **Commit**: YES (groups with Task 2)
  - Message: `feat(glm): add generateTitles method to GLM client`
  - Files: `.env.example`
  - Pre-commit: 无

- [x] 4. 创建 src/search-taobao.js

  **What to do**:
  - 创建新模块 `src/search-taobao.js`
  - 使用 `child_process.execSync` 调用 taobao-native CLI 搜索淘宝商品标题
  - 导出函数 `searchTaobaoTitles(keyword, options)`:
    - `keyword`: 核心词（来自GLM提取）
    - `options.path`: taobao-native CLI路径（默认'taobao-native'）
    - `options.timeout`: 超时时间（默认10000ms）
    - `options.maxResults`: 最大结果数（默认10）
  - 返回值：`string[]`（同行标题数组）
  - 实现安装检测：运行 `which taobao-native`（Linux/Mac）或 `where taobao-native`（Windows），保存到 `isTaobaoNativeInstalled()` 函数
  - 实现手动输入降级：当taobao-native未安装时，返回空数组并在console.warn提示用户使用 `--peer-titles` 手动提供
  - 解析CLI输出，提取商品标题（subject/title字段）
  - 错误处理：try/catch + console.warn + 降级（返回空数组）
  - 遵循项目代码规范：CommonJS (`module.exports`)、JSDoc（`@param`, `@returns`）、中文内联注释
  - 新增环境变量读取：`TAOBAO_NATIVE_PATH`（自定义CLI路径）、`TAOBAO_NATIVE_TIMEOUT`（超时）

  **Must NOT do**:
  - 不为数据源创建抽象接口/基类（直接实现即可）
  - 不修改 `search-1688.js` 或其他现有文件
  - 不添加新的npm依赖

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 需要处理CLI集成、跨平台兼容、错误处理等复杂逻辑
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 5)
  - **Blocks**: Task 6
  - **Blocked By**: Task 1（需要taobao-native CLI研究结果）

  **References**:

  **Pattern References**:
  - `src/search-1688.js:1-52` — 现有搜索模块模式：创建客户端 → 调用API → 过滤结果，导出函数+JSDoc
  - `src/alibaba1688-client.js` — 客户端类模式：构造函数配置 + 异步方法 + 错误处理
  - `src/extract-core.js:1-60` — 降级模式：try/catch主逻辑 + fallback函数

  **API/Type References**:
  - Task 1研究草稿 — taobao-native CLI的命令格式、输出格式、错误行为

  **WHY Each Reference Matters**:
  - search-1688.js是同类模块的参考（搜索+过滤模式）
  - alibaba1688-client.js展示了客户端类的实现模式
  - extract-core.js展示了降级逻辑的实现模式（核心逻辑失败时使用备选方案）
  - Task 1的研究结果决定CLI集成方式

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 模块语法检查通过
    Tool: Bash
    Preconditions: src/search-taobao.js 已创建
    Steps:
      1. 运行 `node -c src/search-taobao.js`
    Expected Result: 无输出（语法正确）
    Failure Indicators: SyntaxError
    Evidence: .sisyphus/evidence/task-4-syntax-check.txt

  Scenario: 模块导出正确函数
    Tool: Bash
    Preconditions: src/search-taobao.js 已创建
    Steps:
      1. 运行 `node -e "const m = require('./src/search-taobao.js'); console.log(typeof m.searchTaobaoTitles, typeof m.isTaobaoNativeInstalled)"`
    Expected Result: 输出 "function function"（两个函数都导出）
    Failure Indicators: 输出 "undefined" 或报错
    Evidence: .sisyphus/evidence/task-4-module-exports.txt

  Scenario: taobao-native未安装时优雅降级
    Tool: Bash
    Preconditions: taobao-native CLI未安装（大多数环境）
    Steps:
      1. 运行 `node -e "const {isTaobaoNativeInstalled} = require('./src/search-taobao.js'); console.log(isTaobaoNativeInstalled())"`
    Expected Result: 输出 "false"（优雅返回false，不崩溃）
    Failure Indicators: 抛出错误或输出 "true"（误检）
    Evidence: .sisyphus/evidence/task-4-fallback-check.txt

  Scenario: searchTaobaoTitles降级到空数组
    Tool: Bash
    Preconditions: taobao-native CLI未安装
    Steps:
      1. 运行 `node -e "const {searchTaobaoTitles} = require('./src/search-taobao.js'); searchTaobaoTitles('项链').then(r => console.log(JSON.stringify(r)))"`
    Expected Result: 输出 "[]"（空数组），console.warn输出建议使用--peer-titles
    Failure Indicators: 抛出错误或返回非数组值
    Evidence: .sisyphus/evidence/task-4-empty-result.txt
  ```

  **Commit**: YES
  - Message: `feat(taobao): add Taobao peer title search module`
  - Files: `src/search-taobao.js`
  - Pre-commit: `node -c src/search-taobao.js`

- [x] 5. 重写 src/generate-title.js

  **What to do**:
  - 完全重写 `src/generate-title.js`
  - 删除 `countWordFrequency` 函数（对中文完全失效的空格分词方式）
  - 删除 `buildTitle` 函数（简单词语拼接，不适用中文标题）
  - 删除 `getLength` 函数（简单 `str.length`，不再需要单独函数）
  - 新增 `generateTitles` 函数，接收：
    - `coreWord` — 核心词
    - `modifiers` — 修饰词列表 `{word, rigidity}`
    - `peerTitles` — 淘宝同行标题数组（来自search-taobao或手动输入）
    - `products` — 1688过滤后商品列表（仅用于上下文参考，不用于高频词统计）
    - `maxLength` — 标题最大长度（默认60）
  - 函数逻辑：
    1. 调用 `GLMClient.generateTitles()` 获取AI生成的标题候选
    2. 对每个候选招待 `removeBannedWords()` 过滤违禁词
    3. 过滤长度不足10字符的标题
    4. 去重
    5. 返回3-5个候选标题
  - 保留 `removeBannedWords` 的调用（从 `banned-words.js` 导入）
  - 新增GLM生成失败时的降级逻辑：基于核心词+刚性修饰词简单拼接（不使用空格分词）
  - 遵循项目代码规范：CommonJS、JSDoc、中文注释

  **Must NOT do**:
  - 不保留 `countWordFrequency` 函数（对中文完全失效）
  - 不保留 `buildTitle` 函数（简单拼接不适用）
  - 不保留 `getLength` 函数（不再需要单独函数）
  - 不修改 `banned-words.js`
  - 不在新降级逻辑中使用空格分词

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 核心逻辑重写，需要精心设计GLM交互和降级逻辑
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 4)
  - **Blocks**: Task 6
  - **Blocked By**: Task 2（需要GLM客户端的generateTitles方法）

  **References**:

  **Pattern References**:
  - `src/generate-title.js:1-119` — 当前完整实现，需要被替换的逻辑
  - `src/banned-words.js:1-?` — 违禁词过滤模块，`removeBannedWords` 函数的用法

  **API/Type References**:
  - `src/glm-client.js` (Task 2 修改后) — `generateTitles` 方法的签名和返回格式
  - `src/extract-core.js:20-26` — 降级模式：try主逻辑 + catch调用降级函数

  **WHY Each Reference Matters**:
  - 当前generate-title.js需要被完全替换，理解其结构有助于保留removeBannedWords调用
  - banned-words.js是唯一保留的依赖
  - glm-client.js的新方法是核心依赖
  - extract-core.js的降级模式是参考实现

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 模块语法检查通过
    Tool: Bash
    Preconditions: src/generate-title.js 已重写
    Steps:
      1. 运行 `node -c src/generate-title.js`
    Expected Result: 无输出（语法正确）
    Failure Indicators: SyntaxError
    Evidence: .sisyphus/evidence/task-5-syntax-check.txt

  Scenario: countWordFrequency已移除
    Tool: Bash
    Preconditions: src/generate-title.js 已重写
    Steps:
      1. 运行 `node -e "const m = require('./src/generate-title.js'); console.log(typeof m.countWordFrequency)"`
    Expected Result: 输出 "undefined"（函数已移除）
    Failure Indicators: 输出 "function"（函数仍在）
    Evidence: .sisyphus/evidence/task-5-no-word-freq.txt

  Scenario: generateTitles函数存在且参数正确
    Tool: Bash
    Preconditions: src/generate-title.js 已重写
    Steps:
      1. 运行 `node -e "const m = require('./src/generate-title.js'); console.log(typeof m.generateTitles)"`
    Expected Result: 输出 "function"
    Failure Indicators: 输出 "undefined"
    Evidence: .sisyphus/evidence/task-5-method-exists.txt

  Scenario: 降级逻辑不使用空格分词
    Tool: Bash
    Preconditions: src/generate-title.js 已重写
    Steps:
      1. 在generate-title.js中搜索 `.split(/\s+/)` 或 `split(' ')` 或空格分词模式
      2. 确认不存在这些模式
    Expected Result: 无空格分词代码
    Failure Indicators: 仍存在空格分词逻辑
    Evidence: .sisyphus/evidence/task-5-no-space-split.txt
  ```

  **Commit**: YES
  - Message: `refactor(title): rewrite title generation with GLM AI peer reference`
  - Files: `src/generate-title.js`
  - Pre-commit: `node -c src/generate-title.js`

- [x] 6. 更新 src/index.js 新流程编排

  **What to do**:
  - 重构 `src/index.js` 的 `run()` 函数，新增淘宝搜索步骤
  - 新流程：
    ```
    Step 1: extractCoreAndModifiers(input)           → { coreWord, modifiers }     [不变]
    Step 2: searchAndFilter(coreWord, modifiers)     → products[]                  [不变]
    Step 3: searchTaobaoTitles(coreWord)             → peerTitles[]                [新增]
    Step 4: generateTitles({ coreWord, modifiers, peerTitles, products, maxLength }) → titles[]  [改写]
    ```
  - **关键优化**：Step 2（1688搜索）和 Step 3（淘宝搜索）并行执行（`Promise.all`）
  - 当 `peerTitles` 为空数组且无手动输入时，`generateTitles` 使用降级模式（仅核心词+修饰词）
  - 更新 `run()` 函数签名，新增 `options.peerTitles` 参数
  - 更新console输出，新增淘宝搜索步骤的进度提示
  - 保留所有现有的console.log风格（emoji前缀）
  - 保留现有模块导入，新增 `search-taobao.js` 导入

  **Must NOT do**:
  - 不修改 `extractCoreAndModifiers` 的调用方式
  - 不修改 `searchAndFilter` 的调用方式
  - 不删除现有的console.log输出
  - 不改变 `run()` 函数的返回类型结构（扩展而非替换）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 核心流程编排变更，需要确保并行执行和降级逻辑正确
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (sequential)
  - **Blocks**: Task 7
  - **Blocked By**: Task 4 (search-taobao), Task 5 (generate-title)

  **References**:

  **Pattern References**:
  - `src/index.js:1-53` — 当前流程编排器，线性步骤+console.log风格
  - `src/search-1688.js:9-24` — searchAndFilter调用模式

  **API/Type References**:
  - `src/search-taobao.js` (Task 4 创建) — `searchTaobaoTitles(keyword, options)` 签名
  - `src/generate-title.js` (Task 5 重写) — `generateTitles({ coreWord, modifiers, peerTitles, products, maxLength })` 签名

  **WHY Each Reference Matters**:
  - index.js是需要修改的核心文件，理解当前流程是关键
  - search-1688.js展示了搜索模块的调用模式
  - 新模块的接口签名决定了index.js的调用方式

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
    Evidence: .sisyphus/evidence/task-6-syntax-check.txt

  Scenario: run函数接受options参数
    Tool: Bash
    Preconditions: src/index.js 已修改
    Steps:
      1. 运行 `node -e "const {run} = require('./src/index.js'); console.log(run.length)"` 检查函数参数数量
    Expected Result: 输出 "2"（input + options两个参数）
    Failure Indicators: 输出 "1" 或报错
    Evidence: .sisyphus/evidence/task-6-run-signature.txt

  Scenario: 1688和淘宝搜索并行执行（代码检查）
    Tool: Bash
    Preconditions: src/index.js 已修改
    Steps:
      1. 在index.js中搜索 Promise.all
    Expected Result: 找到Promise.all调用，包含1688搜索和淘宝搜索
    Failure Indicators: 无Promise.all或只有串行调用
    Evidence: .sisyphus/evidence/task-6-parallel-search.txt
  ```

  **Commit**: YES (groups with Task 7)
  - Message: `feat(flow): integrate Taobao search and new title generation into pipeline`
  - Files: `src/index.js`
  - Pre-commit: `node -c src/index.js`

- [x] 7. 更新 bin/cli.js 新增选项

  **What to do**:
  - 在 `bin/cli.js` 中新增两个选项：
    - `-p, --peer-titles <titles>` — 手动提供淘宝同行标题，逗号分隔
    - `-f, --peer-titles-file <path>` — 从文件读取淘宝同行标题，每行一个
  - 将传入的同行标题解析为数组，传递给 `run()` 的 `options.peerTitles` 参数
  - `--peer-titles-file` 读取文件内容，按行分割为标题数组
  - 更新program.description，反映新流程（添加"淘宝同行标题参考"）
  - 当使用 `--peer-titles` 时，跳过taobao-native搜索（手动输入优先于自动搜索）
  - 处理文件读取错误（文件不存在、格式错误等）
  - 保留现有 `--length` 和 `--count` 选项不变

  **Must NOT do**:
  - 不删除现有选项（`--length`, `--count`）
  - 不改变现有命令行格式（`node bin/cli.js "关键词"`）
  - 不添加交互式输入模式（只用命令行参数）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 简单的CLI参数扩展，commander库用法
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (sequential, after Task 6)
  - **Blocks**: None
  - **Blocked By**: Task 6 (index.js新签名)

  **References**:

  **Pattern References**:
  - `bin/cli.js:1-41` — 当前CLI实现，commander库用法

  **API/Type References**:
  - `commander` npm包 — `.option()` 方法的用法

  **WHY Each Reference Matters**:
  - 当前CLI是commander实现，保持一致的模式

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: CLI帮助显示新选项
    Tool: Bash
    Preconditions: bin/cli.js 已修改
    Steps:
      1. 运行 `node bin/cli.js --help`
    Expected Result: 输出包含 --peer-titles 和 --peer-titles-file 选项的描述
    Failure Indicators: 帮助信息中缺少新选项
    Evidence: .sisyphus/evidence/task-7-cli-help.txt

  Scenario: --peer-titles参数解析
    Tool: Bash
    Preconditions: bin/cli.js 已修改
    Steps:
      1. 运行 `node bin/cli.js "test" --peer-titles "标题1,标题2,标题3" 2>&1 | head -5`
      2. 观察是否有解析错误
    Expected Result: 无解析错误（可能因API key未设置而报错，但不是参数解析错误）
    Failure Indicators: unknown option或参数解析错误
    Evidence: .sisyphus/evidence/task-7-peer-titles-arg.txt

  Scenario: 无peer-titles时正常执行
    Tool: Bash
    Preconditions: bin/cli.js 已修改
    Steps:
      1. 运行 `node bin/cli.js --help`
      2. 确认基本命令行格式不变
    Expected Result: 帮助信息正常显示，原有选项不变
    Failure Indicators: 原有选项消失或格式错误
    Evidence: .sisyphus/evidence/task-7-backward-compat.txt
  ```

  **Commit**: YES (groups with Task 6)
  - Message: `feat(flow): integrate Taobao search and new title generation into pipeline`
  - Files: `bin/cli.js`
  - Pre-commit: `node -c bin/cli.js`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **计划合规审计** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **代码质量审查** — `unspecified-high`
  Run `node -c` on all modified files. Review all changed files for: `as any`, empty catches, console.log in prod (console.warn is OK), unused imports/variables, hardcoded API keys. Check AI slop: excessive comments, over-abstraction, generic names. Verify CommonJS pattern consistency. Verify JSDoc on all exports. Verify Chinese comments on business logic.

- [x] F3. **真实手动QA** — `unspecified-high`
  Start from clean state. Execute: 1) `node bin/cli.js --help` — verify new options shown. 2) `node bin/cli.js "纯银项链女高级感" --peer-titles "925纯银项链女锁骨链简约百搭,韩版项链女设计感小众,纯银项链女生日礼物送女友"` — verify title generation works. 3) Test without `--peer-titles` — verify graceful degradation. 4) Test without taobao-native installed — verify fallback message. Save all output to evidence.

- [x] F4. **范围保真检查** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance. Verify `extract-core.js`, `search-1688.js`, `alibaba1688-client.js`, `banned-words.js`, `data/banned-words.json` are UNCHANGED. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes.

---

## Commit Strategy

- **Task 2+3**: `feat(glm): add generateTitles method to GLM client` — `src/glm-client.js`, `.env.example`
- **Task 4**: `feat(taobao): add Taobao peer title search module` — `src/search-taobao.js`
- **Task 5**: `refactor(title): rewrite title generation with GLM AI peer reference` — `src/generate-title.js`
- **Task 6+7**: `feat(flow): integrate Taobao search and new title generation into pipeline` — `src/index.js`, `bin/cli.js`

---

## Success Criteria

### Verification Commands
```bash
# 语法检查
node -c src/search-taobao.js && node -c src/generate-title.js && node -c src/glm-client.js && node -c src/index.js && node -c bin/cli.js
# Expected: 无输出（全部通过）

# CLI帮助
node bin/cli.js --help
# Expected: 显示 --peer-titles 和 --peer-titles-file 选项

# 功能测试（手动输入同行标题模式）
node bin/cli.js "纯银项链女高级感" --peer-titles "925纯银项链女锁骨链简约百搭,韩版项链女设计感小众"
# Expected: 生成3-5个SEO优化标题，核心词前置，无违禁词

# 无taobao-native降级测试
# Expected: 不崩溃，显示友好提示建议使用--peer-titles

# 全流程测试（需要有效API keys）
node bin/cli.js "纯棉T恤男宽松夏季"
# Expected: 完整流程执行，生成标题
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] `countWordFrequency` completely removed from `generate-title.js`
- [ ] GLM client has both `extractCoreAndModifiers` and `generateTitles` methods
- [ ] `search-taobao.js` handles taobao-native not installed gracefully
- [ ] `index.js` runs 1688 search and Taobao search in parallel
- [ ] CLI shows new options in `--help`
- [ ] Unchanged files: `extract-core.js`, `search-1688.js`, `alibaba1688-client.js`, `banned-words.js`, `data/banned-words.json`