# 多维挖词与生意参谋验证：详细实施设计

日期：2026-09-11。状态：核心发现链路已实现并进入回归验收；完整设计仍有后续阶段，未启用定时任务。

## 本轮实施记录

- 已接入五类常青需求维度及用户自定义输入，保留新闻、字典、季节来源；模型提示要求需求链、商品形态和具体用途，不再限定固定商品目录。
- 已实现查询词精确归一化、成功或有效空结果后滚动 30 天冷却、历史成功查询兼容、同词排他认领；失败不开始冷却，同轮已完成结果不重复请求。
- 已保存本轮发现快照及逐词有效结果，部分失败和主动暂停保留原轮次；重试只处理未完成词根。平台异常不继续消耗后续查询。
- 已保留原始指标及采集时间，修复候选整理时丢失证据的问题；证据复用校验关键词、时间及明确指定的查询条件。未给历史证据伪造新时间。
- 已在开始节点弹窗提供维度勾选、自定义输入，在灵感结果中展示来源、需求链、30 天状态和轮动新增/保留数量，取消 20/30 条静默截断。
- 未完成：独立词根复核节点与新版图、共享到手动词根流水线的统一查询队列、逐页断点、完整缺失/区间指标评分、到期词根主动调度及软配额、profile 管理与每日定时调度。这些仍按正文设计，不应把本轮称为完整系统已交付。
- 当前排他锁不按超时自动抢占；进程异常退出的残留锁恢复入口仍需补充，避免未经确认重叠操作浏览器。
- 协作情况：本轮多次调用 Antigravity 请求实现和只读评审，未获得有效交付（超时/无输出）；本轮代码与验收由 Codex 完成，不能视为已通过 Antigravity 独立代码评审。

本日补充：按用户要求改为滚动 30 天内词根不重复、满期允许重新发现生意参谋轮动词；以下第 6.1 节为去重和复查的最终规则，替代早期短周期自动复查建议。

依据：2026-09-10-multidimensional-keyword-discovery.md，以及本轮对现有源码的检查。Antigravity 使用 agy plan 模式阅读了提供的完整方案并返回架构建议，没有独立读取或验证仓库代码。本文为整合并修正后的实施规格。

## 1. 共同评审结论

| 议题 | Antigravity 的建议 | 最终设计 |
| --- | --- | --- |
| 来源与维度 | 新闻触发信号与职业等常青维度分开 | 采纳；常青维度可以主动产生需求，不需要伪造新闻触发 |
| 多来源 | 同词合并推导链，适当提高优先级 | 保留独立来源；转载不加分，独立证据奖励设上限，避免来源越多分数无限增长 |
| 新商品 | 商品词尾校验，限定 3～8 字和严格 10% 配额 | 词尾仅作辅助；商品形态、具体用途与需求解释决定准入。探索份额可配置，保证不会长期饿死 |
| 租约 | 90 秒租约与心跳恢复 | 租期根据实际动作超时配置；加 ownerEpoch 及操作前检查。过期不代表旧浏览器操作已停止 |
| 数据缺失 | 指标多状态，缺失不归零 | 采纳；不能直接把 -- 解释成平台脱敏或低频，应保留 unknown 原因 |
| 每日抽样 | 日期和版本确定性抽样 | 采纳，并保存生成结果；固定随机种子不能保证 LLM 重试输出一致 |
| 热点过期 | 新闻排队超过 24 小时丢弃 | 改为按需求有效窗口处理，新闻发布时间不等于需求结束时间 |
| 分阶段交付 | 先证据、后发现、再交互与调度 | 存储和队列恢复提前到基础阶段，与证据一起验收 |

## 2. 用户最终看到的流程

新版每日动态选品模板：

```text
配置分析方向
    → 多维需求挖掘
    → 词根确认（可配置自动通过）
    → 生意参谋拓词与验证
    → 关键词结果确认
    → 完成研究 或 货源选品 → 标题生成 → 铺货复核 → 完成
```

