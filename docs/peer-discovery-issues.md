# 同行发现流水线 — Issue 列表（PM 视角）

> 旧 issue #49-#57 已关闭（按技术模块拆分），以下为按用户价值重新组织的版本。
> GitHub 已有 #58–#62。以下保留原计划任务划分，不直接运行创建脚本重复创建；修改或补充 Issue 前先核对现有任务。

## 与现有 Issue 对齐（2026-10-15）

- #62新增验收：本地生成并持久化allocationPlan，随机分配重试不重抽；按目标店铺及batchSize拆批，传完整店铺快照与合法sequential-average模式。新增run/offerId/目标店铺级账本，不能用既有批次hash替代；A店成功B店失败只重试B。首版整商品铺货，SKU仅作比价证据，不支持指定SKU铺货。默认24小时证据有效期（evidenceMaxAgeMs 严格校验为安全正整数，拒绝布尔与浮点自动取整），过期及刷新失败阻塞提交，刷新后重新确认。无有效货源但仍有未知提交时保留核对入口，不提前完成。详见技术设计§5及§7.3。
**本轮版本修正**：#61按原始快照与minPayment筛选分层；#62按当前manifest及商品snapshotRevision匹配验证结果。草稿即使无需重生标题也须同步当前confirmed集合；草稿/选择/复核状态以同一revision的bundle原子更新，提交账本独立保留。按技术设计§5和§7.3验收A/B→仅A、全部失效、商品图片/售价变化、付款阈值变化、崩溃恢复和并发提交。此次仅本地计划更新，尚未修改线上Issue。

- #58 对应输入及源商品提取，#59/#60 对应淘宝图搜与店铺聚合，#61 对应销量榜采集及付款达标过滤，共享基础流程不变。
- #62 定义为新增“图搜选货→铺货复核”分支，不替换原“文字搜货→同行店铺判定→报告”分支；启动时单选任务目标。
- 新分支价格阈值使用 `imagePriceRatioThreshold`，默认"1"，启动时严格校验为最多6位小数的正十进制字符串，拒绝科学计数法与超精度数值，与定点比较契约完全对齐，严格判定价格比小于阈值，等于不通过；界面默认100%，允许用户指定比例。原分支默认0.7保持不变。
- #62 必须处理全部达标商品，不按店铺货源数量提前结束；保留规格与可比单价校验、四级状态、平台故障暂停、货源去重和证据追溯。
- 铺货交接需包含标题和目标淘宝类目；缺项提示补全、禁止自动提交，商品需经人工确认后铺货。配置比例变化后重新评估并使旧复核选择失效。
- 详细参数、交接及测试要求以 `peer-shop-discovery-design.md` §1.0 为准；本次先更新本地设计，线上 #62 正文尚待同步。
- 技术接入按设计§1.3–1.4：discoveryBranch 默认 peer-analysis，新增 image-selection；Runner/画布共用步骤选择，CLI/MCP暴露分支和 imagePriceRatioThreshold。运行后切换分支必须新建运行。
- #61 抽出 collectShopCandidates，只筛付款人数并保留商品信息；#62 不复用含 minProducts/minSourcing 的原同行包装器。3件达标商品全部保留，达到5件货源也不提前终止图搜。
- #62 增加标题草稿生成和 reviewPeerListings 适配任务；缺淘宝类目在弹窗人工确认，不假定必经生意参谋。草稿保存、重试、版本校验、既有铺货结果和成功项幂等须有集成验收。

---

## 唯一任务追踪与映射

GitHub #58–#62是唯一执行任务；下文A–K仅作为本地验收分组，不新建同名Issue，不运行docs/create-peer-issues.sh。以下是待同步清单，不代表线上正文已更新。

| 本地分组 | 线上任务归属 | 范围 |
|---|---|---|
| A | #58、#59、#62 | 探针2归#58；探针1归#59；探针3/4归#62，旧文字分支也使用探针3结论 |
| B | #58 | 输入和源商品提取 |
| C | #59、#60 | 淘宝图搜与候选店铺聚合 |
| D | #61、#62 | 共享采集归#61；图搜验证归#62；旧文字店铺判定保留为回归基线，不冒充#62实现 |
| E、F、G、I | #58–#62各自模块 | 编排、错误处理、恢复、参数校验是对应模块的验收，不重复开任务 |
| H | #62 | 图搜四级判定真实样本验收；旧文字判定单独回归 |
| J、K | #62及#58–#61对应节点 | #62承担新分支报告/复核闭环；共享输入与节点UI归对应任务 |

### #62实施检查表（待同步线上）
- [ ] 共享MCP启动协调器（设计§5.4）：等待run/runtime原子发布再入队；查询/取消不创建幽灵任务；覆盖初始化/入队失败、崩溃恢复、取消竞态及状态写失败。此项归共享编排验收，不重复创建Issue。
- [ ] S0探针4通过，记录唯一采用的provider、凭证/费用、错误分类与脱敏fixture；未通过不得进入图搜上线阶段。
- [ ] §4.7：image-search-provider及image-sourcing-matcher，全部达标商品验证、定点比较、缓存期限及恢复。
- [ ] §4.8：listing-draft-preparer，纯标题调用、有界并发、请求取消、逐项持久化及进度。
- [ ] §4.9及§5：peer-listing-adapter、复核bundle、本地allocationPlan、单店拆批和逐项账本。
- [ ] §4.10：peer-product-report-writer，JSON/Excel同口径、失败可单独重试及下载。
- [ ] §6：双分支画布与复核弹窗，渐进展示、手动补全、暂停、重试、核对、人工结束。
- [ ] §7：真实服务契约fixture、崩溃/并发测试、真实平台单店拆批与图搜验收。完成代码不等于验收通过。

