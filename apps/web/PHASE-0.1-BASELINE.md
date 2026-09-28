# Phase 0.1 盘点基线

## 范围与证据

基线提交：`3b7d4eb`（master）。本次只修正文档，不修改运行代码或业务规则。路径均相对于仓库根目录；本文件记录状态语义与调用关系，不把静态代码覆盖视为浏览器验收通过。

## 基线命令与环境

| 命令 | 本次复核结果 |
| --- | --- |
| `npm run build --prefix apps/web` | 通过；282 modules，2 个 JS chunk 超过 500 kB 的既有警告 |
| `npm run lint --prefix apps/web` | 0 errors，11 warnings |
| `node --test test/unit/web/*.test.mjs` | 163 pass，0 fail，7 suites |
| 浏览器回归 | 入口及五个遗漏专项由本次 Phase 0.2 复核逐项执行；结果见文末记录，不以此表推定全部通过 |

构建、lint、单测日志分别位于 `/tmp/phase01-review-build.log`、`/tmp/phase01-review-lint.log`、`/tmp/phase01-review-unit.log`，属于本机临时复核证据，不是仓库永久归档。

| 环境项 | 实测值 |
| --- | --- |
| 系统 | darwin / arm64 |
| Node | v22.22.3，`/Users/sunnstars/.hermes/node/bin/node` |
| npm | 10.9.8 |
| Chrome | 153.0.8010.54，`/Applications/Google Chrome.app` |
| Playwright | 1.62.1，Codex bundled runtime；项目默认 `require('playwright')` 无法解析 |
| 前端构建 | Vite 8.1.0、React 19.2.7、React Flow 12.11.1、Tailwind 4.3.1 |

浏览器脚本使用 `channel: 'chrome'`。不能将“项目未声明 Playwright”写成“机器没有浏览器/无法测试”，也不能仅安装 Chromium 就假定满足 Chrome channel 要求。本机可不修改依赖，使用：

```bash
ECOM_PLAYWRIGHT_MODULE=/Users/sunnstars/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright npm run test:workflow-browser
```

该路径是本机配置，不应硬编码进业务代码；其他机器需确认自己的 Playwright 与 Chrome 路径。回归使用独立 headless Chrome 和本地替身，不连接真实商家会话、不真实铺货。

### 既有 lint 警告

| 规则 | 文件 | 内容 |
| --- | --- | --- |
| no-unused-expressions | category-root-picker.jsx:43 | Set toggle 表达式 |
| no-unused-vars | use-workflow-confirmations.js:12 | activeTemplateMode 未使用 |
| no-unused-vars | workflow-launch-params.js:56 | catch 参数未使用 |
| no-useless-escape | workflow-launch-params.js:33 | URL 正则转义 |
| exhaustive-deps | use-workflow-run-catalog.js:71–74 | cleanup 直接访问 ref.current，共四条 |
| exhaustive-deps | use-workflow-request-scope.js:10 | 工具报告 viewKey 依赖不必要；实际用于切换请求作用域，不能直接删除 |
| exhaustive-deps | shop-picker.jsx:26 | effect 的 value 依赖 |
| no-unused-vars | watermark-studio-panel.jsx:109 | catch 参数未使用 |

## 状态分层与数据流

### 四种状态不得混用

| 层级 | 来源/转换 | 消费者 |
| --- | --- | --- |
| 业务摘要 `summary.status` | `skills/pipeline-flow/src/` 各 flow、表格和同行 skill | runtime 停止/继续判断、摘要展示、节点状态规划 |
| 执行态 `runtime.status` | `skills/pipeline-flow/runtime/runner.js` 与 runtime store | 工作流 API、SSE、运行操作 |
| API `run.status` | `core/workflow/pipeline-runs.js: pipelineSummaryToWorkflowRun` | Web session/runtime、历史展示、活跃判断 |
| 节点 `nodeStates[id].status` | `core/workflow/pipeline-node-state.js: buildNodeStates` | 节点色调、按钮、进度、阻塞详情 |

API 的优先级明确为 `runtime?.status || summary.status || 'unknown'`。有 runtime 的运行与没有 runtime 的旧历史不可直接套用同一张业务字符串表。

节点状态先由业务摘要和模式规划，再应用 runtime progress，最后处理 activeStep；因此摘要映射并非最终节点状态的唯一来源。

### 代表性映射

以下为正常运行停止/完成边界的映射，不表示每个中间业务状态都调用一次终态转换。

| 业务状态 | runtime 边界结果 | 有 runtime 时 API 状态 | 节点规划/用途 |
| --- | --- | --- | --- |
| mining_empty、mining_manual_action_required | blocked | blocked | mine 阻塞，不是正常结束 |
| awaiting_keyword_review、keyword_review_empty | blocked | blocked | keywordReview 阻塞，提供人工处理 |
| verified_empty、verified_no_generation_eligible、verified_partial_manual_required、manual_action_required | blocked | blocked | 按模式阻塞 verify 或采集等节点 |
| awaiting_product_review | blocked | blocked | 节点结合 runtime progress；progress 的该值归一化为 waiting_confirmation |
| select_failed、generate_failed | failed | failed | 对应选品/标题节点失败 |
| needs_review、ready_to_distribute、awaiting_user_confirmation | needs_review | needs_review | 铺货节点 needs_review / waiting_confirmation，按模式确定 |
| workflow_complete | completed | completed | 对应模式结束节点完成；不是未使用状态 |
| paused / cancelled | paused / cancelled | paused / cancelled | 保留暂停/取消语义 |
| keywords_reviewed、products_selected、generated 等中间业务结果 | 正常继续时仍处于 running | running（正常继续时） | 推进后续步骤；不能仅凭业务字符串判定 UI 停止 |