“多维需求挖掘”只分析和生成词根；所有生意参谋页面操作归入同一验证阶段。词根确认用于花查询时间之前筛除无关方向，关键词结果确认用于查看市场数据后决定进入选品的词。

研究模式的完成条件：本轮有效查询都处理到终态、结果确认或按预先设置的自动策略输出。零通过词也可以完成研究，明确展示“完成，本轮无通过词”；权限阻塞和未完成查询不能假装完成。

每天自动运行可设为自动确认词根并停在关键词结果确认。用户主动暂停的任务不能被次日定时触发自动恢复。不会因新配置覆盖正在运行的参数。

新模板使用独立 version，节点 ID 在实施时分配并固定。旧定义、历史、运行状态保持原解释。精确关键词模板直接进入证据验证；手动词根模板复用拓词队列。不要复制两套查询、评分和限流。

## 3. 多维知识与分析配置

配置对象保存 profileId、revision、name、enabledDimensions、customInputs、allowedCategories、excludedCategories、region、timezone、lookAheadDays、sourceSettings、queryPolicy、reviewPolicy、stopAfterVerification。

维度枚举：current_event、season_festival、persona、profession、hobby、scene、problem。探索是调度通道 exploration，不当成真实内容来源。

初版知识库每个常青维度维护约 20～30 个经过审阅的条目。每条记录 dimensionId、label、tasks、contexts、constraints、relatedDimensionIds、catalogVersion。具体商品不作为必须命中的固定答案。

| 维度 | 深入拆解方法 | 示例购买任务 |
| --- | --- | --- |
| 职业 | 工作动作 → 使用环境 → 携带/清洁/整理限制 | 维修人员分隔保存小零件 |
| 爱好 | 初学/进阶 → 活动流程 → 工具使用与收纳 | 水彩学习者清洗和摆放画笔 |
| 人群 | 生活阶段 → 生活安排 → 空间与使用约束 | 租房者无需改造墙面增加收纳 |
| 季节节日 | 地区 → 真实日期 → 准备期 → 使用窗口 | 入学前整理宿舍床边物品 |
| 场景问题 | 地点/时段 → 当前障碍 → 可被商品解决的任务 | 夜间阅读提供局部照明 |
| 时事 | 可追溯事件 → 影响范围 → 持续时间 → 具体需求 | 降雨影响通勤时保护鞋子和随身物品 |

每轮选择不同维度条目，并进行有因果关系的二至三维交叉。配额使用前一版计划的初始软比例，按有证据的候选动态分配。用户输入没有业务数量上限，界面分页和接口分批提交；服务端仍保留请求大小上限。

抽样键：profileId + businessDate + catalogVersion + iteration。恢复读取已有样本和 LLM 输出；只有显式“探索新方向”增加 iteration。重复点击相同请求键不会多生成一批。

## 4. 数据契约

使用 CommonJS、JSDoc 和项目已有校验工具；不为这次设计引入 TypeScript。以下字段是存储/API 约定，数据库或文件内的具体结构由 repository 隔离。

