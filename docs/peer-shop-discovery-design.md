# 淘宝同行发现流水线（以货找店）— 详细设计

## 1. 概述

### 1.0 新增图搜选货分支（2026-10-15）

本节是 #58–#62 与本计划的范围对齐补充，不替换原有同行发现分支。后文文字搜索及默认0.7规则仅用于原分支；新分支按本节独立实施。

共享流程：导入淘宝商品（#58）→ 淘宝图搜（#59）→ 候选店铺聚合（#60）→ 销量榜采集及达标商品过滤（#61）。

在启动配置中以单选项选择任务目标，同次运行只执行一个分支：
- 同行发现：沿用原有文字搜索、店铺级判定及同行报告。
- 图搜选货：达标商品 → 1688图搜验证（#62）→ 商品清单 → 铺货复核。不得因店铺未满足 confirmed 数量门槛而丢弃已验证合格商品。

#### 比例配置与判定

- 新分支使用独立参数 `imagePriceRatioThreshold`，默认1；CLI、MCP和节点配置使用同一字段，不复用原分支默认0.7。
- 界面显示“货源价格低于淘宝价格的比例”，百分比输入默认100%；内部存储规范化后的标准十进制倍率字符串（如100%对应'1'，80%对应'0.8'），最多支持6位小数，拒绝科学计数法与超精度数值，直接与定点比较契约对齐；空值填默认值'1'，非法输入在启动前报错拒绝，不静默钳制。
- 判定为 **1688可比单件价格 / 淘宝对应规格售价 < imagePriceRatioThreshold**。必须严格小于，等于阈值不通过；边界计算使用十进制定点或十进制库，不能先将价格比四舍五入后比较。
- 默认1时：淘宝29.9元、货源29.89元通过价格条件；货源29.9元或30元不通过。配置0.8时：淘宝100元、货源79.99元通过；80元不通过。
- 价格通过不等于可铺货：规格明确一致且价格口径可比才 confirmed；规格未知为 suspected；缺图、缺价格、批量价不可比为 inconclusive；明确不同规格或价格不满足为 rejected。只自动将 confirmed 放入待复核清单，其他结果保留原因供查看。

#### 执行与交接

- 图搜能力须先做真实样本探针，确认图片输入方式、结果字段、规格/单价证据及平台错误识别；不得在图搜失败时静默替换为文字搜索。
- 每个达标商品均记录图搜结果，不使用原分支“达到 minSourcing 后提前结束”的优化；同次运行可复用相同图片与搜索配置的原始结果，但每个源商品按自己的售价和规格独立判定。
- 每个源商品可有多个候选货源，保留全部证据；默认推荐一个 confirmed 货源，复核时可替换。下游按1688 offerId与规格去重，保留全部来源关系；同货源出现不同标题或类目时由用户选择，不自动重复铺货。
- 交接字段包括源店铺、淘宝商品ID/链接/主图/规格/售价、1688 offerId/链接/主图/规格/可比单价、价格比及阈值、四级结果与原因、证据时间。报告同时保留失败和无法判定记录。
- 进入既有铺货复核前补齐铺货标题及目标淘宝类目；类目沿用生意参谋推荐或人工确认结果，不直接将1688类目当成淘宝类目。缺少标题/类目可保存待复核，但必须提示补全且禁止自动提交。确认店铺、分配方式后才能铺货，不因图搜完成自动提交。
- 分支标识和比例参数持久化到运行配置；分支标识纳入相关缓存键，图片/搜索参数纳入搜索指纹，价格、规格及比例纳入判定依赖。仅调整比例时复用原始图搜结果、重新评估，并使旧待复核清单失效，防止提交旧选择。
- 普通单商品失败隔离记录；登录、验证码、限流暂停分支。复用现有节流、暂停/取消、断点恢复与结果查询机制。

#### 分支验收

覆盖默认1及自定义比例的严格边界、缺失/批量价格、规格冲突、无图、图搜无结果、平台阻塞、去重、取消恢复、比例修改后清单失效；验证原同行发现分支保持原行为。JSON/Excel与复核弹窗使用同一判定结果，显示本次比例及未通过原因。

补充集成验收：同店仅3件付款达标时图搜分支保留3件，原分支默认商品门槛仍不通过；前5件已确认后图搜仍验证剩余商品。标题失败后只重试标题，缺类目在弹窗保存后继续；旧草稿版本提交被拒绝，修改比例不重复提交成功商品。

### 1.1 目标
用户导入 3-4 条淘宝商品链接，系统自动通过「图搜找同款 → 聚合候选店铺 → 逐店采集销量榜 → 1688 货源验证」流程，输出满足判定条件的同行店铺清单。

### 1.2 与现有 competitor-analysis 的关系
现有 `competitor-analysis` 是「已知店铺 → 分析商品结构」，本流水线是「已知商品 → 发现店铺」。两者互补：本流水线的输出（同行店铺列表）可直接作为 competitor-analysis 的输入。

### 1.3 运行模式
新增 pipeline mode: `peer-discovery`，步骤数组:
```js
const PEER_DISCOVERY_STEPS = [
  'extractSources',      // N2: 源商品信息提取
  'findSimilarProducts', // N3: 淘宝图搜找同款
  'evaluateShops',       // N4-N6: 逐店采集+货源验证+闸门判定
  'peerReport'           // N7: 输出 JSON + Excel
];
const PEER_IMAGE_SELECTION_STEPS = [
  'extractSources', 'findSimilarProducts', 'collectPeerProducts',
  'verifyImageSources', 'prepareListingDrafts', 'reviewPeerListings', 'peerProductReport'
];
function getPeerSteps(params) {
  return params.discoveryBranch === 'image-selection'
    ? PEER_IMAGE_SELECTION_STEPS : PEER_DISCOVERY_STEPS;
}
```

`mode` 仍为 `peer-discovery`，新增 `discoveryBranch` 枚举 `peer-analysis`（默认，原流程）/ `image-selection`。新建运行时选择，启动后不可原地切换，切换需新建运行。Runner、画布、恢复时的步骤校验统一调用 `getPeerSteps`；禁止只改画布而不改执行步骤。discoveryBranch 持久化到 run.json 并在恢复时校验一致性；不纳入配置指纹（因为分支决定步骤数组而非判定参数，分支变更等价于新建运行）。

### 1.4 图搜分支节点与交接契约

| 节点 | 输入与输出 | 完成/阻塞条件 |
|---|---|---|
| collectPeerProducts | 调用共享 collectShopCandidates；保存 peer-products.jsonl，包含 shopKey、itemId、productUrl、imageUrl、title、规格证据、售价、付款下界及采集完整性 | 不应用 minProducts/minSourcing；即使仅1件付款达标也保留。主图缺失交给下一节点记录，不静默丢弃 |
| verifyImageSources | 对每件商品图搜，保存 image-sourcing-results.jsonl；原始搜索缓存独立保存 | 只使用 imagePriceRatioThreshold 严格小于判定；逐件记录，无店铺数量闸门和提前达标结束。平台异常暂停，恢复复用已完成商品 |
| prepareListingDrafts | confirmed 货源经显式适配器转换为既有标题生成输入；保存 peer-listing-drafts.jsonl | 标题按对应1688商品和匹配词生成；只重试失败商品。类目无可靠来源时保留空值，输出 needs_input，不伪造类目，不无限重试 |
| reviewPeerListings | 展示草稿和证据；补标题、确认目标淘宝类目、选择店铺及分配方式 | 复用铺货复核 UI 与提交服务，通过适配器接入，不直接把报告行作为提交数据。选中项缺标题/类目时禁用提交，并定位缺项 |
| peerProductReport | 读取当前有效草稿版本、用户选择及逐项铺货结果，输出JSON/Excel | 只有复核明确完成才到此节点；失败/待确认项由既有复核重试或人工处理，不把“已提交”当“已成功” |

**标题与类目补全路径**：
- 不新增必经的生意参谋查词步骤。有可追溯的生意参谋推荐类目则预填为待确认；无推荐时在复核弹窗提供目标淘宝类目选择，保存类目ID、名称、来源和确认时间。无类目目录连接时明确提示不可用，保留草稿，不以1688类目代替。
- 标题生成失败保留错误和“重试标题生成”操作；用户可编辑标题。人工确认类目、保存标题只更新当前商品草稿，不重跑图搜。
- reviewPeerListings 默认返回 manual_action_required，展示“补全并保存”“确认铺货”和既有人工完成入口。保存不等于铺货；只有用户明确提交才调用平台。只对选中项检查完整性，未选项可留在草稿中。
- 复核持久化 draftRevision、源结果版本、配置指纹及逐项提交记录。继续/重试先加载这些状态；旧版本弹窗提交由服务端拒绝，已确认成功的商品不得重复提交。比例修改后重新生成未提交项的草稿和选择，不删除已提交记录，不重新提交已成功项。
- 空 confirmed 清单仅在验证完成、证据未过期且没有提交中/待核对项时进入可解释的无结果终态；证据待刷新或已有未知提交时按§5保留恢复/核对入口，不进入空白铺货弹窗。

**实施拆分**：新增 shared-shop-collector.js（collectShopCandidates）、image-sourcing-matcher.js、listing-draft-preparer.js 和 peer-listing-adapter.js；原 shop-evaluator.js 调用共享采集后保留旧闸门。run-store 增加上述三个产物路径及草稿复核状态，节点注册/状态映射/动作接口分别覆盖新步骤。测试放统一 test/ 树。实现前先验证现有标题、类目和铺货服务的真实输入契约，适配器测试必须使用该契约的fixture，不能仅验证独立mock。

---

## 2. 模块架构

```
skills/peer-discovery/
├── index.js                    # 主编排入口（按 discoveryBranch 选择 step 函数）
├── src/
│   ├── source-extractor.js     # 共享: N2 源商品信息提取
│   ├── similar-finder.js       # 共享: N3 淘宝图搜找同款 + 店铺聚合
│   ├── shared-shop-collector.js # 共享: collectShopCandidates（纯采集，无闸门）
│   ├── shop-evaluator.js       # 原分支: N4-N6 单店评估（采集+文字货源+闸门）
│   ├── sourcing-matcher.js     # 原分支: 文字搜索货源判定器（相似度+价格比，<=）
│   ├── peer-report-writer.js   # 原分支: N7 同行店铺 Excel 报告
│   ├── image-sourcing-matcher.js  # 图搜分支: 1688图搜货源判定器（严格 <，十进制定点）
│   ├── listing-draft-preparer.js  # 图搜分支: confirmed 货源→铺货标题草稿
│   ├── peer-listing-adapter.js    # 图搜分支: 草稿→既有铺货复核服务适配器
│   └── peer-product-report-writer.js # 图搜分支: 商品清单 Excel 报告
├── SKILL.md
```

测试统一位于 `test/unit/skills/peer-discovery/`、`test/integration/` 与 `test/browser/`，不在skill下新建独立test目录。


### 2.1 依赖关系图

```
peer-discovery/index.js
  ├── [共享] source-extractor.js
  │     └── collector.js (resolveCompetitorShop, waitForTab)
  │     └── taobao-native-client.js
  ├── [共享] similar-finder.js
  │     └── search-taobao-image.js (imageSearchSingleRaw)
  │     └── collector.js (resolveCompetitorShop)
  ├── [共享] shared-shop-collector.js
  │     └── collector.js (collectSortedShopProducts)
  │
  ├── [原分支 peer-analysis] shop-evaluator.js
  │     └── shared-shop-collector.js (collectShopCandidates)
  │     └── sourcing-matcher.js          # 文字搜索，<= 判定
  │     │     └── analyzer.js (tokenizeTitle)
  │     │     └── search-web-1688.js (searchWeb1688)
  │     └── collector.js (enrichCompetitorProduct)
  │     └── peer-report-writer.js → exceljs
  │
  ├── [图搜分支 image-selection] image-sourcing-matcher.js  # 1688图搜，严格 < 判定
  │     └── image-search-provider.js（新增；S0选定图搜通道，不调用文字searchWeb1688替代）
  │     └── 十进制定点比较（decimal.js 或手动定点运算）
  ├── [图搜分支] listing-draft-preparer.js
  │     └── title-gen (标题生成服务)
  │     └── sycm-research (生意参谋类目推荐，可选)
  ├── [图搜分支] peer-listing-adapter.js
  │     └── 既有铺货复核服务 (distribution API)
  ├── [图搜分支] peer-product-report-writer.js → exceljs
  │
  └── [共享] input-parser.js (parseCompetitorInputs)
      └── run-store.js (appendJsonl, readJsonl)
```

---

## 3. 数据流与文件格式

### 3.1 运行目录结构

```
data/pipeline/runs/<runId>/
├── run.json                        # 运行状态与参数（含 discoveryBranch）
├── runtime-control.json            # 暂停/取消控制信号
├── peer-input.json                 # N1: 解析后的源链接
├── source-products.jsonl           # N2: 源商品信息
├── similar-products.jsonl          # N3: 同款商品（含完整字段）
├── candidate-shops.jsonl           # N3: 聚合后的候选店铺
│
├── [原分支 peer-analysis]
│   ├── shop-evaluations.jsonl      # N4-N6: 逐店判定结果
│   ├── shop-eval-state.json        # 断点续跑检查点
│   ├── sourcing-details.jsonl      # N5: 每个达标商品的货源验证详情
│   ├── peer-discovery-result.json  # N7: 最终 JSON
│   └── 同行发现报告.xlsx            # N7: Excel 报告
│
├── [图搜分支 image-selection]
│   ├── peer-snapshots/             # 不可变店铺快照（按 revision 编号）
│   ├── peer-snapshot-manifest.json # 当前快照指针（原子切换）
│   ├── peer-products.jsonl         # manifest 派生视图（非权威输入）
│   ├── image-sourcing-results.jsonl # 逐件图搜验证结果
│   ├── image-sourcing-cache.jsonl  # 原始图搜结果缓存（按图片摘要+搜索参数键）
│   ├── image-selection-state.json  # 图搜分支断点续跑检查点
│   ├── peer-review-bundles/        # 不可变复核 bundle（按 revision 编号）
│   ├── peer-review-current.json    # 当前复核 bundle 指针（原子切换）
│   ├── peer-listing-drafts.jsonl   # 草稿导出视图（动作读取 bundle）
│   ├── peer-allocation-plan.json   # 不可变分配计划（planId + 逐项明细）
│   ├── peer-submissions.jsonl      # 独立提交/核对账本（永久保留）
│   ├── peer-product-result.json    # 最终商品清单 JSON
│   └── 图搜选货报告.xlsx            # 最终 Excel 报告
```

### 3.2 核心数据结构

#### source-products.jsonl（N2 输出）
```json
{
  "inputUrl": "https://item.taobao.com/item.htm?id=xxx",
  "shopKey": "shop123",
  "shopName": "某某旗舰店",
  "title": "玛瑙手机挂绳女手腕绳...",
  "price": 15.80,
  "mainImageUrl": "https://img.alicdn.com/...",
  "itemId": "xxx",
  "extractedAt": "2026-10-14T10:00:00Z"
}
```

#### similar-products.jsonl（N3 输出）
```json
{
  "sourceInputUrl": "https://item.taobao.com/...",
  "sourceShopKey": "shop123",
  "productId": "src-0",
  "rank": 1,
  "title": "同款商品标题",
  "price": 12.50,
  "imageUrl": "https://...",
  "shopKey": "shop456",
  "shopName": "另一家店",
  "shopUrl": "https://shop456.taobao.com/",
  "itemId": "yyy",
  "productUrl": "https://item.taobao.com/item.htm?id=yyy"
}
```

#### candidate-shops.jsonl（N3 聚合输出）
```json
{
  "shopKey": "shop456",
  "shopName": "另一家店",
  "shopUrl": "https://shop456.taobao.com/",
  "sourceCount": 2,
  "similarProductCount": 5,
  "representativeProducts": ["yyy", "zzz"]
}
```

#### shop-evaluations.jsonl（N4-N6 输出）
```json
{
  "shopKey": "shop456",
  "shopName": "另一家店",
  "shopUrl": "https://shop456.taobao.com/",
  "verdict": "qualified",
  "reason": null,
  "totalCollected": 35,
  "paymentQualifiedCount": 20,
  "sourcingVerifiedCount": 20,
  "sourcingUnverifiedCount": 0,
  "sourcingConfirmedCount": 7,
  "sourcingSuspectedCount": 3,
  "sourcingInconclusiveCount": 5,
  "sourcingRejectedCount": 5,
  "collectionCompleteness": "uncertain",
  "judgeConfigHash": "j1a2b3c4",
  "collectConfigHash": "c5d6e7f8",
  "searchConfigHash": "s9a0b1c2",
  "products": [
    {
      "title": "达标商品标题",
      "productUrl": "https://item.taobao.com/item.htm?id=...",
      "paymentText": "500+人付款",
      "paymentLowerBound": 500,
      "taobaoPrice": 29.90,
      "sourcing": {
        "level": "confirmed",
        "reason": "matched",
        "aliUrl": "https://detail.1688.com/offer/xxx.html",
        "aliComparablePrice": 6.80,
        "aliRawMinPrice": 6.80,
        "aliMinOrderQty": 1,
        "aliTitle": "1688商品标题",
        "similarity": 0.62,
        "priceRatio": 0.23
      }
    }
  ],
  "evaluatedAt": "2026-10-14T10:05:00Z"
}
```

verdict 取值: `qualified` | `unqualified` | `inconclusive` | `blocked`

sourcing.level 取值: `confirmed` | `suspected` | `rejected` | `inconclusive`

---

## 4. 各节点详细设计

### 4.1 N1: 人工导入链接

**复用**: `input-parser.js` → `parseCompetitorInputs(input, { limit: 10 })`

**逻辑**:
1. 接收 CLI 参数或 API 传入的链接文本
2. 调用 `parseCompetitorInputs` 解析、去重、校验
3. 限制 1-10 条有效链接
4. 写入 `peer-input.json`

