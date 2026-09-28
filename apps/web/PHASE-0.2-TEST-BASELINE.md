# Phase 0.2 回归入口与关键用例基线

## 状态与范围

基线代码提交：`3b7d4eb`。本文件根据 Phase 0.1 修正及上一轮实测结果更新，只修正文档，不代表已新增测试、修改统一入口或完成全部 Phase 0.2 工作。

**当前状态：资产盘点和现有测试实测已完成；遗漏专项接入、关键缺口用例、稳定视觉基线尚未完成。**

必须区分：
- 执行通过：现有脚本中的断言通过。
- 已有覆盖：源码中有对应断言，但仅覆盖该断言的边界。
- 验收完成：计划要求的场景、集成链路及视觉基线都已验证。

不能由第一项直接推导第三项。以下结果来自上一轮复核，本次文档修正没有重新运行浏览器测试。

## 测试资产与实测结果

### 前端单元测试

`test/unit/web/` 实际有 **20 个 `.test.mjs` 文件**。执行 `node --test test/unit/web/*.test.mjs` 得到 **163 pass、0 fail、7 suites**。删除未经核实的逐文件估算用例数，嵌套 suite 的计数以 Node 测试报告为准。

| 文件 | 主要覆盖内容 |
| --- | --- |
| workflow-view-models.test.mjs | 节点动作、摘要、产物及启动参数等视图模型 |
| workflow-data.test.mjs | 节点数据重置与画布归一化 |
| distribution-view-model.test.mjs | 铺货状态、导出文本及校验 |
| watermark-inpaint.test.mjs | 水印修复算法 |
| review-paste-parser.test.mjs | 粘贴解析 |
| workflow-event-connection.test.mjs | SSE 连接、重连、重放 |
| workflow-action-registry.test.mjs | 动作路由 |
| workflow-request-scope.test.mjs | 请求隔离和防重 |
| use-workflow-launch.test.mjs | 启动相关逻辑 |
| use-persistent-map.test.mjs | 持久化 map |
| use-seed-miner.test.mjs | 种子挖掘相关逻辑 |
| category-root-utils.test.mjs | 分类树 |
| selection-modes.test.mjs | 模式切换与配置 |
| order-sheet-draft.test.mjs | 商品草稿 |
| order-sheet-sku.test.mjs | SKU 选择 |
| product-selection-view.test.mjs | 商品选择视图 |
| review-draft-autosave.test.mjs | 自动保存辅助逻辑 |
| review-group-fields.test.mjs | 分组字段 |
| review-image-compress.test.mjs | 图片压缩 |
| zip-writer.test.mjs | ZIP 创建 |

### 浏览器专项

`test/browser/` 有 **10 个专项脚本和 1 个统一入口**，不是 11 个独立测试套件。上一轮逐项执行十个专项，全部退出码为 0。

| 专项 | 已在统一入口 | 实测结果 | 主要边界 |
| --- | --- | --- | --- |
| workflow-hook-races.mjs | 是 | 通过 | 19 个真实 React hook 场景，请求替身 |
| workflow-session-races.mjs | 是 | 通过 | 历史顺序、重置、删除、SSE、catalog |
| workflow-studio-ui.mjs | 是 | 通过 | Studio 三视口、布局、产物与输入滚动 |
| keyword-filter.mjs | 是 | 通过 | 筛选面板 |
| distribution-categories.mjs | 是 | 通过 | 类目、复制及面板交互 |
| distribution-job-refresh.mjs | 否 | 通过 | job hook 轮询、旧响应失效、终态停止轮询 |
| distribution-copy-formats.mjs | 否 | 通过 | 三种格式、注入复制回调的成功/失败反馈 |
| distribution-shops.mjs | 否 | 通过 | 店铺配置、分配、逐商品核对结果及本地平台夹具 |
| unified-selection.mjs | 否 | 通过 | 选品模式与节点面板 |
| discovery-direction.mjs | 否 | 通过 | 选词方向输入 |

这些脚本使用本地 Vite 和 headless Chrome，通过 finally 清理浏览器和服务器。shops、unified-selection 会导入后端模块，但测试使用本地夹具/替身，导入本身不等于连接真实商家平台，也不是已经确认的环境阻塞。

日志：`/tmp/phase02-browser-review.log`；单测日志：`/tmp/phase01-review-unit.log`。日志为本机临时证据，长期复现应记录实际命令和测试报告，不依赖临时文件永远存在。

## 环境与运行方式

原“未找到 Chrome、所有浏览器测试无法运行”的结论已撤回。