| 对象 | 必须字段 | 核心约束 |
| --- | --- | --- |
| Signal | signalId、sourceType、sourceUrl、sourceName、text、publishedAt、observedAt、validFrom、validUntil、timeStatus | 时间未知用 null；抓取时间不能替代发布时间；常青知识库来源引用 catalogVersion |
| Hypothesis | hypothesisId、signalIds、dimensionIds、actor、task、scene、problem、purchaseJob、rationale | signalIds 可为空，但需有知识库/用户输入依据；不能没有解释链 |
| Root | rootId、canonicalText、normalizationVersion、productFamily、productStatus | productStatus 为 known、unknown_concrete、invalid；同名跨语义保留消歧信息 |
| DiscoveryCandidate | candidateId、runId、rootId、hypothesisIds、primaryDimension、dimensionTags、discoveryScore、validUntil | 来源关系为集合；发现评分与市场评分独立 |
| QueryJob | jobId、queryKey、context、subscriberRunIds、state、checkpoint、attempts、nextAllowedAt、lease | 一次查询可以满足多个运行；取消一个订阅者不取消其他运行仍需的工作 |
| Evidence | evidenceId、queryJobId、context、capturedAt、parserVersion、pageNo、rows、contentHash | 不可变快照，重解析产生新版本；每行有稳定 rowId |
| Decision | decisionId、candidateId、keyword、evidenceRefs、ruleVersion、conclusion、reasonCodes、score、revision | evidenceRefs 含快照和行 ID；缺失时允许空集合和 null 分数 |
| ManualChoice | candidateId、action、reason、basedOnDecisionId、revision、updatedAt | 不覆盖自动验证结论；重新评分后标记人工决定基于旧证据 |

Root 的稳定 ID 不含每日抽样顺序。候选属于具体运行；多个运行可共享 Root 和证据，但人工排除默认只影响本次运行，永久排除需独立操作并显示作用范围。

Signal 的有效期和需求的有效期分别保存。一条旧新闻可能产生持续需求，也可能已失效；过期依据需有规则版本和解释。

### 指标结构

```json
{
  "value": null,
  "lowerBound": null,
  "upperBound": 5,
  "upperInclusive": false,
  "status": "bounded",
  "reason": null,
  "unit": "index",
  "rawText": "<5"
}
```

status：measured、zero、bounded、missing、unavailable、parse_error。reason 可为 unknown、not_requested、permission、platform_suppressed，但仅在已知原因时赋具体原因。百分比统一按 0～1 保存，原文保留；指数与人数不混用。零值、区间和缺失都不得通过 Number(value || 0) 合并。

区间跨越阈值时不能精确裁决，进入待观察或数据不足；必要指标缺失时不重新归一化剩余权重制造高分。

## 5. 来源与商品推导

新闻复用现有 RSS/Atom 采集器，先验证配置、返回内容和时间，再按事件聚合。天气只在有真实来源和地区配置时启用；否则界面显示季节推演。节日使用实际年份日历，准备期由购买任务和履约周期确定。

来源状态分为未配置、可用、降级、失败；同时保留最近成功更新时间。失败时使用仍有效的缓存或常青维度，不把缓存伪装成今日新闻。

AI 每次接收有限的需求批次、经营范围和需要补足的商品家族，返回结构化商品形态与关联理由。不强制从已有 180 项商品目录选择。

未知具体商品满足：物品形态明确、用途可解释、与需求相关、未命中排除范围，即可进入探索池。字数、词尾和分词词性仅作为证据。生意参谋是否存在相符关键词是后续证据，不能保证一定返回商品叶子类目。

同词多来源合并保留各推导链；多个转载只构成一个事件依据。发现优先级采用主要依据分数加有上限的独立支持奖励。具体奖励参数经过样例回放确定。

## 6. 查询上下文与证据复用

queryKey 使用稳定序列化后的 SHA-256：platformContextId、canonicalQuery、queryMode、rangeStart、rangeEnd、compareType、filters、sort、requestedMetrics、normalizationVersion。平台上下文使用本地标识，不存登录凭证。

实际请求的周期必须解析为起止日期。页数是覆盖要求，checkpoint 与证据保存已覆盖页；不同排序的第 1 页不能当作同一覆盖。parserVersion 用于证据兼容检查，不必因解析器升级自动重复网络请求，原始有效快照可重新解析。

复用条件：

1. 账号/店铺、统计起止日期、模式、筛选和指标定义兼容。
2. 证据确实包含目标关键词行，并在有效期内。
3. 关键指标完整且可解释，分页覆盖满足当前任务声明。
4. 推荐类目保持其原始作用范围，不能把词根级建议静默复制为所有关联词的类目。