**错误处理**: 无效链接记录到 `invalid` 数组，不阻断流程。

### 4.2 N2: 源商品信息提取 (`source-extractor.js`)

**新增模块**: `skills/peer-discovery/src/source-extractor.js`

**导出函数**:
```js
/**
 * @param {object} options
 * @param {string} options.dataDir
 * @param {string} options.runId
 * @param {object} options.client - TaobaoNativeClient 实例
 * @param {Function} [options.onProgress]
 * @returns {Promise<{ products: object[], errors: object[] }>}
 */
async function extractSourceProducts(options)
```

**逻辑**:
1. 读取 `peer-input.json` 获取链接列表
2. 逐条调用 `resolveCompetitorShop(link, { client })` 进入商品页/店铺页
3. 在商品页上执行 JS 提取: 主图 URL、标题、售价、shopKey
4. 提取脚本（注入页面执行）:
```js
() => {
  const img = document.querySelector('#J_UlThumb img, .PicGallery--mainPic img, .mainPic img');
  const title = document.querySelector('#J_Title h3, .ItemHeader--mainTitle, h1[data-title]')?.textContent?.trim();
  const priceEl = document.querySelector('.tm-promo-price .tm-price, .Price--priceInt, [class*="priceInt"]');
  const price = parseFloat(priceEl?.textContent?.replace(/[^\d.]/g, '')) || null;
  const shopLink = document.querySelector('a[href*="shop"], .ShopHeader--shopName a, [class*="shopName"] a');
  const shopUrl = shopLink?.href || '';
  return { mainImageUrl: img?.src || img?.dataset?.src || '', title, price, shopUrl };
}
```
5. 从 shopUrl 解析 shopKey（复用 `page-parser.js` 的 `canonicalShopUrl`）
6. 写入 `source-products.jsonl`

**错误处理**:
- 单条提取失败 → 记录 error，跳过该链接，继续其他
- 主图为空 → 记录 `missing_main_image`，该链接无法参与图搜
- 全部失败 → 返回 `manual_action_required`

**限流**: 每条链接间隔 ≥ 2 秒。

### 4.3 N3: 淘宝图搜找同款 (`similar-finder.js`)

**新增模块**: `skills/peer-discovery/src/similar-finder.js`

**导出函数**:
```js
/**
 * @param {object} options
 * @param {string} options.dataDir
 * @param {string} options.runId
 * @param {number} [options.maxCandidateShops=30]
 * @param {Function} [options.onProgress]
 * @returns {Promise<{ candidates: object[], similarCount: number, errors: object[] }>}
 */
async function findSimilarProducts(options)
```

**逻辑**:
1. 读取 `source-products.jsonl`
2. 对每个有 mainImageUrl 的源商品，调用 `imageSearchSingle(mainImageUrl, productId, { timeout: 30000 })`
3. **关键扩展**: 当前 `parseImageSearchResult` 只返回 `peerTitles` 和 `priceRange`，不返回店铺信息。需要扩展解析逻辑，从图搜原始数据中提取每个同款商品的:
   - `title`, `price`, `imageUrl`
   - `shopKey`, `shopName`, `shopUrl`（从商品卡片的店铺链接解析）
   - `itemId`, `productUrl`
4. 按 `shopKey` 去重聚合: 同一店铺保留图搜排名最靠前的 1 个代表商品
5. 排除源店铺（`sourceShopKey`）
6. 截断到 `maxCandidateShops`（默认 30）
7. 写入 `similar-products.jsonl` 和 `candidate-shops.jsonl`

**图搜数据扩展方案**:

当前 `imageSearchSingle` 返回的 `parseImageSearchResult` 丢弃了店铺信息。有两种方案:

**方案 A（推荐）**: 在 `similar-finder.js` 中直接解析图搜原始 JSON，不复用 `parseImageSearchResult`。图搜 CLI 输出的 `data.result.categories[].products[]` 中每个 product 对象包含 `shopName`、`shopUrl` 等字段。新增一个本地解析函数 `parseSimilarProducts(data, sourceInfo)` 提取完整字段。

**方案 B**: 修改 `parseImageSearchResult` 增加店铺字段返回。但这会影响现有 `searchPeerTitlesByImage` 的调用方，风险较高。

选择方案 A，在 `similar-finder.js` 内部实现解析，不修改 `search-taobao-image.js`。

**但问题是**: `imageSearchSingle` 内部调用 `parseImageSearchResult` 后只返回 `peerTitles`，原始数据被丢弃。需要绕过这一层。

**实际方案**: 直接调用底层的 `imageSearchSingleNative` 或 `guardTaobaoImageSearch`，拿到原始 JSON 后自行解析。或者更简单——在 `similar-finder.js` 中复制 `imageSearchSingleNative` 的调用逻辑，但使用自己的解析函数。

考虑到代码复用和维护性，最佳方案是:
1. 在 `search-taobao-image.js` 中新增一个导出函数 `imageSearchSingleRaw(imageUrl, productId, options)` 返回原始 JSON 数据（不做 parseImageSearchResult 转换）
2. `similar-finder.js` 调用 `imageSearchSingleRaw` 获取原始数据，用自己的 `parseSimilarProducts` 解析

```js
// search-taobao-image.js 新增导出
async function imageSearchSingleRaw(imageUrl, productId, options = {}) {
  // 复用 imageSearchSingleNative 的执行逻辑，但返回原始 data 而非 parsed result
  const result = await executeImageSearch(imageUrl, productId, options);
  return { productId, rawData: result, hasMatch: Boolean(result) };
}
```

**限流**: 图搜复用现有的 `_acquireLock` 单例锁和 `withRateLimit` 并发控制。每张图间隔 ≥ 4 秒。

**断点续跑**: 已处理的源商品记录到 `similar-finder-state.json`，中断后跳过已完成项。

### 4.4 N4-N6: 逐店评估 (`shop-evaluator.js`)

**新增模块**: `skills/peer-discovery/src/shop-evaluator.js`

**导出函数**:
```js
/**
 * 评估单个候选店铺。
 * @param {object} shop - candidate-shops.jsonl 中的一行
 * @param {object} options
 * @param {object} options.client - TaobaoNativeClient
 * @param {number} [options.minProducts=10]
 * @param {number} [options.minSourcing=5]
 * @param {number} [options.minPayment=10]
 * @param {number} [options.similarityThreshold=0.45]
 * @param {number} [options.priceRatioThreshold=0.7]
 * @param {Function} [options.onProgress]
 * @returns {Promise<object>} shop-evaluation 对象
 */
async function evaluateShop(shop, options)

/**
 * 批量评估所有候选店铺（串行）。
 * @param {object} options
 * @returns {Promise<{ qualified: object[], skipped: object[], errors: object[] }>}
 */
async function evaluateAllShops(options)
```

#### N4: 进店采集销量榜

```js
async function collectShopSnapshot(shop, options) {
  const { client, collectLimit = 40 } = options;

  // 复用 collector.js，采集上限应大于 minProducts 以尽量覆盖全店
  let result;
  try {
    result = await collectSortedShopProducts(shop, 'hot', {
      client, limit: collectLimit
    });
  } catch (err) {
    if (isPlatformBlocker(err)) throw err; // 平台级故障向外抛出
    return {
      status: 'collection_incomplete', actual: 0,
      totalCollected: 0, collectionCompleteness: 'interrupted',
      collectionComplete: false, products: [], error: err.message
    };
  }

  // 判定采集完整性 — 必须由采集器返回明确的结束原因，不能仅靠数量推断
  // 现有 collectSortedShopProducts 最多滚动 3 次后停止，未必真的到末页
  // 因此：只有采集器明确报告 endReason='no_more_products' 时才标记 reached_end
  const endReason = result.endReason || 'unknown';
  const collectionCompleteness =
    endReason === 'no_more_products' ? 'reached_end'   // 采集器确认无更多商品
    : result.collectionError       ? 'interrupted'      // 采集中途出错
    :                                'uncertain';        // 达到滚动上限或数量上限，不确定是否完整

  // 原始快照不应用付款筛选，修改minPayment时只重算。
  return {
    status: 'collected', products: result.products, totalCollected: result.products.length,
    collectionCompleteness, collectionComplete: collectionCompleteness === 'reached_end'
  };
}

async function collectShopCandidates(shop, options) {
  const snapshot = options.snapshot || await collectShopSnapshot(shop, options);
  const minPayment = options.minPayment ?? 10;
  const products = snapshot.products.filter(p => {
    const parsed = parsePaymentSignal(p.paymentText);
    // hasSignal=false 表示无付款信息（区别于"确实0人付款"），不自动通过
    // hasSignal=true 且 value >= minPayment 才通过
    // minPayment=0 时，所有有付款信号的商品都通过（包括"不足10人付款"→value=0）
    return parsed.hasSignal && parsed.value >= minPayment;
  });
  return { ...snapshot, products };
}

// 原同行分支专用包装器；图搜分支只调用共享采集及筛选。
async function collectQualifiedProducts(shop, options) {
  const { client, minProducts = 10 } = options;
  const snapshot = await collectShopCandidates(shop, options);
  const qualified = snapshot.products;
  const { collectionCompleteness } = snapshot;

  if (qualified.length < minProducts) {
    // 只有 reached_end 才能确定"确实不够"；uncertain/interrupted 不能断定整店不足
    return {
      status: 'insufficient_products',
      actual: qualified.length,
      required: minProducts,
      totalCollected: snapshot.totalCollected,
      collectionCompleteness,
      collectionComplete: collectionCompleteness === 'reached_end',
      products: []
    };
  }

  // 对全部达标商品做货源验证（不只验证前 minProducts 个）
  // 原因：前 10 件可能恰好货源少，后面的可能有更多符合的，不能因抽样偏差否定整店
  // 先统一数据结构
  const normalizedQualified = qualified.map(p => ({
    ...p,
    taobaoPrice: p.taobaoPrice ?? p.price ?? null,
    title: p.detailTitle || p.title,
    paymentLowerBound: parsePaymentLowerBound(p.paymentText)
  }));

  // 逐个补全链接 + 货源验证，遇到平台故障立即抛出
  const productsWithSourcing = [];
  for (const product of normalizedQualified) {
    // 补全链接
    let enriched = product;
    try {
      enriched = await enrichCompetitorProduct(shop, product, { client });
      enriched.taobaoPrice = product.taobaoPrice;
      enriched.paymentLowerBound = product.paymentLowerBound;
    } catch (err) {
      if (isPlatformBlocker(err)) {
        err.platform = err.platform || 'taobao'; // enrichCompetitorProduct 操作淘宝
        err.platformStatus = err.status || err.code || 'unknown';
        err.actionHint = err.message || '淘宝客户端需要处理';
        throw err;
      }
      enriched = { ...product, enrichmentError: err.message };
    }

    // 货源验证
    let sourcing;
    try {
      sourcing = await matchSourcing(enriched, options);
    } catch (err) {
      if (isPlatformBlocker(err)) {
        // matchSourcing 内部已设置 err.platform='1688'，此处兜底
        err.platform = err.platform || '1688';
        throw err;
      }
      sourcing = { level: 'inconclusive', reason: 'sourcing_error', error: err.message };
    }

    productsWithSourcing.push({
      title: enriched.title,
      productUrl: enriched.productUrl,
      paymentText: product.paymentText,
      paymentLowerBound: product.paymentLowerBound,
      taobaoPrice: product.taobaoPrice,
      sourcing
    });
    await sleep(1500);

    // 提前终止优化：如果 confirmed 已达 minSourcing，无需继续验证剩余商品
    const confirmedSoFar = productsWithSourcing.filter(p => p.sourcing.level === 'confirmed').length;
    if (confirmedSoFar >= (options.minSourcing || 5)) break;
  }

  // 分项统计：区分采集数、达标数、已验证数、未验证数
  const verifiedCount = productsWithSourcing.length;
  const unverifiedCount = normalizedQualified.length - verifiedCount; // 提前终止时剩余未验证的

  return {
    status: 'collected',
    products: productsWithSourcing,  // 已包含 sourcing 结果（仅已验证部分）
    collectionCompleteness,
    preEvaluated: true,
    stats: {
      totalCollected: snapshot.totalCollected,       // 采集到的商品总数
      paymentQualified: normalizedQualified.length,  // 付款达标的商品数
      sourcingVerified: verifiedCount,               // 已完成货源验证的商品数
      sourcingUnverified: unverifiedCount             // 因提前终止未验证的商品数
    }
  };
}
```

**边界**：collectShopCandidates 是两个分支共享的纯采集入口；collectQualifiedProducts 仅用于原同行分支，包含店铺闸门和文字搜货。图搜分支不能调用该包装器，必须独立验证共享采集返回的全部商品。

**付款人数解析**（返回结构化结果，区分"有信号"和"无信号"）:
```js
/**
 * @param {string} paymentText - 原始付款文本
 * @returns {{ value: number, hasSignal: boolean }}
 *   hasSignal=true: 页面展示了付款信息，value 为解析出的下界（可能为 0）
 *   hasSignal=false: 页面无付款信息，value=0 但不应与"确实0人"混淆
 */
function parsePaymentSignal(paymentText) {
  const text = String(paymentText || '').trim();
  if (!text) return { value: 0, hasSignal: false };

  // 1. 先处理"不足"/"少于"等明确表示未达标的描述（有信号，值为 0）
  if (/不足|少于|未满/.test(text)) return { value: 0, hasSignal: true };

  // 2. 处理区间格式 "100-200人付款" → 取下界 100
  const rangeMatch = text.match(/(\d+(?:\.\d+)?)\s*[-~]\s*(\d+(?:\.\d+)?)\s*万?\s*人付款/);
  if (rangeMatch) return { value: parsePaymentNumber(rangeMatch[1], text), hasSignal: true };

  // 3. 处理单值格式 "500+人付款" / "1.5万人付款" / "10人付款"
  const singleMatch = text.match(/(\d+(?:\.\d+)?)\s*(万)?\s*\+?\s*人付款/);
  if (singleMatch) return { value: parsePaymentNumber(singleMatch[1], text, singleMatch[2] === '万'), hasSignal: true };

  // 4. 无付款信号
  return { value: 0, hasSignal: false };
}

// 兼容旧调用方：只返回数值（用于 applyShopVerdict 等不需要区分信号的场景）
function parsePaymentLowerBound(paymentText) {
  return parsePaymentSignal(paymentText).value;
}

function parsePaymentNumber(numStr, fullText, isWan = false) {
  let value = parseFloat(numStr);
  if (isNaN(value)) return 0;
  if (isWan || /万/.test(fullText.replace(numStr, ''))) value *= 10000;
  return Math.floor(value);
}
```

**解析示例**:
| 输入 | value | hasSignal | 说明 |
|------|-------|-----------|------|
| `"500+人付款"` | 500 | true | 标准格式 |
| `"10+人付款"` | 10 | true | 恰好达标 |
| `"不足10人付款"` | 0 | true | 有信号但值为 0，minPayment=0 时通过 |
| `"1.5万人付款"` | 15000 | true | 万单位 |
| `"100-200人付款"` | 100 | true | 区间取下界 |
| `""` / `null` | 0 | false | 无付款信号，任何 minPayment 都不通过 |
| `"月销 500"` | 0 | false | 非"人付款"格式，不匹配 |

#### N5: 1688 货源验证（原分支 peer-analysis）

**新增模块**: `skills/peer-discovery/src/sourcing-matcher.js`

⚠️ **本模块仅用于原分支（peer-analysis）**，价格比较使用 `<=`（含等于）。图搜分支（image-selection）使用独立的 `image-sourcing-matcher.js`，价格比较使用严格 `<`（不含等于）+ 十进制定点运算。两个模块不共享判定逻辑，避免规则混淆。

```js
/**
 * 判定单个商品是否有同款低价货源。
 * @param {object} product - 达标商品 { title, taobaoPrice, productUrl }
 * @param {object} options
 * @param {number} [options.similarityThreshold=0.45]
 * @param {number} [options.priceRatioThreshold=0.7]
 * @param {number} [options.port=9222]
 * @returns {Promise<object>} sourcing result
 */
async function matchSourcing(product, options)

/**
 * 计算两个标题的分词相似度（Jaccard 系数）。
 * @param {string} titleA
 * @param {string} titleB
 * @returns {number} 0-1
 */
function titleSimilarity(titleA, titleB)
```

**matchSourcing 逻辑**（四级判定: confirmed/suspected/rejected/inconclusive）:

⚠️ **参数名称约定**：全链路统一使用以下名称，从 CLI/MCP 入口到判定器不做转换：
- `similarityThreshold`（非 `similarity`）
- `priceRatioThreshold`（非 `priceRatio`）
- `minProducts`, `minSourcing`, `minPayment`
- `searchMaxProducts`, `searchMaxPages`（1688 搜索配置，可调）

CLI 和 MCP 入口的参数名必须与上述一致。