## Sprint 0: 技术探针（原估时0.5-1天，探针4完成后重估）

> **目标**: 消除最大的技术不确定性，决定后续开发方案。
> **演示**: 无用户可演示产出，但输出技术决策文档。

### Issue A: [同行发现-S0] 技术探针：验证图搜数据和商品页提取可行性

**用户故事**: 作为项目经理，我需要在正式开发前确认以下四项关键技术假设是否成立，避免团队在错误方向上投入。

**探针 1: 淘宝图搜原始数据是否包含店铺信息**
- 用 1 条已知有同款的淘宝商品链接，调用 imageSearchSingle 获取原始 JSON
- 检查 `data.result.categories[].products[]` 中每个 product 对象是否包含 shopName、shopUrl、shopKey
- 如果包含 → N3 直接解析，无需额外请求
- 如果不包含 → N3 降级为逐个打开同款商品页解析店铺（增加大量请求和时间）

**探针 2: 商品页 JS 注入提取在不同模板下的兼容性**
- 准备 3-5 条不同类目的淘宝商品链接（服饰、数码、家居、饰品、食品各一条）
- 用设计文档 §4.2 的 JS 脚本逐条测试主图/标题/价格/shopKey 提取
- 记录每条链接的提取成功率

**探针 3: 1688 搜索结果卡片是否包含起订量和单件价格**
- 用 2-3 个不同品类关键词在 1688 搜索，获取原始卡片数据
- 检查 cardText / DOM 中是否能解析出：起订量（如"1件起批"→1）、单件价格（非阶梯价时的明确单价）
- 记录可提取率：多少比例的卡片能拿到 minOrderQuantity 和 singlePiecePrice
- **如果可提取** → M0 扩展 normalizeCard 实现此提取逻辑
- **如果不可提取** → 所有商品将进入 suspected/inconclusive，confirmed 永远无法达成，需要评估是否调整判定策略

**探针 4: 1688真实图搜通道与字段可行性（#62上线前置门禁）**
- **执行脚本与产物约定**:
  - 探针脚本: `test/probes/s0-probe-1688-image-search.js`（独立执行，不污染主代码）
  - 脱敏 Fixture: `test/fixtures/peer-discovery/s0-probe-1688-image-search.json`（供单元测试和 CI 离线回放）
  - 决策报告: `docs/operations/probes/s0-probe-1688-image-summary.md`（记录通道选型、耗时基线、字段覆盖率与风控评估）
- 先检查当前账号是否具备获授权的图片检索API，核实实际端点/版本、输入方式、权限、计费及配额；不得凭名称假定API可用。缺少凭证或需付费授权则记录待用户配置（错误分类: `ERR_1688_IMAGE_AUTH_MISSING`），不擅自购买。
- API不可用时评估用户登录浏览器的正常图片上传图搜，记录CDP上传步骤、图片类型/体积限制、页面解析稳定性、登录/验证码/限流错误（错误分类: `ERR_1688_IMAGE_CAPTCHA`、`ERR_1688_IMAGE_RATE_LIMIT`）；不绕过验证码，不自动在通道间反复重试。
- 经用户授权后用至少3个品类的已知商品图片低频取样，记录每次耗时、成功/阻塞情况、候选数、完整性，以及offerId、规格、单件价格、币种、起订量、在售证据的覆盖率，保留脱敏响应fixture。不通过提高频率主动探测风控阈值，样本结果不作平台安全频率保证。
- 输出明确选型决策（API或浏览器，含可复现调用/上传过程），统一到设计§4.7的provider契约。字段不足可评估受限详情补全并测耗时；无法取得可比价格/规格证据则保持inconclusive，不能降低标准制造confirmed。
- 无可用通道时暂停#62上线，报告具体阻塞及恢复条件；允许原同行分支独立推进，不用文字搜索伪装图搜。

**验收标准**:
- [ ] 探针 1 结论明确，附原始 JSON 样本
- [ ] 探针 2 结论明确，5 条链接提取成功率
- [ ] 探针 3 结论明确，1688 卡片起订量/单件价格可提取率，附原始 cardText 样本
- [ ] 探针 4 选型、耗时/费用/字段覆盖报告及脱敏 fixture（`test/fixtures/peer-discovery/s0-probe-1688-image-search.json`）齐全；图搜分支可用性结论明确，失败不降级为文字搜索
- [ ] 更新设计文档 Q1、Q3，新增 Q6（1688 字段可提取性）

**预估工时**: 0.5-1 天 | **P0** 阻塞后续所有开发

---

## Sprint 1: 最小闭环（3-4天）

> **目标**: 输入链接 → 终端输出同行店铺 JSON，端到端跑通。
> **演示**: 运营粘贴 3 条链接，终端显示找到的同行店铺清单。

### Issue B: [同行发现-S1] 输入链接后能看到源商品信息

**用户故事**: 作为电商运营，我粘贴 3-4 条淘宝商品链接后，系统能告诉我每条链接对应的商品标题、价格和主图，让我确认导入是否正确。

**场景**: 运营从收藏夹复制了几条商品链接，想看看系统能不能正确识别。

**验收标准（产品视角）**:
- [ ] 输入 3 条有效链接，终端显示每条的：商品标题、售价、主图 URL、所属店铺名
- [ ] 混入 1 条无效链接，系统提示失败但不影响其他链接
- [ ] 重复粘贴同一链接，自动去重
- [ ] 全部无效时，提示「没有有效的商品链接」

