# 工作流代码导航

本说明对应 2026-09-09 通用工作流与合规选品范围的重构收尾。刷单、虚假评价专用接口未继续增强或迁移；不能将本次验收表述为所有业务的完整验收。

## 前端入口

`apps/web/src/WorkflowStudio.jsx` 组装画布、侧栏、节点操作和弹窗。

| 文件（相对 apps/web/src/features/workflow） | 职责 |
| --- | --- |
| workflow-node-actions.js | 选择主次操作、恢复动作和按钮文案 |
| workflow-launch-params.js | 输入解析、启动参数收集、前端校验 |
| workflow-node-view.js | 节点摘要、数量、状态和诊断展示 |
| workflow-history-view.js | 历史名称、状态和当前步骤映射 |
| workflow-data.js | 节点规范化、新运行临时状态重置 |
| hooks/use-workflow-session.js | 模板切换、历史载入、新建和复制运行 |
| hooks/use-workflow-run-catalog.js | 模板/历史目录、刷新代次隔离、删除后的列表同步及局部错误 |
| hooks/use-workflow-confirmations.js | 人工确认请求与确认后的视图同步 |
| hooks/use-workflow-commands.js | 暂停、继续、重跑等命令请求及状态反馈 |
| hooks/use-workflow-runtime.js | 服务端快照和增量事件投影为节点状态 |
| hooks/use-workflow-events.js | React 生命周期内的 SSE 连接所有权 |
| workflow-event-connection.js | 原生 EventSource 重连、回放去重与旧连接隔离 |
| workflow-request-scope.js | 请求通道防重、过期响应与过期 finally 隔离 |
| hooks/use-workflow-request-scope.js | 切换运行/模板或卸载时关闭旧请求作用域 |

前端不再保留转导出层。业务和测试直接引用以上实现模块；命令 URL 和请求体构造位于 `apps/web/src/api/workflow-api.js`。`workflow-node-types.js` 直接从 `components/nodes/legacy-nodes.jsx` 和 `components/nodes/production-node.jsx` 引入组件。

## 后端入口

`bin/server.js` 组装应用、共享依赖及尚未迁移的领域接口；已抽取的路由都接收同一个协调器，不能各自创建占用状态。

| core/server 文件 | 职责 |
| --- | --- |
| workbench-coordinator.js | 服务实例内的任务预占、执行与按所有者释放 |
| workbench-routes.js | 四个旧工作台列表、详情、CLI 启动与兼容批次摘要入口 |
| workbench-cli.js | 旧工作台 CLI 参数数组和有界日志截断，不启动子进程 |
| pipeline-routes.js | 八个流水线列表/详情、启动、补词和运行控制入口 |
| workflow-control-routes.js | 图校验、启动、取消、重跑、恢复和暂停，包含旧版回退 |
| workflow-event-stream.js | SSE 快照、事件游标与连接清理 |
| workflow-query-routes.js | 七个模板、历史列表/删除、运行详情、产物预览/下载及 SSE 入口 |
| distribution-routes.js | 五个铺货预检、提交、人工完成、查询和控制接口；提交准备阶段防重 |
| distribution-jobs.js | 实例内任务 Map、任务文件读写、结果核对及工作流完成同步 |
| selection-review-routes.js | 人工筛词和货源选品确认，完成后暂停在下一步骤，不调用执行器 |
| http-fallbacks.js | 业务路由后的静态资源、SPA 兜底及结构化请求体超限错误 |
| seed-routes.js | 十个种子生命周期、预览、数据统计和缓存清理接口 |
| research-routes.js | 六个独立挖词、标题生成和分享解析接口，包含数值解析辅助函数 |
| platform-routes.js | 平台状态以及生意参谋、淘宝、铺货浏览器启动入口 |
| runtime-view.js | 当前运行摘要与旧记录的画布快照回退 |
| sycm-access-recovery.js | Chrome 就绪后清理可恢复的连接阻塞，不绕过平台限流 |

`test/workbench-cli.test.js` 检查模式专属参数、数值过滤、关键词独立参数以及原有 200 KiB 字节截断行为；UTF-8 边界处理保持旧实现，不宣称截断后不会出现替换字符。

`test/http-fallbacks.test.js` 验证真实 API 优先、未知 API 的 JSON 404、静态文件、SPA GET/HEAD 和非 GET 拒绝、实际上传限制及其他错误透传。兜底注册必须留在全部业务路由之后。