```js
async function matchSourcing(product, options = {}) {
  const {
    similarityThreshold = 0.45,
    priceRatioThreshold = 0.7,
    port = 9222,
    searchMaxProducts = 10,
    searchMaxPages = 1
  } = options;

  // 1. 提取搜索关键词: 分词取前 3 个高频实词
  const tokens = tokenizeTitle(product.title);
  const keyword = tokens.slice(0, 3).join(' ');
  if (!keyword) return { level: 'inconclusive', reason: 'empty_keyword' };

  // 2. 搜索 1688 — 平台级异常必须向外抛出，不能吞掉
  let searchResult;
  try {
    searchResult = await searchWeb1688({
      keyword, port, maxProducts: searchMaxProducts, maxPages: searchMaxPages
    });
  } catch (err) {
    // 区分平台级故障 vs 普通搜索失败
    // searchWeb1688 在登录失效/验证码/限流时抛出带 status 的错误
    if (isPlatformBlocker(err)) {
      // 保留平台来源，让外层知道是 1688 而非淘宝
      err.platform = '1688';
      err.platformStatus = err.status || err.code || 'unknown';
      err.actionHint = err.message || '1688 平台需要处理';
      throw err; // 向外抛出，由 evaluateAllShops 捕获并触发 blocked 暂停
    }
    return { level: 'inconclusive', reason: 'search_failed', error: err.message };
  }

  // ok: false 也需区分：平台状态异常 vs 正常无结果
  if (!searchResult?.ok) {
    if (searchResult.status === 'captcha_required' || searchResult.status === 'login_required') {
      const err = new Error(searchResult.message || '1688 平台需要登录或验证');
      err.code = searchResult.status;
      err.platform = '1688';
      err.platformStatus = searchResult.status;
      err.actionHint = searchResult.status === 'captcha_required'
        ? '请在 Chrome 中完成 1688 验证码后重试'
        : '请在 Chrome 中登录 1688 后重试';
      throw err; // 平台级故障，向外抛出
    }
    return { level: 'inconclusive', reason: 'search_not_ok', detail: searchResult.message };
  }

  if (!searchResult.products?.length) {
    return { level: 'inconclusive', reason: 'no_1688_result' };
  }

  // 3. 逐条计算相似度、价格比、规格一致性
  const taobaoPrice = product.taobaoPrice;
  if (!taobaoPrice || taobaoPrice <= 0) {
    return { level: 'inconclusive', reason: 'missing_taobao_price' };
  }

  // ⚠️ 前置依赖：normalizeCard 当前不返回 minOrderQuantity 和 singlePiecePrice
  // 需要在 search-web-1688.js 的 domExtractionExpression 和 normalizeCard 中扩展：
  //   1. DOM 提取时从 cardText 解析起订量（如 "1件起批" → 1, "2件起批" → 2）
  //   2. DOM 提取时识别单件价格（如卡片中有明确的 "¥20.00" 且无阶梯标记）
  //   3. normalizeCard 输出 minOrderQuantity (number|null) 和 singlePiecePrice (number|null)
  // 此任务属于 M1 的前置工作，需用真实 1688 搜索结果验证字段可提取性
  // 在扩展完成前，所有商品的 comparablePrice 将为 null，全部进入 suspected/inconclusive

  const candidates = searchResult.products.map(ali => {
    const sim = titleSimilarity(product.title, ali.title);
    const minOrderQty = ali.minOrderQuantity; // null/undefined 表示未知（需 normalizeCard 扩展后才有值）
    const isTieredPrice = Array.isArray(ali.priceBand?.prices) && ali.priceBand.prices.length > 1;

    // 确定有效比较价格：优先用明确的单件价格，其次在满足条件时用 minPrice
    // 规则：singlePiecePrice 存在 → 用它；否则 minOrderQty===1 且非阶梯价 → 用 minPrice；其余 → 不可比
    let comparablePrice = null;
    if (ali.singlePiecePrice != null && ali.singlePiecePrice > 0) {
      comparablePrice = ali.singlePiecePrice;
    } else if (minOrderQty === 1 && !isTieredPrice) {
      comparablePrice = ali.priceBand?.minPrice ?? ali.price;
    }
    // minOrderQty 未知、>1、或阶梯价 → comparablePrice 保持 null → 不可比

    const ratio = comparablePrice ? comparablePrice / taobaoPrice : Infinity;
    // 规格一致性三态：'consistent'（明确一致）| 'inconsistent'（明确不一致）| 'unknown'（无法判断）
    const specStatus = checkSpecConsistency(product.title, ali.title);
    return {
      ali, sim,
      comparablePrice,     // 有效比较价格（null = 不可比）
      rawMinPrice: ali.priceBand?.minPrice ?? ali.price, // 原始最低价（仅记录，不用于比较）
      ratio,
      minOrderQty,
      isTieredPrice,
      specStatus           // 'consistent' | 'inconsistent' | 'unknown'
    };
  });

  // 4. 四级判定
  // confirmed: 相似度达标 + 有效比较价格存在 + 价格比达标 + 规格明确一致
  // 注意：specStatus === 'unknown' 不能进 confirmed（未知≠一致），只能进 suspected
  //       specStatus === 'inconsistent' 明确不同规格，不能进 confirmed 也不能进 suspected
  const confirmed = candidates
    .filter(c => c.sim >= similarityThreshold && c.comparablePrice != null && c.ratio <= priceRatioThreshold && c.specStatus === 'consistent')
    .sort((a, b) => b.sim - a.sim)[0];
  if (confirmed) {
    return {
      level: 'confirmed', reason: 'matched',
      aliUrl: confirmed.ali.url || confirmed.ali.redirectUrl,
      aliTitle: confirmed.ali.title,
      aliComparablePrice: confirmed.comparablePrice,
      aliRawMinPrice: confirmed.rawMinPrice,
      aliMinOrderQty: confirmed.minOrderQty,
      similarity: confirmed.sim, priceRatio: confirmed.ratio
    };
  }

  // 未决候选分类：
  // - specStatus === 'inconsistent' → 明确不同规格，排除（不进 suspected，留给 rejected/inconclusive）
  // - specStatus === 'unknown' + 价格可比且达标 → suspected（规格待确认）
  // - comparablePrice == null → inconclusive（价格不可比）
  // - 价格可比且超标 → 排除（留给 rejected）
  const suspected = candidates
    .filter(c => {
      if (c.sim < similarityThreshold) return false;
      if (c.specStatus === 'inconsistent') return false; // 明确不同规格，不是"未知"
      if (c.comparablePrice != null && c.ratio > priceRatioThreshold) return false;
      return c.comparablePrice == null || c.specStatus === 'unknown';
    })
    .sort((a, b) => Number(b.comparablePrice != null) - Number(a.comparablePrice != null) || b.sim - a.sim)[0];
  if (suspected) {
    const reason = suspected.comparablePrice == null
      ? (suspected.minOrderQty == null ? 'min_order_qty_unknown' : suspected.isTieredPrice ? 'tiered_price_not_comparable' : 'no_single_piece_price')
      : 'spec_unknown'; // 规格未知（非不一致）
    return {
      level: suspected.comparablePrice == null ? 'inconclusive' : 'suspected', reason,
      aliUrl: suspected.ali.url || suspected.ali.redirectUrl,
      aliTitle: suspected.ali.title,
      aliRawMinPrice: suspected.rawMinPrice,
      aliMinOrderQty: suspected.minOrderQty,
      similarity: suspected.sim,
      priceRatio: suspected.comparablePrice ? suspected.ratio : null,
      specStatus: suspected.specStatus,
      note: suspected.comparablePrice == null
        ? (suspected.minOrderQty == null ? '1688起订量未知，无法确认单件价格'
          : suspected.isTieredPrice ? '1688为阶梯价，无法确定单件采购价格'
          : `1688起订量${suspected.minOrderQty}件，无明确单件价格`)
        : '规格一致性未知（非明确不一致），标记疑似待人工确认'
    };
  }

  // rejected: 有充分数据证明不满足条件
  // 走到这里说明 confirmed 和 suspected 分支都没有匹配到任何候选
  const bestSim = Math.max(...candidates.map(c => c.sim));
  if (bestSim < similarityThreshold) {
    return { level: 'rejected', reason: 'low_similarity', bestSimilarity: bestSim };
  }

  // 相似度达标的候选中，按排除原因分类
  const simPassedCandidates = candidates.filter(c => c.sim >= similarityThreshold);
  const inconsistentSpecs = simPassedCandidates.filter(c => c.specStatus === 'inconsistent');
  const comparableAndExpensive = simPassedCandidates.filter(c => c.comparablePrice != null && c.ratio > priceRatioThreshold);

  // 所有达标候选都是规格不一致 → spec_mismatch（不是价格问题）
  if (inconsistentSpecs.length > 0 && inconsistentSpecs.length === simPassedCandidates.length) {
    return { level: 'rejected', reason: 'spec_mismatch',
      detail: `所有 ${inconsistentSpecs.length} 个相似候选规格明确不一致` };
  }

  // 部分规格不一致 + 部分价格超标 → 分别报告
  if (inconsistentSpecs.length > 0 && comparableAndExpensive.length > 0) {
    return { level: 'rejected', reason: 'spec_mismatch_and_price_too_high',
      specMismatchCount: inconsistentSpecs.length,
      bestPriceRatio: Math.min(...comparableAndExpensive.map(c => c.ratio)) };
  }

  // 所有达标候选都有可比价格且超标 → price_too_high
  if (comparableAndExpensive.length > 0) {
    return { level: 'rejected', reason: 'price_too_high',
      bestPriceRatio: Math.min(...comparableAndExpensive.map(c => c.ratio)) };
  }

  // 兜底：理论上不应到达（suspected 应已捕获剩余情况）
  return { level: 'inconclusive', reason: 'unexpected_fallthrough' };
}
// 注：不存在 "all_candidates_incomparable" 分支——价格不可比的候选在 suspected 分支
// 已被捕获并返回 level='inconclusive'（reason 为 min_order_qty_unknown / tiered_price_not_comparable / no_single_piece_price）
```

**titleSimilarity 实现**:
```js
function titleSimilarity(titleA, titleB) {
  const tokensA = new Set(tokenizeTitle(titleA));
  const tokensB = new Set(tokenizeTitle(titleB));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) if (tokensB.has(t)) intersection++;
  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? intersection / union : 0;
}
```

**checkSpecConsistency 实现**（三态：consistent / inconsistent / unknown）:
```js
// 规格词表：材质、件数、规格等可明确比对的属性
const SPEC_PATTERNS = {
  material: /纯银|925银|不锈钢|钛钢|铜镀金|合金|塑料|硅胶|木质|陶瓷|玻璃|真皮|PU/,
  // 数量：分别捕获数字和单位词，保留单位语义
  quantity: /(\d+|一|二|两|三|四|五)\s*(件套|套|件|个|只|条|对|双|把|支|片|块|组|包|盒|箱)/,
  size: /(\d+(?:\.\d+)?)\s*(cm|mm|寸|英寸|厘米|毫米)/
};

// 单位归一化表（全部转为 mm，保留小数精度）
const SIZE_TO_MM = { cm: 10, 厘米: 10, mm: 1, 毫米: 1, 寸: 33.33, 英寸: 25.4 };

// 中文数字转阿拉伯数字
const CN_NUM = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5 };

// 套装类单位（表示多件组合，不能与单件单位等同）
const SET_UNITS = new Set(['件套', '套', '组']);
// 单件类单位
const SINGLE_UNITS = new Set(['件', '个', '只', '条', '把', '支', '片', '块']);
const PACKAGE_UNITS = new Set(['包', '盒', '箱']);
// 配对类单位
const PAIR_UNITS = new Set(['对', '双']);

function normalizeSpec(key, rawMatch) {
  if (key === 'size') {
    const m = rawMatch.match(/(\d+(?:\.\d+)?)\s*(cm|mm|寸|英寸|厘米|毫米)/);
    if (!m) return rawMatch;
    const valueMm = parseFloat(m[1]) * (SIZE_TO_MM[m[2]] || 1);
    // 保留精度：不四舍五入为整数，用 toFixed 去除浮点误差后比较
    // 0.1mm → "0.1mm", 10mm → "10mm", 25.4mm → "25.4mm"
    return `${parseFloat(valueMm.toPrecision(6))}mm`;
  }
  if (key === 'quantity') {
    const m = rawMatch.match(/(\d+|一|二|两|三|四|五)\s*(件套|套|件|个|只|条|对|双|把|支|片|块|组|包|盒|箱)/);
    if (!m) return rawMatch;
    const num = CN_NUM[m[1]] || parseInt(m[1], 10);
    const unit = m[2];
    // 保留单位语义：返回 { num, unit, category } 用于比较
    // category: 'set' | 'single' | 'pair' | 'package'；比较时仍须核对具体单位
    const category = SET_UNITS.has(unit) ? 'set' : PAIR_UNITS.has(unit) ? 'pair'
      : PACKAGE_UNITS.has(unit) ? 'package' : SINGLE_UNITS.has(unit) ? 'single' : 'unknown';
    return JSON.stringify({ num, unit, category });
  }
  return rawMatch; // material 等直接返回原文
}

function compareQuantity(qa, qb) {
  // 解析 normalizeSpec 返回的 JSON
  const a = JSON.parse(qa);
  const b = JSON.parse(qb);
  // 没有明确换算证据时，只比较完全相同的单位，不能把套内件数当作套数。
  if (a.unit !== b.unit || a.category !== b.category) return 'unknown';
  // 包/盒/箱及套/组未说明内部件数，即使外包装数量相同也不足以确认规格。
  if (a.category === 'package' || ['套', '组'].includes(a.unit)) return 'unknown';
  // 同单位下比较数量；件套中的数字表示套内件数。
  if (a.num === b.num) return 'consistent';
  return 'inconsistent';
}

function checkSpecConsistency(titleA, titleB) {
  const extractSpecs = (title) => {
    const specs = {};
    for (const [key, pattern] of Object.entries(SPEC_PATTERNS)) {
      const match = title.match(pattern);
      if (match) specs[key] = normalizeSpec(key, match[0]);
    }
    return specs;
  };
  const specsA = extractSpecs(titleA);
  const specsB = extractSpecs(titleB);
  const allKeys = new Set([...Object.keys(specsA), ...Object.keys(specsB)]);

  let hasConflict = false;
  let hasComparison = false;
  let hasMissing = false;
  let hasQuantityUnknown = false;

  for (const key of allKeys) {
    const a = specsA[key];
    const b = specsB[key];
    if (a && b) {
      if (key === 'quantity') {
        // 数量需要特殊比较：不同计量类别返回 unknown
        const qResult = compareQuantity(a, b);
        if (qResult === 'unknown') hasQuantityUnknown = true;
        else if (qResult === 'inconsistent') hasConflict = true;
        else hasComparison = true;
      } else {
        hasComparison = true;
        if (a !== b) hasConflict = true;
      }
    } else if (a || b) {
      hasMissing = true;
    }
  }

  if (!hasComparison && !hasMissing && !hasQuantityUnknown) return 'unknown';
  if (hasConflict) return 'inconsistent';
  if (hasMissing || hasQuantityUnknown) return 'unknown';
  return 'consistent';
}
```

**三态语义**：
- `consistent`：所有出现的规格维度双方都有且归一化后全部匹配，无单方缺失；数量单位完全相同、含义明确且数值相等 → 可进 confirmed
- `inconsistent`：任一维度归一化后冲突（如"纯银" vs "不锈钢"，"3件" vs "1件"，"0.1mm" vs "0.4mm"） → 明确不同规格，不进 suspected
- `unknown`：无共同维度；或某维度单方缺失；或数量计量类别不同（如"1对" vs "1个"无法确定是否等价） → 无法判断，可进 suspected

**归一化示例**：
| 标题 A | 标题 B | 结果 | 原因 |
|--------|--------|------|------|
| 硅胶垫 3件套 | 硅胶垫 3件套 | consistent | 数量和单位完全一致 |
| 硅胶垫 3件套 | 硅胶垫 3件 | unknown | 套装(set) vs 单件(single)，计量类别不同 |
| 硅胶垫 3件套 | 硅胶垫 | unknown | 件数单方缺失 |
| 硅胶垫 10mm | 硅胶垫 1cm | consistent | 尺寸归一化后都是 10mm |
| 硅胶垫 0.1mm | 硅胶垫 0.4mm | inconsistent | 保留精度后 0.1mm ≠ 0.4mm |
| 硅胶垫 10mm | 硅胶垫 20mm | inconsistent | 10mm ≠ 20mm |
| 陶瓷杯 1对 | 陶瓷杯 1个 | unknown | 配对(pair) vs 单件(single)，计量类别不同 |
| 陶瓷杯 1对 | 陶瓷杯 1对 | consistent | 数量和单位完全一致 |
| 陶瓷杯 1箱 | 陶瓷杯 1个 | unknown | 无箱内件数，不能换算 |
| 硅胶垫 3件套 | 硅胶垫 3套 | unknown | 套内件数不同于套数 |
| 陶瓷杯 1盒 | 陶瓷杯 1盒 | unknown | 同为一盒也不能证明盒内件数一致 |
| 纯银项链 | 不锈钢项链 | inconsistent | 材质冲突 |
| 手机壳 | 手机壳 | unknown | 无任何规格维度 |

#### N6: 商品状态→店铺结论汇总（applyShopVerdict）

使用汇总规则表，考虑"未知项可能满足条件"的情况：

```js
function applyShopVerdict(evaluation, options = {}) {
  const { minSourcing = 5, minProducts = 10 } = options;
  const C = evaluation.sourcingConfirmedCount || 0;
  const S = evaluation.sourcingSuspectedCount || 0;
  const I = evaluation.sourcingInconclusiveCount || 0;
  const Q = evaluation.paymentQualifiedCount || evaluation.qualifiedProductCount || 0;
  const U = evaluation.sourcingUnverifiedCount || 0; // 未验证的达标商品数（提前终止时剩余）
  const completeness = evaluation.collectionCompleteness || 'uncertain';

  // 规则 4: confirmed 已达标 → qualified（无论采集是否完整，已确认就够了）
  if (C >= minSourcing) {
    evaluation.verdict = 'qualified';
    evaluation.reason = null;
    return evaluation;
  }

  // 规则 5: 已验证的全部加起来仍不足，且没有未验证的商品 → unqualified
  // 注意：如果有未验证商品（U > 0），不能断定不足，因为未验证的可能满足
  if (C + S + I < minSourcing && U === 0) {
    // 还要看采集完整性：只有 reached_end 才能确定"整店确实不够"
    if (completeness === 'reached_end') {
      evaluation.verdict = 'unqualified';
      evaluation.reason = `已验证全部 ${C + S + I + (evaluation.sourcingRejectedCount || 0)} 件达标商品，确认货源 ${C} 个，不足 ${minSourcing} 个（采集完整）`;
    } else {
      // uncertain/interrupted: 当前采集范围内不足，但不能断定整店不足
      evaluation.verdict = 'inconclusive';
      evaluation.reason = `当前采集范围内确认货源 ${C} 个，不足 ${minSourcing} 个，但采集不完整（${completeness}），未采到的商品可能满足`;
    }
    return evaluation;
  }

  // 规则 6: 有未验证商品或未知项可能补足 → inconclusive
  evaluation.verdict = 'inconclusive';
  const parts = [];
  if (U > 0) parts.push(`未验证 ${U} 件`);
  if (S > 0) parts.push(`疑似 ${S} 件`);
  if (I > 0) parts.push(`无法判定 ${I} 件`);
  evaluation.reason = `已确认货源 ${C} 个，不足 ${minSourcing} 个，${parts.join('、')}可能补足`;
  return evaluation;
}
```