词根查询返回的完整目标行可以直接用于评分；整个词根任务尚未采完时允许展示部分结果，但不能声称全量覆盖。只有不满足条件的关键词进入补查队列。

当前 canReuseCandidateSycmEvidence 对 inspiration 来源无条件返回 true。新运行必须使用上述契约；旧记录展示为 legacy evidence，重新运行时补齐上下文或重新查询，不改写历史结论。

### 6.1 滚动一个月去重与轮动复查

“一个月”采用连续 30 天：nextEligibleAt = lastCompletedAt + 30 × 24 小时。存储 UTC 时间，界面按 Asia/Shanghai 展示；不在月初清空历史。例如 9 月 11 日 10:00 完成查询，10 月 11 日 10:00 起可重新排队。30 天到期只是获得复查资格，不保证立即执行。

分开三个键：

- rootHistoryKey = researchScopeId + normalizedQueryText，控制 30 天内不重复查询。researchScopeId 表示同一经营研究范围，多个模板和每日任务共享；更换运行 ID、来源、统计日期、筛选条件不绕过这个门槛。
- queryKey 保存前述完整平台上下文，决定证据是否兼容以及同轮请求能否合并。它不能代替 rootHistoryKey，否则每天日期变化都会绕过去重。
- cycleId 标识一次发现周期；到期复查创建新 cycleId，旧证据和决策保持不变。别名规则升级需要合并历史并采用较晚的完成时间，不能通过换规范化版本解除冷却。

规范化仅合并确定的同一查询表达，如空格、大小写和标点差异。语义相近但在生意参谋上可能返回不同结果的词不直接合并为硬去重键，例如“收纳箱”和“整理箱”；它们关联同一商品家族做软排序。AI 建议的同义关系不直接写入硬合并规则。

| 情况 | 自动处理 |
| --- | --- |
| 从未有效查过 | 进入新词队列 |
| 已生成但尚未查询 | 合并来源，保持一个待处理候选，不消耗 30 天窗口 |
| 词根已有排队或执行中的周期 | 合并订阅者，不创建第二轮任务 |
| 有效完成，未满 30 天 | 展示“本月已查”和可复查时间，过滤出新候选列表；历史结果可单独查看 |
| 有效完成，已满 30 天 | 重新评估当前需求，进入到期复查队列，采集新关联词 |
| 明确的有效空结果或市场不通过 | 本轮已完成，仍按 30 天复查，避免反复查空词 |
| 登录/权限/解析失败 | 不记录有效完成；保留阻塞和重试节奏 |
| 已采部分页后暂停或失败 | 保留同一 cycleId 继续未完成工作；已经成功的页不重复累计 |
| 新热点再次提到未到期词根 | 合并新依据，等待原可复查时间，不自动提前查 |

一轮完成是该轮预先声明的采集范围及必要证据补查完成，不要求查尽平台全部分页。部分数据可提前展示，但不得靠反复新建“补查”改变上下文或补查清单以绕过去重。剩余任务超过原查询窗口、上下文已经无法恢复时，记录 abandoned_partial；已有成功页保留完成时间作为本轮去重基准，不能无限重启同一词根。

缓存与去重分开：未满 30 天时，仅复用仍满足证据时效和上下文要求的旧结果。旧证据已过期则显示“历史数据已过期，等待复查”，不能标成今日验真通过，也不自动提前重查。平台冷却时间和这条业务去重时间分别展示。

结果词自然交叉不算重复查询：查询“零件盒”和“工具箱”可能返回同一关联词。合并该词的来源并保存各自证据，不丢弃平台返回行、不额外再查一次。同一研究范围 30 天内已经正式推荐过的关联词默认归入“已有结果更新”，不反复作为新词推荐；满期后可再次推荐并展示历史对照。

### 6.2 满期复查后的结果对照

