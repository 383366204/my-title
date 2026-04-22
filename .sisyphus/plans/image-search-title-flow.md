# 以图搜图替代文字搜索 — 标题生成流程优化

## TL;DR

> **Quick Summary**: 用 1688 商品主图通过 taobao-native `image_search` 在淘宝搜索视觉同款，用同款商品的真实标题替代当前基于蓝海词的文字搜索结果，解决标题风格不匹配的根本问题。
> 
> **Deliverables**:
> - 新模块 `src/search-taobao-image.js`（以图搜图 + 限流 + 降级）
> - 修改 `src/index.js`（流程从并行改为串行：1688→图片搜索→GLM）
> - `image_search` 返回格式探查与解析
> - CLI/MCP 接口兼容性保持不变
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves (基础探查 → 核心实现 → 集成验证)
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 4 → Task 5

- [x] 3. 实现 `image_search` 调用与结果解析

  **What to do**:
  - 基于 Task 1 探查到的 `image_search` 返回格式，实现 `imageSearchSingle()` 函数的完整逻辑
  - 核心调用逻辑：
    ```javascript
    function imageSearchSingle(imageUrl, productId, options = {}) {
      // 1. 验证 imageUrl 非空
      if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) {
        return { productId, peerTitles: [], priceRange: {}, hasMatch: false };
      }
      
      // 2. 构建 CLI 命令（参照 search-taobao.js:84-91 的模式）
      const winPath = toWindowsPath(TAOBAO_NATIVE_PATH);
      const tmpOutput = path.join(os.tmpdir(), `taobao-image-${productId}-${Date.now()}.json`);
      
      const cmd = `cmd.exe /c "${winPath}" image_search --args '{\\"imagePath\\":\\"${imageUrl}\\",\\"sourceApp\\":\\"my-title\\"}' -o "${toWindowsPath(tmpOutput)}"`;
      
      // 3. execSync 执行，设置超时(30s)
      const result = execSync(cmd, { encoding: 'utf8', timeout: options.timeout || 30000 });
      
      // 4. 读取 -o 输出文件（避免 stdout 截断）
      const rawData = fs.readFileSync(tmpOutput, 'utf8');
      
      // 5. 解析 JSON（基于 Task 1 确定的结构）
      const data = JSON.parse(rawData);
      
      // 6. 提取 peerTitles、priceRange 等
      return parseImageSearchResult(data, productId);
    }
    ```
  - 实现 `parseImageSearchResult(data, productId)` 解析函数：
    - 根据 Task 1 记录的实际字段名提取 products 数组
    - 从每个 product 中提取 title 字段 → 组成 peerTitles 数组
    - 提取价格字段 → 计算 priceRange: { min, max }
    - 提取销量字段 → 可选记录（用于后续爆款加权，v2 使用）
    - 如果 products 为空或解析失败 → 返回 `{ productId, peerTitles: [], hasMatch: false }`
    - 清理临时文件
  - 错误处理覆盖：
    - execSync 超时 → 返回无匹配结果 + warn 日志
    - JSON 解析失败 → 返回无匹配结果 + warn 日志
    - 文件读取失败 → 尝试从 stdout 解析（fallback 到 search-taobao.js 的模式）
    - taobao-native 进程异常退出（非零 exit code）→ 捕获 stderr 并返回无匹配

  **Must NOT do**:
  - ❌ 不假设返回格式与 `search_products` 相同（必须按 Task 1 实际探查结果编写）
  - ❌ 不在 image_search 调用中实现限流（这是 Task 4 的职责）
  - ❌ 不修改 GLM prompt 或 glm-client.js

  **Recommended Agent Profile**:
  - **Category**: `deep` — 核心业务逻辑实现，涉及 CLI 调用、JSON 解析、多种错误路径处理
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 2 (with Tasks 4, 5)
  - **Blocks**: Task 5, Task 6 | **Blocked By**: Task 1 (返回格式), Task 2 (骨架)

  **References**:

  **Pattern References**:
  - `src/search-taobao.js:83-121` — CLI 调用+JSON 解析+错误处理的完整模式（核心参考）
  - `src/search-taobao.js:93-100` — JSON 行查找和解析逻辑
  - `src/search-taobao.js:104-113` — products 数组提取和 title 映射
  - `src/alibaba1688-client.js:192-206` — execSync 错误处理和重试模式

  **External References**:
  - `.sisyphus/evidence/task1-image-search-format.md` — **关键依赖**: Task 1 探查的实际返回格式

  **Acceptance Criteria**:

  - [ ] `imageSearchSingle()` 接受有效1688图片URL并返回 `{ peerTitles: string[], priceRange: {}, hasMatch: boolean }`
  - [ ] 无效URL（空/非http）立即返回 `{ hasMatch: false }` 且不调用CLI
  - [ ] 有效URL但无结果时返回 `{ peerTitles: [], hasMatch: false }`
  - [ ] 所有错误路径（超时/解析失败/进程异常）都被 catch 且不抛出异常
  - [ ] 临时输出文件在函数结束后被清理

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 有效图片URL成功获取同款标题
    Tool: Bash
    Preconditions: Task 1 已完成；淘宝桌面版可运行
    Steps:
      1. node -e "const { imageSearchSingle } = require('./src/search-taobao-image');
         imageSearchSingle('<真实1688图片URL>', 'test-001').then(r => console.log(JSON.stringify(r, null, 2))).catch(e => console.error(e.message));"
      2. 检查 peerTitles 是否为非空数组，hasMatch 是否为 true
    Expected Result: 返回含非空peerTitles的对象，hasMatch=true，无未捕获异常
    Failure Indicators: 抛异常、peerTitles空但hasMatch=true
    Evidence: .sisyphus/evidence/task3-success-result.json

  Scenario: 无效URL快速跳过不调用CLI
    Tool: Bash
    Steps:
      1. node -e "const { imageSearchSingle } = require('./src/search-taobao-image');
         Promise.all([imageSearchSingle('', 'e'), imageSearchSingle('not-a-url', 'i')]).then(r => console.log(JSON.stringify(r)));"
      2. 确认两次都在 <100ms 内返回
    Expected Result: 两次都返回 `{ peerTitles: [], hasMatch: false }`，瞬间返回
    Evidence: .sisyphus/evidence/task3-invalid-url-skip.txt

  Scenario: CLI调用失败时的优雅降级
    Tool: Bash
    Steps:
      1. 临时将 TAOBAO_NATIVE_PATH 改为不存在的路径
      2. node -e "const { imageSearchSingle } = require('./src/search-taobao-image');
         imageSearchSingle('https://example.com/test.jpg', 'fail').then(r => console.log('ok:', JSON.stringify(r))).catch(e => console.error('err:', e.message));"
      3. 恢复 TAOBAO_NATIVE_PATH
    Expected Result: 返回 `{ peerTitles: [], hasMatch: false }`，不抛异常
    Evidence: .sisyphus/evidence/task3-cli-fail-graceful.txt
  ```

  **Evidence to Capture**:
  - [ ] task3-success-result.json
  - [ ] task3-invalid-url-skip.txt
  - [ ] task3-cli-fail-graceful.txt

  **Commit**: NO (groups with Task 4)

- [x] 4. 实现限流与并发控制 (`withRateLimit` + `searchPeerTitlesByImage` 主逻辑)

  **What to do**:
  - 实现 `withRateLimit(items, handler, concurrency, intervalMs)` 并发控制函数：
    - 启动 `concurrency` 个 worker 并行处理队列中的 items
    - 每个 worker 从共享索引取任务，执行完后取下一个
    - 每 `concurrency` 个任务完成后等待 `intervalMs`（不是每个都等）
    - 单个 task 失败 catch 后返回默认值，不影响其他 worker
  - 实现 `searchPeerTitlesByImage(products, options)` 主入口：
    - 过滤掉没有有效图片URL的商品（`!p.url || !p.url.startsWith('http')`），记录跳过数量
    - 只启动一次淘宝桌面版（`launchTaobaoDesktop` + sleep 5000ms）
    - 调用 `withRateLimit(products, handler, concurrency=2, intervalMs=4000)`
    - 打印统计日志：总数/匹配数/耗时
    - 返回结果数组长度等于输入 products 长度
  - 实现 `isImageSearchAvailable()` 导出函数
  - 实现 `sleep(ms)` 工具函数

  **Must NOT do**:
  - ❌ 不实现 image_search 具体调用（Task 3 已做）
  - ❌ 不修改 index.js（Task 5 做）
  - ❌ concurrency 默认值不超过 2

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — 并发控制涉及 Promise 调度、错误隔离
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 2 (with Tasks 3, 5)
  - **Blocks**: Task 5, Task 6 | **Blocked By**: Task 2 (骨架), Task 3 (imageSearchSingle)

  **References**:
  - `src/index.js:186-198` — batch 并行处理模式（Promise.all + 日志风格参考）
  - `src/index.js:194-197` — 单项失败的 catch 处理模式
  - `src/search-taobao.js:75-76` — 等待桌面版就绪的模式

  **Acceptance Criteria**:

  - [ ] `withRateLimit()` 通过日志时间戳验证间隔 ≥ intervalMs
  - [ ] 单个 task 失败不阻塞其他 task
  - [ ] 无 URL 商品被正确过滤和计数
  - [ ] 返回数组长度 == 输入 products 长度
  - [ ] N=15, concurrency=2 时总耗时在 60-90s 内

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 限流生效（调用间隔≥3秒）
    Tool: Bash
    Preconditions: 至少3个有图片的1688商品；淘宝桌面版可运行
    Steps:
      1. 准备测试产品列表（从1688搜索获取前3个带图商品）
      2. node -e "const { searchPeerTitlesByImage } = require('./src/search-taobao-image');
         console.log('start:', new Date().toISOString());
         searchPeerTitlesByImage(testProducts, { concurrency: 1, intervalMs: 3000 }).then(r => {
           console.log('end:', new Date().toISOString(), 'count:', r.length);
         });"
      3. 观察日志时间戳
    Expected Result: 调用间隔约3-5s；总耗时 ≥ (N-1) × 3s
    Failure Indicators: 间隔<2s；所有调用几乎同时发出
    Evidence: .sisyphus/evidence/task4-rate-limit-log.txt

  Scenario: 部分失败不影响整体
    Tool: Bash
    Steps:
      1. 构造混合输入：2个有效URL + 1个无效URL + 1个空URL
      2. 运行 searchPeerTitlesByImage
      3. 检查返回长度==4；无效URL结果为 hasMatch:false
    Expected Result: 4条结果；无效的不阻塞其他
    Evidence: .sisyphus/evidence/task4-partial-failure.txt

  Scenario: 无图片商品正确跳过
    Tool: Bash
    Steps:
      1. 输入 [{id:'1'}, {id:'2', url:''}, {id:'3', url:'not-http'}]
      2. 运行 searchPeerTitlesByImage
    Expected Result: 日志显示"3个商品无图片URL，跳过"；返回3条hasMatch:false；不调CLI
    Evidence: .sisyphus/evidence/task4-skip-no-image.txt
  ```

  **Evidence to Capture**:
  - [ ] task4-rate-limit-log.txt
  - [ ] task4-partial-failure.txt
  - [ ] task4-skip-no-image.txt

  **Commit**: NO (groups with Task 3, 5)

