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
- `flow export` 只导出 `1688链接$$铺货标题`，供 `1688-distribution` 使用，不自动点击铺货按钮。
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
- `distribution-batch.txt` 输出格式为 `1688链接$$铺货标题`。
- `distribution-review.md` 是人工审核报告，铺货前必须先看。
- 铺货仍由 `1688-distribution` 单独执行，执行前建议人工检查清单。
