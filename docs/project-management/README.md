# 项目管理文档

本目录是 `ecom-ai-tools` 的项目管理基线。项目定位是**稳定的电商全流程运营工具**：选品只是第一个已经跑通的运营环节，后续持续把同行分析、好店跟踪、单店月度净利润核算、关键词监控、运营表单、活动日历、素材批处理、异常处理、统一任务和运营 SOP 编排进同一个工作台。

团队采用轻量 PMP 思维管理 2 人协作：先明确范围、风险、决策和验收标准，再用 GitHub Issues / Milestones / Projects 管理开发交付，不引入重型流程。

## 文档地图

| 文档 | 用途 | 更新频率 |
|---|---|---|
| [project-charter.md](./project-charter.md) | 项目章程、目标、范围、成功标准和治理机制 | 变更时 |
| [backlog.md](./backlog.md) | WBS / Epic / 初始 Backlog、估算与准入准出规则 | 每周 |
| [operations-processes.md](./operations-processes.md) | 运营流程、数据模型、任务类型、复核点和验收标准 | 流程变化时 |
| [risk-register.md](./risk-register.md) | 风险登记册、评分规则和应对策略 | 每周 |
| [decision-log.md](./decision-log.md) | 关键决策记录，避免口头约定丢失 | 决策发生时 |
| [team-workflow.md](./team-workflow.md) | 2 人协作、例会、分支、评审和升级机制 | 流程变化时 |
| [github-project-blueprint.md](./github-project-blueprint.md) | GitHub Projects 看板、字段、视图、自动化和配置清单 | 看板调整时 |

## 产品定位

```text
电商全流程运营工作台
= 可编排的运营 Workflow
+ 可复用的领域 Skill
+ 可追踪的运行产物
+ 统一任务与异常处理
+ SOP 与检查清单
+ 关键节点人工复核
```

当前已落地闭环：

```text
灵感选词 → 人工筛词 → 市场验证 → 货源选品 → 标题生成 → 铺货复核
```

目标全流程：

```text
机会发现
→ 自动选品
→ 同行分析
→ 货源与好店跟踪
→ 商品贡献预估
→ 标题与素材生成
→ 人工复核与上架
→ 关键词表现监控
→ 订单 / 评价 / 售后跟踪
→ 单店月度净利润核算
→ 异常识别
→ 统一任务处理
→ 节令活动复盘
→ SOP 沉淀
→ 反哺下一轮选品
```

## 管理原则

1. **全流程视角**：每个功能必须说明所属运营环节、上下游产物、异常类型、任务类型和人工复核点。
2. **单一事实来源**：开发任务在 GitHub Project，产品内运营任务在统一任务中心，代码和管理基线在仓库。
3. **小批量交付**：以可测试、可演示、可回滚的最小增量推进。
4. **风险前置**：外部 API、平台规则、数据质量、单店净利润数据、费用假设、素材授权和合规边界必须显式跟踪。
5. **文档轻量但可审计**：只记录影响范围、进度、质量、风险的决策，不写形式化长文。
6. **每日可见**：任何阻塞项必须在当天进入 `Blocked` 或产品内任务中心的 `blocked` 状态，并写清需要谁做什么。

## PMP 到轻量执行的映射

| PMP 知识领域 | 本项目落地方式 |
|---|---|
| 整合管理 | 项目章程、决策记录、GitHub Project、统一任务中心作为整合视图 |
| 范围管理 | 项目章程范围边界 + Backlog / WBS + Issue 准入规则 |
| 进度管理 | Milestone、Iteration、每周计划会和状态字段 |
| 成本管理 | 2 人人力容量表 + 单店月度净利润核算能力，不做组织级或法定财务成本核算 |
| 质量管理 | Definition of Done、测试命令、代码评审、回归清单 |
| 资源管理 | RACI、Owner 字段、每周容量和 WIP 限制 |
| 沟通管理 | 每日异步同步、周会、Blocked 升级规则 |
| 风险管理 | 风险登记册、Risk 字段、异常中心、每周风险评审 |
| 采购管理 | 外部 API、账号、素材授权和第三方工具依赖清单 |
| 干系人管理 | 运营人员、维护者、外部平台作为干系人分类管理 |

## 快速开始

1. 阅读并按实际情况修订 [project-charter.md](./project-charter.md)。
2. 阅读 [operations-processes.md](./operations-processes.md)，确认新增流程和统一任务模型。
3. 从 [backlog.md](./backlog.md) 挑选任务创建 GitHub Issues。
4. 按 [github-project-blueprint.md](./github-project-blueprint.md) 创建 GitHub Project。
5. 每周更新 Backlog 和 Risk Register。
6. 所有影响架构、外部依赖、合规边界、任务模型或交付范围的讨论，24 小时内沉淀到 Decision Log。