#### evaluateAllShops 编排

```js
async function evaluateAllShops(options = {}) {
  const { dataDir, runId, client, onProgress } = options;
  const context = getRun({ dataDir, runId });
  const candidates = readJsonl(context.run.files.candidateShops);
  const stateFile = path.join(context.runDir, 'shop-eval-state.json');

  // 取消信号检测：从控制文件读取，每个店铺评估前检查
  const controlFile = path.join(context.runDir, 'runtime-control.json');
  function shouldCancel() {
    try {
      const control = JSON.parse(fs.readFileSync(controlFile, 'utf8'));
      return control.requestedAction === 'cancel';
    } catch { return false; }
  }
  // requestRuntimeCancel 写入 { requestedAction: 'cancel' } 到此文件
  // runner.js 的 requestRuntimePause 写入 { requestedAction: 'pause' }
  // 两者共用同一控制文件，通过 requestedAction 区分
  // finalized = 已得出确定结论（qualified/unqualified），可跳过
  // inconclusive/blocked 不加入 finalized，恢复后重试
  const state = readJson(stateFile, {
    finalized: [], blocked: [],
    judgeConfigHash: null,    // 判定配置指纹（similarityThreshold, priceRatioThreshold, minProducts, minSourcing, minPayment）
    collectConfigHash: null,  // 采集配置指纹（sortType, limit, scrollPages, collectLimit）
    searchConfigHash: null    // 搜索配置指纹（maxProducts, maxPages, sort, port）
  });
  const finalizedSet = new Set(state.finalized);
  // 三层配置指纹：options 已经过 normalizePeerDiscoveryParams 标准化
  // 所有字段都有确定值（非 undefined），?? 默认值仅作防御性兜底
  // 指纹计算的字段必须与实际执行的字段完全一致
  const currentJudgeConfigHash = hashConfig({
    similarityThreshold: options.similarityThreshold,   // 标准化后必有值
    priceRatioThreshold: options.priceRatioThreshold,
    minProducts: options.minProducts,
    minSourcing: options.minSourcing,
    minPayment: options.minPayment
  });
  const currentCollectConfigHash = hashConfig({
    sortType: 'hot',
    collectLimit: options.collectLimit,                 // 标准化后必有值（默认 40）
    scrollPages: 3
  });
  const currentSearchConfigHash = hashConfig({
    searchMaxProducts: options.searchMaxProducts,       // 标准化后必有值（默认 10）
    searchMaxPages: options.searchMaxPages,             // 标准化后必有值（默认 1）
    port: options.port                                  // 标准化后必有值（默认 9222）
  });

  // 三层配置变更检测：
  // - 判定配置变了 → 清空 finalized，全部重新评估（复用采集快照和搜索缓存）
  // - 采集配置变了 → 清空 finalized + 采集快照缓存失效，需重新进店采集
  // - 搜索配置变了 → 清空 finalized + 搜索缓存失效，需重新搜索 1688
  const judgeChanged = state.judgeConfigHash && state.judgeConfigHash !== currentJudgeConfigHash;
  const collectChanged = state.collectConfigHash && state.collectConfigHash !== currentCollectConfigHash;
  const searchChanged = state.searchConfigHash && state.searchConfigHash !== currentSearchConfigHash;

  if (judgeChanged || collectChanged || searchChanged) {
    state.finalized = [];
    state.blocked = [];
    finalizedSet.clear();
    // 采集/搜索缓存的失效由各层独立判断（collectQualifiedProducts 和 matchSourcing 内部比对指纹）
  }

  const evaluations = [];    // qualified
  const unqualified = [];    // unqualified
  const inconclusive = [];   // inconclusive
  const blocked = [];        // blocked
  const errors = [];

  for (let i = 0; i < candidates.length; i++) {
    // 取消检查点：每个店铺评估前检查控制文件
    if (shouldCancel()) {
      // 返回停止结果，runtime.json 的 cancelled 终态由 runner 统一写入。
      return { status: 'cancelled', evaluations, unqualified, inconclusive, blocked, errors,
        message: `用户取消，已完成 ${evaluations.length + unqualified.length + inconclusive.length + blocked.length}/${candidates.length} 家店铺评估` };
    }

    const shop = candidates[i];
    if (finalizedSet.has(shop.shopKey)) {
      // 断点续跑: 读取与当前配置指纹匹配的最新评估（而非第一条历史记录）
      // 因为 appendJsonl 追加写入，同一店铺可能有多条记录（如首次不通过、调参后通过）
      const allEvals = readJsonl(context.run.files.shopEvaluations)
        .filter(e => e.shopKey === shop.shopKey
          && e.judgeConfigHash === currentJudgeConfigHash
          && e.collectConfigHash === currentCollectConfigHash
          && e.searchConfigHash === currentSearchConfigHash);
      const existing = allEvals.length > 0 ? allEvals[allEvals.length - 1] : null;
      if (existing) {
        if (existing.verdict === 'qualified') evaluations.push(existing);
        else unqualified.push(existing);
      } else {
        // 配置指纹不匹配的记录不应出现在 finalized 中（上面已清空），
        // 但如果出现说明状态不一致，移除并重新评估
        finalizedSet.delete(shop.shopKey);
        state.finalized = state.finalized.filter(k => k !== shop.shopKey);
        // 不 continue，落入下方的正常评估流程
      }
      if (existing) continue;
    }

    onProgress?.({ current: i, total: candidates.length,
      message: `正在评估 ${shop.shopName} (${i + 1}/${candidates.length})` });

    try {
      // N4: 采集达标商品（检查采集快照配置指纹决定是否复用）
      const collection = await collectQualifiedProducts(shop, options);

      if (collection.status === 'blocked') {
        // 平台级故障：暂停整条流水线，不标记完成
        const platform = collection.platform || 'taobao'; // 采集阶段操作淘宝
        const eval_ = { ...shop, verdict: 'blocked', reason: collection.reason,
          platform, platformStatus: collection.platformStatus || 'unknown',
          actionHint: collection.actionHint || collection.reason,
          totalCollected: 0, paymentQualifiedCount: 0, sourcingVerifiedCount: 0, sourcingUnverifiedCount: 0, sourcingConfirmedCount: 0, sourcingSuspectedCount: 0, sourcingInconclusiveCount: 0, sourcingRejectedCount: 0, products: [],
          judgeConfigHash: currentJudgeConfigHash, collectConfigHash: currentCollectConfigHash, searchConfigHash: currentSearchConfigHash, evaluatedAt: new Date().toISOString() };
        blocked.push(eval_);
        appendJsonl(context.run.files.shopEvaluations, eval_);
        state.blocked.push(shop.shopKey);
        writeJson(stateFile, { ...state, judgeConfigHash: currentJudgeConfigHash, collectConfigHash: currentCollectConfigHash, searchConfigHash: currentSearchConfigHash });
        return { status: 'blocked', evaluations, unqualified, inconclusive, blocked, errors,
          platform,
          message: `${platform === 'taobao' ? '淘宝' : platform}平台故障：${collection.reason}，已保存进度，恢复后从 ${shop.shopName} 继续` };
      }

      if (collection.status === 'insufficient_products' && collection.collectionComplete) {
        // 已采完确实不够 → unqualified（确定结论，可跳过）
        const eval_ = { ...shop, verdict: 'unqualified',
          reason: `达标商品 ${collection.actual} 个，不足 ${collection.required} 个（采集完整）`,
          qualifiedProductCount: collection.actual, totalCollected: collection.totalCollected || 0, paymentQualifiedCount: collection.actual, sourcingVerifiedCount: 0, sourcingUnverifiedCount: 0, sourcingConfirmedCount: 0, sourcingSuspectedCount: 0, sourcingInconclusiveCount: 0, sourcingRejectedCount: 0, products: [],
          judgeConfigHash: currentJudgeConfigHash, collectConfigHash: currentCollectConfigHash, searchConfigHash: currentSearchConfigHash, evaluatedAt: new Date().toISOString() };
        unqualified.push(eval_);
        appendJsonl(context.run.files.shopEvaluations, eval_);
        state.finalized.push(shop.shopKey);
        writeJson(stateFile, { ...state, judgeConfigHash: currentJudgeConfigHash, collectConfigHash: currentCollectConfigHash, searchConfigHash: currentSearchConfigHash });
        await sleep(2000);
        continue;
      }

      if (collection.status === 'insufficient_products' && !collection.collectionComplete) {
        // 采集不完整 → inconclusive（不确定，不标记完成）
        const eval_ = { ...shop, verdict: 'inconclusive',
          reason: `达标商品 ${collection.actual} 个，但采集不完整，无法判定`,
          qualifiedProductCount: collection.actual, totalCollected: collection.totalCollected || 0, paymentQualifiedCount: collection.actual, sourcingVerifiedCount: 0, sourcingUnverifiedCount: 0, sourcingConfirmedCount: 0, sourcingSuspectedCount: 0, sourcingInconclusiveCount: 0, sourcingRejectedCount: 0, products: [],
          judgeConfigHash: currentJudgeConfigHash, collectConfigHash: currentCollectConfigHash, searchConfigHash: currentSearchConfigHash, evaluatedAt: new Date().toISOString() };
        inconclusive.push(eval_);
        appendJsonl(context.run.files.shopEvaluations, eval_);
        // 不加入 finalized，恢复后重试
        writeJson(stateFile, { ...state, judgeConfigHash: currentJudgeConfigHash, collectConfigHash: currentCollectConfigHash, searchConfigHash: currentSearchConfigHash });
        await sleep(2000);
        continue;
      }

      // N5+N6: 货源验证 + 汇总
      // collectQualifiedProducts 已在采集阶段对全部达标商品完成货源验证（preEvaluated=true）
      // 此处直接使用其结果，不再重复验证
      const productsWithSourcing = collection.products; // 已含 sourcing 字段

      // N6: 汇总规则（商品状态→店铺结论）— 使用分项统计，不混淆采集数/达标数/已验证数
      const stats = collection.stats || {};
      const evaluation = {
        ...shop,
        totalCollected: stats.totalCollected ?? 0,  // 采集到的商品总数；此作用域没有 result
        paymentQualifiedCount: stats.paymentQualified || productsWithSourcing.length, // 付款达标数
        sourcingVerifiedCount: stats.sourcingVerified || productsWithSourcing.length, // 已验证数
        sourcingUnverifiedCount: stats.sourcingUnverified || 0,  // 未验证数（提前终止剩余）
        sourcingConfirmedCount: productsWithSourcing.filter(p => p.sourcing.level === 'confirmed').length,
        sourcingSuspectedCount: productsWithSourcing.filter(p => p.sourcing.level === 'suspected').length,
        sourcingInconclusiveCount: productsWithSourcing.filter(p => p.sourcing.level === 'inconclusive').length,
        sourcingRejectedCount: productsWithSourcing.filter(p => p.sourcing.level === 'rejected').length,
        collectionCompleteness: collection.collectionCompleteness,
        products: productsWithSourcing,
        evaluatedAt: new Date().toISOString(),
        judgeConfigHash: currentJudgeConfigHash, collectConfigHash: currentCollectConfigHash, searchConfigHash: currentSearchConfigHash
      };
      applyShopVerdict(evaluation, options); // 使用汇总规则表（含 collectionCompleteness 和 unverifiedCount）

      // 按结论分类
      if (evaluation.verdict === 'qualified') evaluations.push(evaluation);
      else if (evaluation.verdict === 'unqualified') unqualified.push(evaluation);
      else inconclusive.push(evaluation);

      appendJsonl(context.run.files.shopEvaluations, evaluation);

      // 只有确定结论才标记为 finalized
      if (evaluation.verdict === 'qualified' || evaluation.verdict === 'unqualified') {
        state.finalized.push(shop.shopKey);
      }
      // inconclusive 不加入 finalized，恢复后重试
      writeJson(stateFile, { ...state, judgeConfigHash: currentJudgeConfigHash, collectConfigHash: currentCollectConfigHash, searchConfigHash: currentSearchConfigHash });

    } catch (err) {
      if (isPlatformBlocker(err)) {
        // 平台级异常 → blocked，暂停流水线
        // 保留平台来源（err.platform 由 matchSourcing/enrichCompetitorProduct 设置）
        const platform = err.platform || 'unknown';
        const eval_ = { ...shop, verdict: 'blocked', reason: err.message,
          platform,                          // '1688' | 'taobao' | 'unknown'
          platformStatus: err.platformStatus || err.code || 'unknown',
          actionHint: err.actionHint || err.message,
          totalCollected: 0, paymentQualifiedCount: 0, sourcingVerifiedCount: 0, sourcingUnverifiedCount: 0, sourcingConfirmedCount: 0, sourcingSuspectedCount: 0, sourcingInconclusiveCount: 0, sourcingRejectedCount: 0, products: [],
          judgeConfigHash: currentJudgeConfigHash, collectConfigHash: currentCollectConfigHash, searchConfigHash: currentSearchConfigHash, evaluatedAt: new Date().toISOString() };
        blocked.push(eval_);
        appendJsonl(context.run.files.shopEvaluations, eval_);
        state.blocked.push(shop.shopKey);
        writeJson(stateFile, { ...state, judgeConfigHash: currentJudgeConfigHash, collectConfigHash: currentCollectConfigHash, searchConfigHash: currentSearchConfigHash });
        return { status: 'blocked', evaluations, unqualified, inconclusive, blocked, errors,
          platform,  // 透传到 stepEvaluateShops
          message: `${platform === '1688' ? '1688' : platform === 'taobao' ? '淘宝' : ''}平台故障：${err.message}，已保存进度` };
      }

      // 非平台级异常 → 记录错误，该店铺标记 inconclusive，继续下一家
      const errorRecord = { shopKey: shop.shopKey, shopName: shop.shopName,
        code: err.code || 'EVAL_FAILED', message: err.message };
      errors.push(errorRecord);

      const eval_ = { ...shop, verdict: 'inconclusive',
        reason: `评估异常：${err.message}`, totalCollected: 0, paymentQualifiedCount: 0, sourcingVerifiedCount: 0, sourcingUnverifiedCount: 0, sourcingConfirmedCount: 0, sourcingSuspectedCount: 0, sourcingInconclusiveCount: 0, sourcingRejectedCount: 0, products: [],
        judgeConfigHash: currentJudgeConfigHash, collectConfigHash: currentCollectConfigHash, searchConfigHash: currentSearchConfigHash, evaluatedAt: new Date().toISOString() };
      inconclusive.push(eval_);
      appendJsonl(context.run.files.shopEvaluations, eval_);
      // 不加入 finalized，恢复后重试
      writeJson(stateFile, { ...state, judgeConfigHash: currentJudgeConfigHash, collectConfigHash: currentCollectConfigHash, searchConfigHash: currentSearchConfigHash });
    }

    await sleep(2000);
  }

  return { status: 'completed', evaluations, unqualified, inconclusive, blocked, errors };
}
```

### 4.5 N7: 输出报告 (`peer-report-writer.js`)

**新增模块**: `skills/peer-discovery/src/peer-report-writer.js`

```js
/**
 * @param {object} options
 * @param {string} options.dataDir
 * @param {string} options.runId
 * @returns {Promise<{ file: string, count: number }>}
 */
async function writePeerDiscoveryReport(options)
```

**JSON 输出** (`peer-discovery-result.json`):
```json
{
  "ok": true,
  "runId": "2026-10-14-100000",
  "summary": {
    "inputProducts": 4,
    "candidateShops": 12,
    "shopsQualified": 3,
    "shopsUnqualified": 5,
    "shopsInconclusive": 3,
    "shopsBlocked": 1,
    "totalCollected": 240,
    "totalPaymentQualified": 120,
    "totalSourcingConfirmed": 18,
    "totalSourcingSuspected": 8,
    "totalSourcingInconclusive": 15,
    "totalSourcingRejected": 79
  },
  "shops": [ /* qualified evaluations */ ],
  "unqualified": [ /* unqualified evaluations with reasons */ ],
  "inconclusive": [ /* inconclusive evaluations with reasons */ ],
  "blocked": [ /* blocked evaluations with reasons */ ],
  "errors": []
}
```

**Excel 输出** (四个工作表):

| 工作表 | 列 |
|--------|-----|
| 同行店铺 | 店铺名、店铺链接、采集商品数、付款达标数、已验证数、未验证数、confirmed数、suspected数、inconclusive数、rejected数、采集完整性、判定结果 |
| 达标商品清单 | 店铺名、商品标题、商品链接、付款人数下限、淘宝价、1688链接、1688可比价、1688原始最低价、起订量、相似度、价格比、货源级别(confirmed/suspected/rejected/inconclusive)、备注 |
| 未达标与无法判定 | 店铺名、判定结果(unqualified/inconclusive/blocked)、原因、采集完整性、达标商品实际数、confirmed实际数 |
| 错误记录 | 店铺名/链接、错误阶段、错误码、错误信息 |

复用 `exceljs`（已有依赖），参考 `report-writer.js` 的实现模式。

---

### 4.6 collectPeerProducts (`shared-shop-collector.js`)

以下4.6–4.10是拟新增模块的实施契约，不代表现有API；持久化及版本规则统一引用§5，禁止另建不兼容的检查点协议。所有导出实现补齐JSDoc。