| 项目 | 已验证情况 |
| --- | --- |
| Node / npm | v22.22.3 / 10.9.8 |
| 项目默认 Playwright 解析 | `require('playwright')` 返回 MODULE_NOT_FOUND |
| 可用 Playwright | Codex bundled runtime，版本 1.62.1 |
| Chrome | `/Applications/Google Chrome.app`，153.0.8010.54 |
| ECOM_PLAYWRIGHT_MODULE | 默认未设置；上一轮在子进程中显式设置 |
| Vite | 可用；端口占用时自动选择其他端口，不停止原有服务 |

从仓库根目录运行，本机无需安装新依赖：

```bash
export ECOM_PLAYWRIGHT_MODULE=/Users/sunnstars/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright

# 当前仅包含五个专项
npm run test:workflow-browser

# 尚未接入的专项必须显式运行
node test/browser/distribution-job-refresh.mjs
node test/browser/distribution-copy-formats.mjs
node test/browser/distribution-shops.mjs
node test/browser/unified-selection.mjs
node test/browser/discovery-direction.mjs
```

该路径属于本机环境，不写进业务代码。其他机器应确认自己的模块位置与浏览器。脚本指定 `channel: 'chrome'`，仅执行 `playwright install chromium` 不保证满足该要求。后续是否把 Playwright 纳入项目开发依赖应单独决定，不是当前阻塞项。

## 九个场景的覆盖评估

不再使用 FULL 表示整个业务场景穷尽覆盖。下表“已有覆盖”仅描述已读到并实测通过的断言，“部分覆盖”明确列出必须补齐的边界。

| # | 场景 | 评估 | 已有证据与剩余边界 |
| --- | --- | --- | --- |
| 1 | 历史 A 迟到不覆盖 B | 已有覆盖 | request-scope、event-connection、hook/session races 覆盖请求顺序、旧响应和连接隔离；不外推为所有异步入口都已验证 |
| 2 | 模板/模式切换与重复运行 | 部分覆盖 | 有数据重置和模式输入保留测试；缺重复运行后的产物面板清空/刷新、跨运行持久草稿集成断言 |
| 3 | 连点确认、暂停、重试 | 已有覆盖 | scope 防重及已测试操作的解锁/重复调用断言；新增或迁移操作仍需逐项对照，不能仅凭通用 scope 测试免验 |
| 4 | 节点动作和产物 | 已有覆盖 | 视图模型和动作注册表覆盖开始无产物、部分状态/阻塞规则及 UI 打开产物；策略重构前仍须逐个迁移分支补输入矩阵 |
| 5 | 铺货完成后进入完成节点 | 部分覆盖 | job-refresh 只证明 hook 的 completed 和轮询行为，shops 证明面板及本地核对逻辑；缺真实 Studio 回调→加载快照→end 完成的集成断言 |
| 6 | 三种复制格式与复制降级 | 部分覆盖 | 格式、交互和反馈已测；copy-formats 注入假的 onCopyText，没有调用 Studio 的真实 copyText，未覆盖 execCommand/Clipboard 顺序和 DOM 清理 |
| 7 | 弹窗草稿恢复与运行隔离 | 部分覆盖 | 有面板取消/重开及自动保存辅助函数测试；缺切换运行后的自动保存归属、迟到写入及新运行草稿展示集成验证 |
| 8 | 卸载、StrictMode、SSE 重连 | 已有覆盖 | hook/session/event-connection 验证所挂载 hook 的清理、重连、重放；不是全站所有组件的生命周期认证 |
| 9 | 布局、滚动、提示无遮挡 | 部分覆盖 | 有三视口几何/滚动断言和专项截图；缺关键断点两侧、固定参考图、视觉比较标准与人工验收记录 |

合计：**4 项已有针对性覆盖、5 项部分覆盖**。测试通过不代表没有遗漏，也不代表 Phase 0.2 已完成。

## 待补齐工作及验收

| 优先级 | 工作 | 验收要求 |
| --- | --- | --- |
| P1 | 接入遗漏五个专项 | 更新统一入口，失败传播非零退出码；串行运行无资源泄漏、无真实平台副作用；入口实测十项均执行 |
| P1 | 铺货完成全链路 | 在 Studio 集成夹具中触发 job 完成，验证刷新快照、end 完成、弹窗关闭；重复完成不重复处理，旧运行响应不覆盖新运行 |
| P1 | 真实复制降级 | 在浏览器中调用真实复制实现，只替换浏览器 API；覆盖 execCommand 成功/返回 false、Clipboard 成功/拒绝、API 缺失及 textarea 清理；异常分支以当前实现为基线，不夹带修复 |
| P1 | 重复运行及产物隔离 | 重跑后不展示上一运行结果，新结果属于新 runId；验证模式/模板配置按现有规则保留或重置，而非新加“所有草稿跨模板保留”的业务要求 |
| P1 | 草稿跨运行隔离 | 挂载真实草稿组件，切换 runId 后验证写入目标、旧响应失效和弹窗重开内容 |
| P1 | 稳定视觉基线 | 建立场景清单、固定数据与字体/动画条件、参考图和比较规则，覆盖关键断点两侧并记录审阅结果 |