- [x] 5. 改造 `src/index.js` 流程（并行→串行化 + 集成图片搜索）

  **What to do**:
  - **核心变更区域**: `src/index.js` 第82-115行（Step 2+3 并行搜索区）+ 第230-261行（富化区 fallback 标题处）
  
  **变更1 — 流程从并行改为串行**（第87-112行区域）:
  ```javascript
  // Before: Promise.all([1688搜索, 淘宝文字搜索])
  // After: 
  // Step 2: 1688 搜索先独立完成
  let products = [];
  try {
    products = await require('./search-1688').searchAll(coreWord, blueOceanWord, modifiers);
  } catch (err) { /* 保持现有降级不变 */ }
  
  // Step 3: 以图搜图获取同行标题（串行，依赖 products）
  let imageSearchResults = [];
  let taobaoTitles = [];
  
  if (products.length > 0 && !(peerTitles && peerTitles.length > 0)) {
    const { searchPeerTitlesByImage, isImageSearchAvailable } = require('./search-taobao-image');
    if (isImageSearchAvailable()) {
      try {
        imageSearchResults = await searchPeerTitlesByImage(products);
        taobaoTitles = imageSearchResults
          .filter(r => r.hasMatch && Array.isArray(r.peerTitles))
          .flatMap(r => r.peerTitles);
      } catch (err) {
        console.warn('⚠️ 以图搜图失败，降级到文字搜索:', err.message);
        taobaoTitles = await require('./search-taobao').searchTaobaoTitles(blueOceanWord);
      }
    } else {
      taobaoTitles = await require('./search-taobao').searchTaobaoTitles(blueOceanWord);
    }
  } else if (peerTitles && peerTitles.length > 0) {
    taobaoTitles = peerTitles;
  }
  ```

  **变更2 — per-product fallback 标题优化**（第238-243行区域）:
  ```javascript
  // Before: constructFallbackTitle(blueOceanWord, p.title, taobaoTitles, maxLength)
  // After: 优先使用该商品自己的图片搜索同款标题
  const imageResult = (imageSearchResults || []).find(r =>
    r.productId === normalizedId || r.productId === String(productId)
  );
  const fallbackPeerTitles = (imageResult && imageResult.hasMatch && imageResult.peerTitles)
    ? imageResult.peerTitles
    : (taobaoTitles || []);
  shopTitle = constructFallbackTitle(blueOceanWord, p.title || '', fallbackPeerTitles, maxLength);
  ```

  **变更3 — stats 扩展**（第130-135行区域）:
  ```javascript
  stats.imageSearchTotal = imageSearchResults.length;
  stats.imageSearchMatched = (imageSearchResults || []).filter(r => r.hasMatch).length;
  stats.taobaoSource = imageSearchResults.length > 0 ? 'image_search' : (taobaoTitles.length > 0 ? 'text_search' : 'none');
  ```

  **变更4 — 降级路径同步更新**（第276-337行的两个降级分支）:
  - 确保 `taobaoTitles` 变量在降级路径中也可用（当前降级路径可能重新声明了 taobaoNames，需检查一致性）

  **Must NOT do**:
  - ❌ 不改 GLM selectAndGenerate prompt 或参数
  - ❌ 不改 1688 搜索/去重逻辑
  - ❌ 不改变输出 products 字段结构（11字段保持）
  - ❌ 不移除 --peer-titles 支持
  - ❌ 不删除 search-taoba.js 引用（仍为降级备选）

  **Recommended Agent Profile**:
  - **Category**: `deep` — 核心流程改造，架构变更+多模块协调
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO | **Blocked By**: Task 2, 3, 4
  - **Blocks**: Task 6, 7, F1-F4

  **References**:
  - `src/index.js:61-338` — **完整文件**（唯一要修改的核心文件）
  - `src/index.js:87-112` — **重点**: Promise.all → 串行化
  - `src/index.js:103-111` — --peer-titles 判断（保持不变）
  - `src/index.js:230-261` — 富化区和 fallback 标题（需接入 imageSearchResults）
  - `src/search-taobao-image.js` — 新模块导出的 API 签名

  **Acceptance Criteria**:

  - [ ] `node bin/cli.js "纯银项链女高级感"` 完整跑通（exit code 0）
  - [ ] 日志出现 "以图搜图" / "图片搜索" 输出
  - [ ] 输出 products 包含完整11字段
  - [ ] `--peer-titles "标题1,标题2"` 仍有效且跳过图片搜索
  - [ ] stats 含 `imageSearchTotal`, `imageSearchMatched`, `taobaoSource`
  - [ ] taobao-native 不可用时自动降级到文字搜索

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 完整流程端到端（正常路径）
    Tool: Bash
    Preconditions: .env 配置完整；淘宝桌面版可运行
    Steps:
      1. node bin/cli.js "纯银项链女高级感" 2>&1 | tee .sisyphus/evidence/task5-e2e-normal.txt
      2. 检查日志序列: 提取核心词 → 1688搜索 → 以图搜图 → GLM生成 → 完成
      3. 检查铺货标题不为空
    Expected Result: 流程完整；有图片搜索日志；标题合理
    Evidence: .sisyphus/evidence/task5-e2e-normal.txt

  Scenario: --peer-titles 绕过图片搜索
    Tool: Bash
    Steps:
      1. node bin/cli.js "纯银项链女高级感" --peer-titles "手动标题" 2>&1 | tee .sisyphus/evidence/task5-peer-bypass.txt
      2. grep -c "图片搜索" .sisyphus/evidence/task5-peer-bypass.txt
    Expected Result: grep 结果为 0（无图片搜索日志）
    Evidence: .sisyphus/evidence/task5-peer-bypass.txt

  Scenario: taobao不可用时降级到文字搜索
    Tool: Bash
    Steps:
      1. 备份并移除 taobao-native.cmd
      2. node bin/cli.js "纯棉T恤男宽松" --count 1 2>&1 | tee .sisyphus/evidence/task5-fallback.txt
      3. grep "降级到文字搜索" .sisyphus/evidence/task5-fallback.txt
      4. 恢复 taobao-native.cmd
    Expected Result: grep 匹配到降级日志；流程不中断
    Evidence: .sisyphus/evidence/task5-fallback.txt

  Scenario: 输出schema兼容性
    Tool: Bash
    Steps:
      1. node bin/cli.js "纯银项链女高级感" --count 1 2>&1
      2. 检查输出的每个 product 字段完整性
    Expected Result: 11字段齐全
    Evidence: .sisyphus/evidence/task5-schema-check.txt
  ```

  **Evidence to Capture**:
  - [ ] task5-e2e-normal.txt
  - [ ] task5-peer-bypass.txt
  - [ ] task5-fallback.txt
  - [ ] task5-schema-check.txt

  **Commit**: YES (groups with Task 3, 4)
  - Message: `feat: 集成以图搜图到主流程，替代文字搜索获取同行标题`
  - Files: `src/index.js`
  - Pre-commit: `node bin/cli.js "纯棉T恤男宽松" --count 1`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE.

- [x] 6. 降级路径全覆盖测试

  **What to do**:
  - 系统性验证所有降级路径（failure mode testing）：
  1. **taobao-native 未安装**: `isImageSearchAvailable()` 返回 false → 走文字搜索
  2. **taobao-native 已安装但启动失败**: `launchTaobaoDesktop()` 抛异常 → catch 后走文字搜索
  3. **图片搜索全部无匹配**: 所有商品 image_search 返回 hasMatch:false → 全部用 constructFallbackTitle
  4. **混合情况**: 部分商品有同款 + 部分没有 → 各自走对应路径
  5. **1688 搜索结果为空**: products 为空 → 跳过图片搜索，直接返回空结果
  6. **1688 图片 URL 全部无效**: 所有 p.url 为空/非http → 全部跳过，日志显示"N个商品无图片URL"
  7. **execSync 超时**: 单个 image_search 超过30s → 返回 hasMatch:false，继续下一个
  8. **--peer-titles 手动提供**: 完全跳过图片搜索和文字搜索

  对每个路径：运行对应条件 → 检查不崩溃 → 检查输出合理 → 记录到 evidence

  **Must NOT do**:
  - ❌ 不修改任何业务逻辑代码（纯测试验证任务）
  - ❌ 不跳过任何一个降级路径

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — 多路径测试覆盖
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 3 (with Task 7)
  - **Blocks**: F1-F4 | **Blocked By**: Task 5

  **References**:
  - `src/index.js:103-112` --peer-titles 判断逻辑
  - `src/index.js:137-148` 空产品提前返回逻辑
  - `src/search-taobao-image.js` 所有错误处理分支
  - `src/index.js:276-337` 两个降级路径

  **Acceptance Criteria**:

  - [ ] 8个降级路径全部执行过且不崩溃
  - [ ] 每个路径有对应的 evidence 文件记录
  - [ ] 无未捕获异常导致进程非零退出

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 8种降级路径矩阵测试
    Tool: Bash
    Steps:
      对每个路径编写最小复现脚本并执行，记录 stdout+stderr+exit code
      路径1: 移除taobao-native.cmd → 运行CLI → 检查有"降级到文字搜索"
      路径2: 保留cmd但kill桌面版进程 → 运行 → 检查不崩溃
      路径3: 用一个不可能有同款的图(如纯色方块URL) → 检查全部hasMatch:false
      路径4: 混合有效/无效URL的产品列表 → 检查部分有标题部分fallback
      路径5: 用一个1688无结果的词(如随机字符串) → 检查products为空且跳过图片搜索
      路径6: mock空url的products → 检查"无图片URL"日志
      路径7: 设置timeout=1ms强制超时 → 检查返回默认值
      路径8: --peer-titles "test" → 检查无图片搜索日志
    Expected Result: 8/8 路径不崩溃，exit code 0，输出符合预期
    Failure Indicators: 任一路径崩溃(exit code ≠ 0)或输出不符合预期
    Evidence: .sisyphus/evidence/task6-fallback-matrix/
  ```

  **Evidence to Capture**:
  - [ ] task6-fallback-matrix/ (目录，含每个路径的结果文件)

  **Commit**: NO (groups with Task 7)

