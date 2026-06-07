---
name: keyword-mining
description: "每日蓝海候选词挖掘：基于种子池、类目规则、本地评分、多样性控制和可选 SYCM 预检，产出可进入生意参谋验证的候选关键词"
version: 0.3.0
platforms: [linux, macos, windows]
---

# Keyword Mining

用于每天稳定产出一批候选蓝海词，解决“每天想不到选品方向”的问题。这个 skill 只做初筛和路线规划，不替代生意参谋验证。

## 推荐入口

```bash
node bin/cli.js mine-keywords --limit 50 --json
node bin/cli.js mine-keywords --limit 80 --mode explore --json
node bin/cli.js mine-keywords --limit 30 --mode strict --json
node bin/cli.js mine-keywords --limit 50 --output-max-per-product-core 2 --json
```

## 流程

1. 读取 `data/keyword-mining/seeds.json`。
2. 按种子优先级、历史成功/失败和状态排序。
3. 对普通种子扩词，对 `type=direct` 的种子单独输出为 `directKeywords`。
4. 使用类目规则组合材质、人群、风格、场景、功能、价格带、痛点和趋势词。
5. 用拒绝规则提前过滤不合理组合，如“宝宝戒指”“纯银宠物玩具”。
6. 本地评分并分层：`high` / `mid` / `low`。
7. 生成 `signature`，把词序不同、弱修饰词不同但本质相同的候选聚成同一选品方向。
8. 按种子、类目、扩词模式、商品核心词做多样性控制。
9. 输出下一步命令：热搜验证、Blue 模式蓝海深挖、标题生成。

## 模式

- `strict`: 只保留更强候选，适合时间少时使用。
- `balanced`: 默认模式，兼顾质量和数量。
- `explore`: 放宽阈值，适合蓝海词不足时扩展新方向。

## Hermes 验证结论

- 正向挖词的主要价值是找到“市场入口词”，不是直接判定蓝海。
- `hot` 模式按搜索人气排序，适合确认有人搜。
- `blue` 模式按需求供给比排序，适合从入口词里深挖真正蓝海关联词。
- `demandSupplyRatio = 需求 / 供给`，数值越高越偏蓝海；`>= 1` 才表示需求大于供给。
- `direct` 种子通常是已经足够具体的选品入口，不参与普通扩词排序，除非显式传 `--include-direct-seeds`。

## 输出字段

- `keyword`: 候选关键词。
- `seed`: 来源种子。
- `category`: 来源类目。
- `pattern`: 扩词模式，例如 `material+seed`、`direct-seed`。
- `localScore`: 本地初筛分。
- `tier`: `high` / `mid` / `low`。
- `reason`: 为什么值得验证。
- `nextAction`: 通常为 `sycm_verify`。
- `coreProduct`: 商品核心词，例如 `发夹`、`戒指`、`冰袖`。
- `signature`: 方向签名，用于近似去重。
- `cluster`: 被合并到同一方向的相似候选词。
- `clusterSize`: 同方向被合并的词数量；数值越大，说明这个方向重复扩散越明显。
- `stats.clustered`: 聚类后的方向数量。
- `stats.duplicatesRemoved`: 被方向级去重合并掉的候选数量。
- `directKeywords`: direct 种子列表，可直接选品或先做 hot/blue 双验证。
- `nextCommands.hotCheck`: 生意参谋热搜验证命令。
- `nextCommands.blueExplore`: 生意参谋 Blue 模式蓝海深挖命令。

## 去重与多样性

默认不是简单字符串去重，而是方向级去重：

- `夏季防晒冰袖女` 和 `防晒冰袖女夏季` 会合并成同一个 `signature`。
- `送礼珍珠发夹`、`复古珍珠发夹`、`高级感珍珠发夹` 这类弱修饰词变化，会聚成同一个珍珠发夹方向。
- 同一个 `coreProduct` 默认最多输出 3 个候选，避免一天的结果被同一商品形态刷屏。

想更分散时使用：

```bash
node bin/cli.js mine-keywords --limit 50 --output-max-per-product-core 2 --json
```

想围绕某个商品形态深挖时，可以临时放宽：

```bash
node bin/cli.js mine-keywords --limit 50 --output-max-per-product-core 5 --json
```

## 弱模型操作建议

先执行：

```bash
node bin/cli.js mine-keywords --limit 50 --mode balanced --json
```

优先挑 `tier=high` 的词执行 `hotCheck`。确认有人搜之后，再执行同词的 `blueExplore`，从返回结果里挑 DSR 高、无品牌和违禁风险的关联词。如果 high 不够，再挑 `tier=mid`。如果蓝海词不足，重新执行：

```bash
node bin/cli.js mine-keywords --limit 80 --mode explore --json
```

然后继续用 `hotCheck -> blueExplore` 双步骤验证。