**技术备注**: N1+N2 节点 | 新增 source-extractor.js, index.js | 复用 input-parser.js, collector.js | 落盘 peer-input.json, source-products.jsonl

**依赖**: S0 探针 2 完成

**预估工时**: 1 天

---

### Issue C: [同行发现-S1] 系统能自动找到同款商品并列出候选店铺

**用户故事**: 作为电商运营，我导入商品链接后，系统能自动帮我找到同款商品，并告诉我哪些店铺在卖同款——我不需要自己去淘宝一个个搜。

**场景**: 运营导入了 3 条手机挂绳链接，系统通过图搜找到 15 个同款，聚合出 8 家候选店铺。

**验收标准（产品视角）**:
- [ ] 导入 3 条链接后，终端显示同款商品总数和候选店铺数
- [ ] 候选店铺列表包含：店铺名、店铺链接、该店同款数量
- [ ] 源商品自己的店铺被排除
- [ ] 候选店铺上限 30 家（可配置）
- [ ] 某条链接图搜无结果时，提示无同款，继续处理其他链接

**技术备注**: N3 节点 | 新增 similar-finder.js | 修改 search-taobao-image.js 新增 imageSearchSingleRaw | 落盘 similar-products.jsonl, candidate-shops.jsonl | 断点续跑 similar-finder-state.json

**依赖**: Issue B（需要 source-products.jsonl）+ S0 探针 1 完成

**预估工时**: 1 天

---

### Issue D: [同行发现-S1] 系统能判定哪些候选店铺是真正的同行

**用户故事**: 作为电商运营，我不需要看所有候选店铺，系统帮我筛选出真正值得监控的同行——那些卖得好、而且有便宜货源的店铺。

**场景**: 系统找到 8 家候选店铺后，逐家检查销量榜和 1688 货源，最终告诉运营 2 家是真正的同行。

#### 四级状态分类（修订 P1-1）

每个店铺和每个商品的评估结果必须区分为四种状态，不能把平台故障当成"不合格"：

| 状态 | 含义 | 后续行为 |
|------|------|---------|
| `qualified` | 确认同行 | 计入合格数 |
| `unqualified` | 确认不达标（商品不足/货源不足） | 计入跳过数，不再重试 |
| `inconclusive` | 无法判定（1688搜索无结果/价格缺失/规格不可比） | 不计入合格也不计入跳过，标记待人工确认 |
| `blocked` | 平台级故障（登录失效/验证码/限流/客户端掉线） | **暂停整条流水线**，保存进度，不标记完成 |

**关键规则**：
- `blocked` 状态下不得将店铺或商品标记为 completed，恢复后从断点继续
- `inconclusive` 的商品不计入 `sourcingConfirmedCount`，单独统计为 `sourcingInconclusiveCount`
- 1688 搜索失败返回 `inconclusive`（而非 `matched:false`），避免把"没查成功"变成"没有货源"

#### 货源判定增强（修订 P1-2, R1-1）

标题相似度 ≥0.45 仅作为候选筛选条件，不能直接认定为同款。货源判定分四级：

| 级别 | 条件 | 计入已确认货源 |
|------|------|-------------|
| `confirmed` | 相似度≥阈值 **且** 价格比≤阈值（1688价≤淘宝价×0.7）**且** 规格明确一致（specStatus=consistent） | ✅ 是 |
| `suspected` | 相似度≥阈值 **且** 采购价格可比、价格比≤阈值，但规格未知（specStatus=unknown，非不一致） | ❌ 否，标记"疑似同款／规格待确认" |
| `rejected` | 相似度<阈值（明确不同款）；或所有可比价候选价格比均>阈值（明确不低价） | ❌ 否 |
| `inconclusive` | 1688搜索无结果/超时；淘宝价格缺失；1688起订量未知或仅有批量档价格（由 suspected 分支动态返回 level=inconclusive）；平台异常透传 | ❌ 否，单独计入无法判定数，待人工确认 |

**关键区分**：
- `rejected` = 有充分数据证明不满足条件（不同款或价格超标）
- `inconclusive` = 缺少数据无法判定（缺价格、缺搜索结果、批量档 vs 零售不可比）
- 批量档最低价不能直接作为相同采购条件的价格——当 1688 结果的 minOrderQuantity 显著高于 1 件时，该价格标记为"批量档价格，不可直接比较"，归入 `inconclusive`

**价格口径**：
- 1688 价格取搜索结果卡片的 `priceBand.minPrice`，同时记录 `minOrderQuantity`（起订量）和价格档位说明
- 淘宝价格取商品页售价，无法取得时该商品标记 `inconclusive`（reason: `missing_taobao_price`）
- 价格比 = 1688 minPrice / 淘宝售价，**仅在两者都可取得且采购条件可比时计算**
- 当 1688 minOrderQuantity > 1 且无单件价格时，价格比不可计算，归入 `inconclusive`
- 输出中明确标注"页面展示付款人数下限"，不称为"近期销量"

#### 商品状态→店铺结论汇总规则（修订 R1-2）

单个商品的四级状态需要汇总为店铺级结论。汇总时必须考虑"未知项可能满足条件"的情况：

设：C = confirmed 数, S = suspected 数, I = inconclusive 数, R = rejected 数, Q = 达标商品总数, M = minSourcing 阈值

