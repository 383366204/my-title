# GitHub Projects 看板结构设计

- **版本**：v1.3
- **更新日期**：2026-09-15

- **项目名称**：ecom-ai-tools Delivery Board
- **适用团队**：2 人
- **目标**：用一个项目同时管理电商全流程运营能力的执行看板、当前迭代、路线图、评审队列、合规风险和技术债。产品内统一任务中心不放在 GitHub Project 中管理，避免开发 Issue 和运营任务混淆。
- **设计原则**：字段少而稳定，状态表达真实工作流，避免为工具维护支付额外成本。

## 1. 创建步骤

1. 进入 GitHub 仓库。
2. 打开 **Projects** 标签页。
3. 点击 **New project**。
4. 选择 **Team planning** 或空白项目模板。
5. 项目命名为 `ecom-ai-tools Delivery Board`。
6. 将当前仓库加入 Project。
7. 按下文创建字段、视图、标签和自动化。
8. 在 README 或本页记录 Project 链接。

建议 Project 描述：

```text
ecom-ai-tools 的电商全流程运营执行看板：范围用 Backlog 管理，进度用 Iteration 管理，运营环节用 Epic 管理，平台合规、素材授权和技术风险用 Risk 字段显式跟踪。
```

## 2. 字段设计

### 2.1 必填字段

| 字段名 | 类型 | 选项 / 格式 | 用途 | 规则 |
|---|---|---|---|---|
| Status | Single select | Backlog, Ready, In Progress, In Review, Blocked, Done | 工作流状态 | 唯一真实状态来源 |
| Priority | Single select | P0, P1, P2, P3 | 优先级 | Ready 之前必须填写 |
| Size | Single select | S, M, L, XL | 工作量估算 | Ready 之前必须填写；XL 不能进入迭代 |
| Work Type | Single select | feature, bug, refactor, docs, research, infra, risk, security, compliance, operations | 工作类型 | 创建 Issue 后尽快填写 |
| Epic | Single select | E01-E15 | 对应 Backlog Epic | 执行类任务必须归属 Epic |
| Risk | Single select | High, Medium, Low | 失败概率与影响 | 外部依赖、平台规则、素材授权和数据质量任务必须填写 |
| Owner | Assignee / 单选成员 | 成员 A / 成员 B | 唯一责任人 | In Progress 之前必须填写 |
| Iteration | Iteration | 1-2 周 | 当前执行迭代 | Ready 排期后填写 |
| Milestone | Repository milestone | M1-M4 | 阶段目标 | 与项目章程保持一致 |

> 建议用 GitHub 的 Assignee 表达 Owner，避免成员信息和 Project 单选字段不一致。

### 2.2 辅助字段

| 字段名 | 类型 | 选项 / 格式 | 用途 |
|---|---|---|---|
| Component | Single select | workflow, selection, competitor, store-tracking, listing, keyword-performance, profit, campaign-calendar, operations-sheet, asset-processing, exception-center, task-center, sop, platform, cli, mcp, web, data, docs | 快速筛选运营环节或代码范围 |
| Blocked Reason | Single select | waiting-review, waiting-account, waiting-decision, waiting-external, waiting-env, waiting-authorization | 分析阻塞来源 |
| Start Date | Date | YYYY-MM-DD | 排期开始 |
| Due Date | Date | YYYY-MM-DD | 预计完成 |
| Value | Single select | critical, high, medium, low | 业务或用户价值 |
| Regression Required | Checkbox | true / false | 是否需要完整回归 |
| Docs Required | Checkbox | true / false | 是否需要更新用户文档 |

不要把验收标准、技术方案、测试结果放入 Project 字段；这些内容写在 Issue 正文，避免字段过长难以维护。

## 3. 看板列与流转规则

```text
Backlog → Ready → In Progress → In Review → Done
                  ↓
               Blocked
                  ↓
          In Progress / Ready
```