`test/selection-review-routes.test.js` 覆盖 verify/select 分支、generate 等待状态、输入规范化、旧记录无 runtime、未完成复核和异常返回。该测试不证明底层复核服务已有版本冲突保护。

`core/server/order-sheet-draft-routes.js` 是此前阶段留下的草稿兼容层，不持有自己的任务互斥锁。入口中其余刷单、虚假评价专用接口不在本次收尾范围，保持原位置和行为。

铺货模块由 server 创建单个任务服务，沿用 process.cwd 下的 distribution-runs 数据目录；确认日志读取器通过 getter 获取最新 app.locals 注入。自动提交在环境检查前占用准备标记，后台执行器同步抛错也走任务失败清理。它不是跨进程锁，也不改变平台侧幂等策略。

`test/distribution-routes.test.js` 用临时文件、延迟环境检查和模拟提交器覆盖确认、防重复提交、检查失败释放、暂停取消、同步/异步异常、完成节点同步及重新核对。不会提交真实商品。

`core/test/workflow-query-routes.test.js` 验证历史删除确认、动态任务锁、运行状态保护、产物缺失、完整预览、文件下载及 SSE 握手。所有文件均为临时测试数据，不访问生产产物。

种子模块接收同一个 DEFAULT_DATA_DIR 和事件写入函数，研究模块接收同一个 AsyncLocalStorage，平台模块接收运行时 getter。不要在各注册函数中另建日志上下文或改用模块目录作为业务数据目录。

后端不再保留 `core/workflow/index.js` 和 `pipeline-adapter.js` 汇总入口。调用方直接从以下实现文件导入：

| 文件 | 职责 |
| --- | --- |
| pipeline-definition-common.js | 节点 ID、顺序、产物名称等适配器内部常量 |
| pipeline-templates.js | 模板、节点与边、历史版本选择 |
| pipeline-params.js | 参数规范化、图校验、启动解析和 CLI 参数 |
| pipeline-storage.js | 工作流定义及事件读写、运行目录删除 |
| pipeline-node-output.js | 从业务摘要提取节点产物摘要 |
| pipeline-node-diagnostics.js | 阻塞原因与恢复建议 |
| pipeline-node-state.js | 业务摘要和 runtime 转换成画布节点状态 |
| pipeline-runs.js | 运行列表、详情和摘要适配 |
| pipeline-artifacts.js | 读取完整产物与结构化预览 |

这些模块只做工作流适配，不负责重新实现各 skill 的选品、评分、采集或标题算法。

## 直接引用约定

模块只导出自己实现的函数、类和常量，不转导出其他模块的符号。组合 hook、业务编排器和模块注册表有实际行为，仍然保留。

以下纯转发 skill 入口已删除：`alibaba1688/index.js`、`keyword-mining/index.js`、`pipeline-flow/index.js`、`sycm-research/index.js`、`taobao-opc/index.js`、`title-gen/index.js`。CLI、MCP 和项目内调用方已直接引用实现文件，命令参数和工具名称不变。外部脚本若曾 `require('.../skills/title-gen')`，也需要改为具体文件，旧目录导入不再兼容。

| 能力 | 直接引用位置 |
| --- | --- |
| 标题编排 / 批量标题 | skills/title-gen/src/pipeline.js / batch.js |
| 1688 搜索 / 分享链接解析 | skills/alibaba1688/src/search-1688.js / client.js |
| 生意参谋查询 / Chrome 辅助 | skills/sycm-research/src/sycm-cdp-extractor.js / sycm-browser-helper.js |
| 挖词 / 种子存储 | skills/keyword-mining/src/pipeline.js / seed-store.js |
| 流水线编排 / 运行存储 | skills/pipeline-flow/src/flow-orchestrator.js / run-store.js |
| 淘宝 OPC 客户端 | skills/taobao-opc/src/mcp-client.js |

早期计划和验收记录保留当时的路径，不能作为当前导入示例；以本导航和各 skill 的最新使用示例为准。

## 调用链

```text
节点按钮
  -> workflow-action-registry 分发
  -> Studio 组装的命令 / 确认 / 弹窗处理
  -> api/workflow-api.js
  -> bin/server.js 组装的领域路由
  -> workflow 适配器、runtime、业务 skill
  -> 持久化摘要与产物
  -> SSE / 详情 API
  -> use-workflow-runtime / use-workflow-session
  -> workflow-node-view 与节点组件
```