| 优先级 | 条件 | 店铺结论 | 说明 |
|--------|------|---------|------|
| 1 | 采集过程遇到平台故障 | `blocked` | 最高优先，暂停流水线 |
| 2 | Q < minProducts 且采集完整 | `unqualified`（insufficient_products） | 已采完确实不够 |
| 3 | Q < minProducts 且采集不完整（进店失败/解析异常） | `inconclusive`（collection_incomplete） | 不能断定不够 |
| 4 | C ≥ M | `qualified` | 已确认数已达标，直接通过 |
| 5 | C + S + I < M | `unqualified`（insufficient_sourcing） | 即使所有未知项都满足也不够 |
| 6 | C < M 且 C + S + I ≥ M | `inconclusive`（sourcing_uncertain） | 未知项可能补足，不能断定不足 |

**示例**：M=5, C=4, I=6 → 命中规则 6 → `inconclusive`（不能判 insufficient_sourcing）

**验收标准（产品视角）**:
- [ ] 终端显示评估进度：「正在评估 XX 旗舰店 (3/8)」
- [ ] 完成后显示：合格店铺数、未达标数、无法判定数、阻塞数、各家原因
- [ ] 合格标准：达标商品（页面付款下限≥10）≥10 个，其中 **confirmed** 货源 ≥5 个
- [ ] 汇总规则：confirmed 已达标→qualified；confirmed+suspected+inconclusive 仍不足→unqualified；其余→inconclusive
- [ ] 商品数量不足区分"已采完不足"（unqualified）和"采集不完整"（inconclusive）
- [ ] 平台故障（登录/验证码/限流）时暂停流水线并保存进度，不将故障店铺标记为完成
- [ ] 外层节点将 blocked 映射为 runner 的 manual_action_required，保留结果和恢复信息，不继续执行报告节点
- [ ] 单店商品级失败（1688超时/无结果）标记为 inconclusive，不影响其他商品继续评估
- [ ] 货源判定区分 confirmed/suspected/rejected/inconclusive 四级
- [ ] 输出中包含起订量、价格档位和价格口径说明

**技术备注**: N4-N6 节点 | 新增 shop-evaluator.js, sourcing-matcher.js | 复用 collector.js, analyzer.js, search-web-1688.js | 落盘 shop-evaluations.jsonl（含四级状态）| 断点续跑 shop-eval-state.json（blocked/inconclusive 不标记完成）| 含 sourcing-matcher 单元测试（含规格一致性、inconclusive 场景）

**依赖**: Issue C（需要 candidate-shops.jsonl）

**预估工时**: 2 天（含四级状态逻辑、规格一致性核对、单元测试）

---

### Issue E: [同行发现-S1] 一键运行整条流水线并输出结果

**用户故事**: 作为电商运营，我不想关心中间步骤，一条命令就能从链接得到同行店铺清单。

**场景**: 运营在终端输入 `node bin/cli.js discover-peers --links "链接1,链接2,链接3"`，等待几分钟后看到 JSON 格式的同行店铺清单。

**验收标准（产品视角）**:
- [ ] CLI 命令 `discover-peers` 可用，支持 --links 参数
- [ ] 支持 --json 仅输出 JSON
- [ ] 支持阈值参数: --min-products, --min-sourcing, --min-payment, --similarity-threshold, --price-ratio-threshold, --max-shops, --search-max-products, --search-max-pages, --collect-limit, --port
- [ ] CLI/MCP 均可指定 collectLimit=50、port=9333，标准化结果一致；默认40/9222。采集上限10-50件，与现有采集器最多滚动3次的能力一致，不保证采满。
- [ ] minProducts/minSourcing 在1-50范围内且不得超过 collectLimit；越界及不可实现的组合在启动前拒绝，不降低门槛或访问平台。
- [ ] MCP 工具 `discover_peers` 注册成功，AI agent 可调用
- [ ] 运行过程中终端显示进度

**技术备注**: runner.js 集成 PEER_DISCOVERY_STEPS | run-store.js 扩展文件路径 | CLI + MCP 注册

**依赖**: Issue B, C, D 全部完成

**预估工时**: 0.5 天

---

## Sprint 2: 真实环境验证 + 容错（2-3天）

> **目标**: 用真实数据跑通，验证判定准确性，确保异常不崩溃。
> **演示**: 用 3 条真实链接跑完整流程，人工抽查货源匹配准确率。

### Issue F: [同行发现-S2] 混入失效链接不导致流水线崩溃

**用户故事**: 作为电商运营，我有时候会粘贴到已下架的链接，系统应该跳过它继续处理，而不是整个报错退出。

**验收标准（产品视角）**:
- [ ] 3 条链接中 1 条已下架，运行不中断，结果中包含 2 条有效链接的产出
- [ ] 错误信息记录在输出的 errors 字段中
- [ ] 全部链接失效时，正常结束并提示「没有有效的商品链接」

**技术备注**: 异常隔离测试 | 对应设计文档 §7 异常场景表

**依赖**: Issue E

**预估工时**: 0.5 天

---

### Issue G: [同行发现-S2] 中途断开后重跑不需要从头开始，调参后能重新评估

**用户故事**: 作为电商运营，流水线跑到一半电脑休眠了，我重新打开后不想等已经跑完的店铺再跑一遍。另外我调低了相似度阈值后重跑，系统应该用新参数重新评估，而不是直接读旧结论。

#### 数据分层（修订 P1-3, R2-3）

断点续跑必须分离原始采集数据和评估结论，避免阈值变更后被旧结论覆盖。**采集快照的复用不仅看店铺身份，还必须校验采集配置是否一致**：

