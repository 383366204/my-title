# keyword-mining

Use this skill to discover daily candidate keywords. The default daily workflow derives short product roots from news, dictionary, calendar, and trend inspirations; the legacy seed pool remains available for compatibility. It does not prove that a keyword is blue-ocean until SYCM verifies it.

This skill is designed for weak agents. Prefer the CLI and follow the returned `nextCommands`.

## Weak Agent Golden Path

Start the default dynamic daily pipeline:

```bash
node bin/cli.js flow daily --discovery-mode inspiration --root-limit 8 --json
```

Optional RSS/Atom feeds are configured with `INSPIRATION_NEWS_FEEDS`. Without feeds, dictionary and calendar inspiration still run.

Use balanced local seed mining only for legacy/manual exploration:

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

1. Collects deterministic daily inspirations from configured news feeds, a dictionary, calendar context, and optional trends.
2. Blocks sensitive news, brand/IP risks, banned words, and abstract non-products.
3. Converts safe inspirations into short, concrete 1688 product roots with the configured LLM and local fallback rules.
4. Applies root and product-family cooldowns plus source quotas and diversity limits.
5. Queries each selected root through SYCM serially, at one page per root.
6. Scores and clusters the returned long-tail candidates.
7. Persists the inspiration, product-root, candidate, and rejection chain for node inspection.
8. Stops on the mining node when Chrome/SYCM is unavailable instead of silently returning an empty review step.

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
- `inspiration.inspirations[]`: source provenance and safety decision.
- `inspiration.roots[]`: productized roots, scores, cooldowns, and rejection reasons.
- `stats.rootQueries`: serial SYCM root-query outcomes.

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
- No dynamic candidates: inspect `inspiration.roots[].rejectReason`; do not inject repeated static fallback words unless hybrid mode was selected.

## Never Do These

- Do not treat keyword-mining output as verified blue-ocean data.
- Do not skip SYCM verification.
- Do not generate titles from `observe` candidates.
- Do not add random broad seeds like `女装` unless the user explicitly wants broad exploration.
- Do not delete seeds automatically.