| 函数签名 | 输入 | 输出 |
|---|---|---|
| `collectShopSnapshot(shop, options)` | 稳定shopKey、采集参数、signal、平台会话 | `{shopKey, products, completeness, observedAt, diagnostics}`；原始商品不应用付款筛选 |
| `collectShopCandidates(shop, options)` | 上述快照及minPayment | 原始证据与付款筛选后products；未知付款数不自动通过 |
| `stepCollectPeerProducts(ctx)` | 当前候选店铺版本、run参数、store、runtime | `{status, generation, collectedCount, eligibleCount, incompleteShops}`及manifest引用 |

执行顺序：读取当前候选店铺 → 检查取消/暂停 → 复用有效快照或串行采集 → 写不可变快照并原子发布manifest → 按付款门槛生成当前商品集合 → 保存节点进度。移除的店铺不能继续贡献旧商品。原分支仍经collectQualifiedProducts执行店铺门槛；图搜分支不使用该包装器。

平台登录/验证码/限流错误返回manual_action_required及平台操作信息；其他采集失败记录retryable及不完整范围。只有全部目标店铺完成且确无达标商品才能返回no_products_found。逐店进度包含完成/失败/待处理数，暂停返回stepIncomplete。

### 4.7 verifyImageSources (`image-sourcing-matcher.js`)

**通道决策门禁**：现有searchWeb1688是文字检索，不视为可用图搜实现。新增image-search-provider.js包装唯一选定通道。S0探针4（脚本：`test/probes/s0-probe-1688-image-search.js`）先验证当前账号实际获授权的1688图片检索API；记录真实端点/版本、图片URL或上传要求、凭证作用域、计费及字段样本，沉淀脱敏Fixture至`test/fixtures/peer-discovery/s0-probe-1688-image-search.json`。缺少凭证或未授权抛出`ERR_1688_IMAGE_AUTH_MISSING`。没有已验证授权API时，才评估用户登录浏览器中的正常上传图搜路径（验证码归类`ERR_1688_IMAGE_CAPTCHA`，限流归类`ERR_1688_IMAGE_RATE_LIMIT`）。验证码只阻塞并请求人工处理，不绕过，不在两种通道间自动重试。两条路径均未验证成功则#62不得上线，原同行分支可独立交付。

| 函数签名 | 输入 | 输出 |
|---|---|---|
| `searchImageSources({imageRef, searchOptions, signal})` | 服务端生成的图片摘要及受控URL/文件引用，限流配置 | `{provider, providerVersion, observedAt, candidates, completeness, diagnostics}`；候选含offerId、链接、图、标题、规格、币种、价格原文、起订量证据及证据来源 |
| `verifyImageSource(product, options)` | 源商品快照、provider、判定参数 | `{productKey, snapshotRevision, searchConfigHash, judgeConfigHash, observedAt, expiresAt, candidates, verdict, reasons}` |
| `stepVerifyImageSources(ctx)` | 当前generation及快照 | 当前验证结果引用、confirmed/suspected/rejected/inconclusive计数、进度 |

图片URL下载须拒绝内网/本地地址及跳转到内网，限制响应大小、类型、超时；上传文件只用服务端受控目录，不接受客户端任意路径。请求经平台限流器串行排队，尊重Retry-After，不用标题并发池驱动图搜。

顺序：验证图片 → 查时间有效且指纹匹配的原始缓存 → provider图搜 → 规范化并保留原始证据 → 对全部候选执行相似度、规格、可比价格判定 → 持久化结果 → 写检查点。缺价格/规格证据不推断confirmed；候选为空只有在检索完整时才算确定无结果。字段缺失为inconclusive，正常无匹配可rejected；平台故障暂停。不得图搜失败后静默转文字搜索。

价格比较使用十进制定点整数交叉相乘，不先做Number除法。由于淘宝价格通常为2位小数（如29.90元），而1688批发单价可能出现3或4位小数（如小五金或辅料0.125元），必须先统一转换为同标度（默认4位小数，放大10000倍）的已校验正价格BigInt整数，再传入比价函数。ratio为正十进制字符串（支持精度上限由参数schema统一约束，最多6位小数，超限拒绝而非舍入）：

```js
/**
 * 将十进制价格文本对齐转换为统一精度的 BigInt 整数。
 * 解决 1688 三位/四位小数与淘宝两位小数因位宽不一致产生的量级错误。
 * @param {string|number} price 价格原文或数值
 * @param {number} [targetScale=4] 统一目标标度（默认4位小数，乘以 10^4）
 * @returns {bigint} 对齐后的价格整数（如 "29.9" -> 299000n, "0.125" -> 1250n）
 */
function parsePriceToScaledBigInt(price, targetScale = 4) {
  const str = String(price ?? '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(str)) throw new Error(`非法价格格式: ${price}`);
  const [whole, fraction = ''] = str.split('.');
  if (fraction.length > targetScale) {
    throw new Error(`价格小数位数 (${fraction.length}) 超过目标标度 (${targetScale}): ${price}`);
  }
  const paddedFraction = fraction.padEnd(targetScale, '0');
  const scaled = BigInt(whole + paddedFraction);
  if (scaled <= 0n) throw new Error(`价格必须大于0: ${price}`);
  return scaled;
}

/**
 * 严格比较可比价格；调用方先完成币种、规格及单件证据校验，且 p 与 t 已通过 parsePriceToScaledBigInt 统一对齐标度。
 * @param {bigint} p 货源价格整数（对齐标度后）。
 * @param {bigint} t 淘宝价格整数（对齐标度后）。
 * @param {string} ratio 正十进制倍率（如 "1", "0.8"）。
 * @returns {boolean} 是否严格小于阈值。
 */
function belowImagePriceRatio(p, t, ratio) {
  if (typeof p !== 'bigint' || typeof t !== 'bigint' || p <= 0n || t <= 0n ||
      typeof ratio !== 'string' || !/^\d+(?:\.\d{1,6})?$/.test(ratio)) {
    throw new Error('非法价格或倍率');
  }
  const [whole, fraction = ''] = ratio.split('.');
  const numerator = BigInt(whole + fraction);
  if (numerator <= 0n) throw new Error('倍率必须大于0');
  return p * (10n ** BigInt(fraction.length)) < t * numerator;
}
```

入口将既有数值倍率规范化为最多6位小数的十进制字符串，不能直接用浮点价格乘法；原始价格也从十进制文本解析。最终比例仅供展示，不参与判定。

### 4.8 prepareListingDrafts (`listing-draft-preparer.js`)

| 函数签名 | 输入 | 输出 |
|---|---|---|
| `prepareListingDraft(candidate, options)` | confirmed证据、已确认商品信息、人工编辑版本、标题配置、signal | `{draftKey, inputRevision, title, category, titleSource, titleError, needsInput}` |
| `prepareListingDrafts(candidates, options)` | 当前候选集合、store、共享LLM限流器、onProgress | 各项草稿及ready/needsInput/failed计数，不因单项失败抛弃整批 |
| `stepPrepareListingDrafts(ctx)` | 当前验证集合及已有草稿 | 当前bundle引用、完成进度；标题/类目缺失交接复核节点处理 |

只调用标题层，不调用title-gen完整run，不再次执行1688搜索、淘宝搜索或生意参谋查询。参考现有skills/title-gen/src/generate-title.js中的generateTitles输入契约，但其返回string[]且吞错降级，不能直接当作带成功/失败来源的结果。新增薄适配器返回titleSource（llm/fallback/manual）及错误信息；降级标题需人工确认，空标题标记needs_input。

标题池默认并发3、服务端可设1–5，受共享LLM限流器约束；每项默认120秒预算（包括最多1次可重试瞬态错误，尊重服务端退避），提供真实请求取消，禁止只Promise.race后放任请求运行。401/403或配置错误停止派发剩余LLM请求，保留所有草稿为待处理；429按共享限流器退避，预算耗尽转单项needs_input。

派发前先创建所有草稿占位，每项完成即按inputRevision条件保存结果及进度；原子bundle发布由单写者串行处理，防止并发覆盖人工修改。旧版本结果只留诊断、不覆盖新草稿。运行采用后台任务与轮询/事件，启动HTTP请求立即返回runId，不保持到整批结束。弹窗可渐进查看、编辑和重试失败项；首版在准备阶段完成或暂停并冻结当前集合后才允许确认分配和铺货，避免后台生成不断使提交revision失效。

暂停/取消停止新派发并处理在途取消；重启按已保存的inputRevision恢复，仅补未完成项。单项失败计入进度并继续，全部任务settled后进入复核；缺类目保留空值，不阻塞整批标题生成，也不无限重试。

### 4.9 reviewPeerListings (`peer-listing-adapter.js`)

| 函数签名 | 输入 | 输出 |
|---|---|---|
| `savePeerDraftEdits(ctx, request)` | expectedDraftRevision、逐项标题/类目修改 | 新bundle版本或revision_conflict |
| `createPeerAllocationPlan(ctx, request)` | 当前版本、选中offer、店铺ID、分配方式 | 持久化planId、店铺快照、逐店数量与明细；不提交 |
| `submitPeerAllocationPlan(ctx, request)` | expectedDraftRevision、expectedPlanId、confirm=true | jobId及逐子批状态；后台执行，不阻塞HTTP |
| `reconcilePeerSubmissions(ctx, request)` | 已保存的batch/attempt引用 | 逐店逐offer成功/失败/未知及证据，不重新提交 |
| `stepReviewPeerListings(ctx)` | 当前bundle、plan与账本 | review_completed或manual_action_required，附允许的用户动作 |

§5为唯一事务规则：保存、确认分配、实际提交是不同动作；每次写入校验revision。实际调用按单店快照及sequential-average拆批，沿用合法服务参数，不新增manual平台模式。价格证据刷新使旧选择失效；当前服务仅支持整商品铺货，不承诺指定SKU。提交响应丢失先核对，成功项不重发；暂停阻止新子批，已提交继续提供核对入口。人工结束记录原因与真实结果，不把失败/未知改成成功。

### 4.10 peerProductReport (`peer-product-report-writer.js`)

`writePeerProductReport({runId, bundle, allocationPlan, ledger, outputDir})`返回`{jsonPath, excelPath, summary, reportRevision}`；`stepPeerProductReport(ctx)`读取同一版本快照生成报告。输出含源商品与词/店铺关系、验证结果及证据时间、标题/目标类目、本地分配方式、每店每offer提交状态及失败原因。统计分别列商品数、分配项数、提交成功/失败/未知数，不混用口径。

运行中可下载标记partial的快照报告；最终报告仅在§5规定的复核完成或确定无结果终态生成。写临时文件成功后原子发布，失败可单独重试报告，不重新选品或铺货。Excel以文本写入外部标题等内容，禁止将外部输入写成公式；报告路径必须位于run目录，下载沿用现有授权校验。

## 5. 主编排入口与版本协议

本节取代此前“读取全部追加日志 + 已处理 ID 列表”的步骤示例。步骤实现必须遵守以下事务和版本契约，不能把审计日志当作当前状态。以下函数为计划中的纯决策函数，存储、平台及 UI 接入仍需实施；不宣称已完成生产实现。

### 当前数据与身份

- 每个 run 只有一个活动执行器；复核保存、配置修改、提交共用 run 级写锁及 revision 条件更新。另用平台级会话锁保护共享淘宝客户端/CDP，避免不同 run 的导航相互覆盖。
- 原始采集与付款筛选分层。新增 collectShopSnapshot，仅采集并保留原始商品和完整性证据；collectShopCandidates 在该快照上应用 minPayment。两个分支共享原始快照，不共享店铺判定门槛。
- sourceProductKey 必须来自平台商品ID；只有明确指向商品ID的规范链接才能作等价键。不得用数组下标或标题代替。缺少稳定ID时保留采集诊断并尝试补全，仍失败则记录无法判定，不自动进入可铺货集合。
- 原始快照版本 snapshotRevision 由商品ID、主图内容标识、原始价格/币种/规格证据、付款原文及解析器版本决定。图片用下载内容摘要或可验证的图片版本标识，不能只假设 URL 永不变化。
- 店铺每次刷新写新的不可变快照文件，成功落盘后原子切换 manifest 指针；旧快照只用于审计。当前商品全集只从 manifest 引用的快照重建。某次刷新为空也提交空集合，不能沿用上次商品。
- 正常中断保留已提交的店铺快照；平台错误不标记完成。非平台采集失败标记 retryable，不当作“店铺没有商品”。只对本次成功采集范围报告数量；部分失败时展示不完整警告并提供重试，不能输出“所有店铺无商品”的确定结论。
- minPayment 变化只重新筛选原始快照；collectLimit/采集器版本变化或用户明确刷新才重新采集。付款下界未知与实际为0分开，未知不自动通过。
- 放宽minPayment后新纳入的商品，若没有匹配当前版本的搜索和验证证据，必须补做下游搜索与验证；复用原始快照不等于跳过货源验证。
- 产品清单 generation 是当前快照引用、过滤条件、分支和解析器版本的哈希。检查点必须同时匹配 generation、sourceProductKey 和商品 snapshotRevision。

### 图搜结果与缓存

- evidenceMaxAgeMs 通过 CLI（--evidence-max-age-ms）和 MCP（evidenceMaxAgeMs）暴露，标准化后持久化到 run 参数，运行期间固定。原始图搜缓存同样保存时间证据，不通过缓存命中更新采集时间。
- 新图搜分支使用 evidenceMaxAgeMs，默认24小时，入口仅接受有限正整数；这是本系统的刷新策略，不是平台的数据有效性保证。每份源商品、候选货源证据记录 observedAt、expiresAt、evidenceRevision；联合判定的 expiresAt 取依赖证据最早到期时间。缺失/非法时间、未来采集时间及 now >= expiresAt 均不可作为当前有效证据，不能通过重新写入缓存延长有效期。
- 恢复、展示可提交状态、实际提交前均检查有效期。过期项显示“证据已过期，需刷新”，不得继续以有效 confirmed 提交；保留历史证据但不把过期视为 rejected 或无货。刷新源商品和货源的价格、规格、在售状态，重新判定；图片/搜索参数变化或搜索缓存过期时重新图搜。所有刷新遵循既有限流与平台会话锁，失败进入可重试阻塞，不回退到旧 confirmed。
- 复核弹窗提供“刷新选中商品证据”。刷新更新证据版本和bundle，要求用户重新确认；有效证据内仅调整比例可本地重判。提交前若过期，返回 needs_refresh，不自动刷新后静默提交。平台请求发出后的价格变化无法由缓存协议保证，报告保留判定时间及提交时间。
- 原始图搜缓存键为图片摘要、平台/搜索参数及采集器版本。每个商品的判定键额外绑定 sourceProductKey、snapshotRevision、判定器版本、imagePriceRatioThreshold。价格、规格或图片变化后，旧判定不得复用。
- 每件商品验证完成即持久化结果，再提交检查点。崩溃发生在两者之间时，可从完整结果恢复检查点，不重复调用平台。普通失败保存可重试状态；重试只针对该项，平台错误暂停整条分支。
- 当前结果只能选取当前 manifest 商品集合中“商品版本 + 搜索指纹 + 判定指纹”全部匹配的最新记录。被移除商品、旧价格/图片、旧比例结果均排除。比例变化可复用原始图搜缓存，但必须重判，不能只更改显示标签。
- 无产品/无 confirmed 须区分确定无结果、采集不完整、证据待刷新及提交待核对；只有确定无结果且没有待核对提交才结束并输出原因报告，其余进入可恢复人工处理。

### 草稿、复核与提交