保存每轮关联词集合和数据快照，按规范化关键词对照：本轮新增、本轮仍在、本轮未出现、指标可比变化。若页数或筛选不同，“未出现”只能解释为本轮采集范围未见，不能称为退出榜单。统计指标只有定义、单位和窗口长度可比时才计算变化；否则展示两期原值及上下文。

调度初始采用 70% 新词、30% 已到期词的软比例，某侧不足时可由另一侧补足；按实际人工保留率调整。到期词也必须满足当时有效的需求与经营范围，过季方向延后到下一适用窗口。复查池不是固定重复种子池，不要求每个月把所有历史词机械查询一遍。

大模型生成前接收近期已查询词根的相关摘要，生成后由服务端以完整 rootHistoryKey 索引再次过滤；不能仅依赖提示词或把全部历史塞入上下文。发现到期词时允许重新分析需求，但必须使用本轮保存的最新分析结果，不能把上月理由伪装为新事件。

### 6.3 数据、交互与验收补充

新增 RootResearchHistory：researchScopeId、rootHistoryKey、lastCompletedCycleId、lastCompletedAt、nextEligibleAt、lastOutcome、activeCycleId、revision。领取/创建周期时在同一持久化事务中复查时间与活动周期，防止两个任务同时查询刚到期的词。

结果视图增加“新词根、已到期、本月已查、已有结果更新”筛选。行内展示上次查询、距可复查时间、本轮新关联词数；满期显示“加入复查队列”。未到期不提供普通自动复查入口，“探索新方向”不会清空历史。查询恢复按钮继续处理同一轮未完成工作。

增量验收：第 29 天拒绝新周期、满 30 天准入、跨月月初不清零；改模板/来源/日期不能绕过；缓存失效不提前重查；失败不误记完成；部分成功恢复不重复计数；到期并发只产生一轮；返回重复关联词只更新来源；多周期证据对照不覆盖历史。时间通过可注入时钟测试，不等待实际一个月。

## 7. 存储、队列与恢复协议

首版保持文件存储，所有新发现状态集中在 data/keyword-discovery，通过 discovery-store.js 访问。默认单个后台进程作为写入与执行所有者，CLI/MCP 经服务提交发现任务；不允许另启一个独立后台同时消费同一队列。

写入协议：串行追加带递增 sequence、operationId 和校验信息的事务事件，完成 fsync 后才确认接受；将派生状态写入同目录临时文件并原子替换。一个“页结果已保存”事件同时包含证据引用、下一检查点和本次完成统计，避免多个独立文件互相失配。

重启按快照 lastSequence 重放后续有效事件；尾部不完整事件隔离，已提交序列不回退。先写入不可变证据并持久化，再提交引用事件；崩溃产生的未引用文件可延迟清理。快照压缩和日志清理必须在可恢复检查后执行。

查询状态：pending → waiting_platform → running → completed；可进入 retry_wait、blocked、paused、failed、expired、cancelled。用户暂停的是运行的消费意图；不能把所有共享查询直接取消。

领取任务同时保存 workerId、ownerEpoch、leaseUntil；每个浏览器动作及结果提交前确认所有权。旧 epoch 的提交被拒绝。租约过期后先确认旧执行者已退出或已失去浏览器控制，再恢复；不能仅凭超时就同时启动第二个浏览器操作者。

同一浏览器上下文的一次查询与连续翻页需要会话所有权，不能在翻页中途让另一个任务切换页面。主动进入长时间休息后可释放会话，但恢复时必须重新定位并确认查询上下文。

分页 checkpoint 保存 queryKey、lastCommittedPage、rowKeys、contextFingerprint。页面内容发生变化、排序不稳定或无法跳页时，重新定位并去重采集，明确记录恢复动作；不承诺所有页面都能无网络请求地跳到下一页。

暂停命令返回“暂停请求已接受”，页面动作结束或超时后到达 paused。恢复从已提交检查点继续。请求超时重发不能重复入队或重置检查点。

