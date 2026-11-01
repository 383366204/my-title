# ADR v1.0: my-title Agent 平台改造架构决议与基线清单

> **状态**：Accepted / Consensus v1.0  
> **更新日期**：2026-11-01  
> **联合评审方**：Antigravity (`f448f962-c7ec-4a7b-9d07-8608fb4cacf9`) × ChatGPT / Codex (`01a1923e-ce06-7be1-9048-600788b64ead`)  
> **代码基线**：`master` (`bbf6a1b`)  
> **关联计划**：`/Users/sunnstars/Downloads/my-title-agent-platform-refactor-plan.md`

---

## 1. 背景与问题陈述

`my-title` 已具备完整的电商选品、生意参谋（SYCM）查词、1688 货源搜索、标题生成、同行发现（以货找店 / 图搜选货）、竞争对手溯源、刷单/评价表与多平台铺货能力，并提供了 CLI、MCP Server（`bin/mcp-server.mjs`）和 React Web 工作台（`apps/web` + `bin/server.js`）。

在向可扩展 Agent 平台演进时，当前代码库存在四个必须收敛的工程问题：

1. **双轨制 Workflow 并存**：
   - 原型图执行器：`core/workflow/scheduler.js` + `core/workflow/registry.js` + `core/workflow/run-store.js`（默认模拟节点，仅在 legacy fallback 分支与旧恢复测试中使用）。
   - 生产流水线执行器：`skills/pipeline-flow/runtime/runner.js` + `skills/pipeline-flow/runtime/store.js` + `core/workflow/pipeline-runs.js`（承载全部真实业务）。
   - 此外，步骤顺序在 `skills/pipeline-flow/runtime/runner.js` 与 `core/workflow/pipeline-templates.js` 中双份维护，且 HTTP 控制逻辑在 `core/server/pipeline-routes.js` 与 `core/server/workflow-control-routes.js` 中重复实现。
2. **跨进程浏览器争用隐患**：
   - 生意参谋、淘宝图搜、1688 网页采集与铺货均共享本机 Chrome CDP（默认端口 `9222`）。
   - 现有 `createWorkbenchCoordinator`（`core/server/workbench-coordinator.js`）仅在单进程内存闭包内生效；`core/platform-access-guard.js` 虽提供按平台维度的文件锁，但不同平台任务（如淘宝图搜与 1688 网页采集）在 CLI、stdio MCP、Web Server 多进程并发启动时仍可能争用同一 Chrome CDP 实例。
3. **入口与工具胶水逻辑分散**：
   - `bin/mcp-server.mjs`（1516 行）同时内嵌了 12 个 `server.tool()` 注册点、内存异步任务表、独立 HTTP/SSE Server 与业务 Adapter，未与 `bin/server.js` 共享统一执行层。
4. **业务复核与高危副作用授权未分离**：
   - 筛词/选品复核（允许 Agent 辅助生成草稿并修订业务输入）与铺货上架（不可逆外部写操作，严禁模型自批）需要明确的模型隔离与提交账本保护。

---

## 2. 核心架构决议（D1–D11）