查“按钮为什么不出现”先看动作选择；查“按钮发了什么请求”看命令 hook 和 API；查“已完成却显示阻塞”看后端节点状态映射与前端快照同步；查“数量对不上”同时核对产物摘要与完整预览的数据口径。

## 状态约定

- 快照以服务端为准，完整替换运行字段；增量字段缺失才保留旧值，显式 null、0 等值必须能清除旧状态。
- pendingAction、operationMessage、chromeStartMessage 是临时 UI 字段，不应从旧运行复制到新运行。
- EventSource 自身负责短暂断线重连；重连只读状态，绝不重发业务命令。
- replay 事件只补日志，不用旧进度覆盖新快照；终态通知在快照同步后关闭连接。
- 事件游标依赖现有日志仅追加约定，不能无配套迁移地截断运行事件文件。
- 人工确认在同一视图内防止重复提交；取消使用独立通道，不会被其他请求的等待状态拦住。响应失效只影响当前页面，不代表取消已发往后端的业务操作。
- 历史目录以最近一次刷新为准，删除成功使旧列表请求失效；刷新失败保留已有列表并显示局部错误，不能把正在执行的流水线标成失败。

## 样式入口

`apps/web/src/App.css` 只维护导入顺序。原 5832 行规则按连续区段移入 `styles/`，不是按名称重新排序；纯迁移后的构建 CSS 与基线逐字节一致。`responsive-workspace.css` 是独立的窄屏修复层。具体职责及级联约束见 `apps/web/src/styles/README.md`。

窄屏侧栏采用覆盖展开，操作一侧时收起另一侧；顶部信息可换行，底部日志保留独立高度。桌面布局和原模板节点顺序未改变。

## 后端占用约定

- 同一个服务实例只有一个 workbench 协调器。这是进程内互斥，不是跨进程锁，也不替代已有平台限流与铺货作业管理。
- 新任务在解析分享链接等异步准备之前预占；准备或参数校验失败时释放自己的预占。
- Promise 任务由协调器统一在成功、失败或同步抛错时释放。CLI 子进程由 error/exit 事件释放，必须比对任务对象身份，不能清空后来启动的任务。
- 暂停/取消只写控制请求，仍在运行的任务继续占用，直到执行器真正结束。不能在 HTTP 返回“已请求取消”时提前解锁。
- 旧的单步骤执行及旧工作流 resume/retry 回退也共享协调器；它们现在会对并发执行返回 409。
- 注入的 getPipelineRuntimeRunner 必须在每次请求时调用；不要在路由注册时提前调用并缓存 app.locals 中的 runner。

## 验证入口

`npm test` 覆盖 Web 状态、CLI 与主要工作流 API 测试；`npm run test:pipeline` 覆盖流水线；`npm run web:build` 验证生产构建。此次另独立验证 `core/test`、1688 和标题生成测试，没有执行包含两类专用表格测试的完整 `test:all`。

真实平台 smoke 需要显式 ECOM_LIVE_TESTS=1。普通回归不得使用真实铺货动作来证明成功。

`npm run test:workflow-browser` 顺序执行三个浏览器脚本：19 个命令/确认竞态场景、历史/SSE/目录刷新矩阵，以及五种选品/同行分析模板在 1440、980、390 像素视口的画布、侧栏、长产物与手动输入滚动检查。全部业务 HTTP 用替身。需要可用的 Playwright 包与本机 Chrome；若 Playwright 不在项目依赖中，用 `ECOM_PLAYWRIGHT_MODULE` 指向已安装包。测试结束自动关闭临时服务，不连接用户的 3000 端口后端。

`node --test test/workflow-concurrency.test.js core/test/workbench-coordinator.test.js` 使用临时 HTTP 端口、延迟 Promise 与模拟子进程，验证跨路由互斥、准备失败、运行失败、取消未结束、迟到退出事件和旧入口兼容；不会调用真实平台或生成业务文件。

`test/server-route-contract.test.js` 对照重构前 HEAD 提取的 70 组路径、方法和路由中间件数量，另检查通配步骤路由与 SPA 兜底顺序。新增合法接口时需要同步更新此 fixture，而不能直接删除断言。

`test/domain-routes.test.js` 在临时目录和 HTTP 替身中验证种子生命周期、缓存清理白名单、关键词验真失败、标题搜索适配器、分享解析、SSE 并发上下文及平台启动失败返回。它不证明真实 Chrome、淘宝或生意参谋当前可用。
