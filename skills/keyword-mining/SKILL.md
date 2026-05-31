---
name: keyword-mining
description: "每日蓝海候选词挖掘 - 基于种子词池、类目规则、本地评分和多样性控制，产出可去生意参谋验证的候选关键词"
version: 0.2.0
platforms: [linux, macos, windows]
---

# Keyword Mining

用于每天稳定产出一批候选蓝海词，解决“每天想不到选品方向”的问题。这个 skill 只做初筛，不替代生意参谋验证。

## 输入

- 种子词池：`data/keyword-mining/seeds.json`
- 可选数量：默认 50 个候选词
- 可选多样性限制：按种子、类目、扩词模式控制输出上限

## 处理逻辑

1. 读取种子池，按优先级、历史表现和更新时间排序。
2. 根据类目选择扩词规则，例如饰品、宠物、家居、节日礼品、玩具。
3. 生成材质、人群、风格、场景、功能等组合词。
4. 用负面组合规则过滤明显不合理的词，例如“戒指宝宝”“宠物玩具玛瑙”。
5. 本地评分，保留商品形态明确、材质/人群/功能/场景清晰的词。
6. 按分数排序，再做多样性控制，避免某一个种子或模式刷屏。
7. 输出下一步命令，方便弱模型按步骤执行生意参谋验证和标题生成。

## 输出

候选词列表，每个候选词包含：

- `keyword`: 候选关键词
- `seed`: 来源种子
- `category`: 来源类目
- `pattern`: 扩词模式
- `localScore`: 本地初筛分
- `reason`: 为什么值得验证
- `nextAction`: 固定为 `sycm_verify`
- `nextCommands`: 下一步 CLI 命令，包括 `sycm`、`titleResearch`、`titleGenerate`

## 推荐流程

```text
seed add/list
→ mine-keywords
→ 人工或 sycm-research 验证
→ 验证通过后进入 title-gen
→ 铺货和结果回流到种子池
```

## CLI

```bash
node bin/cli.js seed list
node bin/cli.js seed add "玛瑙戒指" --category 饰品 --priority 8 --reason "生意参谋关联词回流"
node bin/cli.js mine-keywords --limit 100
node bin/cli.js mine-keywords --limit 50 --output-max-per-seed 5 --output-max-per-category 20
node bin/cli.js mine-keywords --json
```