源码锚点：`runner.js: STOP_STATUSES / runtimeStatusForPipelineStatus`、`pipeline-runs.js: pipelineSummaryToWorkflowRun`、`pipeline-node-state.js: statusPlanForSummary / buildNodeStates`。

`runtimeStatusForPipelineStatus` 的默认结果为 completed，但它用于停止/结束边界；不能把该函数孤立应用到每个中间状态推导运行完成。

### 历史、未知值与显示兜底

- 无 runtime 的旧历史：API 可直接回退到业务状态，前端现有兼容分支仍有意义，不能删除。
- `workflow-history-view.js` 的 `getPipelineVisualState` 明确处理 workflow_complete、失败字符串、requiresUserAction 和中间业务状态；“不在 ACTIVE 中”不等于“前端未使用”。
- `pipeline-labels.js` 未命中标签时保留原字符串；`workflow-node-view.js` 有 cancelled 的“已取消”标签，不能写为未处理。
- 未知业务摘要：`statusPlanForSummary` 默认标记开始已完成、mine 运行中，之后可能被 runtime 覆盖。这是现状，不是本轮修改建议。
- 节点 tone 未命中时为 muted；未知节点/动作保留现有兜底。单纯集合未命中不能证明运行结束。
- `review` 历史节点通过 `effectiveCanvasNodeId` 映射为 export；`getCanvasNodeState` 会合并旧 review/export 状态，保留干预状态优先逻辑。
- 表格和同行的 review_source_imported、products_confirmed、competitor_* 等业务状态通过模式及 runtime 映射参与展示，不称为无用或未来预留。

### 两个前端活跃集合的真实差异

| 字符串 | workflow-data ACTIVE_RUN_STATUSES | getWorkflowRuntimeActions 的 activeRunStatuses |
| --- | --- | --- |
| pending、running、created、mined、verified、generated、resuming、retrying、awaiting_keyword_review | 有 | 有 |
| products_selected、awaiting_product_review | 有 | 无 |
| keywords_reviewed | 无 | 有 |

节点暂停动作还要求节点状态为 running/resuming/retrying；Studio 顶部暂停条件使用自己的 isRunActive。故不能推断“整个页面没有暂停按钮”。这些差异在业务状态直接进入 API 或历史 fallback 时值得补用例，但不能推定现代 runtime 路径必现错误，也不能自动合并集合。

### 铺货任务另属一个状态域

来源：`core/server/distribution-routes.js`、`distribution-jobs.js`；消费：`use-distribution-job.js`。

- submitting：提交中；checking_confirmation：重新核对。
- paused / cancelled：暂停、取消；failed：任务失败。
- completed：全部确认完成；completed_with_issues：仍有问题，需要继续核对。
- 轮询终态集合只有 completed、failed、cancelled；completed_with_issues 继续轮询，不能因名称含 completed 就停止。
- 商品条目、平台访问和种子池属于其他状态域，不混入工作流常量。本表不声称枚举这些域的全部状态。

## 调用关系与状态归属

### 静态依赖（关键子图，不代表全仓库循环依赖扫描）

```text
WorkflowStudio
  -> useWorkflowRuntime -> useWorkflowEvents -> workflow-event-connection
  -> useWorkflowOperations -> useWorkflowLaunch / useWorkflowCommands
  -> useWorkflowSession -> runtimeNodeFields（纯值导入）
  -> useWorkflowOverlay / useNodeArtifact / useWorkflowConfirmations
  -> WorkflowOverlayManager / NodeOperationPanel
       -> DistributionExportPanel -> useDistributionJob
useWorkflowCommands / useWorkflowConfirmations -> useWorkflowRequestScope
```

### 运行时回调链路