| 编号 | 决议主题 | 决议内容与强约束 |
| :--- | :--- | :--- |
| **D1** | **保留现有目录与模块制式** | 保持 CommonJS、现有 `skills/<domain>/` 路径与直接引用约定（不设纯 re-export barrel）；**砍掉** `capabilities/` + `agent-skills/` 目录大迁移。 |
| **D2** | **显式装配替代 AppKernel** | **砍掉**微内核与插件生命周期概念；采用显式依赖装配函数（如 `createWorkflowControlService`），模块按职责接收窄接口，禁止把 Context 变成全局 Service Locator。 |
| **D3** | **ToolRegistry 与 Executor 分离** | `ToolRegistry` 仅保存工具定义（Schema、兼容名称、风险、资源键与平台依赖）；`ToolExecutor` 统一负责参数校验、授权核验、资源租约获取、平台冷却检查与事件追踪。 |
| **D4** | **多入口共享服务与双粒度调用** | HTTP、CLI、MCP、Web Agent 共用应用服务层。支持两种调用粒度：<br>1) **单步或自由组合操作**（如“只查词”、“查词+生成标题”）：直接调用 `ToolRegistry` 中的独立原子 Tool（`sycm.query`、`keyword.suggest`、`title.generate` 等）；<br>2) **规范流水线或局部阶段流水线**：调用 5 个 `workflow.*` 组合工具（`workflow.start` 支持 `stopAfterStep` 局部阶段执行）。 |
| **D5** | **单服务优先 + 跨进程资源租约** | CLI、stdio MCP 优先将执行命令转发给已运行的本地 Runtime Server（转发超时通过幂等请求查询原操作，禁止静默切换本地重跑）；当本地无常驻服务时，通过跨进程原子文件租约（`data/runtime/workbench-lease.json`，绑定 `cdp:<port>` 资源键、唯一 `ownerToken`、`pid`、心跳及旧持有者失效检查）在本地执行。 |
| **D6** | **唯一固定 Workflow Runner** | 以现有 `skills/pipeline-flow` 渐进收敛为唯一固定 Workflow Runner；统一 `runtime/runner.js` 与 `pipeline-templates.js` 的步骤定义；React Flow 画布仅作为只读状态投影（`core/workflow/pipeline-runs.js`）与参数配置界面；迁移恢复测试后退役 `core/workflow/scheduler.js`。 |
| **D7** | **异步长任务与安全取消** | `workflow.start / resume` 快速返回持久化回执；模型等待、人工复核（`needs_review`）与平台阻塞（`blocked`）期间**不持有浏览器锁**；取消操作在步骤安全边界生效，底层浏览器操作实际停止前不释放锁。 |
| **D8** | **Review 与 ExecutionApproval 分离** | **Review（业务复核）**：管理灵感词根、筛词、选品的勾选草稿（`reviewDraft`）与过滤参数修订，校验乐观锁 `version`。<br>**ExecutionApproval（高危副作用授权）**：管理铺货发布等外部写操作，绑定精确输入摘要（`inputDigest`）与 Run `revision`（修改店铺/商品后旧授权立即失效），**严禁模型通过 Tool 自行批准**，并配合提交账本（`SubmissionLedger`）防止崩溃后重复提交。`workflow.resume` 仅表示尝试推进，绝不隐含审批通过。 |
| **D9** | **原子快照与事件恢复规则** | `skills/pipeline-flow/runtime/store.js` 升级为 `tmp + rename` 原子写入，维护 `revision` 与 `attempt`；快照与领域产物保存业务事实，事件流用于审计与 SSE 重连。 |
| **D10** | **文件级 Skill 与先外后内演进** | Skill 采用 `skills/*/SKILL.md` 文件索引与按需加载；优先完成外部 Harness（Codex / Antigravity / dsh）的标准 MCP/CLI 接入闭环（PR-07），再增量建设 Web 内嵌 Agent Runner 与聊天侧边栏（PR-08/09）。 |
| **D11** | **v1.0 明确排除项** | v1.0 **不包含** AI 动态生成 DAG 图、专用 `adapters/harness/` 适配层、多 Subagent 编排、TypeScript / Next.js / Zustand 重写。 |

---

## 3. 全量执行入口与工具基线清单

### 3.1 MCP 工具基线清单（`bin/mcp-server.mjs` 现有 12 个注册点 + 新增 5 个 Workflow 工具）

> **兼容承诺**：现有 12 个 MCP 工具的名称、入参 Schema 与返回格式在 PR-03 / PR-07 迁移至 `ToolRegistry` 后保持 100% 向后兼容。

