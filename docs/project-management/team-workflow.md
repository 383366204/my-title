# 2 人团队协作流程

- **版本**：v1.3
- **更新日期**：2026-09-15
- **适用团队**：成员 A、成员 B
- **核心目标**：低沟通成本、高交付确定性、全流程范围可控、合规与授权风险可见

## 1. RACI

> R = 执行，A = 最终负责，C = 被咨询，I = 被告知。2 人团队中 A 和 R 可以是同一人。

| 活动 | 成员 A | 成员 B |
|---|---|---|
| 需求澄清与优先级 | A/R | C |
| 运营全流程设计 | A/R | C |
| 统一任务与异常模型 | C | A/R |
| SOP 与检查清单 | A/R | C |
| 合规与素材授权边界 | C | A/R |
| 架构设计 | C | A/R |
| 功能开发 | R | R |
| 代码评审 | R | R |
| 测试与质量门槛 | R | A/R |
| 外部平台风险 | R | A/R |
| 发布判断 | C | A/R |
| 用户文档 | A/R | C |
| 看板维护 | A/R | C |

## 2. 每周节奏

| 时间 | 活动 | 时长 | 输出 |
|---|---|---|---|
| 周一 | 计划会 | 30 分钟 | 本周目标、Owner、验收标准、风险动作 |
| 每日 | 异步同步 | 5 分钟 | 昨日完成 / 今日计划 / 阻塞 |
| 周三 | 中期检查 | 10 分钟 | 延期和阻塞处理 |
| 周五 | 回顾 + Backlog 修剪 | 30 分钟 | 完成情况、风险更新、下周候选 |
| 随需 | 技术决策会 | 15 分钟 | ADR 草案 |

## 3. 每日异步同步格式

```markdown
### YYYY-MM-DD
Done:
-

Today:
- [ ]

Blocked:
- <问题> / 需要谁做什么 / 截止时间：无
```

规则：

1. 没有阻塞也要写 `Blocked: 无`。
2. 阻塞必须说明需要谁做什么。
3. 阻塞超过 1 个工作日，创建或更新 Issue，并移动到 `Blocked`。

## 4. Issue 生命周期

```text
Backlog
  ↓ 满足 Definition of Ready
Ready
  ↓ Owner 领取并开始
In Progress
  ↓ 提交 PR 或请求复核
In Review
  ↓ 评审通过并满足 Definition of Done
Done

任意状态 --发现阻塞--> Blocked
Blocked --解除阻塞--> In Progress 或 Ready
```

### 状态规则

| 状态 | 进入条件 | 退出条件 |
|---|---|---|
| Backlog | 新需求、新 bug、新风险 | 所属运营环节、上下游产物、复核点、价值、验收标准和规模评估 |
| Ready | 本迭代可能执行 | Owner 开始工作 |
| In Progress | 已开始编码或调研 | 有可评审产物 |
| In Review | PR / 文档 / 测试结果请求复核 | 非作者评审通过 |
| Blocked | 等待人、账号、权限、外部服务或决策 | 阻塞解除，写清处理结果 |
| Done | 满足 Definition of Done | 不轻易重开；新问题另建 Issue |

## 5. WIP 限制

| 状态 | 限制 |
|---|---|
| In Progress | 每人最多 2 个 |
| In Review | 全团队最多 3 个 |
| Blocked | 必须每天复查 |
| Ready | 当前迭代最多 8 个 |

超过限制时：

1. 先完成或关闭已有任务。
2. 将低优先级任务退回 Ready / Backlog。
3. 不通过“并行开新任务”掩盖延期。

## 6. 分支与提交

### 分支命名

```text
feature/<issue-id>-<short-topic>
fix/<issue-id>-<short-topic>
docs/<issue-id>-<short-topic>
refactor/<issue-id>-<short-topic>
```

示例：

```text
feature/b-005-filter-reasons
fix/b-003-title-regression
docs/b-009-env-preflight
```

### 提交建议

```text
<type>(<scope>): <summary> (#<issue-number>)
```

示例：

```text
feat(title-gen): add rigid modifier regression tests (#3)
fix(workflow): preserve retry context after cancel (#11)
docs(pm): add project governance baseline (#2)
```

## 7. 代码评审标准

评审人重点检查：

1. 是否满足 Issue 验收标准。
2. 是否引入无关改动。
3. 外部 API 错误、超时、空数据、权限状态是否处理。
4. 是否违反平台规则、真实订单 / 评价边界或素材授权要求。
5. 新流程是否已定义异常事件、任务类型、实体关联和人工复核点。
6. 任务中心是否会出现重复任务、状态冲突或丢失审计记录。
7. 跨环节产物是否使用统一实体 ID 和字段来源。
8. 是否破坏 CLI / MCP / Web 行为一致性。
9. 测试是否覆盖主路径、失败路径和边界条件。
10. 是否泄露密钥、Cookie、账号信息。
11. 文档是否同步更新。
12. 复杂逻辑是否有中文业务注释，导出函数是否有 JSDoc。

评审时限：

- 普通任务：1 个工作日内响应。
- 阻塞主流程的修复：2 小时内响应。
- 评审人休假或不可用时，明确记录暂停原因。

## 8. 质量验证

日常开发：

```bash
npm test
```

涉及 core / skills：

```bash
npm run test:core-skills
```

涉及 pipeline：

```bash
npm run test:pipeline
```

涉及 Web UI：

```bash
npm run web:build
```

完整回归：

```bash
npm run test:all
```

发布前必须确认：

- [ ] 相关测试通过。
- [ ] Web 构建通过。
- [ ] CLI 帮助和示例有效。
- [ ] MCP 工具参数和错误信息有效。
- [ ] `.env` 与敏感数据未提交。
- [ ] 用户文档更新。
- [ ] 平台合规、真实订单 / 评价边界和素材授权检查完成。
- [ ] 异常事件、任务状态和审计记录可追溯。
- [ ] 单店月度净利润中的真实值、预估值、缺失数据、固定费用和分摊规则已区分。
- [ ] 已知问题、风险和人工操作条件写清。

## 9. 发布流程

1. 冻结新增范围，只允许发布阻塞项。
2. 执行完整回归。
3. 更新 README / Skill 文档 / 运行说明。
4. 更新风险登记册。
5. 打 tag 或记录版本说明。
6. 发布后在 GitHub Project 归档 Done。
7. 回顾线上问题并创建跟进 Issue。

## 10. 冲突与升级

| 情况 | 处理规则 |
|---|---|
| 优先级冲突 | 先保 P0 主流程和质量底线 |
| 技术方案冲突 | 各写 1 页备选方案，按风险和维护成本决策 |
| 新运营流程接入冲突 | 先做数据契约、异常类型、任务类型和人工复核点评审，再排实现 |
| 范围 vs 时间冲突 | 缩小自动化范围或延后环节，不降质量、合规和授权门槛 |
| 外部账号或权限问题 | 记录 Blocked，不等待超过 1 天 |
| 无法达成一致 | 默认技术负责人做发布安全决策，事后写 ADR |

## 11. 文档维护责任

| 文档 | 责任人 | 更新触发 |
|---|---|---|
| project-charter.md | 成员 A | 目标、范围、干系人变化 |
| backlog.md | 成员 A | 每周修剪 |
| risk-register.md | 成员 A 记录，成员 B 复核 | 每周或重大变化 |
| decision-log.md | 决策提出者 | 每个关键决策 |
| team-workflow.md | 成员 B | 协作流程变化 |
| github-project-blueprint.md | 看板管理员 | 字段、视图、自动化变化 |