- draftKey 使用目标 offerId + 明确 SKU/规格标识，保留多个 sourceProductKey 来源。规格标识未知时不以通用标题去重合并。
- 每次生成草稿都重建“当前有效的 confirmed 集合”，即使没有标题需要生成也必须提交更新。是否仍需提交按目标店铺逐项计算，不按商品是否在任意店铺成功排除整个草稿。A/B通过变为仅A通过时，B从可提交集合移除；不删除B的历史及已提交凭证。过期证据保留为待刷新项，不走确定无结果终态。
- 草稿输入版本绑定源验证证据、目标offer/SKU、标题生成配置及人工修改版本。输入变化必须生成新草稿版本或要求用户重新确认，不能只按 productKey 复用成功标题。
- activeDrafts、draftRevision、reviewState、selection 和来源 generation 一起写入一个新的不可变复核 bundle，再原子切换指针，避免“新草稿配旧 completed”。同一输入重复执行不增加版本；集合/证据/配置变化时增加版本，重置未提交项选择及确认状态。选中项为空时不允许自动提交。
- 提交服务接收 expectedDraftRevision、商品键、店铺、分配方式，在同一个锁内校验当前版本、confirmed证据、选中项标题/目标类目和提交账本；校验通过后先落盘 submissionIntent，再调用平台。配置更新与提交不能交错绕过版本检查。
- 新适配器维护run/目标店铺/offerId的商品级提交账本，不以草稿revision作为唯一去重依据。既有服务只有批次hash去重，不能声称已具备该逐项协议；新增账本在调用既有服务之前过滤成功/未知项。成功项禁止自动重复提交；响应丢失项标记待核对，不能直接重发；已提交及核对中的商品禁止改写其提交内容。
- submittedLedger 独立于活动草稿集合，永久保留当前run提交证据。更新比例不删除已提交记录，也不会重新提交成功项。
- 多店铺分配**完全在本地完成**，不依赖平台的分配模式。先生成并持久化不可变 allocationPlan（planId、draftRevision、目标店铺快照、分配方式、逐项分配明细 `[{ offerId, targetShopId, sourceDraftKeys }]`），向用户展示每店数量并确认。顺序平均按用户确认的商品和店铺顺序连续分段，余数依店铺顺序分配；随机平均先打乱商品再分段；随机分配为每件商品抽取一家店，允许空店；重复分配为每件商品分配所有店铺。平均分配各店数量差不超过1，商品少于店铺时允许零商品店铺。随机方式在plan生成时固定种子并保存实际明细，恢复和重试不得重新抽签。
- **提交时按目标店铺拆批**：每店仅包含其分配商品，再按既有batchSize上限拆为有序子批，持久化batchId、商品明细、提交时间和状态。零商品店铺不调用服务。子批串行执行并遵守平台限流/会话锁；每批前检查暂停、当前计划及证据有效期，取消不撤回已发出的请求，仍须保留核对入口。
- 适配器通过服务端店铺配置解析targetShopId，获取包含id、revision、platformShopName、port的店铺快照，每批传 `targetShops: [shopSnapshot]` 和现有合法模式 `distributionMode: 'sequential-average'`。单目标店铺下该模式不会改变本地分配。禁止传裸shopId、虚构manual模式、临时修改共享配置或绕过既有店铺校验；选中店铺须与快照一致，否则提交阻塞。UI仍显示用户选择的本地分配方式，另存实际平台执行模式供核对。
- 提交携带 expectedPlanId；服务器校验它与当前 bundle 匹配，再原子记录提交意图及其明细。UI 店铺名称不作幂等身份。
- 现有输入仅支持链接/标题/类目，结果按offerId核对，不支持指定SKU铺货。首版明确为整商品铺货，skuKey仅作选品价格比较证据，不承诺只铺该SKU。生成分配计划前按offerId合并来源；同offer的标题/类目冲突须人工选定唯一草稿，界面提示整商品铺货范围，不能把多个SKU提交成重复商品。用户要求仅铺指定SKU时阻塞并说明暂不支持，不静默转整商品。
- 实际提交单位为 runId + targetShopId + offerId。同商品向A成功、B失败时，只允许重试B；失败必须确定无副作用才可重发，未知先核对。同键重试记录不同attempt但保留同一业务身份。核对使用该子批的单店快照、offerId集合和submittedAt；无法唯一对应当前尝试的记录标记unknown，不采用其他店铺或旧批次成功记录。
- **验收要求**：本地 allocationPlan 明细、实际提交批次（每批的 offerId 列表和目标 shopId）、核对结果三者逐项一致。中断恢复后读取已持久化的 plan，不重新生成分配。
- 修改店铺/分配方式须显式生成新计划并重新确认，仅重分配尚未发出且无未知结果的项；已成功、提交中、待核对项冻结，不能移动或删除。旧计划未执行项标记 superseded，不计入新计划待办；旧计划已发出项继续核对并进入报告。
- 自动完成条件是当前确认计划中的所有分配项均成功，且本run没有提交中/待核对项；不能因某商品任意一家成功而完成。失败项需重试或明确人工结束；人工结束保留失败/未知及操作原因，不伪造成功，也不重发未知项。无confirmed但账本仍有提交中/待核对项时保留核对入口，不直接进入无结果完成。
- completed 只对指定 draftRevision 和确认范围有效。人工完成必须记录操作者确认、时间和方式，不伪造平台成功。已完成run修改配置需新建运行；未完成run修改比例后返回 verifyImageSources，重新评估并生成新复核bundle。
- 类目/标题只对选中项强制完整；未选草稿允许缺项。单商品标题重试保留其他人工编辑。无有效 confirmed 时撤销旧提交资格；是否输出最终无结果报告按上面的证据与提交状态判断，不留可提交旧弹窗。

### 步骤处理表

| 步骤ID / 导出函数 | 执行与恢复行为 |
|---|---|
| extractSources / stepExtractSources | 初始化run及文件索引，提取源商品；错误分类后逐项保存，平台错误返回manual_action_required |
| findSimilarProducts / stepFindSimilar | 淘宝图搜、源店铺排除、候选集合生成；候选集合带版本，不追加成永久累积列表 |
| evaluateShops / stepEvaluateShops | 仅原分支：调用原店铺评估器；blocked优先映射manual_action_required，保留platform、错误码、操作指引；cancelled透传 |
| peerReport / stepPeerReport | 仅原分支：同行报告 |
| collectPeerProducts / stepCollectPeerProducts | 调用collectShopSnapshot并发布manifest；按minPayment筛选，保留所有达标商品，不应用minProducts/minSourcing |
| verifyImageSources / stepVerifyImageSources | 按验证键恢复或逐项图搜判定，不达到5件就停止；发布当前generation结果 |
| prepareListingDrafts / stepPrepareListingDrafts | 按当前confirmed集合协调草稿；补标题、保留或提示类目缺失；原子提交复核bundle，禁止无条件提前复用旧文件 |
| reviewPeerListings / stepReviewPeerListings | 读取当前bundle；仅当前revision已完成才能返回review_completed，否则根据pending/needs_input/ready_to_submit/submitting/needs_reconciliation阻塞；提交由显式操作接口触发 |
| peerProductReport / stepPeerProductReport | 输出当前选择、失败/未知原因及账本结果；仅在复核完成或明确无结果终态后产出最终报告 |

步骤返回 manual_action_required 时包含 manualAction.userMessage、resumeStep 和来源平台。暂停/取消通过既有 runtime/store 控制接口检查；店铺/商品循环前后均检查，runner 负责 runtime.json 的终态。暂停中途返回 stepIncomplete:true，继续恢复当前步骤。已完成、失败、取消任务的重复停止请求返回已有终态，不制造永久 cancelling。

### 版本过滤的参考决策函数

用于单元测试的最小纯函数；generation 指针切换、写锁及提交幂等必须另做存储集成测试。

```js
/**
 * 选取当前商品集合的有效验证记录。
 * @param {object[]} products 当前manifest中的商品。
 * @param {object[]} rows 按落盘顺序排列的历史验证。
 * @param {object} config 当前搜索及判定指纹。
 * @param {number} now 本次决策时间戳（毫秒）。
 * @returns {object[]} 每个商品最多一条当前结果。
 */
function selectCurrentImageResults(products, rows, config, now = Date.now()) {
  if (!config.searchConfigHash || !config.judgeConfigHash) {
    throw new Error('缺少当前验证指纹，禁止读取历史判定作为当前结果');
  }
  const current = new Map(products.map(p => [p.productKey, p.snapshotRevision]));
  const latest = new Map();
  for (const row of rows) {
    if (!current.has(row.productKey) ||
        !row.snapshotRevision || row.snapshotRevision !== current.get(row.productKey) ||
        row.searchConfigHash !== config.searchConfigHash ||
        row.judgeConfigHash !== config.judgeConfigHash) continue;
    latest.set(row.productKey, row);
  }
  // 先取最新记录再检查期限，禁止最新记录过期后回退旧confirmed。
  return [...latest.values()].filter(row =>
    Number.isFinite(row.observedAt) && Number.isFinite(row.expiresAt) &&
    row.observedAt <= now && row.expiresAt > row.observedAt && now < row.expiresAt);
}

/**
 * 计算当前草稿成员及需刷新输入的键，不修改提交账本。
 * @param {object[]} candidates 当前confirmed生成的候选草稿，键已按offer/SKU去重。
 * @param {object[]} existing 旧活动草稿。
 * @returns {object} 当前成员、移除项、需重新生成或确认项。
 */
function planDraftRefresh(candidates, existing) {
  const old = new Map(existing.map(d => [d.draftKey, d]));
  const keys = new Set(candidates.map(c => c.draftKey));
  return {
    activeKeys: [...keys],
    removedKeys: existing.filter(d => !keys.has(d.draftKey)).map(d => d.draftKey),
    refreshKeys: candidates.filter(c => {
      const d = old.get(c.draftKey);
      return !d || d.inputRevision !== c.inputRevision || Boolean(d.titleError);
    }).map(c => c.draftKey)
  };
}
```

### 5.1 Runner 集成

步骤数组与getPeerSteps只在一处实现，Runner/画布均引用，文档重复展示仅说明接入位置。恢复必须使用运行中持久化的标准化params，不接受更换分支。no_products_found/no_confirmed_sources注册为正常无结果终态；采集或验证未完成且不能确定结果时用manual_action_required，不伪装无结果。

在 `runner.js` 中新增:
```js
const PEER_DISCOVERY_STEPS = ['extractSources', 'findSimilarProducts', 'evaluateShops', 'peerReport'];
const PEER_IMAGE_SELECTION_STEPS = [
  'extractSources', 'findSimilarProducts', 'collectPeerProducts',
  'verifyImageSources', 'prepareListingDrafts', 'reviewPeerListings', 'peerProductReport'
];
function getPeerSteps(params) {
  return params.discoveryBranch === 'image-selection'
    ? PEER_IMAGE_SELECTION_STEPS : PEER_DISCOVERY_STEPS;
}

// 在 mode-to-steps 映射中添加:
if (mode === 'peer-discovery') steps = getPeerSteps(params);

// 注册新的停止状态（加入 STOP_STATUSES 集合）:
// 'no_products_found'      — 所有候选店铺均无付款达标商品，终止流水线
// 'no_confirmed_sources'   — 完整有效验证后确定无confirmed且无在途/待核对提交，终止并附原因摘要
// 'review_completed'       — 铺货复核已完成，继续到报告节点（非停止状态，是正常继续）
// 不依赖runner尚未支持的stopPipeline标志。无结果步骤先写原因报告再返回停止状态。

// 在 createDefaultStepFns 中添加:
const peerDiscovery = require('../../peer-discovery');
// 原分支:
// extractSources → peerDiscovery.stepExtractSources
// findSimilarProducts → peerDiscovery.stepFindSimilar
// evaluateShops → peerDiscovery.stepEvaluateShops
// peerReport → peerDiscovery.stepPeerReport
// 图搜分支:
// collectPeerProducts → peerDiscovery.stepCollectPeerProducts
// verifyImageSources → peerDiscovery.stepVerifyImageSources
// prepareListingDrafts → peerDiscovery.stepPrepareListingDrafts
// reviewPeerListings → peerDiscovery.stepReviewPeerListings
// peerProductReport → peerDiscovery.stepPeerProductReport
```

### 5.2 run-store 扩展

在 `initRun` 的 files 初始化中添加 peer-discovery 专用文件路径:
```js
// 共享文件（两个分支都用）
peerInput: path.join(runDir, 'peer-input.json'),
sourceProducts: path.join(runDir, 'source-products.jsonl'),
similarProducts: path.join(runDir, 'similar-products.jsonl'),
candidateShops: path.join(runDir, 'candidate-shops.jsonl'),

// 原分支 (peer-analysis) 专用
shopEvaluations: path.join(runDir, 'shop-evaluations.jsonl'),
sourcingDetails: path.join(runDir, 'sourcing-details.jsonl'),
peerDiscoveryResult: path.join(runDir, 'peer-discovery-result.json'),

// 图搜分支 (image-selection) 专用
peerProducts: path.join(runDir, 'peer-products.jsonl'), // manifest派生视图，不作为权威输入
peerSnapshotManifest: path.join(runDir, 'peer-snapshot-manifest.json'),
peerSnapshotsDir: path.join(runDir, 'peer-snapshots'), // 不可变店铺快照
peerReviewPointer: path.join(runDir, 'peer-review-current.json'), // 指向完整复核bundle
peerReviewBundlesDir: path.join(runDir, 'peer-review-bundles'),
peerAllocationPlan: path.join(runDir, 'peer-allocation-plan.json'), // 不可变分配计划
peerSubmissionLedger: path.join(runDir, 'peer-submissions.jsonl'), // 独立提交/核对账本
imageSourcingResults: path.join(runDir, 'image-sourcing-results.jsonl'),
imageSourcingCache: path.join(runDir, 'image-sourcing-cache.jsonl'),  // 原始图搜结果缓存
imageSelectionState: path.join(runDir, 'image-selection-state.json'), // 图搜分支断点续跑检查点
similarFinderState: path.join(runDir, 'similar-finder-state.json'),   // N3 断点续跑检查点
peerListingDrafts: path.join(runDir, 'peer-listing-drafts.jsonl'), // 仅导出视图，动作读取bundle
peerProductResult: path.join(runDir, 'peer-product-result.json'),
```

### 5.3 CLI 入口

在 `bin/cli.js` 中新增命令。Commander 的 kebab-case 选项名会自动转为 camelCase 属性名，但 `--max-shops` → `opts.maxShops` 与下游的 `maxCandidateShops` 不一致，需要显式映射。同时所有数值参数需要解析和范围校验：

```js
program
  .command('discover-peers')
  .option('--discovery-branch <branch>', 'peer-analysis 或 image-selection', 'peer-analysis')
  .option('--image-price-ratio-threshold <ratio>', '图搜分支严格价格比上限，默认1', '1')
  .description('以货找店：从淘宝商品链接发现同行店铺')
  .requiredOption('-l, --links <links>', '淘宝商品链接（逗号分隔或文件路径）')
  .option('--min-products <n>', '达标商品数量闸门', '10')
  .option('--min-sourcing <n>', '有货源商品数量闸门', '5')
  .option('--min-payment <n>', '付款人数下界', '10')
  .option('--similarity-threshold <n>', '标题相似度阈值', '0.45')
  .option('--price-ratio-threshold <n>', '价格比阈值', '0.7')
  .option('--max-shops <n>', '候选店铺上限', '30')
  .option('--search-max-products <n>', '1688搜索每页商品数', '10')
  .option('--search-max-pages <n>', '1688搜索最大页数', '1')
  .option('--collect-limit <n>', '单店采集上限（10-50件，最多滚动3次，不保证采满）', '40')
  .option('--port <n>', 'Chrome CDP 端口', '9222')
  .option('--evidence-max-age-ms <ms>', '图搜分支证据有效期（毫秒，默认86400000=24h）')
  .option('--allocation-method <method>', '多店铺分配方式: sequential/random-average/random/duplicate', 'sequential')
  .option('--json', '仅输出 JSON')
  .action(async (opts) => {
    // 直接传 Commander 原始值（字符串），由 normalizePeerDiscoveryParams 统一转换
    // 不在此处做 parseInt/parseFloat，确保 CLI 和 MCP 经过完全相同的标准化路径
    const params = normalizePeerDiscoveryParams({
      discoveryBranch: opts.discoveryBranch,
      imagePriceRatioThreshold: opts.imagePriceRatioThreshold,
      links: opts.links,
      minProducts: opts.minProducts,
      minSourcing: opts.minSourcing,
      minPayment: opts.minPayment,
      similarityThreshold: opts.similarityThreshold,
      priceRatioThreshold: opts.priceRatioThreshold,
      maxShops: opts.maxShops,           // normalizePeerDiscoveryParams 内部映射为 maxCandidateShops
      searchMaxProducts: opts.searchMaxProducts,
      searchMaxPages: opts.searchMaxPages,
      collectLimit: opts.collectLimit,
      port: opts.port,
      evidenceMaxAgeMs: opts.evidenceMaxAgeMs,
      allocationMethod: opts.allocationMethod
    });
    const result = await runPipelineRuntime({ mode: 'peer-discovery', params });
    if (opts.json) console.log(JSON.stringify(result));
  });

/**
 * 统一参数校验和默认值填充（CLI 和 MCP 共用）
 * 入口不做 parseInt/parseFloat，全部由此函数统一处理，确保 CLI 和 MCP 行为一致。
 *
 * 完整参数契约（标准化后的字段 → 下游消费方）：
 *   links              → stepExtractSources / input-parser
 *   minProducts        → collectQualifiedProducts / applyShopVerdict
 *   minSourcing        → applyShopVerdict / 提前终止优化
 *   minPayment         → collectQualifiedProducts 过滤
 *   similarityThreshold → matchSourcing / hashJudgeConfig
 *   priceRatioThreshold → matchSourcing / hashJudgeConfig
 *   maxCandidateShops  → findSimilarProducts 截断
 *   collectLimit       → collectQualifiedProducts 采集上限
 *   searchMaxProducts  → matchSourcing → searchWeb1688 / hashSearchConfig
 *   searchMaxPages     → matchSourcing → searchWeb1688 / hashSearchConfig
 *   port               → matchSourcing → searchWeb1688 / hashSearchConfig
 *   evidenceMaxAgeMs   → 图搜分支证据有效期（毫秒），仅 image-selection 分支使用
 *   allocationMethod   → 多店铺分配方式，仅 image-selection 分支使用
 *
 * @param {object} raw - 原始参数（可能含字符串、undefined、越界值、小数）
 * @returns {object} 标准化后的参数
 * @throws {Error} 采集上限或数量门槛越界、门槛超过采集能力时拒绝启动。
 */
function normalizePeerDiscoveryParams(raw) {
  const discoveryBranch = raw.discoveryBranch ?? 'peer-analysis';
  if (!['peer-analysis', 'image-selection'].includes(discoveryBranch)) {
    throw new Error('未知的同行发现分支');
  }
  // 严格规范化图搜价格比例：统一为标准十进制字符串（最多6位小数，与 belowImagePriceRatio 严格比较契约完全对齐）
  let ratioStr;
  const ratioInput = raw.imagePriceRatioThreshold;
  if (ratioInput == null || (typeof ratioInput === 'string' && ratioInput.trim() === '')) {
    ratioStr = '1';
  } else if (typeof ratioInput === 'number') {
    if (!Number.isFinite(ratioInput) || ratioInput <= 0) {
      throw new Error('图搜价格比例必须为有限且大于0的数值');
    }
    ratioStr = String(ratioInput);
  } else if (typeof ratioInput === 'string') {
    ratioStr = ratioInput.trim();
  } else {
    throw new Error('图搜价格比例必须为数字或标准十进制文本');
  }
  // 严格十进制格式校验：必须匹配 ^\d+(?:\.\d{1,6})?$，拒绝科学计数法 (如 1e-7) 或超精度数值 (如 0.1234567)
  if (!/^\d+(?:\.\d{1,6})?$/.test(ratioStr)) {
    throw new Error(`图搜价格比例格式非法: ${ratioInput}。必须为标准十进制正数，且最多支持6位小数，拒绝科学计数法与超精度数值`);
  }
  const [whole, fraction = ''] = ratioStr.split('.');
  if (BigInt(whole + fraction) <= 0n) {
    throw new Error(`图搜价格比例必须大于0: ${ratioInput}`);
  }
  const imagePriceRatioThreshold = ratioStr;
  // 整数校验：解析 → 取整 → 范围限制
  const clampInt = (v, min, max, def) => {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n)) return def;
    return Math.max(min, Math.min(max, n));
  };
  // 浮点校验：解析 → 范围限制（保留精度）
  const clampFloat = (v, min, max, def) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.max(min, Math.min(max, n));
  };
  // 与现有 collector 的50件上限对齐；拒绝不可实现的要求，不悄悄降低用户门槛。
  const boundedCount = (key, min, max, def) => {
    const value = raw[key] === undefined ? def : Math.floor(Number(raw[key]));
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new Error(`${key} 必须在 ${min}-${max} 之间`);
    }
    return value;
  };
  const collectLimit = boundedCount('collectLimit', 10, 50, 40);
  const minProducts = boundedCount('minProducts', 1, 50, 10);
  const minSourcing = boundedCount('minSourcing', 1, 50, 5);
  if (discoveryBranch === 'peer-analysis' && (minProducts > collectLimit || minSourcing > collectLimit)) {
    throw new Error('商品数量门槛和货源数量门槛均不能超过单店采集上限 collectLimit');
  }
  return {
    links: raw.links,
    discoveryBranch,
    imagePriceRatioThreshold,
    // 判定参数（浮点）
    similarityThreshold: clampFloat(raw.similarityThreshold, 0, 1, 0.45),
    priceRatioThreshold: clampFloat(raw.priceRatioThreshold, 0, 10, 0.7),
    // 数量闸门（整数）
    minProducts,
    minSourcing,
    minPayment: clampInt(raw.minPayment, 0, 10000, 10),
    // 候选店铺上限（整数）
    maxCandidateShops: clampInt(raw.maxCandidateShops ?? raw.maxShops, 1, 100, 30),
    // 采集配置（整数）
    collectLimit,
    // 搜索配置（整数）
    searchMaxProducts: clampInt(raw.searchMaxProducts, 1, 50, 10),
    searchMaxPages: clampInt(raw.searchMaxPages, 1, 10, 1),
    // 浏览器端口（整数）
    port: clampInt(raw.port, 1, 65535, 9222),
    // 图搜分支专用：证据有效期（毫秒，安全正整数，默认 24 小时）
    evidenceMaxAgeMs: (() => {
      const v = raw.evidenceMaxAgeMs;
      if (v == null || (typeof v === 'string' && v.trim() === '')) {
        return 24 * 60 * 60 * 1000; // 默认 24h (86,400,000ms)
      }
      // 严格类型校验：拒绝 boolean（防止 true 隐式转为 1ms）、数组、对象等
      if (typeof v !== 'number' && typeof v !== 'string') {
        throw new Error('evidenceMaxAgeMs 必须为正整数（毫秒）');
      }
      // 若为字符串，必须是纯数字字符构成的正整数，严禁包含小数或科学计数法
      if (typeof v === 'string' && !/^\d+$/.test(v.trim())) {
        throw new Error(`evidenceMaxAgeMs 格式非法: ${v}。必须为纯正整数字符串，禁止包含小数或科学计数法`);
      }
      const n = typeof v === 'number' ? v : Number(v.trim());
      // 必须为大于0的安全整数（拒绝 1.9 等浮点数，不自动取整）
      if (!Number.isSafeInteger(n) || n <= 0) {
        throw new Error(`evidenceMaxAgeMs 必须为大于0的安全整数（毫秒）: ${v}`);
      }
      return n;
    })(),
    // 图搜分支专用：多店铺分配方式
    allocationMethod: (() => {
      const v = raw.allocationMethod ?? 'sequential';
      if (!['sequential', 'random-average', 'random', 'duplicate'].includes(v)) {
        throw new Error(`未知的分配方式: ${v}，可选: sequential, random-average, random, duplicate`);
      }
      return v;
    })()
  };
}
```