| 触发 | 链路与写入 | 生命周期约束 |
| --- | --- | --- |
| 节点按钮 | normalizeCanvasNode 嵌入回调 → dispatchNodeAction → nodeInteractionRef → handleNodeAction → 既有 action registry → command/overlay | 稳定包装器读取最新处理器，不因闭包变更重建所有节点 |
| 节点字段修改 | dispatchNodeUpdate → nodeUpdateRef → updateNodeData / 模式切换 | 历史只读及重建运行规则保持 |
| 打开节点弹窗 | handleNodeAction → selectedNodeId + openOverlay → useNodeArtifact；Studio effect 对同节点产物 refreshArtifact | 关闭由 closeOverlay 清空；重开仍刷新服务端草稿 |
| 历史/模板切换 | loadHistoryRun / loadTemplate / resetRunView → historyRequestRef 失效、disconnectRunEvents → 节点/边、运行、日志、产物重置 | 迟到历史响应不能覆盖新视图；保留模式草稿 ref |
| 重复运行 | repeatWorkflow → buildFreshRunNodes → resetRunView → launchWorkflow(新节点快照) | 不使用尚未提交的旧 React state |
| 启动/远程操作 | launchWorkflow 或 runRemoteOperation → API → listenToRunEvents / reloadRun | launch 防重；command request-scope 防重及跨运行失效 |
| SSE | useWorkflowEvents → handleRuntimeMessage → runStatus、节点、日志；终态刷新历史 | 连接隔离、重放处理和订阅清理 |
| 人工确认 | Confirmations → API → resume/reloadRun、产物更新、closeOverlay | confirmation ticket 必须仍属于当前 scope |
| 铺货状态变更 | useDistributionJob.setJob → onJobChange → onDistributionJobChange → Studio.updateDistributionNodeJob | revision 防旧轮询覆盖；jobId 完成通知去重 |
| 铺货完成 | updateDistributionNodeJob → export.distributionJob、关闭弹窗、追加日志 → loadHistoryRunRef(job.workflowRunId) → fetchHistoryRuns | 依靠新快照进入 end，不能只改弹窗状态 |

### 主要状态所有者与写入入口

| 状态 | 创建位置 | 写入入口 |
| --- | --- | --- |
| nodes / edges | Studio 的 React Flow hooks | Session 模板/历史/重置；runtime 快照/进度；Studio 配置/铺货回调；launch/commands 操作反馈；React Flow change handlers |
| currentRunId / runStatus / logs | useWorkflowRuntime | runtime 事件；Session 加载/重置；Launch 启动；Commands、Confirmations 操作反馈 |
| selectedNodeId | Studio | 点击、动作路由、Session、runtime 注入的选择回调 |
| artifactState | useNodeArtifact | 自身加载、Session 重置、Confirmations 更新 |
| activeOverlay | useWorkflowOverlay | Studio 打开；Session/Confirmations/完成回调关闭 |
| distribution job | useDistributionJob | 还原请求、轮询、提交、人工完成、重新核对 |

不再用 setter 文本出现次数称作“写入者数量”。跨模块共享 setter 不意味着应创建另一份全局状态。

### Callback-ref 与配置重置

- nodeInteractionRef、nodeUpdateRef：每次 render 更新处理器，传给节点的 dispatch 包装器稳定。
- loadHistoryRunRef：给 Operations、Confirmations 和铺货完成回调提供最新历史加载函数，不是节点专属回调。
- resetWorkflowNodeData 清理运行字段并保留配置；normalizeCanvasNode 保留输入数据并补默认值，两者目的不同。抽公共字段前逐项验证默认值、覆盖顺序、引用和回调，不能机械合并。

## CSS 约束

- App.css 是工作流样式入口；index.css 也包含全局规则，不能忽略其影响。
- 保持 styles/README.md 中的导入顺序及 theme-overrides 后置覆盖。
- 纯文件搬迁可对比 CSS 字节；等值令牌化后不要求字节相同，应对比计算样式和截图。
- 修改选择器前检查所有定义，url 路径以文件位置为准。

## 后续门禁

- Phase 0.1 完成的是语义/依赖盘点，不代表 Phase 0.2 的缺口用例与截图基线已经完成。
- 浏览器本次逐脚本结果、静态覆盖误判和缺失用例见 Phase 0.2 复核结论；无需因环境误判先安装依赖。
- 进入常量整理前，必须保留 runtime 正常路径、无 runtime 历史 fallback、节点状态和铺货任务状态的区分。

## 本次浏览器实测记录

使用上述 ECOM_PLAYWRIGHT_MODULE，按顺序直接运行 `node test/browser/<脚本名>`；未修改统一入口。每个进程单独启动和清理本地 Vite、headless Chrome。5173 已被占用时由 Vite 自动选择其他端口，不停止原有服务。

| 脚本 | 退出码 |
| --- | --- |
| workflow-hook-races.mjs | 0 |
| workflow-session-races.mjs | 0 |
| workflow-studio-ui.mjs | 0 |
| keyword-filter.mjs | 0 |
| distribution-categories.mjs | 0 |
| distribution-job-refresh.mjs | 0 |
| distribution-copy-formats.mjs | 0 |
| distribution-shops.mjs | 0 |
| unified-selection.mjs | 0 |
| discovery-direction.mjs | 0 |

日志：`/tmp/phase02-browser-review.log`。Studio 截图输出到 `/tmp/workflow-studio-qa`；复制专项输出到 `/tmp/distribution-copy-qa`；店铺专项输出到仓库忽略目录 `output/shop-qa`。这些是当前测试产物，不是已审批、版本化的视觉对比基线，本次也未宣称人工逐张视觉验收通过。

结论：已证明本机可以运行现有十个浏览器专项，不能据此断言 Phase 0.2 九大场景全部覆盖。现有入口仍只包含五个脚本，新增用例及稳定视觉基线仍待完成。