- [x] 7. CLI/MCP 接口兼容性验证

  **What to do**:
  - 验证所有入口点在改造后仍然正常工作：
  1. **CLI 默认模式**: `node bin/cli.js "关键词"` — 图片搜索自动启用
  2. **CLI --length 参数**: `node bin/cli.js "关键词" --length 30` — maxLength 正确传递
  3. **CLI --count 参数**: `node bin/cli.js "关键词" --count 2` — limit 正确截断产品数
  4. **CLI --peer-titles**: `node bin/cli.js "关键词" --peer-titles "t1,t2"` — 绕过图片搜索
  5. **MCP server**: 检查 `bin/mcp-server.mjs` 中 `generate_title` 工具调用是否兼容（它内部调用 `run()`）
  6. **缓存命中**: 连续运行两次相同参数 → 第二次应命中缓存（cache key 未变则行为不变）
  7. **silent 模式**: 确认 silent=true 时图片搜索日志被正确抑制

  **Must NOT do**:
  - ❌ 不修改 MCP server 或 CLI 入口代码（除非发现真正的兼容性问题）

  **Recommended Agent Profile**:
  - **Category**: `quick` — 接口兼容性检查
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 3 (with Task 6)
  - **Blocks**: F1-F4 | **Blocked By**: Task 5

  **References**:
  - `bin/cli.js` — CLI 入口， commander 命令定义
  - `bin/mcp-server.mjs` — MCP server 入口
  - `src/index.js:61-62` — run() 函数签名和 options 参数

  **Acceptance Criteria**:

  - [ ] 7个入口点/模式全部验证通过
  - [ ] MCP server 的 generate_title 工具仍能正常返回结果
  - [ ] 缓存机制未被破坏

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 全接口兼容性矩阵
    Tool: Bash
    Steps:
      1. node bin/cli.js "纯银项链女高级感" → 检查正常完成
      2. node bin/cli.js "纯银项链女高级感" --length 30 → 检查标题长度≤30字符
      3. node bin/cli.js "纯银项链女高级感" --count 1 → 检查只返回1个产品
      4. node bin/cli.js "纯银项链女高级感" --peer-titles "手动标题" → 检查使用手动标题
      5. # MCP server 验证（如果有测试方式的话）
      6. node bin/cli.js "纯银项链女高级感" → 运行两次 → 第二次应有"命中缓存"日志
      7. node bin/cli.js "纯银项链女高级感" --silent → 检查无控制台输出但仍有返回值
    Expected Result: 7/7 通过
    Failure Indicators: 任一模式报错或行为异常
    Evidence: .sisyphus/evidence/task7-compat-matrix/
  ```

  **Evidence to Capture**:
  - [ ] task7-compat-matrix/

  **Commit**: NO (独立验证任务)

---


### Interview Summary
**Key Discussions**:
- 当前流程: 用户输入 → GLM提取核心词 → **并行**(1688搜索 + 淘宝文字搜索) → GLM生成标题
- 问题本质: 1688找到商品A(简约锁骨链)，淘宝文字搜"纯银项链女高级感"返回B(韩版流苏)的标题 → 风格错位
- 新方案: 1688商品主图 → taobao `image_search` → 视觉同款标题 → GLM参考真同款生成
- 搜索范围: **全部**1688商品都做图片搜索，但控制频率防限流
- 文字搜索: 先替代，效果不够好时再加回作为补充
- 失败降级: 图片搜索无结果时标记"无同款"，使用构造回退标题
- 测试策略: Agent-Executed QA（项目无测试框架）

**Research Findings**:
- 1688 API 返回 `item.image` 字段 → 映射为 `p.url` → 最终输出 `'主图链接'`（已确认数据链路畅通）
- taobao-native `image_search` 支持 CDN URL 输入（SKILL.md 明确说明）
- 当前 `search-taobao.js` 只提取 `title` 字段，价格/销量/图片等全部丢弃
- 项目使用 CommonJS、camelCase 函数、PascalCase 类、中文内联注释
- 无测试框架，package.json test 为占位符

### Metis Review
**Identified Gaps** (addressed):
- **架构变更**: 并行→串行 flow，需重新设计 index.js 流程编排 → 已纳入计划
- **image_search 返回格式未知** → Task 1 专门做探查测试
- **v1 保持扁平 peerTitles**: 不改 GLM prompt 结构，合并所有图片搜索结果为 flat array → 已确定范围边界
- **限流策略**: 最大2并发，3-5秒间隔 → 已纳入 Task 2 设计
- **缓存失效风险**: image search 改变了输出内容 → Task 5 更新 cache key
- **1688 CDN URL 可能被淘宝拒绝** → Task 2 包含 base64 降级方案

---

## Work Objectives

### Core Objective
将标题生成流程中的淘宝同行标题来源，从「蓝海词文字搜索」升级为「1688商品主图以图搜图」，使GLM学习的同行标题与实际1688商品视觉风格一致。

### Concrete Deliverables
- `src/search-taobao-image.js` — 以图搜图模块（核心新代码）
- `src/index.js` 修改 — 流程从并行改为串行，集成图片搜索
- `.sisyphus/evidence/` — 各任务QA验证证据文件

### Definition of Done
- [ ] `node bin/cli.js "纯银项链女高级感"` 能完成全流程，图片搜索被调用且返回同款标题
- [ ] 输出 schema 完全兼容现有11字段结构
- [ ] 图片搜索失败时自动降级为回退标题，不中断流程
- [ ] 限流生效：日志可看到调用间隔 ≥3秒
- [ ] `--peer-titles` 手动参数仍然有效，跳过图片搜索

### Must Have
- 对每个有图片URL的1688商品调用 `taobao-native image_search`
- 并发控制：最多2个同时进行，批次间间隔3-5秒
- 解析 image_search 返回结果，提取 title / price / 销量 等字段
- 无匹配时标记 "无同款"，使用 constructFallbackTitle 兜底
- p.url 为空时跳过该商品（不做图片搜索）
- 使用 `-o <file>` 标志输出大结果到临时文件再读取
- 所有 taobao-native 调用传入 `sourceApp: "my-title"`

### Must NOT Have (Guardrails)
- ❌ 不修改 `glm-client.js` 的任何 prompt（保持扁平 peerTitles 结构）
- ❌ 不修改 `search-taobao.js` 的已有逻辑（保留作为降级备选）
- ❌ 不改变 MCP server 接口签名
- ❌ 不添加单元测试框架
- ❌ 不实现 per-product peerTitles 传入 GLM（留 v2）
- ❌ 不修改 1688 搜索和过滤逻辑
- ❌ 不对 image_search 结果做缓存（避免复杂度）

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: None
- **Framework**: N/A
- **Primary Verification**: Agent-Executed QA Scenarios (CLI execution + output inspection)

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **CLI/TUI**: Use Bash (`node bin/cli.js`) - Run command, inspect stdout/stderr, check exit code
- **Module-level**: Use Bash (`node -e "..."`) - Import module, call functions, compare output
- **API/Backend**: Use Bash (curl) - Not applicable (this is a CLI tool)

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - 探查+基础设施):
├── Task 1: image_search 返回格式探查 [quick]
└── Task 2: search-taobao-image.js 基础骨架 [quick]

Wave 2 (After Wave 1 - 核心实现, MAX PARALLEL):
├── Task 3: image_search 调用与结果解析 [deep]
├── Task 4: 限流与并发控制 [unspecified-high]
└── Task 5: index.js 流程改造（串行化） [deep]

Wave 3 (After Wave 2 - 集成+验证):
├── Task 6: 降级路径全覆盖测试 [unspecified-high]
└── Task 7: --peer-titles 兼容性验证 [quick]

Wave FINAL (After ALL tasks — 4 parallel reviews):
├── Task F1: Plan Compliance Audit (oracle)
├── Task F2: Code Quality Review (unspecified-high)
├── Task F3: End-to-End Manual QA (unspecified-high)
└── Task F4: Scope Fidelity Check (deep)

Critical Path: Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → F1-F4
Parallel Speedup: ~40% faster than sequential (Wave 2 has 3 parallel tasks)
Max Concurrent: 3 (Waves 1 & 2)
```