以上均是未完成任务，不再以“缺少 Playwright”作为阻塞理由。需要新增夹具或断言时记录实际缺口，并在后续实施中完成。

## 截图基线现状

Studio 脚本已生成以下视口截图：1440×1000、980×800、390×844；场景包括 initial、discovery-config、diagnostics、artifact、manual-input。现有几何断言包括页面宽度、控制台贴底、弹窗边界和长列表滚动。

| 当前输出目录 | 内容 | 证据性质 |
| --- | --- | --- |
| `/tmp/workflow-studio-qa` | Studio 三视口截图 | 本次运行输出，可被后续执行覆盖 |
| `/tmp/distribution-copy-qa` | 复制菜单/面板 | 专项运行输出 |
| `output/shop-qa` | 店铺、分配及核对面板 | 仓库忽略目录内的专项截图 |

不能说“完全没有铺货面板截图”，shops 专项已生成相关截图。但这些产物都不是经过审批的固定参考图，也没有证明执行了截图差异比较。

后续需按场景盘点、归档，而非仅按脚本统计：侧栏展开/收起、历史列表、阻塞/错误提示、关键词复核、标题结果、铺货完成/失败等各自的状态和断言。已有 diagnostics 等截图不自动代表所有错误状态都覆盖。

至少补充 980px、760px 及本轮受影响其他断点两侧的布局验证（例如阈值前后 1px），不能用一个 980px 视口代替断点两侧。固定动态数据、等待字体加载、关闭动画；明确参考图存放位置、差异容忍规则及人工确认方式。此项尚未实施，本次未逐张进行视觉审批。

## 进度清单

- [x] 修正测试资产数量，移除不可靠的逐文件用例估算。
- [x] 核实 Chrome 与 Playwright 环境，并记录无依赖安装的运行方式。
- [x] 逐项运行现有十个浏览器专项，退出码均为 0。
- [x] 完成九个场景的证据/缺口评估，移除过高的 FULL 结论。
- [x] 五个遗漏专项接入统一入口并验证入口运行结果（13/13 通过）。
- [~] 铺货完成：hook 级已用真实 useDistributionJob 验证状态回调和轮询终态。**未覆盖** Studio 级链路（刷新快照/关闭弹窗/完成节点更新），需 Phase 3 提取 updateDistributionNodeJob 后方可测试。
- [x] 真实复制降级断言（copy-text-fallback.mjs，导入生产 copyText）。
- [~] 产物隔离：已挂载真实 useNodeArtifact hook + mock API，含乱序响应验证（旧运行迟到不覆盖新运行）。**未覆盖**草稿跨运行隔离，需 Phase 3 草稿组件解耦后方可测试。
- [x] 建立视觉基线目录结构和规范文档（test-baselines/README.md）。
- [ ] 固定视觉参考图、补断点两侧验证和人工审阅记录。（需人工参与）
- [ ] 根据新增测试结果更新基线，完成 Phase 0.2 验收。（需人工确认）

## 新增测试脚本

| 脚本 | 覆盖缺口 | 断言数 |
|------|---------|--------|
| distribution-completion-integration.mjs | #5 铺货完成 hook 级 | 4 (真实hook状态回调/onJobChange/轮询终态)。**未覆盖** Studio 级链路，待 Phase 3 |
| copy-text-fallback.mjs | #6 真实复制降级 | 6 (导入生产copyText：正常复制/textarea清理/execCommand回退/无API拒绝/null输入) |
| run-switch-isolation.mjs | #2 产物隔离 | 4 (真实useNodeArtifact + mock API：初始加载/**乱序响应验证**/切回恢复)。**未覆盖**草稿隔离，待 Phase 3 |

## 统一入口现状

`run-regressions.mjs` 现包含 **13 个脚本**，全部实测通过：

```
workflow-hook-races.mjs
workflow-session-races.mjs
workflow-studio-ui.mjs
keyword-filter.mjs
distribution-categories.mjs
distribution-job-refresh.mjs          ← 新纳入
distribution-copy-formats.mjs         ← 新纳入
distribution-shops.mjs                ← 新纳入
unified-selection.mjs                 ← 新纳入
discovery-direction.mjs               ← 新纳入
distribution-completion-integration.mjs ← 新增
copy-text-fallback.mjs                  ← 新增
run-switch-isolation.mjs                ← 新增
```

运行命令：
```bash
ECOM_PLAYWRIGHT_MODULE=/path/to/playwright node test/browser/run-regressions.mjs
```