**关键设计决策**：
- CLI 入口**不做** `parseInt`/`parseFloat`，直接传字符串给 `normalizePeerDiscoveryParams`，由标准化层统一转换
- MCP 入口传 number，同样经过标准化层（`Math.floor(Number(v))` 对已是整数的 number 无副作用）
- 两个入口最终产出完全相同的标准化参数对象
- `collectLimit` 和 `port` 纳入标准化，确保指纹计算和实际执行使用同一份值
- CLI 和 MCP 均暴露 collectLimit、port；单店采集上限为10-50件，默认40件。沿用采集器最多滚动3次的能力，上限不是采集数量保证；无法确认末页时仍标记 uncertain。
- minProducts、minSourcing 范围为1-50，且不能超过 collectLimit；非法组合在启动运行、访问平台前报错，不自动降低门槛。不要求 minSourcing <= minProducts，因为 minProducts 是最低门槛而非验证数量上限。

**参数入口回归要求**：默认值40/9222；CLI `--collect-limit 50 --port 9333` 与 MCP 同值参数得到相同配置；collectLimit=200、minProducts=100，以及collectLimit=20/minProducts=30、collectLimit=20/minSourcing=30均拒绝启动。合法配置的指纹使用标准化后的实际参数。

### 5.4 MCP 工具

异步任务启动须先初始化业务run和runtime状态，再返回taskId；后台失败记录runtime failed及错误原因，不只写console。不存在的taskId返回明确not_found，禁止创建幽灵控制文件。后台进程重启后标记遗留running为interrupted并要求恢复，不宣称任务仍在执行。状态/取消接口按discoveryBranch读取对应manifest或店铺结果，不能用同行店铺统计冒充图搜商品进度。以下查询示例展示原分支，图搜分支使用§5的当前generation和提交账本，返回商品验证数、草稿数及铺货结果。

在 `bin/mcp-server.mjs` 中注册（异步模式，与 Issue K 一致）:
状态查询复用 `skills/pipeline-flow/runtime/store.js` 的 `readRuntimeState`、`readRuntimeControl`。运行生命周期以 `runtime.json` 为唯一来源，`run.json` 仅提供业务产物索引，不再由评估器写入取消终态。

**新增启动协调器契约（下例helper为待实现接口，不是现有导出）**：
- `initializePeerTask(params)`先分配唯一ID，在未发布目录写入业务run、空产物索引、runtime queued及步骤数组；完成后原子发布任务目录。初始化失败直接抛错，不返回taskId/started，不启动平台请求；未发布目录仅由启动恢复清理，不可查询。
- `enqueuePeerTask(task)`等待进程内执行队列接收后返回；后台执行读取已初始化任务，不重建run、不清空已有暂停/取消信号。队列接收失败在已发布runtime写failed，返回该任务failed而非started。接收前后的进程崩溃由重启扫描将遗留queued/running标记interrupted，提供恢复入口。
- 执行器持有run锁，调用接入peer-discovery模式后的runner及getPeerSteps；初始化/执行须拆分，不能直接沿用会重新初始化或清空控制信号的旧runner路径。执行前后检查控制信号。浏览器检查使用真实预检，不注入无条件browser_ready。
- 后台失败由队列supervisor写已存在runtime的failed（终态条件更新，不能覆盖completed/cancelled）。存储写失败须保留进程内故障记录并使查询返回state_persistence_error，健康检查报警；不能吞错伪装running，重启按interrupted恢复。
- `requirePublishedPeerTask(taskId)`仅查已发布任务，不创建目录，校验ID及路径；不存在返回not_found，索引/runtime损坏返回state_corrupt，不伪造queued。以下错误由MCP统一转换为isError响应。
- `readPeerTaskStatus(task)`按分支读取§5当前manifest/账本或原分支当前候选集与指纹；指纹缺失显示待评估，不把所有历史记录当作匹配。返回状态及失败原因，不以控制文件覆盖已确认终态。
- `requestPeerTaskCancel(taskId)`在同一run锁内核实存在性、终态及控制版本后原子更新。无执行器的queued/暂停任务可直接确认cancelled；在途任务仅请求取消并由执行器确认。不可用fs.writeFileSync覆盖控制文件，与完成并发遵循条件更新。
```js
// 启动任务：返回 taskId，不阻塞等待整个流程
server.tool('discover_peers', '以货找店：从淘宝商品链接发现同行店铺（异步，返回 taskId）', {
  discoveryBranch: z.enum(['peer-analysis', 'image-selection']).optional().default('peer-analysis'),
  imagePriceRatioThreshold: z.union([z.number(), z.string()]).optional().default('1').describe('图搜分支价格比例阈值（严格小于判定，最多6位小数的正十进制数，如 1 或 0.8）'),
  links: z.string().describe('淘宝商品链接，逗号分隔'),
  minProducts: z.number().optional().default(10),
  minSourcing: z.number().optional().default(5),
  minPayment: z.number().optional().default(10),
  similarityThreshold: z.number().optional().default(0.45),
  priceRatioThreshold: z.number().optional().default(0.7),
  maxCandidateShops: z.number().optional().default(30),
  searchMaxProducts: z.number().optional().default(10),
  searchMaxPages: z.number().optional().default(1),
  collectLimit: z.number().optional().default(40).describe('单店采集上限10-50件，最多滚动3次，不保证采满'),
  port: z.number().optional().default(9222).describe('Chrome CDP 端口'),
  evidenceMaxAgeMs: z.union([z.number(), z.string()]).optional().default(86400000).describe('图搜分支证据有效期（安全正整数，单位毫秒，默认24h）'),
  allocationMethod: z.enum(['sequential', 'random-average', 'random', 'duplicate']).optional().default('sequential').describe('多店铺分配方式')
}, async ({ links, ...rawParams }) => {
  const params = normalizePeerDiscoveryParams({ links, ...rawParams });
  const task = await initializePeerTask(params);
  await enqueuePeerTask(task); // 仅等待队列接收，不等待业务执行；失败按协调器契约记录
  const snapshot = await readPeerTaskStatus(task);
  return { content: [{ type: 'text', text: JSON.stringify(snapshot) }] };
});

// 查询进度：协调器按分支和当前版本汇总，不直接统计追加日志。
server.tool('get_peer_discovery_status', '查询同行发现任务进度', {
  taskId: z.string().describe('discover_peers 返回的任务 ID')
}, async ({ taskId }) => {
  const task = await requirePublishedPeerTask(taskId);
  const snapshot = await readPeerTaskStatus(task);
  return { content: [{ type: 'text', text: JSON.stringify(snapshot) }] };
});

// 取消任务：写入取消信号到控制文件，返回 cancelling
// 完整路径：MCP 写入信号 → 停止循环并返回 → runner 写 runtime.json 终态 → 查询确认
server.tool('cancel_peer_discovery', '取消运行中的同行发现任务', {
  taskId: z.string().describe('要取消的任务 ID')
}, async ({ taskId }) => {
  // 写入取消信号到 runtime-control.json（与 pause 共用文件，通过 requestedAction 区分）
  const snapshot = await requestPeerTaskCancel(taskId);
  return { content: [{ type: 'text', text: JSON.stringify(snapshot) }] };
});

// 取消信号的目标消费路径（实施时按协调器契约接入，尚未实现）：
// 1. MCP cancel_peer_discovery 写入 runtime-control.json { requestedAction: 'cancel' }
// 2. evaluateAllShops 每个店铺评估前调用 shouldCancel() 读取控制文件
// 3. 检测到 cancel → 保存当前进度 → return { status: 'cancelled' }，由 runner 写 runtime.json 终态
// 4. stepEvaluateShops 检测 result.status === 'cancelled' → 透传，不继续执行 peerReport 节点
// 5. 查询接口读取 runtime.json；最后一家执行期间取消或零候选时，由 runner 节点返回后的控制检查确认取消。
// 6. 取消与完成并发时以 runner 最终状态为准；终态优先于遗留控制信号，已结束任务不会永久显示 cancelling。
```

**取消边界回归要求**：
- 初始化写入任一步失败：启动返回错误，不入队、不返回started；未发布目录不可查询。成功返回taskId后立即查询，业务run及runtime均存在。
- 入队失败：已发布任务标记failed并返回明确错误；后台抛错记录失败原因；终态写入失败查询返回state_persistence_error，不吞错。
- 初始化发布后、入队前、开始执行前分别注入崩溃：重启识别遗留任务为interrupted，恢复不重新创建run或清空已确认控制信号。
- 不存在taskId的查询/取消均not_found且不创建文件；状态损坏返回state_corrupt，不伪造queued。排队期间取消后执行器不得启动平台操作。
- 最后一家店铺执行期间取消：runner 在节点返回后检查信号，不执行报告，查询最终返回 cancelled。
- 零候选时取消：仍执行 runner 的节点返回后检查，不依赖店铺循环存在。
- 已 completed/failed/cancelled 的任务再次取消：返回原终态，不改写控制文件。
- 运行中已发出取消但尚未停止：查询返回 cancelling；不得提前返回 cancelled。
- 完成与取消并发：以 runner 已确认的终态为准，查询忽略遗留取消信号；断言不会永久停留 cancelling。

---

## 6. 前端 Workflow 集成

### 6.1 Pipeline Template

此节原模板仅适用于 discoveryBranch=peer-analysis。image-selection 模板按 getPeerSteps 的7步生成画布，不复用 evaluateShops 节点。启动配置新增“任务目标”单选（同行发现/图搜选货）；图搜分支显示比例输入，默认100%，提交前除以100传 imagePriceRatioThreshold，隐藏店铺数量门槛。原分支保持原参数。复核节点提供打开清单、补全并保存、重试标题、确认铺货及人工完成动作，沿用既有提交确认和取消机制。

在 `core/workflow/pipeline-templates.js` 中新增:
```js
if (mode === 'peer-discovery') {
  return {
    id: 'peer-discovery-v1',
    mode: 'peer-discovery',
    name: '同行发现（以货找店）',
    nodes: [
      { id: 'start', type: 'production-start', data: { label: '导入商品链接', competitorConfig: true } },
      { id: 'extractSources', type: 'pipeline-extract-sources', data: { label: '提取源商品', description: '打开商品页提取主图、标题、价格' } },
      { id: 'findSimilarProducts', type: 'pipeline-find-similar', data: { label: '图搜找同款', description: '以主图搜索淘宝同款商品' } },
      { id: 'evaluateShops', type: 'pipeline-evaluate-shops', data: { label: '逐店评估', description: '采集销量榜、验证1688货源、判定同行' } },
      { id: 'peerReport', type: 'pipeline-peer-report', data: { label: '生成报告', description: '输出同行店铺清单和Excel报告', peerDownload: true } },
      { id: 'end', type: 'production-end', data: { label: '完成', description: '查看同行店铺清单', peerDownload: true } }
    ],
    edges: [
      ['start', 'extractSources'],
      ['extractSources', 'findSimilarProducts'],
      ['findSimilarProducts', 'evaluateShops'],
      ['evaluateShops', 'peerReport'],
      ['peerReport', 'end']
    ].map(([s, t]) => ({ id: `${s}-${t}`, source: s, target: t }))
  };
}
```

### 6.2 Node State Mapping

在 `core/workflow/pipeline-node-state.js` 中添加 peer-discovery 节点的状态映射。

### 6.3 Artifact View

在 `apps/web/src/features/workflow/artifact-view.js` 的 `ARTIFACT_HANDLERS` 中添加:
- `extractSources`: 显示源商品列表（标题、价格、主图缩略图）
- `findSimilarProducts`: 显示候选店铺列表（店铺名、同款数量）
- `evaluateShops`: 显示评估结果（合格/跳过/错误，达标商品数，有货源数）
- `peerReport`: 显示最终报告下载链接

---

## 7. 测试策略

### 7.1 单元测试（M1，不依赖外部平台）

**sourcing-matcher.test.js**（四级判定: confirmed/suspected/rejected/inconclusive）:
| 用例 | 输入 | 预期 |
|------|------|------|
| 标题相似度 | "纯银项链女" vs "纯银锁骨链女款" | Jaccard ≥ 0.45 |
| 标题相似度 | "手机壳" vs "连衣裙" | Jaccard < 0.45 |
| confirmed | 相似度 0.6 + 单件价 6.8 + 淘宝价 29.9 + 规格一致 | level=confirmed, ratio=0.23 |
| confirmed | 相似度 0.6 + minOrderQty=1 + 非阶梯价 minPrice 6.8 + 淘宝价 29.9 + 规格一致 | level=confirmed |
| rejected(价格) | 相似度 0.6 + 单件价 25.0 + 淘宝价 29.9 | level=rejected (price_too_high, ratio=0.84) |
| rejected(相似度) | 相似度 0.3 + 单件价 6.8 + 淘宝价 29.9 | level=rejected (low_similarity) |
| suspected(规格未知) | 相似度 0.6 + 单件价 6.8 + 淘宝价 29.9 + specStatus=unknown | level=suspected (spec_unknown) |
| rejected(规格不一致) | 相似度 0.6 + 单件价 6.8 + 淘宝价 29.9 + specStatus=inconsistent（如纯银 vs 不锈钢） | level=rejected, reason=spec_mismatch（非 price_too_high） |
| rejected(规格+价格) | 2个候选：一个 specStatus=inconsistent，一个 ratio=0.84 | level=rejected, reason=spec_mismatch_and_price_too_high |
| inconclusive(起订量未知) | 相似度 0.6 + minOrderQuantity=null + 淘宝价 29.9 | level=inconclusive (min_order_qty_unknown) |
| inconclusive(阶梯价) | 相似度 0.6 + minOrderQty=1 + 阶梯价 + 淘宝价 29.9 | level=inconclusive (tiered_price_not_comparable) |
| inconclusive(无价格) | 相似度 0.6 + 淘宝价=null | level=inconclusive (missing_taobao_price) |
| inconclusive(无结果) | 1688 搜索 products=[] | level=inconclusive (no_1688_result) |
| inconclusive(全不可比) | 相似度 0.6 + 所有候选 minOrderQty>1 且无 singlePiecePrice | level=inconclusive (no_single_piece_price)，由 suspected 分支返回（非 all_candidates_incomparable） |
| 平台异常透传 | searchWeb1688 抛出 captcha_required | throw（不吞掉，由外层触发 blocked） |
| 平台异常透传 | searchWeb1688 返回 ok:false, status=login_required | throw |
| 多条结果 | 3条中1条 confirmed + 1条 suspected + 1条 rejected | level=confirmed, 取相似度最高 |
| 价格超标不进 suspected | 相似度 0.6 + 单件价 25.0(ratio=0.84) + 规格未知 | level=rejected（价格已超标，不因规格未知进 suspected） |
| parsePaymentSignal | "500+人付款" | { value: 500, hasSignal: true } |
| parsePaymentSignal | "不足10人付款" | { value: 0, hasSignal: true }（有信号但值为0，minPayment=0时通过） |
| parsePaymentSignal | "10+人付款" | { value: 10, hasSignal: true } |
| parsePaymentSignal | "1.5万人付款" | { value: 15000, hasSignal: true } |
| parsePaymentSignal | "100-200人付款" | { value: 100, hasSignal: true }（取下界） |
| parsePaymentSignal | "" / null | { value: 0, hasSignal: false }（无信号，任何minPayment都不通过） |
| parsePaymentSignal | "月销 500" | { value: 0, hasSignal: false }（非"人付款"格式） |
| 汇总: qualified | C=5, S=2, I=1, U=0, completeness=reached_end | verdict=qualified |
| 汇总: unqualified | C=2, S=1, I=0, R=7, U=0, completeness=reached_end | verdict=unqualified（C+S+I=3<5 且采集完整） |
| 汇总: inconclusive(未验证) | C=4, S=0, I=0, U=16, completeness=uncertain | verdict=inconclusive（U>0 不能断定不足） |
| 汇总: inconclusive(采集不完整) | C=2, S=1, I=0, U=0, completeness=uncertain | verdict=inconclusive（采集不完整不能判 unqualified） |