### Dependency Matrix

- **1**: - - 2, 1
- **2**: 1 - 3, 4, 5, 1
- **3**: 2 - 5, 6, 2
- **4**: 2 - 5, 6, 2
- **5**: 2, 3, 4 - 6, 7, 3
- **6**: 5 - 7, F1-F4, 4
- **7**: 5 - F1-F4, 3
- **F1-F4**: 6, 7 - -, 5

### Agent Dispatch Summary

- **1**: **2** - T1 → `quick`, T2 → `quick`
- **2**: **3** - T3 → `deep`, T4 → `unspecified-high`, T5 → `deep`
- **3**: **2** - T6 → `unspecified-high`, T7 → `quick`
- **FINAL**: **4** - F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. 探查 `image_search` 返回格式

  **What to do**:
  - 使用一个真实的 1688 商品图片 URL（可从现有缓存或运行一次 1688 搜索获取），调用 `taobao-native image_search` 命令
  - 调用格式: `taobao-native image_search --args '{"imagePath":"<1688-cdn-url>","sourceApp":"my-title"}' -o /mnt/d/project/my-title/.sisyphus/evidence/task1-image-search-test.json`
  - 等待命令完成（可能需要 5-10 秒加载淘宝页面）
  - 读取输出文件，完整记录返回的 JSON 结构：顶层字段、products 数组结构、每个 product 的字段（title/price/sales/imageUrl 等）
  - 特别关注：
    - 是否有分类小卡（SKILL.md 提到"自动点击页面上的图片分类小卡获取每个分类的商品列表"）
    - 价格字段名和格式（是字符串还是数字）
    - 销量字段名和格式
    - 是否有图片 URL 字段（用于后续可能的二次搜索）
    - 结果数量范围（通常返回多少条）
  - 将探查结果写入 `.sisyphus/evidence/task1-image-search-format.md`，包含：
    - 完整 JSON 结构示例（脱敏处理，保留字段名和类型）
    - 字段说明表（字段名、类型、含义、是否为空的可能情况）
    - 对 Task 3 解析代码的具体建议（哪些字段必取、哪些可选、如何判空）

  **Must NOT do**:
  - 不要假设返回格式与 `search_products` 相同（必须实际验证）
  - 不要跳过 `-o` 输出到文件的步骤（stdout 可能被截断）
  - 不要使用假 URL 测试（必须用真实 1688 CDN URL）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单次 CLI 探查任务，执行简单但结果关键
  - **Skills**: []
    - 无需特殊 skill
  - **Skills Evaluated but Omitted**:
    - `defuddle`: 不涉及网页内容提取
    - `obsidian-cli`: 不涉及 Obsidian 操作

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (Wave 1 first task)
  - **Blocks**: Task 2, Task 3, Task 4, Task 5
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References** (existing code to follow):
  - `src/search-taobao.js:60-122` — 现有的 taobao-native 调用模式（execSync、路径转换、JSON 解析、错误处理）
  - `src/search-taobao.js:84-91` — CLI 命令构建模式（cmd.exe /c、--args JSON、sourceApp 参数）

  **API/Type References** (contracts to implement against):
  - `taobao-native/SKILL.md:208-209` — image_search 工具定义（imagePath 参数支持 CDN URL/base64/本地路径）

  **Test References** (testing patterns to follow):
  - N/A（无测试框架）

  **External References** (libraries and frameworks):
  - taobao-native CLI 文档: `taobao-native/SKILL.md` 全文（调用协议、错误处理、截断问题）

  **WHY Each Reference Matters**:
  - `search-taobao.js`: 新模块必须遵循完全相同的 CLI 调用模式和错误处理风格
  - SKILL.md image_search 定义: 明确参数格式和预期行为，避免调用错误

  **Acceptance Criteria**:

  - [ ] 探查结果文件存在: `.sisyphus/evidence/task1-image-search-format.md`
  - [ ] 文件包含完整的 JSON 结构示例（至少记录所有顶层字段和 products 数组内字段）
  - [ ] 文件包含字段说明表（≥5 个字段的名称+类型+含义）
  - [ ] 文件包含对解析代码的具体建议（至少说明 title/price/sales 三个核心字段的提取方式）

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 成功调用 image_search 并获取结果
    Tool: Bash
    Preconditions: 淘宝桌面版已安装且可运行；有一个真实1688商品图片URL
    Steps:
      1. 先运行一次 1688 搜索获取测试图片URL: `node -e "const c = require('./src/alibaba1688-client'); const client = new c(process.env.ALI_1688_AK); client.searchOffers('项链').then(r => { if(r && r[0]) console.log('IMAGE_URL:', r[0].url); else console.log('NO_RESULTS'); }).catch(e => console.error(e.message))"`
      2. 记录输出的 IMAGE_URL
      3. 执行 image_search: `cmd.exe /c "/mnt/c/Users/38336/AppData/Local/Programs/taobao/bin/taobao-native.cmd" image_search --args '{"imagePath":"<步骤1获取的URL>","sourceApp":"my-title"}' -o .sisyphus/evidence/task1-image-search-test.json`
      4. 读取结果文件: 检查文件大小 > 0 且为合法 JSON
    Expected Result: JSON 文件包含 result 或 data 级别的产品数组，每个产品有 title 字段
    Failure Indicators: 文件不存在、文件为空、JSON 解析失败、无 products 数组
    Evidence: .sisyphus/evidence/task1-image-search-test.json (原始返回数据)
    Evidence: .sisyphus/evidence/task1-image-search-format.md (分析报告)

  Scenario: image_search 处理无效URL的错误情况
    Tool: Bash
    Steps:
      1. 用一个明显无效的 URL 调用: `cmd.exe /c "..." image_search --args '{"imagePath":"https://invalid.example.com/fake.jpg","sourceApp":"my-title"}' -o .sisyphus/evidence/task1-invalid-url.json`
      2. 检查返回的 JSON 中是否有 error / success:false / message 等错误指示字段
    Expected Result: 返回包含错误信息的 JSON（不是崩溃或空响应），可用于编写防御性解析代码
    Failure Indicators: 命令超时(>30s)无返回、进程挂起
    Evidence: .sisyphus/evidence/task1-invalid-url.json
  ```

  **Evidence to Capture**:
  - [ ] task1-image-search-test.json (原始返回)
  - [ ] task1-image-search-format.md (分析报告)
  - [ ] task1-invalid-url.json (错误情况返回)

  **Commit**: YES | NO (groups with Task 2)
  - Message: `chore: 探查 image_search 返回格式并记录`
  - Files: `.sisyphus/evidence/task1-image-search-format.md`, `.sisyphus/evidence/task1-image-search-test.json`
  - Pre-commit: 无

- [x] 2. 创建 `src/search-taobao-image.js` 基础骨架

  **What to do**:
  - 创建新文件 `src/search-taobao-image.js`，作为以图搜图的核心模块
  - 参照 `src/search-taobao.js` 的代码风格和模式，实现以下骨架结构：

  ```javascript
  // src/search-taobao-image.js 骨架
  const { execSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  // Windows 路径（WSL2 环境）— 与 search-taobao.js 保持完全一致
  const TAOBAO_NATIVE_PATH = '/mnt/c/Users/38336/AppData/Local/Programs/taobao/bin/taobao-native.cmd';

  // 从 search-taobao.js 复用的工具函数（或抽取为共享模块）:
  // - isTaobaoNativeInstalled()
  // - toWindowsPath()
  // - launchTaobaoDesktop()

  /**
   * 主入口：对一批1688商品逐一执行以图搜图
   * @param {Array<{id:string, url:string, title:string}>} products - 1688商品列表
   * @param {object} options - 配置选项
   * @returns {Promise<Array<{productId:string, peerTitles:string[], priceRange:{min:number,max:number}, hasMatch:boolean}>>}
   */
  async function searchPeerTitlesByImage(products, options = {}) {}

  /**
   * 对单个商品执行一次 image_search 调用
   * @param {string} imageUrl - 1688商品主图CDN URL
   * @param {string} productId - 商品ID（用于关联结果）
   * @param {object} options - 配置
   * @returns {{peerTitles:string[], priceRange:{min:number,max:number}, hasMatch:boolean}}
   */
  function imageSearchSingle(imageUrl, productId, options = {}) {}

  /**
   * 并发控制器：限制同时进行的 image_search 数量
   * @param {Array} items - 待处理项
   * @param {Function} handler - 每项的处理函数
   * @param {number} concurrency - 最大并发数
   * @param {number} intervalMs - 批次间隔毫秒数
   * @returns {Promise<Array>}
   */
  async function withRateLimit(items, handler, concurrency, intervalMs) {}
  ```

  - 实现 `isTaobaoNativeInstalled()` 和 `toWindowsPath()` 函数（从 search-taobao.js 复制，保持一致）
  - 实现 `launchTaobaoDesktop()` 但优化：只在首次调用时启动，后续调用检测已运行则跳过
  - 导出 `{ searchPeerTitlesByImage, isImageSearchAvailable }`

  **Must NOT do**:
  - ❌ 不实现具体的 image_search 调用逻辑（留给 Task 3）
  - ❌ 不实现结果解析逻辑（需要 Task 1 的探查结果）
  - ❌ 不修改 `search-taobao.js` 的任何代码
  - ❌ 不添加任何 GLM 相关逻辑

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 骨架搭建，主要是函数签名和工具函数复制，无复杂业务逻辑
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - 所有 skills 与此任务无关

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (with Task 1, but depends on Task 1 for format info... actually skeleton can be written independently)
  - **Blocks**: Task 3, Task 4, Task 5
  - **Blocked By**: None (骨架不依赖 Task 1 的具体格式信息)

  **References**:

  **Pattern References**:
  - `src/search-taobao.js:1-124` — 完整参考模板：模块结构、导入、常量定义、函数导出模式
  - `src/search-taobao.js:12-20` — `isTaobaoNativeInstalled()` 实现
  - `src/search-taobao.js:27-29` — `toWindowsPath()` 实现
  - `src/search-taobao.js:35-49` — `launchTaobaoDesktop()` 实现
  - `src/search-taobao.js:60-122` — `searchTaobaoTitles()` 的整体结构（参数→检查→调用→解析→返回）

  **Acceptance Criteria**:

  - [ ] 文件 `src/search-taobao-image.js` 存在且非空
  - [ ] 导出 `searchPeerTitlesByImage` 和 `isImageSearchAvailable` 两个函数
  - [ ] `isTaobaoNativeInstalled()` 正确检测 CLI 是否可用
  - [ ] `toWindowsPath()` 正确转换 WSL2 路径到 Windows 路径
  - [ ] `node -e "const m = require('./src/search-taobao-image'); console.log(Object.keys(m))"` 输出包含 `searchPeerTitlesByImage` 和 `isImageSearchAvailable`
  - [ ] JSDoc 注释覆盖所有导出函数

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 模块可正常 require 且导出正确
    Tool: Bash
    Steps:
      1. 运行: `node -e "const m = require('./src/search-taobao-image'); console.log('exports:', Object.keys(m)); console.log('types:', typeof m.searchPeerTitlesByImage, typeof m.isImageSearchAvailable)"`
    Expected Result: 输出 exports: ['searchPeerTitlesByImage', 'isImageSearchAvailable'] 和 types: function function
    Failure Indicators: ModuleNotFoundError、exports 为空或不包含预期函数、type 不是 function
    Evidence: .sisyphus/evidence/task2-module-load.txt

  Scenario: isTaobaoNativeInstalled 在当前环境中的检测结果
    Tool: Bash
    Steps:
      1. 运行: `node -e "const m = require('./src/search-taobao-image'); console.log('installed:', m.isImageSearchAvailable())"`
    Expected Result: 输出 true（环境中有 taobao-native）或 false（没有），不会抛异常
    Failure Indicators: 抛出未捕获异常（如 ENOENT 未被 try/catch）
    Evidence: .sisyphus/evidence/task2-install-check.txt

  Scenario: toWindowsPath 路径转换正确性
    Tool: Bash
    Steps:
      1. 运行: `node -e "const m = require('./src/search-taobao-image'); console.log(m.toWindowsPath ? 'has toWindowsPath' : 'missing')"` （如果导出了的话）
      2. 或者直接检查源码中函数实现是否存在
    Expected Result: 函数存在且能将 /mnt/c/xxx 转换为 C:\\xxx 格式
    Failure Indicators: 函数缺失或转换结果不符合预期
    Evidence: .sisyphus/evidence/task2-path-convert.txt
  ```

  **Evidence to Capture**:
  - [ ] task2-module-load.txt
  - [ ] task2-install-check.txt
  - [ ] task2-path-convert.txt

  **Commit**: YES (groups with Task 1)
  - Message: `feat: 添加 search-taobao-image.js 以图搜图模块骨架`
  - Files: `src/search-taobao-image.js`
  - Pre-commit: `node -e "require('./src/search-taobao-image')"`


- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Check all changed files for: syntax errors, `console.log` left in prod, empty catches, unused imports, inconsistent naming with project conventions (CommonJS/camelCase/Chinese comments).
  Output: `Files [N clean/N issues] | VERDICT`

- [ ] F3. **End-to-End Manual QA** — `unspecified-high`
  Run `node bin/cli.js "纯银项链女高级感"` from clean state. Verify:
  - Image search is called for each product with valid URL
  - Rate limiting logs show proper intervals
  - Output contains all 11 fields per product
  - Fallback titles used for products without image matches
  - --peer-titles bypasses image search
  Total time under 3 minutes for default query.
  Save all evidence to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task 1-7: read "What to do", read actual diff (git log/diff). Verify 1:1 compliance.
  Check "Must NOT do" compliance across all files.
  Detect cross-task contamination: Task N touching Task M's files.
  Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **1+2**: `chore: 探查 image_search 返回格式 + 添加以图搜图模块骨架` — evidence files, src/search-taobao-image.js
- **3+4+5**: `feat: 实现以图搜图核心逻辑并集成到主流程` — src/search-taobao-image.js, src/index.js
- **6+7**: (no commit, verification only)

---

## Success Criteria

### Verification Commands
```bash
# 正常流程（应触发图片搜索）
node bin/cli.js "纯银项链女高级感" 2>&1 | head -50
# Expected: 日志含 "以图搜图"/"图片搜索"，exit code 0，输出含铺货标题

# 手动标题绕过（不应触发图片搜索）
node bin/cli.js "纯银项链女高级感" --peer-titles "手动测试标题" 2>&1 | grep -c "图片搜索"
# Expected: 输出 0（无图片搜索日志）

# 模块加载验证
node -e "const m = require('./src/search-taobao-image'); console.log(Object.keys(m))"
# Expected: ['searchPeerTitlesByImage', 'isImageSearchAvailable']
```

### Final Checklist
- [ ] `src/search-taobao-image.js` 存在且导出正确
- [ ] `src/index.js` 流程改为串行（1688→图片搜索→GLM）
- [ ] 图片搜索限流生效（concurrency≤2, interval≥3s）
- [ ] 所有降级路径不崩溃
- [ ] --peer-titles 仍然有效
- [ ] 输出 schema 兼容（11字段完整）
- [ ] taobao-native 不可用时降级到文字搜索
- [ ] 无图片URL的商品被跳过而非报错