| 数据层 | 文件 | 内容 | 复用条件 |
|--------|------|------|---------|
| 采集快照 | `shop-snapshots.jsonl` | 每家店铺的销量榜原始数据 + **采集配置指纹** | 相同 runId + 相同店铺 + **相同采集配置**（sortType, limit, scrollPages）→ 复用；采集配置变化 → 重新采集 |
| 货源搜索缓存 | `sourcing-cache.jsonl` | 每个商品的 1688 搜索结果原始数据 + **搜索配置指纹** | 相同商品标题 + 相同搜索参数（maxProducts, maxPages, sort）→ 复用；搜索参数变化 → 重新搜索 |
| 评估结论 | `shop-evaluations.jsonl` | 基于阈值计算的四级结论 + **三层配置指纹**（judgeConfigHash + collectConfigHash + searchConfigHash） | 三层指纹全部一致 → 复用；判定配置变化 → 仅重新评估；采集配置变化 → 重新采集+评估；搜索配置变化 → 重新搜索+评估 |

**三层配置指纹**：每层数据记录生成时的三个独立配置哈希。恢复时逐层比较：
- `judgeConfigHash`（similarityThreshold, priceRatioThreshold, minProducts, minSourcing, minPayment）变了 → 复用原始采集与有效搜索缓存，重新筛选和评估；放宽付款门槛后新纳入且没有搜索证据的商品必须补做搜索和验证，不能承诺所有情况秒级完成
- `collectConfigHash`（sortType, limit, scrollPages, collectLimit）变了 → 该店铺重新采集，下游搜索和评估也重做
- `searchConfigHash`（maxProducts, maxPages, sort, port）变了 → 该商品重新搜索 1688，下游评估重做
- 恢复匹配条件：shopKey + 三层指纹全部匹配才复用旧结论

**验收标准（产品视角）**:
- [ ] 运行到第 5 家店铺时中断，重跑后从第 6 家继续，前 5 家不重新进店采集
- [ ] 平台故障（blocked）时暂停并保存进度，恢复后从断点继续
- [ ] 调低 --similarity-threshold 后重跑，原本 unqualified/inconclusive 的店铺可能变为 qualified（用新参数重新评估，但不重新采集）
- [ ] 不改参数重跑，已完成的店铺直接跳过（秒级完成）
- [ ] 商品不足的确定结论同样保存三层配置指纹；相同配置恢复不重新采集该店
- [ ] 修改 --min-products 或 minPayment 后恢复，基于当前原始快照重新筛选和评估，不重复进店采集；快照不足时如实展示不足，不能假定存在更多商品
- [ ] 修改采集 limit/collectLimit 或显式刷新后，相关店铺重新采集并生成新快照版本，使绑定旧快照的下游结论失效
- [ ] 输出中标注每家店铺的处理方式："跳过(配置未变)" / "重新评估(阈值变更)" / "重新采集(采集范围变更)"

**技术备注**: 三层数据分离 + 三层配置指纹 | shop-snapshots.jsonl + sourcing-cache.jsonl + shop-evaluations.jsonl | runId 恢复入口

**依赖**: Issue E

**预估工时**: 1 天

---

### Issue H: [同行发现-S2] 货源判定准确率经多品类正负例验证

**用户故事**: 作为电商运营，系统说某个 1688 商品是同款低价货源，我点进去看确实是的——而且系统不会把不同款、不同规格的东西误判成同款——我才能信任这个工具。

#### 验收样本设计（修订 P2-4）

校准样本和验收样本必须分开，不能只用"已知有同款"的正例：

**校准集**（用于调参，不计入验收）:
- 3 条已知有同款的链接（正例）
- 运行后人工标注每条货源匹配的 confirmed/suspected/rejected，据此调整默认阈值

**验收集**（用于最终验收，校准后不再调参）:
- 至少 2 个不同品类（如饰品 + 家居），每品类 2 条链接
- 包含正例（已知有同款）和负例（已知无同款 / 同图不同规格 / 配件类低价陷阱）
- 负例用途：验证系统不会把不同款误判为 confirmed

**分项统计**（不以单一确认率作为唯一指标）:

| 指标 | 计算方式 | 目标 |
|------|---------|------|
| 同款准确率 | confirmed 中人工确认为真同款的比例 | ≥70% |
| 价格可比率 | confirmed 中价格口径合理（非配件/非批量档）的比例 | ≥80% |
| 误判率 | rejected/inconclusive 中人工认为实际是同款的遗漏比例 | ≤20% |
| 无法判定比例 | inconclusive 占总评估商品的比例 | 记录，不设硬指标 |

**验收标准（产品视角）**:
- [ ] 校准集跑完后输出阈值调整建议，人工确认后锁定参数
- [ ] 验收集使用锁定参数运行，不再调参
- [ ] 验收集包含 ≥2 个品类、≥4 条链接（含正例和负例）
- [ ] 分项统计四项指标，同款准确率 ≥70%
- [ ] 负例中无误判为 confirmed 的案例（同图不同规格、配件低价不应通过）
- [ ] 包装单位无换算证据时返回 unknown：1箱与1个、3件套与3套、内部件数未知的1盒与1盒均不能确认规格一致
- [ ] inconclusive 案例单独列出供人工复核

**技术备注**: 端到端验收 | 校准/验收分离 | 多品类正负例 | 对应需求文档 §8.2 修订版

**依赖**: Issue E + 真实淘宝客户端 + Chrome CDP

**预估工时**: 1.5 天（含校准轮 + 验收轮 + 负例准备）

---

### Issue I: [同行发现-S2] 我能调整判定阈值来适应不同品类

**用户故事**: 作为电商运营，做饰品的和做家具的，「同款」的标准不一样——饰品标题短、相似度天然低，我需要能调低阈值。