## 8. 限流与每日任务

共用 core/platform-access-guard.js。现有 45～90 秒查询间隔、批次休息可作初始配置，实施时核实实际动作覆盖和页面内翻页频率。沿用平台阻塞和冷却，不以随机间隔作为不会触发限制的承诺。

每日 occurrenceKey = profileId + businessDate。启用后按 Asia/Shanghai 调度；修改计划不会在同日额外生成自动运行。手动重跑使用明确的新 iteration 和 operationId。

输入不限总条数，执行受时间窗口、费用预算和平台状态控制。当前有效积压优先续查；新闻、常青、未知商品保留可配置份额。过期条件取需求 validUntil，超预算显示“等待下个执行窗口”。

本轮对 bin/server.js 和 core/server 的检查未确认独立、持久化的每日触发器，不能将已有工作流 scheduler 直接视作定时系统。实施时补齐计划注册、启动扫描、单业务日防重和离线只补最近有效窗口。

服务停止时不承诺后台执行；界面显示服务状态、下次运行时间、上次执行和错过窗口。手动暂停的任务保持暂停，定时任务不能隐式恢复它。

## 9. 评分、确认与后续选品

discoveryScore 只用于排查询顺序；marketScore 使用真实证据。首版保留当前市场规则的主要权重，先修正数据语义和结果解释，再用历史快照对照新规则。

conclusion：passed、watch、rejected、insufficient_data。failed/blocked 属于查询状态，不属于市场判断。只有关键指标达到明确规则且证据完整时自动 passed；不得仅靠高发现分放行。

ManualChoice 为 include、exclude、watch、clear，显示自动结论。include 不能篡改证据；因技术失败没有证据的词仍不能在自动模式中伪装为已验证。

确认交付生成不可变 selectedKeywordSnapshot，保存候选 ID、决定版本、证据 ID 和来源词根。后续选品读取该快照，新增晚到结果不会修改已开始的选品输入。

确认时若仍有未完成查询，必须选择“继续等待”或“使用当前结果”。后者停止该运行的剩余消费并冻结快照，返回被排除的未完成数量。其他运行对共享任务的订阅仍然有效。

## 10. API 和事件契约（拟新增）

API 挂在现有 Express 应用，最终路径在阶段一与现有路由核对。

| 方法/路径 | 输入 | 返回 |
| --- | --- | --- |
| GET /api/discovery/sources | 无 | 来源配置状态、最近成功时间、错误 |
| GET /api/discovery/profiles/:id | 无 | 配置及 revision |
| PUT /api/discovery/profiles/:id | 配置、expectedRevision | 新 revision，冲突返回 409 |
| POST /api/discovery/runs | profileId、operationId、iteration | 202、runId、operationId、初始 snapshot |
| GET /api/discovery/runs/:id/candidates | cursor、pageSize、筛选、排序 | rows、nextCursor、counts、revision |
| POST /api/discovery/runs/:id/commands | action、operationId、expectedRevision | 202、commandId、当前状态 |
| PATCH /api/discovery/runs/:id/choices | candidateIds、action、reason、expectedRevision | 更新后的 revision 与冲突明细 |
| POST /api/discovery/runs/:id/confirm | operationId、expectedRevision、remainingPolicy | frozenSnapshotId、下一节点 |

命令 action：pause、resume、retry_failed、explore_more、expand_direction。相同 operationId 和相同内容返回原结果；相同键不同内容返回 409。恢复命令须检查平台状态，不能因点击“已恢复”就跳过实际校验。

使用既有运行事件流，增加 discovery_progress、query_progress、platform_wait、candidate_updated、decision_updated、command_applied。事件带 runId、eventId、revision；前端回放去重，发现缺口拉取快照。

统计字段区分 rootsQueued、rootsCompleted、pagesCommitted、keywordsDiscovered、evidenceReused、passed、watch、rejected、insufficientData、technicalFailures。动态新增候选后百分比可变化，因此主要展示计数和阶段，不制造稳定但不真实的百分比。