**shop-evaluator.test.js**: 用 mock client 测试 collectQualifiedProducts（含 collectionCompleteness 三态、提前终止统计）和 applyShopVerdict（含 collectionCompleteness 参数）。

**恢复与节点编排回归用例**：
- 店铺已采完整但商品不足：记录包含 configHash，按相同配置恢复不再采集该店。
- 第一家合格、第二家遇到验证码：stepEvaluateShops 返回 manual_action_required，保留已得结果、阻塞原因及 resumeStep，不执行报告节点。
- 全部正常完成且无合格店铺：返回 no_qualified_peers；不能与平台阻塞混淆。
- 同时有价格不可比候选和价格达标但规格未知候选：返回 suspected；全部价格不可比才返回对应原因的 inconclusive。

**normalizeCard 扩展测试**（前置任务）:
| 用例 | 输入 cardText | 预期 |
|------|-------------|------|
| 起订量提取 | "¥6.80 1件起批" | minOrderQuantity=1 |
| 起订量提取 | "¥5.00 2件起批" | minOrderQuantity=2 |
| 起订量缺失 | "¥6.80" | minOrderQuantity=null |
| 单件价格 | 卡片有明确单价且无阶梯 | singlePiecePrice=对应值 |
| 阶梯价 | 卡片显示多档价格 | singlePiecePrice=null, priceBand.prices.length>1 |

### 7.2 图搜分支单元测试（image-sourcing-matcher.test.js）

| 用例 | 输入 | 预期 |
|------|------|------|
| 严格小于-通过 | 淘宝 29.9, 1688 可比价 29.89, 阈值 1 | confirmed（29.89/29.9 = 0.9997 < 1） |
| 严格小于-边界不通过 | 淘宝 29.9, 1688 可比价 29.9, 阈值 1 | rejected/inconclusive（29.9/29.9 = 1.0 不 < 1） |
| 严格小于-不通过 | 淘宝 29.9, 1688 可比价 30.0, 阈值 1 | rejected |
| 自定义比例-通过 | 淘宝 100, 1688 可比价 79.99, 阈值 0.8 | confirmed（0.7999 < 0.8） |
| 自定义比例-边界不通过 | 淘宝 100, 1688 可比价 80.0, 阈值 0.8 | rejected（0.8 不 < 0.8） |
| 十进制精度 | 淘宝 0.1+0.2=0.3 场景的价格比 | 不因浮点误差误判 |
| 规格冲突 | specStatus=inconsistent | 不进 confirmed，归 rejected(spec_mismatch) |
| 无图 | product.imageUrl=null | inconclusive(missing_image)，不静默替换为文字搜索 |
| 图搜无结果 | 1688 图搜返回空 | inconclusive(no_image_result) |
| 平台阻塞 | 1688 验证码/登录 | throw，platform='1688' |
| 多候选货源 | 同一商品 3 个 confirmed 货源 | 全部保留，推荐相似度最高的 |
| 去重 | 两个源商品匹配到同一 1688 offerId | 按 offerId+规格去重，保留来源关系 |

**listing-draft-preparer.test.js**:
| 用例 | 输入 | 预期 |
|------|------|------|
| 标题生成成功 | confirmed 货源 + 匹配词 | 草稿含铺货标题 |
| 标题生成失败 | LLM 超时 | 草稿标记 titleError，可单独重试 |
| 类目预填 | 有生意参谋推荐 | 草稿含待确认类目 |
| 类目缺失 | 无推荐 | 草稿类目为空，needs_input=true |
| 部分失败重试 | 5 件中 2 件标题失败 | 只重试 2 件，不重跑图搜 |

**peer-listing-adapter.test.js**（必须使用既有铺货服务的真实输入契约 fixture）:
| 用例 | 输入 | 预期 |
|------|------|------|
| 正常转换 | 完整草稿 | 适配器输出符合铺货服务 schema |
| 缺标题 | 草稿无标题 | 该项标记 incomplete，不提交 |
| 缺类目 | 草稿无类目 | 该项标记 needs_input |
| 旧版本提交 | draftRevision 不匹配 | 服务端拒绝 |
| 已成功不重复 | 已确认成功的商品 | 跳过，不重复提交 |

### 7.3 集成测试（M2，模拟数据）

**版本与恢复必测矩阵（阻塞发布）**：
- 标题准备60项：默认在途LLM请求不超过3，平台采集仍串行；单项超时/降级不阻塞其他项，进度与逐项结果持续落盘，HTTP启动请求不等待整批。
- 标题调用预算含退避/重试；取消后不继续派发，实际请求可中止；人工修改后迟到的旧inputRevision结果不能覆盖编辑；重启仅补未完成项，不再次执行搜索链路。
- 1688图搜provider使用探针4脱敏fixture覆盖正常、空结果、不完整结果、字段缺失、登录/验证码/限流；只验证mock不算S0通过，禁止错误降级为文字检索。
- 使用真实distributionMode校验器验证单店调用模式sequential-average合法；targetShops须为服务端解析的对象快照而非ID，旧manual示例必须被拒绝，不修改共享options。
- 四种本地分配覆盖0件、商品少于店铺、非整除及重复分配；按店铺与batchSize拆批后，实际提交的商品/店铺对与确认计划完全一致，零商品不发请求。
- 同offer多个SKU证据只生成一个商品级提交；标题/类目冲突须人工解决；只铺指定SKU的请求被明确阻塞。重试部分失败时成功项不进入任何新子批，未知结果不重发。
- 子批排队时证据到期、店铺配置变化、暂停/取消：未发子批停止；已发子批继续可核对；核对必须使用原店铺快照、提交时间和商品集合，无法唯一匹配时保持unknown。
- 同商品重复分配到A/B店，A成功B明确失败：草稿保留，重试只调用B；B未知时只能核对，不能重发；A成功不能触发整体完成。
- 随机分配后中断恢复：读取相同allocationPlan，不重新抽签；两次并发确认只接收当前expectedPlanId；更换店铺不移动成功/未知项，旧计划未发项被取代。
- **本地分配与平台提交一致性**：4种分配方式各生成plan后，验证每批提交的offerId列表与plan中该targetShopId的明细完全一致；平台不做二次分配（每批仅指定单一店铺）；核对结果逐项匹配plan明细。
- **适配器绕过平台随机分配**：验证peer-listing-adapter调用铺货服务时不使用auto/random-average模式，而是按targetShopId拆批、每批指定单一店铺；既有服务的resolveDistributionMode不被触发为随机路径。
- 证据时间缺失、未来时间、恰好到期、过期恢复、刷新失败：均不允许自动提交，不回退历史confirmed；未到期且指纹一致才能复用。最新记录过期不得回退更旧的有效记录。
- 有效期内修改比例可复用证据；复核等待至过期后提交返回needs_refresh，刷新后revision变化且须重新确认；无有效confirmed但有未知提交仍可核对，不自动无结果完成。
- A/B原均confirmed，改比例后仅A通过且A标题无需重生：活动草稿必须只有A，revision变化、未提交选择清空；B的历史提交账本不删除。
- 全部confirmed变为零：旧活动bundle失效，生成无结果报告；旧弹窗提交返回版本冲突，不可自动铺货。
- 相同productKey的价格/规格/图片任一变化：旧判定不复用；仅比例变化复用原始图搜缓存并重新判定。
- 原始快照付款下界分别为5、20，minPayment从10改为3：不访问平台即可得到两件；调为30则为空，不保留旧商品。
- 重新采集店铺移除B或返回空快照：当前manifest不再引用B；旧日志即使confirmed也不得生成草稿。
- 图搜结果已落盘但检查点未写入时崩溃：恢复复用完整结果，平台调用不重复；只写部分结果时不标记完成。
- 发布新bundle前后分别崩溃：读者只能看到旧的完整bundle或新的完整bundle，不能新草稿配旧completed。
- 两次并发提交、提交与比例修改并发、平台成功后响应丢失：同一提交键最多一次外部提交，未知结果先核对，不能直接重发。
- completed对应旧revision、选中项为空、未选项缺类目：分别要求重新确认、禁止提交、不阻塞合法选中项。
- 最后一件/零候选时取消，平台错误与取消同时发生，进程重启后继续，均按runner状态协议处理；任何恢复不得把部分失败当作确定无货。
- 两个run并发使用淘宝客户端/CDP：会话锁避免跨任务导航干扰，同时不阻塞无关的本地标题处理。

文档纯函数测试只能验证选取与协调决策。上面事务、平台调用次数和原子性场景必须在实现阶段以真实存储适配器和注入故障测试完成，不能以mock成功返回替代。

用 fixture 数据跑完整流程:
- 准备 source-products.jsonl、similar-products.jsonl、candidate-shops.jsonl 的 fixture
- Mock TaobaoNativeClient 和 searchWeb1688
- 验证 run-store 落盘、断点续跑、最终输出格式
- **图搜分支**: Mock 1688 图搜 API，验证 collectPeerProducts → verifyImageSources → prepareListingDrafts 全链路
- **分支隔离**: 验证 peer-analysis 分支不调用 image-sourcing-matcher，image-selection 分支不调用 sourcing-matcher
- **比例修改后清单失效**: 修改 imagePriceRatioThreshold 后重跑，旧草稿标记失效，重新评估

### 7.4 端到端测试（M3，真实环境）

需要:
- 淘宝客户端已登录
- Chrome CDP 已启动（1688 搜索）
- 3 条已知有同款的淘宝商品链接

**原分支验收**:
- 产出 peer-discovery-result.json 和 Excel
- 每家同行店铺的 shopUrl 可访问
- 人工抽查 ≥ 5 条货源匹配

**图搜分支验收**（对应 §1.0 分支验收要求）:
- 覆盖默认比例 1 及自定义比例（如 0.8）的严格边界
- 缺失价格/批量价格/规格冲突/无图/图搜无结果/平台阻塞场景
- 去重：同源商品匹配到同一 1688 offer 时正确去重
- 取消恢复：中途取消后恢复，已完成商品不重复图搜
- 比例修改后清单失效：调整比例后旧待复核清单标记失效
- 原分支保持原行为不受影响
- JSON/Excel 与复核弹窗使用同一判定结果，显示本次比例及未通过原因
- 同店仅 3 件付款达标时图搜分支保留 3 件，原分支默认商品门槛仍不通过
- 前 5 件已确认后图搜仍验证剩余商品
- 标题失败后只重试标题，缺类目在弹窗保存后继续
- 旧草稿版本提交被拒绝，修改比例不重复提交成功商品

---

## 8. 里程碑与工作量估算

| 阶段 | 内容 | 新增文件 | 修改文件 | 预估工时 |
|------|------|---------|---------|---------|
| M0 | **前置**: normalizeCard 扩展 + 1688 图搜 API 探针 + 真实样本验证 | 0 | 1 (search-web-1688.js) | 1天 |
| M1 | sourcing-matcher.js + image-sourcing-matcher.js + 单元测试（原分支四级判定 + 图搜分支严格小于 + 十进制精度） | 3 | 0 | 1.5天 |
| M2 | 共享模块（source-extractor + similar-finder + shared-shop-collector）+ 原分支（shop-evaluator + peer-report-writer）+ index.js + run-store + runner 集成 + 集成测试 | 6 | 3 | 3天 |
| M2b | 图搜分支（listing-draft-preparer + peer-listing-adapter + peer-product-report-writer）+ 步骤函数 + 适配器测试（使用既有铺货服务真实契约 fixture） | 4 | 1 (index.js) | 2天 |
| M3 | 真实环境联调：原分支端到端 + 图搜分支端到端 + collectSortedShopProducts 返回 endReason + 1688 图搜联调 | 0-1 | 2 (search-taobao-image.js, collector.js) | 2-3天 |
| M4 | CLI + MCP + Excel 报告 + 前端 template（双分支画布）+ 复核弹窗 + artifact view | 2 | 4 | 2-3天 |

**总计: 11.5-13.5 天**（原分支 5-8 天 + 图搜分支增量 6.5 天，共享模块复用减少重复）

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 图搜结果不含店铺信息 | N3 无法聚合候选店铺 | S0 探针验证；缺失时降级为打开同款商品页解析店铺（复用 resolveCompetitorShop） |
| 1688 normalizeCard 缺少起订量/单件价格字段 | 所有商品 comparablePrice=null，无法得到 confirmed | **前置任务**：扩展 domExtractionExpression 和 normalizeCard 提取 minOrderQuantity/singlePiecePrice；S0 探针用真实样本验证字段可提取性；扩展前全部进入 suspected/inconclusive |
| 1688 平台故障（登录/验证码/限流） | 需要暂停流水线 | matchSourcing 和 enrichCompetitorProduct 中 isPlatformBlocker → throw 向外抛出；evaluateAllShops 捕获后返回 blocked 暂停；**不是"失败不阻断"** |
| 1688 普通搜索失败（超时/无结果） | 单个商品无法判定 | 标记 inconclusive，不影响其他商品继续评估 |
| 淘宝客户端中途掉线 | 运行中断 | isPlatformBlocker → throw → blocked 暂停；断点续跑（shop-eval-state.json）；恢复后从断点继续 |
| 采集不完整导致误判 | 只采到部分商品就判定整店不足 | collectionCompleteness 三态（reached_end/uncertain/interrupted）；只有 reached_end 才判 unqualified；其余判 inconclusive |
| 标题相似度阈值不准 | 误判同行/漏判 | 参数可配置；校准集/验收集分离；分项统计四项指标 |
| 运行时间过长（20-40分钟） | 用户体验 | 进度回调 + SSE 事件推送；断点续跑；原分支 confirmed 达标提前终止；图搜分支不提前终止（每件都验证） |
| 1688 图搜 API 不可用或字段不足 | 图搜分支无法判定货源 | M0 探针验证；不可用时图搜分支整体 blocked，不静默降级为文字搜索 |
| 十进制浮点精度导致边界误判 | 价格比等于阈值时被错误通过/拒绝 | 使用十进制定点运算或 decimal.js；测试覆盖 29.9/29.9=1.0 和 79.99/100=0.7999 边界 |
| 图搜分支与原分支规则混淆 | 用错价格比较运算符（<=vs<）或阈值 | 两个 matcher 独立模块、独立测试；代码注释标注分支归属；集成测试验证分支隔离 |
| 铺货适配器与既有服务契约不匹配 | 草稿无法提交到铺货复核 | 适配器测试必须使用既有服务的真实输入契约 fixture，不能仅验证独立 mock |
| 平台二次分配导致本地 plan 与实际不一致 | 按店铺重试/核对错误，随机分配不可复现 | 本地完成全部四种分配算法，按 targetShopId 拆批提交，每批指定单一店铺；适配器绕过平台的 auto/random-average 模式；集成测试验证 plan 明细、提交批次、核对结果三者逐项一致 |

---

## 10. 开放问题

| # | 问题 | 决议与当前方案 | 决策时机 |
|---|------|---------|---------|
| Q1 | 图搜原始数据是否包含 shopKey/shopUrl | **已解决（S0探针1）**：Web 卡片可直接提取店铺名及标准店铺链接（覆盖率约 83%）。缺失店铺链接的卡片直接忽略，不开启二次页面请求。 | 已闭环 |
| Q2 | 相似度阈值 0.45 是否合理 | 先按默认值，人工抽查后校准 | M3 后 |
| Q3 | 淘宝商品页价格提取稳定性 | **已解决（S0探针2）**：淘宝价格多为起步价或区间价，不能直接代表指定 SKU 单价。源商品必须提供确切单价证据，否则比价判定保持 `inconclusive`。 | 已闭环 |
| Q4 | 1688 搜索关键词提取策略 | 分词前 3 个实词；后续可引入 LLM | M1 先用简单策略 |
| Q5 | 是否需要前端 Workflow 画布支持 | 已解决：本期包含双分支画布、进度、复核弹窗、铺货及报告下载闭环 | M4 / Sprint 3验收 |
| Q6 | 1688 搜索结果卡片是否能提取起订量和单件价格 | **已解决（S0探针3/4）**：卡片 100% 可提取起订量（MOQ）；但卡片展示价不能作为无条件可比单价。必须通过详情页规格表（`source-detail-collector`）获取经过核验的单件价。 | 已闭环 |