**验收标准（产品视角）**:
- [ ] --similarity-threshold 0.3 能让原本被跳过的饰品店铺通过判定
- [ ] --price-ratio-threshold 0.5 能让原本通过的店铺被更严格地过滤
- [ ] --min-products 5 --min-sourcing 3 能用更宽松的标准发现更多同行
- [ ] 参数调整后结果有明显变化（不是摆设）
- [ ] 调参后重跑，输出标注"复用采集数据重新评估"而非"全新采集"（验证 Issue G 的三层数据分层生效）

**技术备注**: 参数化验证 | 对应需求文档 FR-13 | 依赖 Issue G 的配置指纹比对机制

**依赖**: Issue E, G

**预估工时**: 0.5 天

---

## Sprint 3: 体验完善（2-3天）

> **目标**: 从「能用」到「好用」——报告可分享、Web 可看、agent 可调。
> **演示**: 运营在 Web 界面启动流水线，下载 Excel 报告发给老板。

### Issue J: [同行发现-S3] 我能下载 Excel 报告分享给团队

**用户故事**: 作为电商运营，我需要把同行分析结果发给老板和团队，JSON 他们看不懂，Excel 可以。

**验收标准（产品视角）**:
- [ ] 运行完成后自动生成「同行发现报告.xlsx」
- [ ] 工作表 1「同行店铺」: 店铺名、链接、采集数、付款达标数、已验证/未验证数、confirmed/suspected/inconclusive/rejected 数、采集完整性、判定结果
- [ ] 工作表 2「达标商品清单」: 商品标题、链接、付款人数下限、淘宝价、1688链接、1688可比价、原始最低价、起订量、相似度、价格比、货源级别、备注
- [ ] 工作表 3「未达标与无法判定」: 店铺名、判定结果(unqualified/inconclusive/blocked)、原因、采集完整性、实际数量
- [ ] 工作表 4「错误记录」: 店铺名/链接、错误阶段、错误码、错误信息
- [ ] 所有链接在 Excel 中可点击跳转
- [ ] 空结果时仍生成有效文件

**技术备注**: N7 节点 | 新增 peer-report-writer.js | 依赖 exceljs | 参考 report-writer.js

**依赖**: Issue D（需要 shop-evaluations.jsonl 格式确定）

**预估工时**: 0.5 天

---

### Issue K: [同行发现-S3] 我能在 Web 界面完成从启动到下载的完整操作

**用户故事**: 作为电商运营，我习惯在 Web 界面操作选品流水线，同行发现也应该能在那里完成全部操作——输入链接、启动、看进度、处理异常、下载报告。

#### 完整操作闭环（修订 P2-5）

验收不仅覆盖展示，必须覆盖完整操作链路：

**输入与启动**:
- [ ] 开始节点弹窗中输入淘宝链接（支持粘贴多条），点击启动
- [ ] 启动前检测淘宝客户端和 Chrome CDP 状态，未就绪时显示引导按钮（「启动 Chrome」「打开淘宝客户端」）

**运行中控制**:
- [ ] 运行中可暂停（逐店评估节点支持暂停，当前店铺完成后停止）
- [ ] 暂停后可继续，从断点恢复
- [ ] 平台故障（blocked）时节点显示红色告警，提供「重试」按钮
- [ ] 进度实时显示：当前评估第几家/共几家

**结果与下载**:
- [ ] 运行完成后，报告节点显示下载按钮，点击直接下载 Excel
- [ ] 各节点产物面板展示摘要数据（源商品数、候选店铺数、合格/跳过/无法判定数）

**MCP 异步调用**:
- [ ] MCP `discover_peers` 返回任务 ID，不阻塞等待整个流程
- [ ] 提供 `get_peer_discovery_status(taskId)` 查询进度
- [ ] 提供 `cancel_peer_discovery(taskId)` 发送取消信号，返回 cancelling；执行器确认停止后状态变为 cancelled（通过 get_peer_discovery_status 查询确认）
- [ ] 生命周期统一读取 runtime.json；覆盖最后一家期间取消、零候选、重复取消及完成/取消并发，终态优先于遗留控制信号

**验收标准（产品视角）**:
- [ ] 下拉菜单出现「以货找店」模板，启动配置中可选择「以货找店」或「图搜选货」任务目标；与「指定店铺分析」模板区分
- [ ] 画布显示 5 个节点及四种状态（等待/运行/完成/阻塞）
- [ ] 完整闭环：输入链接 → 启动 → 看进度 → 暂停/继续 → 下载报告
- [ ] 环境未就绪时有明确引导，不静默失败
- [ ] MCP 异步模式：返回 taskId + 进度查询 + 取消
- [ ] 浏览器回归测试通过

**技术备注**: pipeline-templates.js + pipeline-node-state.js + artifact-view.js + 节点按钮/弹窗 + 环境检测 + MCP 异步任务管理

**依赖**: Issue E（runner 集成）+ Issue J（Excel 报告，下载按钮需要报告文件）

**预估工时**: 1.5-2 天

---

## 总览

| Sprint | Issue | 标题 | 工时 | 依赖 | 修订项 |
|--------|-------|------|------|------|--------|
| S0 | A | 技术探针 | 0.5-1天 | 无 | — |
| S1 | B | 输入链接看到源商品信息 | 1天 | A(探针2) | — |
| S1 | C | 自动找同款列候选店铺 | 1天 | B, A(探针1) | — |
| S1 | D | 判定哪些是真正同行 | **2天** | C | P1-1 四级状态 + P1-2 货源三级判定 |
| S1 | E | 一键运行输出结果 | 0.5天 | B,C,D | — |
| S2 | F | 失效链接不崩溃 | 0.5天 | E | — |
| S2 | G | 断点续跑 + 调参重评估 | **1天** | E | P1-3 三层数据分离 + 配置版本追踪 |
| S2 | H | 多品类正负例准确率验证 | **1.5天** | E | P2-4 校准/验收分离 + 分项统计 |
| S2 | I | 可调阈值 | 0.5天 | E, G | 依赖 G 的数据分层；验收需验证复用采集数据重评估 |
| S3 | J | Excel 报告 | 0.5天 | D | — |
| S3 | K | Web 完整操作闭环 | **1.5-2天** | E, J | P2-5 输入/启动/暂停/重试/下载/MCP异步 |

