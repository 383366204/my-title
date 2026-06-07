---
name: pipeline-flow
description: "每日蓝海选品流水线 - 串联 keyword-mining、sycm-research、title-gen，并导出 1688-distribution 可用的铺货清单"
version: 0.1.0
platforms: [linux, macos, windows]
---

# Pipeline Flow

用于把每日选品流程串起来：选词、生意参谋校验、标题生成、导出铺货清单。第一版不自动铺货，保留人工确认点。

## 弱模型执行规则

如果调用方是不擅长推理的 agent，优先阅读同目录的 `AGENT_RUNBOOK.md`，并严格按里面的 Golden Path 或 Step-by-step Mode 执行。

最重要的规则：

- 不要并发生意参谋查询。
- 不要在 `status` 不是 `ready_to_distribute` 时铺货。
- 每一步优先读取 JSON 里的 `nextCommand`。
- 如果 `verified` 为 0，停止并向用户报告，不要强行生成标题。
- 如果 `mustReview` 为 `true` 或 `status=needs_review`，停止并让用户查看 `distribution-review.md`。
- 如果 `distribution-batch.txt` 已生成，先让用户确认，再交给 `1688-distribution`。

## 流程

```text
flow mine
→ flow verify
→ flow generate
→ flow export
```

或一键执行：

```bash
node bin/cli.js flow daily --mine 50 --verify 20 --generate 10 --export 20
```

## 与原有功能的关系

`pipeline-flow` 只做编排，不替代原有 skill，也不改变原有命令：

- `flow mine` 调用 `keyword-mining`，等价于自动化 `mine-keywords` 的候选词生成能力。
- `flow verify` 调用 `sycm-research`，等价于串行执行 `sycm <keyword>`，避免多个 SYCM 查询并发串页。
- `flow verify` 默认使用三层校验：先查严格蓝海词；如果数量不足或分数不通过，再查放宽蓝海词；如果仍不足，再降级查热搜词。
- `flow generate` 调用 `title-gen` 的 `generateTitlePipeline`，并把验证通过的 SYCM 数据作为 `sycmData` 传入。
- `flow export` 导出 `1688链接$$铺货标题`；如果 SYCM 类目分析有推荐类目，则导出 `1688链接$$铺货标题$$推荐类目`，供 `1688-distribution` 使用，不自动点击铺货按钮。
- `flow export` 会做铺货前质量门禁：标题长度、核心词、违禁词、URL、重复 URL/标题、类目冲突、热搜降级数量都会检查；不合格行只进 `distribution-review.md`。
- 每个 flow 步骤都会返回 `nextCommand`，弱模型应优先执行这个字段，而不是自行猜下一步。

原有命令仍可独立使用：

```bash
node bin/cli.js mine-keywords --limit 20
node bin/cli.js sycm "逗猫棒" --mode blue --json
node bin/cli.js "逗猫棒" --sycm-auto
```

## 文件

每次执行会生成一个 run：

```text
data/pipeline/runs/<runId>/
  run.json
  candidates.jsonl
  sycm-results.jsonl
  verified-keywords.jsonl
  generated-products.jsonl
  distribution-batch.txt
  distribution-review.md
data/pipeline/latest.json
```

## Opportunity Pool

流水线会额外沉淀机会池，方便后续继续选品、去重和复盘：

```text
data/pipeline/opportunities/
  keywords.jsonl
  products.jsonl
  rejected.jsonl
```

查看当前机会池：

```bash
node bin/cli.js flow opportunities --json
```

弱模型必须优先读取这些字段：

- `opportunityScore`: 0-100，越高越值得继续。
- `decision`: `continue` 才能进入下一步；`observe` / `review` / `reject` 都应停下来报告。
- `nextAction`: 下一步动作，优先级高于 agent 自己推理。
- `keywordOpportunity`: 关键词通过 SYCM 后的机会判断。
- `productOpportunity`: 1688 商品进入标题/铺货前的货源判断。

当普通挖词结果为空时，`flow mine` 会使用少量保底具体候选词防止流程断流；这些候选词仍然必须经过 `flow verify` 的生意参谋校验，不能直接生成标题或铺货。

## 命令

```bash
node bin/cli.js flow mine --limit 50
node bin/cli.js flow verify --limit 20
node bin/cli.js flow generate --limit 10
node bin/cli.js flow export --limit 20
```

蓝海词不足时默认会先尝试放宽蓝海，再降级到热搜词。可调整或关闭：

```bash
node bin/cli.js flow verify --limit 20 --min-blue-rows 3
node bin/cli.js flow verify --limit 20 --no-hot-fallback
```

`verify` 默认读取 latest run，也可以指定：

```bash
node bin/cli.js flow verify --run 2026-05-31-143848 --limit 10
```

## 约束

- 生意参谋必须串行查询，不能并发。
- 蓝海词不足时允许降级，但结果会标记 `fallbackUsed: true`、`verifyMode`、`confidence` 和 `usage`。
- `verifyMode: "blue"` 表示严格蓝海，`usage: "title_core"`。
- `verifyMode: "blue_relaxed"` 表示放宽蓝海，`usage: "title_optional"`。
- `verifyMode: "hot"` 表示热搜趋势，`usage: "trend_reference"`，不能当作严格蓝海词。
- 每个阶段都落盘，可从 latest run 继续。
- `distribution-batch.txt` 输出格式为 `1688链接$$铺货标题` 或 `1688链接$$铺货标题$$推荐类目`。
- `distribution-review.md` 是人工审核报告，铺货前必须先看。
- `needs_review` 表示有商品被门禁拦截；弱模型必须停止，不要继续铺货。
- 铺货仍由 `1688-distribution` 单独执行，执行前建议人工检查清单。