| 分类 | 现有 MCP 工具名 (`mcpName`) | 标准 Registry ID (`id`) | 所在领域实现 | 资源锁 / 平台依赖 | 执行形态 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **淘宝 OPC** | `taobao_opc_list_tools` | `taobao_opc.list_tools` | `skills/taobao-opc/src/mcp-client.js` | `none` | 同步返回 |
| **淘宝 OPC** | `taobao_opc_call` | `taobao_opc.call` | `skills/taobao-opc/src/mcp-client.js` | `none` | 同步返回 |
| **标题生成** | `generate_title` | `title.generate` | `skills/title-gen/src/pipeline.js` | 可选 `cdp:<port>` (`sycm_auto`/`use_image_search`) | `research=true` 同步；默认异步 `task_id` |
| **标题生成** | `batch_generate_titles` | `title.batch_generate` | `skills/title-gen/src/batch.js` | `1688` API 限流 | 异步 `task_id` |
| **1688 洞察** | `opportunities` | `alibaba.opportunities` | `skills/alibaba1688/src/insights.js` | `1688` API 限流 | 同步返回 |
| **1688 洞察** | `trend` | `alibaba.trend` | `skills/alibaba1688/src/insights.js` | `1688` API 限流 | 同步返回 |
| **生意参谋** | `sycm_query` | `sycm.query` | `skills/sycm-research/src/sycm-cdp-extractor.js` | `cdp:<port>` + `platform:sycm` | 同步/缓存返回 |
| **生意参谋** | `sycm_status` | `sycm.status` | `core/runtime` (原 `sycmDataStore`) | `none` | 同步返回 |
| **关键词挖掘** | `suggest_keywords` | `keyword.suggest` | `skills/title-gen/src/keyword-suggester.js` | `sycm_verify=true` 时需 `cdp:<port>` + `sycm` | 同步返回 |
| **同行发现** | `discover_peers` | `peer.discover` | `skills/peer-discovery/src/peer-task-coordinator.js` | `cdp:<port>` + `taobao` / `1688` | 异步 `taskId` |
| **同行发现** | `get_peer_discovery_status` | `peer.status` | `skills/peer-discovery/src/peer-task-coordinator.js` | `none` | 同步返回 |
| **同行发现** | `cancel_peer_discovery` | `peer.cancel` | `skills/peer-discovery/src/peer-task-coordinator.js` | `none` | 同步返回 |
| **工作流控制 (PR-07 新增)** | `workflow_start` | `workflow.start` | `core/workflow/control-service.js` | `workbench` + 模板对应平台 | 异步返回 `runId`（支持 `stopAfterStep`） |
| **工作流控制 (PR-07 新增)** | `workflow_status` | `workflow.status` | `core/workflow/control-service.js` | `none` | 同步返回状态与节点产物预览 |
| **工作流控制 (PR-07 新增)** | `workflow_submit_review` | `workflow.submit_review` | `core/workflow/control-service.js` | `none` | 同步返回复核状态与 `version` |
| **工作流控制 (PR-07 新增)** | `workflow_resume` | `workflow.resume` | `core/workflow/control-service.js` | `workbench` + 步骤对应平台 | 异步返回（`continue` \| `retry_step`） |
| **工作流控制 (PR-07 新增)** | `workflow_cancel` | `workflow.cancel` | `core/workflow/control-service.js` | `none` | 同步返回 `cancel_requested` |

### 3.2 HTTP Server 路由入口清单（`bin/server.js` + `core/server/*.js`）