**总计: 10-11.5 天**（较修订前 +3 天，增量来自故障分类、数据分层、验收增强、Web 闭环）

### 修订变更记录

| 编号 | 严重度 | 问题 | 影响 Issue | 修订内容 |
|------|--------|------|-----------|---------|
| P1-1 | P1 | 平台故障被当成不合格 | D | 四级状态: qualified/unqualified/inconclusive/blocked；blocked 暂停流水线不标记完成 |
| P1-2 | P1 | 相似度+最低价不足以认定同款 | D | 货源四级: confirmed/suspected/rejected/inconclusive；记录起订量和价格口径；suspected 不计入已确认数 |
| P1-3 | P1 | 调参与断点续跑冲突 | G, I | 三层数据分离（采集快照/搜索缓存/评估结论）；配置版本哈希比对；阈值变更仅重新评估不重新采集 |
| P2-4 | P2 | 验收样本太少且只有正例 | H | 校准集/验收集分离；≥2品类含正负例；分项统计四项指标 |
| P2-5 | P2 | Web 只有展示没有操作闭环 | K | 完整闭环: 输入→启动→进度→暂停/继续→重试→下载；环境检测引导；MCP 异步 taskId |
| R1-1 | P1 | 货源判定表漏掉低价条件 + 价格不可比归类冲突 | D | confirmed 必须同时满足相似度+价格比+规格一致+价格可比；价格不可比归 inconclusive 而非 rejected；批量档价格不可直接比较 |
| R1-2 | P1 | 商品状态如何汇总成店铺结论未定义 | D | 6 条优先级汇总规则：blocked > 采集完整不足 > 采集不完整 > confirmed达标 > 全量仍不足 > 未知可能补足 |
| R2-3 | P2 | 快照复用忽略采集范围变化 | G | 每层数据记录配置指纹（采集配置/搜索配置/判定配置），采集范围变化触发重新采集而非复用旧快照 |
| R1-4 | P1 | 创建脚本和设计文档未同步新规则 | 脚本+设计文档 | 脚本改为从 md 文件提取正文（单一信息源）；设计文档同步四级判定、汇总规则、配置指纹 |
| R3-1 | P1 | matchSourcing 吞掉平台异常，无法暂停流水线 | 设计文档 | 平台级错误（登录/验证码/限流）向外抛出触发 blocked；ok:false 区分平台状态异常 vs 正常无结果；只有正常无搜索结果才进 inconclusive |
| R3-2 | P1 | 起订量未知时默认按 1 件计算，错误确认低价货源 | 设计文档 | minOrderQuantity 不再默认 1；必须有明确单件价格或起订量明确为 1 且非阶梯价才可判 confirmed；缺少证据归 suspected/inconclusive |
| R3-3 | P1 | 断点恢复读取第一条历史记录而非最新匹配记录 | 设计文档 | 恢复时按 shopKey + configHash 过滤，取最后一条匹配记录；配置指纹不匹配时移除 finalized 标记并重新评估 |
| R4-1 | P1 | 单件价格修复仍不正确：比较用 minPrice 而非 singlePiecePrice；`!length>1` 恒 false | 设计文档 | 先确定 comparablePrice（优先 singlePiecePrice，其次 minOrderQty===1 且非阶梯价时用 minPrice），再用它算价格比；修复表达式为 `prices.length > 1` |
| R4-2 | P1 | matchSourcing 读 product.taobaoPrice 但调用方传的是 product.price | 设计文档 | 在 N5 循环前统一商品数据结构：`taobaoPrice: p.taobaoPrice ?? p.price ?? null` |
| R4-3 | P1 | collectQualifiedProducts 缺少采集完整性标记，商品不足永远 inconclusive | 设计文档 | 返回 collectionCompleteness: reached_end/hit_limit/interrupted；只有 reached_end 才 collectionComplete=true；采集上限从 20 提高到 40 |
| R4-4 | P2 | parsePaymentLowerBound 把"不足10人付款"算成 10 | 设计文档 | 先匹配"不足/少于/未满"返回 0；再处理区间格式取下界；覆盖万单位；附解析示例表 |
| R5-1 | P1 | products.length < collectLimit 不能证明已到末页（滚动3次停止≠末页） | 设计文档 | 采集完整性改由采集器返回 endReason 判定：no_more_products→reached_end，collectionError→interrupted，其余→uncertain；不再用数量推断 |
| R5-2 | P1 | enrichCompetitorProduct 吞掉平台阻塞异常 | 设计文档 | 补全链接和货源验证中的 catch 区分 isPlatformBlocker → throw 向外抛出暂停流水线；非平台异常才记录 enrichmentError 继续 |
| R5-3 | P1 | 只验证前 minProducts 件却对整店作否定结论 | 设计文档 | N4+N5 合并到 collectQualifiedProducts：对全部达标商品做货源验证（非只前10件）；confirmed 达 minSourcing 时提前终止；evaluateAllShops 检测 preEvaluated 跳过重复验证 |
| R5-4 | P2 | suspected 未排除价格比已超标的候选 | 设计文档 | suspected filter 增加 `comparablePrice != null && ratio > threshold → false`；rejected 分支检查所有可比价候选是否都超标 |
| R6-1 | P1 | normalizeCard 不返回 minOrderQuantity/singlePiecePrice，confirmed 永远无法达成 | 设计文档 | 新增 M0 前置任务：扩展 domExtractionExpression 和 normalizeCard；matchSourcing 中标注前置依赖；扩展前全部进 suspected/inconclusive |
| R6-2 | P1 | applyShopVerdict 不接收 collectionCompleteness，采集不完整仍判 unqualified | 设计文档 | 汇总规则增加 completeness 参数：只有 reached_end + C+S+I+U 全量仍不足才判 unqualified；uncertain/interrupted 判 inconclusive |
| R6-3 | P2 | 提前终止后 totalProducts/qualifiedProductCount 统计失真 | 设计文档 | collectQualifiedProducts 返回 stats 分项统计（totalCollected/paymentQualified/sourcingVerified/sourcingUnverified）；evaluateAllShops 使用分项数据 |
| R6-4 | P2 | 测试表和风险表仍用旧 matched=true/false 和"限流不阻断" | 设计文档 | 测试表改为四级判定术语（28 个用例含平台异常透传、汇总规则、normalizeCard 扩展）；风险表区分平台故障(暂停) vs 普通失败(inconclusive) |
| R9-1 | P1 | 恢复校验只检查判定 configHash，未覆盖采集范围和搜索参数 | 设计文档 | 三层配置指纹独立比较（judgeConfigHash/collectConfigHash/searchConfigHash）；state 读写和评估记录全部使用三层指纹；任一变化清空 finalized |
| R9-2 | P2 | checkSpecConsistency 布尔值无法区分"明确不一致"和"未知" | 设计文档 | 改为三态 consistent/inconsistent/unknown；inconsistent 排除出 suspected（明确不同规格）；unknown 进 suspected（待人工确认）；新增 checkSpecConsistency 实现和语义说明 |
| R9-3 | P2 | cancel_peer_discovery 调用 requestRuntimePause 实际是暂停非取消 | 设计文档 | 改用 requestRuntimeCancel；接口返回 cancelling（信号已发出）；执行器确认停止后写入 cancelled；stepEvaluateShops 透传 cancelled 状态 |
| R10-1 | P1 | checkSpecConsistency 单方缺失关键属性仍判 consistent；等价单位未归一化 | 设计文档 | 归一化单位（cm/mm/寸→mm，件数统一为 N件）；单方缺失关键属性返回 unknown 而非 consistent；新增归一化示例表 |
| R10-2 | P1 | cancel 接口在任务实际停止前就声明 cancelled | 设计文档 | 接口仅写入取消信号返回 cancelling；执行器在检查点检测到信号后停止循环、保存进度、写入 cancelled；stepEvaluateShops 透传 cancelled |
| R10-3 | P2 | 进度查询直接统计追加日志导致重复计数 | 设计文档 | 按当前三层配置指纹过滤 + 按 shopKey 取最后一条记录；返回 candidateShops 总数和四分类计数 |
| R11-1 | P1 | 规格归一化丢失精度（0.1mm→0mm）和计量语义（1对=1个） | 设计文档 | 尺寸保留小数精度（toPrecision(6)）；数量保留单位类别（set/single/pair），不同类别返回 unknown 而非 consistent；新增 compareQuantity 函数和 10 条归一化示例 |
| R11-2 | P2 | 取消信号消费路径只有注释没有实现 | 设计文档 | evaluateAllShops 中定义 shouldCancel() 读取 runtime-control.json；循环开头检查点检测到 cancel 后保存进度、写入 cancelled 终态、return；MCP cancel 工具直接写控制文件；完整 5 步路径文档化 |