| 列 | 目的 | 进入条件 | 退出条件 | WIP 限制 |
|---|---|---|---|---|
| Backlog | 收集所有候选工作 | 新 Issue 自动进入 | 满足 Definition of Ready | 不限制 |
| Ready | 本迭代候选任务 | 有价值、验收标准、规模、优先级 | Owner 开始执行 | 当前迭代最多 8 |
| In Progress | 正在开发或调研 | 有唯一 Owner，有清晰下一步 | 产生可评审 PR / 文档 / 测试结果 | 每人最多 2 |
| In Review | 等待评审或验收 | 已关联 PR 或产物 | 非作者复核通过 | 全团队最多 3 |
| Blocked | 等待人、权限、外部服务或决策 | 写清 Blocked Reason 和需要谁做什么 | 阻塞解除并记录结果 | 每天复查 |
| Done | 完成 | 满足 Definition of Done | 不轻易重开；新问题另建 Issue | 不限制 |

## 4. 视图设计

### 4.1 01 Delivery Board

- **类型**：Board
- **分组字段**：`Status`
- **排序**：`Priority` → `Size`
- **卡片显示**：Issue 标题、Owner、Priority、Size、Risk、Iteration
- **用途**：日常主看板

建议固定列：

```text
Backlog | Ready | In Progress | In Review | Blocked | Done
```

### 4.2 02 Current Iteration

- **类型**：Table
- **筛选**：`Iteration = @current`
- **分组**：`Owner`
- **排序**：`Priority` → `Status` → `Size`
- **显示字段**：
  - Title
  - Status
  - Priority
  - Size
  - Work Type
  - Epic
  - Risk
  - Milestone
  - Blocked Reason
- **用途**：周计划会和每日同步

### 4.3 03 Intake / Backlog

- **类型**： Table 或 Board
- **筛选**：`Status = Backlog`
- **分组**：`Priority`
- **排序**：`Value` → `Size`
- **显示字段**：
  - Title
  - Priority
  - Size
  - Work Type
  - Epic
  - Risk
  - Created
- **用途**：每周 Backlog 修剪和需求准入

### 4.4 04 Review Queue

- **类型**：Table
- **筛选**：`Status = In Review`
- **分组**：`Owner`
- **排序**：`Priority` → `Due Date`
- **显示字段**：
  - Title
  - Priority
  - Owner
  - Component
  - Regression Required
  - Linked PR
  - Due Date
- **用途**：确保评审不积压

### 4.5 05 Blocked

- **类型**：Board
- **筛选**：`Status = Blocked`
- **分组**：`Blocked Reason`
- **排序**：`Priority`
- **显示字段**：
  - Title
  - Owner
  - Priority
  - Blocked Reason
  - Last update
- **用途**：每日升级和风险跟踪

### 4.6 06 Risk & Reliability

- **类型**：Table
- **筛选**：`Risk in (High, Medium)` 或 `Work Type in (risk, bug, security, refactor)`
- **分组**：`Risk`
- **排序**：`Priority` → `Component`
- **显示字段**：
  - Title
  - Risk
  - Component
  - Owner
  - Status
  - Milestone
- **用途**：每周风险评审和技术债跟踪

### 4.7 07 Roadmap by Milestone

- **类型**：Roadmap 或 Table
- **分组**：`Milestone`
- **排序**：`Priority` → `Epic`
- **显示字段**：
  - Title
  - Milestone
  - Epic
  - Owner
  - Status
  - Start Date
  - Due Date
- **用途**：对外展示阶段目标和进度

### 4.8 08 Done This Week

- **类型**：Table
- **筛选**：`Status = Done` 且最近 7 天关闭
- **分组**：`Epic`
- **显示字段**：
  - Title
  - Owner
  - Size
  - Work Type
  - Closed
- **用途**：周会和回顾

### 4.9 09 Operations Flow Delivery

- **类型**：Table
- **筛选**：`Epic in (E06, E07, E08, E11, E12)` 或 `Component in (keyword-performance, profit, campaign-calendar, exception-center, task-center, sop)`
- **分组**：`Epic`
- **排序**：`Priority` → `Milestone` → `Status`
- **显示字段**：
  - Title
  - Epic
  - Component
  - Status
  - Priority
  - Size
  - Risk
  - Milestone
  - Owner
- **用途**：跟踪关键词监控、单店月度净利润核算、活动日历、异常中心、任务中心和 SOP 的交付进度

> 该视图管理开发交付，不管理产品内运营任务。产品内任务由统一任务中心承载。