> **兼容承诺**：[`test/fixtures/server-route-contract.json`](file:///Users/sunnstars/Documents/Codex/2026-06-11/new-chat/work/my-title/test/fixtures/server-route-contract.json) 与 [`test/integration/server-route-contract.test.js`](file:///Users/sunnstars/Documents/Codex/2026-06-11/new-chat/work/my-title/test/integration/server-route-contract.test.js) 中的全部路由路径、HTTP 方法与返回结构保持兼容。

| 路由模块 | 路径范围 | 职责说明 |
| :--- | :--- | :--- |
| `core/server/workflow-control-routes.js` | `POST /api/workflows/run`, `/validate`, `/runs/:runId/pause\|resume\|retry-node\|cancel`, `/inspiration-roots`, `/keyword-filter/recollect`, `/keywords/query` | 画布端工作流启动、控制与阶段重采/补查入口（PR-02 委托至 `WorkflowControlService`）。 |
| `core/server/pipeline-routes.js` | `GET /api/pipeline/current`, `/runs/:runId`, `POST /api/pipeline/start`, `/runs/:runId/pause\|resume\|candidates\|:step/retry\|:step` | Pipeline 运行时入口（PR-02 与 `workflow-control-routes.js` 共用 `WorkflowControlService`）。 |
| `core/server/workflow-query-routes.js` | `GET /api/workflows/templates`, `/runs`, `/runs/:runId`, `/runs/:runId/nodes/:nodeId/artifact`, `/runs/:runId/events`, `DELETE /api/workflows/runs/:runId` | 工作流模板、历史记录、节点产物、SSE 事件流与删除。 |
| `core/server/selection-review-routes.js` | `POST /api/workflows/runs/:runId/keyword-review`, `/product-review` | 关键词筛选与选品复核提交。 |
| `core/server/keyword-filter-routes.js` | `GET\|POST /api/workflows/runs/:runId/keyword-filter` | 运行级关键词指标过滤配置与草稿保存。 |
| `core/server/distribution-routes.js` | `POST /api/distribution/check`, `/run`, `/manual-complete`, `/runs/:jobId/recheck`, `/chrome/start`, `GET /api/distribution/shops`, `/targets`, `/runs/:jobId` | 1688 铺货预检、自动/人工铺货任务与日志复核。 |
| `core/server/peer-review-routes.js` | `GET\|POST /api/workflows/runs/:runId/peer-review/*` | 同行发现选货铺货草稿与店铺分配复核。 |
| `core/server/competitor-sourcing-routes.js` | `GET\|POST /api/workflows/runs/:runId/competitor-sourcing/*` | 指定店铺竞品 1688 货源匹配、截图比对与转铺货。 |
| `core/server/category-routes.js` | `GET\|POST /api/workflows/runs/:runId/categories/*` | 铺货类目校验与批量复制。 |
| `core/server/order-sheet-draft-routes.js` | `GET\|POST /api/workflows/runs/:runId/order-sheet(-draft)` | 刷单表草稿读写（确认路由位于 `bin/server.js`）。 |
| `core/server/platform-routes.js` | `GET /api/platform-access`, `POST /api/workflows/sycm/chrome/start`, `/taobao-native/start` | 平台访问状态查询、Chrome 调试启动与恢复。 |
| `core/server/seed-routes.js` & `research-routes.js` | `/api/seeds/*`, `/api/mine`, `/api/generate`, `/api/opportunities`, `/api/sycm/extract`, `/api/1688/resolve-share` | 词根池管理与单点研究接口。 |
| `core/server/workbench-routes.js` | `GET /api/workflow/batches`, `POST /api/workbench/run` | 批次摘要与 CLI 子进程执行入口。 |

### 3.3 CLI 入口清单（`bin/cli.js`）
- 单点命令：`<keyword>`（默认生成标题）、`opportunities`、`trend <query>`、`sycm <keyword>`、`sycm-status`、`search-1688-web`、`search-1688-web-health`、`title-gen-preflight`、`reverse-mine <keyword>`、`discover-peers`、`distribute`、`doctor`。
- 词根池命令：`seed list|audit|add`、`seed-add`、`mine-keywords`。
- 流水线命令：`flow daily|mine|review|verify|select|generate|export|keyword|opportunities`、`workflow run|resume`。

---

## 4. 状态机与持久化存储所有权清单

| 存储路径 | 读写模块 | 职责与所有权 | 演进规则 |
| :--- | :--- | :--- | :--- |
| `data/pipeline/runs/<runId>/runtime.json` | `skills/pipeline-flow/runtime/store.js` | **执行状态唯一事实源**：记录 `status`、`activeStep`、`steps`、`params`、`progress`、`control`、`blocker`。 | PR-05 升级为 `tmp + rename` 原子写，新增 `revision` 与 `attempt`。 |
| `data/pipeline/runs/<runId>/events.jsonl` | `skills/pipeline-flow/runtime/store.js` | 运行时事件追加日志（供审计与 SSE 重连）。 | PR-05 规范状态更新与事件写入顺序。 |
| `data/pipeline/runs/<runId>/run.json` 及 `*.jsonl` | `skills/pipeline-flow/src/run-store.js` | **领域产物事实源**：记录 `candidates.jsonl`、`verified.jsonl`、`selected-products.jsonl`、`titles.jsonl` 等业务数据及统计计数。 | 保持领域产物独立存储，不塞入 `runtime.json`。 |
| `data/pipeline/runs/<runId>/workflow.json` | `core/workflow/pipeline-storage.js` | 启动时的画布工作流模板快照（节点坐标与初始配置）。 | 只读快照；画布实时节点状态由 `core/workflow/pipeline-runs.js` 动态投影生成。 |
| `data/pipeline/distribution-runs/<jobId>.json` | `core/server/distribution-jobs.js` | 铺货作业进度、批次状态与完成记录。 | PR-06 接入 `ExecutionApproval` 与提交账本 `SubmissionLedger`。 |
| `data/platform-guard/<platform>.json` | `core/platform-access-guard.js` | 跨进程平台访问熔断、冷却时间与文件锁。 | PR-03 保留并配合 `data/runtime/workbench-lease.json`（浏览器实例 `cdp:<port>` 跨进程租约锁）。 |
| `data/workflow-runs/<runId>.json` | `core/workflow/run-store.js` | **Legacy 原型图运行记录**（供 `core/workflow/scheduler.js` 使用）。 | **Deprecated**：遵循第 5 节退出规则，在 PR-07 停止写入调度。 |

---

## 5. Legacy 调度器 (`core/workflow/scheduler.js`) 兼容与退出规则

1. **过渡期兼容（PR-01 ~ PR-06）**：
   - `core/workflow/control-service.js` 在处理 `/api/workflows/runs/:runId/pause|resume|retry-node` 时，优先检查 `readRuntimeState({ runId })`（生产 `pipeline-flow` 运行记录）。
   - 仅当 `runtime` 不存在且调用方显式允许 `allowLegacyFallback: true` 时，才回退调用 `markRunPaused` / `resumeWorkflow` / `retryWorkflowNode`（保障 `test/integration/workflow-api-recovery.test.js` 与 `test/integration/workflow-concurrency.test.js` 在过渡期全绿）。
2. **正式退役（PR-07）**：
   - 将 `test/integration/workflow-api-recovery.test.js` 中的暂停/恢复/重试测试全部迁移至统一 `pipeline-flow` Runner。
   - 移除 `workflow-control-routes.js` 与 `control-service.js` 中的 `resumeWorkflow` / `retryWorkflowNode` 调用分支。
   - 删除 `core/workflow/scheduler.js` 与 `core/workflow/registry.js` 的执行调度逻辑；历史 `data/workflow-runs/*.json` 仅保留只读查询兼容，不再启动或恢复任何旧 DAG 节点。

---

## 6. 分阶段实施路线图（PR-01 ~ PR-09）

| 阶段 | PR | 交付范围 | 通过条件 |
| :--- | :--- | :--- | :--- |
| **基线** | **PR-01** | 落盘本 ADR、入口/工具/状态/存储清单、legacy 退出规则；更新 `AGENTS.md`。 | 以当前代码为准，列清全部执行入口与兼容承诺。 |
| **统一入口** | **PR-02** | 新增 `core/workflow/control-service.js`（窄接口应用服务与显式装配）；重构 `workflow-control-routes.js` 与 `pipeline-routes.js` 委托至该服务。 | 现有 HTTP 路由契约保持 100% 兼容；消除两套路由中的重复控制逻辑；全量相关测试通过。 |
| **统一入口** | **PR-03** | 实现 `ToolDefinition`、`ToolExecutor`、跨进程浏览器租约锁（`cdp:<port>`）及首批原子 Tool；打通优先转发本地 Server、无服务时持租约本地执行。 | Web、CLI、MCP 争用同一 CDP 时严格互斥；重复请求幂等返回同一操作。 |
| **Workflow** | **PR-04** | 统一固定模板与步骤定义，支持 `stopAfterStep` 局部阶段执行，固化画布只读投影。 | `daily`、`keyword`、`root-keyword`、`peer-discovery` 两分支等模式的检查点与产物一致。 |
| **Workflow** | **PR-05** | 原子快照写（`tmp + rename`）、Run `revision / attempt`、崩溃恢复与事件一致性校验。 | 注入中断后能恢复或明确进入待核对，不静默跳步或重复执行副作用。 |
| **授权** | **PR-06** | 实现分离的 `ReviewService` 与 `ExecutionApproval`（含输入摘要绑定与提交账本 `SubmissionLedger`）。 | 旧版本拒绝；篡改店铺/商品后旧授权失效；`resume` 不能绕过待审或未授权节点。 |
| **标准接入** | **PR-07** | **里程碑 1**：MCP/CLI 接入共用服务，暴露 5 个 `workflow.*` 工具，迁移恢复测试并退役 `core/workflow/scheduler.js`。 | 现有 12 个 MCP 工具兼容；支持单步原子调用与 `workflow.*` 全流程/局部阶段闭环。 |
| **Agent** | **PR-08** | 验证并扩展 `core/llm-client.js` Tool Calling，实现受限 `AgentRunner`、Skill Loader 与会话恢复。 | 具备轮次/预算限制、取消与工具白名单；能启动流程、读取待审并提出建议。 |
| **Agent** | **PR-09** | **里程碑 2**：`apps/web` 新增右侧 Agent 对话栏与 `WorkflowCard` / `ReviewCard` / `ApprovalCard`。 | 刷新及 SSE 重连后状态一致；用户确认通过可信入口落盘并推进执行。 |