## 11. 节点弹窗与操作细节

配置弹窗包含“分析方向、经营范围、来源与时效、执行计划”四个页签。维度用复选框，词条用可批量粘贴的输入框，日期/地区用对应控件，定时启用使用开关。未配置新闻源不能显示为已开启实时新闻。

需求结果弹窗按主维度筛选，列出人群/职业、场景、问题、商品词根、来源数、发现优先级。行展开显示所有推导链；来源原文可点击打开。

验证弹窗固定头部统计、居中的可滚动结果表和底部操作栏。默认列：最左侧勾选、关键词、来源词根、需求摘要、搜索人气、需求供给比、转化率、推荐类目、结论。未知字段显示具体状态；错误提示占独立行，避免被表格遮挡。

节点仅保留一个主要结果入口：“筛选词根”或“查看并确认关键词”。产物内容放在同一个弹窗的结果区域，避免“处理复核”和“查看产物”打开两个重复窗口。

运行中显示暂停；暂停中禁止重复提交并显示等待动作完成；已暂停显示继续；阻塞时显示对应恢复按钮和原因。打开 Chrome 的成功只是环境操作成功，不等同于查询恢复成功。

选择可跨分页保留，默认作用于明确候选 ID。“全部选择”必须区分当前页与当前筛选结果；确认后返回数量、下一节点和已冻结快照，刷新页面仍可恢复。

## 12. 分阶段实施清单

| 阶段 | 修改位置 | 可验收交付 |
| --- | --- | --- |
| A. 契约与基线 | 新增证据指标规范化模块；检查 keyword-verification-flow、root-keyword-expansion-flow | 指标零/缺失/区间分开；上下文不匹配不复用；旧快照可读 |
| B. 持久化队列 | discovery-store、队列执行器、现有平台 guard 与 runtime | 重启恢复、并发互斥、旧 owner 拒绝提交、分页恢复和暂停可观测 |
| C. 多维发现 | dimension-catalog、demand-hypotheses、inspiration-sources/productizer/engine | 常青多维生成、新词通道、真实时效、完整多来源链、可复现恢复 |
| D. 画布闭环 | 新版模板、action registry、结果弹窗、API、artifact view | 节点内配置/筛选/暂停/恢复/确认；输入冻结后正确进入选品 |
| E. 每日运行 | 持久化计划、业务日去重、积压策略、反馈统计 | 每日唯一启动、手动暂停不被覆盖、过期清理、预算续跑 |

阶段 A 与 B 使用模拟输入和已有快照，不需要真实新闻或生意参谋才能完成基础验收。阶段 C 可先交付常青维度，新闻源验证后启用。阶段 D 前就提供阶段 C 的可检查结果，避免长时间只有后台代码没有可用界面。

测试统一放 test/unit/skills、test/unit/web、test/integration、test/browser，按行为覆盖：缺失值判定、证据隔离、多来源去重、队列崩溃恢复、跨运行订阅取消、人工选择冲突、晚到结果与确认快照、跨日触发和移动端滚动。

测试通过后以相同经营范围、相近查询预算对照原策略，记录新商品家族比例、每小时有效词数、人工保留率、数据不足率和平台故障率。先测基线，再定改善目标；不预先承诺命中率或成交提升。

## 13. 首个可交付版本

第一版以“职业、爱好、人群、季节、场景 → 需求解释 → 商品词根 → 共用生意参谋验证 → 节点内确认”为完整交付目标。包含暂停恢复、来源追溯、指标解释和不重复查词。真实新闻采用已验证的配置来源；每日定时在上述链路验收后开启。

无需用户逐项选择内部存储、哈希算法和模块命名。实际启用前界面需要配置经营品类、可用来源和执行时间；设计阶段不代替用户启用自动计划。
