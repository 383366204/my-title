# keyword-mining

Use this skill to mine daily candidate keywords from the seed pool. It only produces candidates. It does not prove that a keyword is blue-ocean until SYCM verifies it.

This skill is designed for weak agents. Prefer the CLI and follow the returned `nextCommands`.

## Weak Agent Golden Path

Start with balanced local mining:

```bash
node bin/cli.js mine-keywords --limit 50 --mode balanced --json
```

Use AI plus local rules when the user asks for more directions:

```bash
node bin/cli.js mine-keywords --limit 50 --source hybrid --ai-candidates 40 --ai-batch-size 20 --json
```

When candidates are too few:

```bash
node bin/cli.js mine-keywords --limit 80 --mode explore --json
```

When results repeat the same product form too much:

```bash
node bin/cli.js mine-keywords --limit 50 --output-max-per-product-core 2 --json
```

## What The Tool Does

1. Reads `data/keyword-mining/seeds.json`.
2. Expands seed words into concrete candidate keywords.
3. Applies reject rules and synonym normalization.
4. Scores local candidates.
5. Optionally asks an LLM for extra candidates in batches.
6. Repairs/salvages LLM JSON where possible.
7. Clusters near-duplicate directions by `signature`.
8. Applies diversity limits by seed, category, pattern, and core product.
9. Returns candidates and the next safe commands.

## Output Fields To Trust

- `candidates[]`: ranked candidate keywords.
- `directKeywords[]`: direct seed keywords. Verify them before title generation.
- `keyword`: candidate keyword.
- `tier`: `high`, `mid`, or `low`.
- `localScore`: local rule score.
- `nextAction`: usually `sycm_verify`; `observe` means do not continue automatically.
- `nextCommands.hotCheck`: SYCM hot-search check.
- `nextCommands.blueExplore`: SYCM blue-ocean exploration.
- `stats.ai.failedBatches`: LLM batches that failed.

## Decision Rules

- Use `tier=high` first.
- If not enough, use `tier=mid`.
- Do not use `tier=low` unless the user asks for exploration.
- If `nextAction` is `observe`, stop and report it instead of querying SYCM automatically.
- Every keyword must pass SYCM before title generation or distribution.
- If AI candidates look strange, trust local `scoreKeyword` and reject reasons over the AI confidence.

## Seed Pool

Add a seed:

```bash
node bin/cli.js seeds add "<seed>" --category "<category>" --priority 5 --json
```

List seeds:

```bash
node bin/cli.js seeds list --json
```

Direct seeds are already concrete product/search entries. They are returned as `directKeywords` and normally do not participate in expansion unless:

```bash
node bin/cli.js mine-keywords --include-direct-seeds --json
```

## Failure Handling

- LLM JSON parse failure: retry with smaller `--ai-batch-size 10`.
- AI provider unavailable: fall back to `--source local`.
- Too many duplicates: lower `--output-max-per-product-core`.
- Too few keywords: use `--mode explore`, then verify with SYCM.
- SYCM unavailable: stop and ask the user to fix Chrome login/CDP; do not mark keywords as verified.

## Never Do These

- Do not treat keyword-mining output as verified blue-ocean data.
- Do not skip SYCM verification.
- Do not generate titles from `observe` candidates.
- Do not add random broad seeds like `女装` unless the user explicitly wants broad exploration.
- Do not delete seeds automatically.