## 5. Epic 字段选项

| 选项 | 名称 | 对应 WBS |
|---|---|---|
| E01 | Operations backbone | 运营价值流、Workflow 基线、人工复核点 |
| E02 | Auto selection | 机会发现、自动选品、选品解释 |
| E03 | Competitor insight | 同行商品、价格、标题、属性和策略分析 |
| E04 | Store tracking | 1688 好店池、快照、变更检测 |
| E05 | Listing quality | 标题生成、上架质量、铺货复核 |
| E06 | Keyword performance | 排名、展现、点击、转化和标题优化闭环 |
| E07 | Store net profit | 单店月度收入、变动成本、固定费用、经营净利润和净利润率 |
| E08 | Campaign calendar | 节令活动、准备周期倒推、活动复盘 |
| E09 | Operations sheets | 订单执行表、评价跟踪表、字段字典 |
| E10 | Asset processing | 授权素材批量处理、归档和追溯 |
| E11 | Exception & task center | 异常事件、统一任务、审计和处理效率 |
| E12 | Operating standards | SOP、检查清单、版本和执行记录 |
| E13 | Workflow workbench | Web 画布、运行控制、阻塞处理、恢复 |
| E14 | Platform reliability | 外部平台、账号、风控、限流和诊断 |
| E15 | Quality & delivery | 质量、合规、文档、发布和复盘 |

## 6. Milestone 建议

| Milestone | 名称 | 建议周期 | 出口条件 |
|---|---|---|---|
| M1 | Operations & task baseline | 3-4 周 | 运营地图、统一 Schema、任务中心 MVP、异常接入、自动选品闭环和失败诊断可用 |
| M2 | Market & traffic insight | 3-4 周 | 同行分析、好店跟踪、关键词快照、趋势和标题优化建议能辅助运营决策 |
| M3 | Operations assets & decisions | 3-4 周 | 订单表、评价表、素材批处理、单店月度净利润核算、活动日历和 SOP 可复核、导出、追溯 |
| M4 | Stable release | 1-2 周 | CLI / MCP / Web 行为一致，诊断、合规检查、回归和文档完整 |

Milestone 不作为任务状态使用；任务是否完成仍看 `Status` 和验收标准。

## 7. 标签体系

Project 字段负责状态、优先级和规模；Label 只做轻量补充，避免同一信息维护两份。

| Label | 用途 |
|---|---|
| `type:feature` | 新能力 |
| `type:bug` | 缺陷 |
| `type:refactor` | 重构 |
| `type:docs` | 文档 |
| `type:research` | 调研 |
| `type:infra` | 环境、构建、运行 |
| `type:risk` | 风险缓解工作 |
| `area:cli` | CLI |
| `area:mcp` | MCP Server |
| `area:web` | Web UI |
| `area:workflow` | Workflow 运行时 |
| `area:keyword-performance` | 关键词排名与流量监控 |
| `area:profit` | 单店月度净利润核算 |
| `area:campaign-calendar` | 节令与活动日历 |
| `area:exception-center` | 运营异常中心 |
| `area:task-center` | 统一任务中心 |
| `area:sop` | 运营 SOP 与检查清单 |
| `area:selection` | 自动选品 |
| `area:competitor` | 同行分析 |
| `area:store-tracking` | 好店跟踪 |
| `area:listing` | 标题与上架 |
| `area:operations-sheet` | 运营表单 |
| `area:asset-processing` | 授权素材批处理 |
| `area:title` | 标题生成 |
| `area:1688` | 1688 |
| `area:sycm` | 生意参谋 |
| `area:taobao` | 淘宝 |
| `area:data` | 数据质量 |
| `external-dependency` | 依赖外部服务 |
| `needs-design` | 需要方案澄清 |
| `needs-repro` | 需要复现信息 |
| `security` | 安全或敏感信息相关 |
| `compliance` | 平台规则、真实订单、评价合规或素材授权相关 |

可选创建命令：

```bash
gh label create "type:feature" --description "New capability" --color "0E8A16"
gh label create "type:bug" --description "Defect or regression" --color "D93F0B"
gh label create "type:risk" --description "Risk mitigation work" --color "FBCA04"
gh label create "external-dependency" --description "Depends on external service or account" --color "5319E7"
```