### 并行机会
- S1: B 完成后 C 和 D 可以部分并行（D 的 sourcing-matcher 单元测试不依赖 C）
- S2: F, G, H 三个 issue 互相独立，可以并行；I 依赖 G 的数据分层
- S3: J 可在 S2 期间提前开始（只依赖 D）；K 依赖 J
- S0 完成后根据实际采集成功率和请求耗时修订工期

### 与旧 issue 的映射
| 新 Issue | 对应旧 Issue |
|----------|------------|
| A (S0) | 无（新增） |
| B (S1) | #50 (source-extractor) |
| C (S1) | #51 (similar-finder) |
| D (S1) | #49 (sourcing-matcher) + #52 (shop-evaluator)，增加四级状态和货源三级判定 |
| E (S1) | #53 (runner集成) + #55 (CLI+MCP) |
| F (S2) | 无（新增，原隐含在 #54 联调中） |
| G (S2) | 无（新增），增加三层数据分离和配置版本追踪 |
| H (S2) | #54 (联调) 的验收部分，增加校准/验收分离和负例 |
| I (S2) | 无（新增，原隐含在 FR-13 中），现依赖 G |
| J (S3) | #56 (Excel报告) |
| K (S3) | #57 (前端集成)，增加完整操作闭环和 MCP 异步 |

| R13-1 | P1 | MCP/CLI 参数名与判定器不一致 | 设计文档 | 全链路统一参数名：similarityThreshold, priceRatioThreshold, searchMaxProducts, searchMaxPages；CLI/MCP/判定器/指纹计算使用同一份标准化配置 |
| R13-2 | P2 | 1688 阻塞被展示成淘宝故障 | 设计文档 | 错误产生处设置 err.platform + platformStatus + actionHint；blocked 记录携带平台信息；stepEvaluateShops 优先使用 result.platform |