## 8. 自动化设计

在 Project 的 **Workflows** 中启用：

| 自动化 | 目标字段值 | 说明 |
|---|---|---|
| Issue added to project | `Status = Backlog` | 新工作先进入待整理池 |
| Issue reopened | `Status = Backlog` | 重开任务重新评估 |
| Issue closed | `Status = Done` | 关闭即归档完成 |
| PR linked | 不自动改状态 | 由作者确认可评审后手动移动到 In Review |
| Item assigned | 不自动改状态 | 避免分配讨论被误判为开始执行 |

推荐手动动作：

| 动作 | 移动状态 |
|---|---|
| Issue 满足 Ready 标准 | Backlog → Ready |
| Owner 开始编码或调研 | Ready → In Progress |
| PR 可评审 | In Progress → In Review |
| 等待外部服务、账号、决策或评审 | 任意状态 → Blocked |
| 评审通过且 DoD 满足 | In Review → Done |

自动化原则：

1. 只自动处理“新增、重开、关闭”三个确定事件。
2. 不用自动化猜测任务是否真正开始或完成。
3. `Blocked` 必须人工填写原因，避免看板看似流动但问题被隐藏。

## 9. Issue 模板

### 9.1 功能 / 任务模板

```markdown
## 背景

<为什么现在要做？谁会受益？>

## 所属运营环节

<Epic / Component / 上游产物 / 下游产物 / 人工复核点>

## 建议方案

<打算怎么做？如果不确定，写需要先调研的问题。>

## 验收标准

- [ ]
- [ ]
- [ ]

## 范围边界

**不做：**

-

## 测试 / 验证

- [ ]

## 风险与依赖

- Risk：
- External dependency：
- Asset authorization：
- Compliance boundary：
- Blocked condition：
```

### 9.2 Bug 模板

```markdown
## 复现步骤

1.
2.
3.

## 期望结果


## 实际结果


## 环境

- 命令 / 入口：
- Node 版本：
- 相关平台状态：
- 是否可稳定复现：

## 日志 / 截图


## 验收标准

- [ ] 复现用例或回归测试覆盖
- [ ] 修复后相关测试通过
- [ ] 用户文档或错误提示更新
```

## 10. 初始导入建议

1. 先创建 Milestones：M1、M2、M3、M4。
2. 再创建 Epic 字段和状态字段。
3. 将 `docs/project-management/backlog.md` 中 P0 任务 B-001 至 B-022 创建为 Issues；P1 / P2 任务先保留在 Backlog，不急于全部导入。
4. 只有本周计划执行的任务设置 Iteration；其余留在 Backlog。
5. B-017 至 B-022 建议作为第二批候选；统一任务中心和异常中心先做 Schema、MVP 和现有 Workflow 接入，不直接做大而全系统。
6. 每个 Issue 首次只填写最小必要字段：Priority、Size、Work Type、Epic、Risk。
7. 周计划会后补 Owner 和 Iteration。

## 11. 看板维护节奏

| 时间 | 动作 |
|---|---|
| 每日 | 检查 In Progress、In Review、Blocked |
| 提 PR 时 | 移动到 In Review，并填写评审要求 |
| 评审完成 | 确认 DoD 后移动 Done |
| 周一 | 设置当前 Iteration，确认 Owner 和目标 |
| 周三 | 清理 Blocked 和超期任务 |
| 周五 | 修剪 Backlog，更新风险视图 |
| 发布后 | 复核 Done 和 Milestone 出口条件 |

## 12. 配置完成检查清单

- [ ] Project 已命名并关联仓库
- [ ] 6 个 Status 选项已创建
- [ ] Priority / Size / Work Type / Epic / Risk 字段已创建
- [ ] 4 个 Milestones 已创建
- [ ] 9 个视图已保存
- [ ] 新增、重开、关闭自动化已启用
- [ ] 标签体系已创建
- [ ] B-001 至 B-004 已导入
- [ ] B-017 至 B-022 已作为任务中心 / 异常中心候选导入
- [ ] E01-E15 Epic 字段已与 Backlog 对齐
- [ ] 成员 A / 成员 B 已有访问权限
- [ ] Project 链接已回填到本页
