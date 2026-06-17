# Weak Agent Runbook

This file is written for weaker agents. Follow it literally. Do not invent extra steps.

## Goal

Produce a distribution batch from daily keyword mining:

```text
mine keywords -> verify with SYCM -> generate titles/products -> export distribution batch
```

The flow does not automatically distribute products. Human review is required before using `1688-distribution`.

## Exact Keyword Mode

Use this when the user says "用这个词选品", "实测这个词", or gives one concrete product keyword. Do not rewrite, shorten, split, or translate the keyword.

Preferred deterministic command:

```bash
node bin/cli.js workflow run --keyword "<exact user keyword>" --json
```

Rules:

- This command must stop before submit with `nextActionCode=confirm_before_submit`.
- Show the concrete product list or batch file to the user.
- Submit only after the user explicitly confirms by running `node bin/cli.js workflow resume --confirm-submit --json`.

Debug command:

```bash
node bin/cli.js flow keyword "<exact user keyword>" --export 20 --products-per-keyword 12 --json
```

Read the JSON result:

- `exactKeyword` must exactly match the user's keyword.
- Confirm that SYCM returned or preserved a category. The category source is `categoryAnalysis.recommendation.recommended.category`, stored as `recommendedCategory`.
- If `status` is `needs_review`, read `files.distributionReview` and report Recommended Submit, Manual Review Candidates, and Hard Rejected rows.
- If `status` is `ready_to_distribute`, read `files.distributionBatch` and `files.distributionReview`, then ask for human confirmation before distribution.
- If `status` is `verified_empty`, `manual_action_required`, `verified_partial_manual_required`, or `generate_failed`, stop and report `blockers`.
- Never distribute from this command without a separate explicit user confirmation of the concrete Recommended Submit list.

## Golden Path

On a new machine, or after moving between macOS/Linux/Windows, run this first:

```bash
node bin/cli.js doctor --json
```

If it returns blockers, stop and fix them before browser-dependent steps.

Run this command first:

```bash
node bin/cli.js flow daily --mine 50 --verify 20 --generate 10 --export 20 --products-per-keyword 12 --json
```

Read the JSON result:

- If `ok` is `true` and `status` is `ready_to_distribute`, open the file in `files.distributionBatch`.
- If `status` is `needs_review`, stop before distribution. Read `files.distributionReview` and report Recommended Submit, Manual Review Candidates, and Hard Rejected rows.
- If `status` is `verified_empty`, stop. Report that SYCM did not verify any candidates.
- If `status` is `manual_action_required` or `verified_partial_manual_required`, stop. Report `blockers` and ask the user to finish the browser action.
- If `status` is `generate_failed`, stop. Report the run id and inspect `generated-products.jsonl`.
- Always show `runId`, `status`, `nextActionCode`, `counts`, `blockers`, and `nextCommand` to the user.

## Step-by-step Mode

Use this when the user asks to debug or resume.

1. Mine:

```bash
node bin/cli.js flow mine --limit 50 --json
```

Success condition:

- JSON `ok` is `true`
- `candidates` is greater than 0
- JSON has `nextCommand`

2. Verify:

```bash
node bin/cli.js flow verify --run <runId> --limit 20 --json
```

Rules:

- SYCM verification must be serial. Never run multiple `flow verify` or `sycm` commands in parallel.
- SYCM verification also extracts category analysis. Preserve `categoryAnalysis.recommendation.recommended.category` as the category for later distribution.
- The verifier first uses strict blue-ocean mode. If rows are insufficient, it tries relaxed blue-ocean mode. If that still fails, it falls back to hot-search mode.
- If `verifyMode` is `blue`, treat it as high-confidence blue-ocean data.
- If `verifyMode` is `blue_relaxed`, treat it as medium-confidence blue-ocean data.
- If `verifyMode` is `hot`, treat it as trend/hot data, not strict blue-ocean data.
- If `verified` is 0, stop and report `verified_empty`.
- If `blockers` contains `sycm_manual_action_required`, stop even when some keywords were verified. Do not run generate.
- If `verified` is greater than 0, continue.

3. Generate:

```bash
node bin/cli.js flow generate --run <runId> --limit 10 --products-per-keyword 12 --json
```

Success condition:

- JSON `ok` is `true`
- `generated` is greater than 0

Rules:

- `--limit` is the number of verified keywords to generate.
- The default `--products-per-keyword` is 12. Use a smaller value only when the user explicitly asks for a tiny smoke test.
- Do not call `node bin/cli.js "<keyword>" --count 10` as a substitute for this step; `--count` means candidate title count.
- Do not run multiple title-generation commands in parallel.

4. Export:

```bash
node bin/cli.js flow export --run <runId> --limit 20 --json
```

Success condition:

- JSON `ok` is `true`
- `count` is greater than 0
- `file` points to `distribution-batch.txt`
- `mustReview` is `false`

If `mustReview` is `true` or `status` is `needs_review`, stop. Do not distribute until a human reads `reviewFile`. Recommended Submit rows are the default batch; Manual Review Candidates are optional add-ons and are not written to `distribution-batch.txt`.
Rows blocked by `missing_category` must not be distributed until a category is supplied.

## Files

Each run writes files here:

```text
data/pipeline/runs/<runId>/
```

Important files:

- `run.json`: status and counts
- `candidates.jsonl`: mined keywords
- `sycm-results.jsonl`: raw SYCM results and scores
- `verified-keywords.jsonl`: keywords that passed SYCM
- `generated-products.jsonl`: products and generated titles
- `distribution-batch.txt`: input for distribution; contains only Recommended Submit rows, preferably in `URL$$title$$category` form
- `distribution-review.md`: human review report with Recommended Submit, Manual Review Candidates, and Hard Rejected sections; read this before distribution

The opportunity pool is accumulated here:

```text
data/pipeline/opportunities/
  keywords.jsonl
  products.jsonl
  rejected.jsonl
```

To inspect the best accumulated opportunities:

```bash
node bin/cli.js flow opportunities --json
```

## Opportunity Fields

Read these fields literally. Do not reinterpret them.

- `opportunityScore`: 0-100 score. Higher is better.
- `decision`: `continue`, `observe`, `review`, or `reject`.
- `nextAction`: the next safe action, such as `search_1688`, `generate_title`, `manual_review`, or `stop`.
- `keywordOpportunity`: why a keyword should continue after SYCM.
- `productOpportunity`: why a product should continue after 1688/title generation.

Rules:

- If `decision` is `continue`, follow `nextAction`.
- If `decision` is `observe` or `review`, stop and report the row to the user.
- If `decision` is `reject`, do not distribute that row.
- If export writes `product_opportunity_*` in `exportReasons`, stop and read `distribution-review.md`.
- When keyword mining returns no candidates, the flow may use fallback concrete candidates. These still must pass SYCM before product search.

## Status Meanings

- `mined`: candidates are ready; run verify next.
- `verified`: SYCM has verified at least one keyword; run generate next.
- `verified_empty`: no keyword passed SYCM; stop.
- `manual_action_required`: SYCM needs login, slider completion, or feature opening before continuing; stop.
- `verified_partial_manual_required`: some keywords passed, but a later SYCM query needs manual action; stop before generation.
- `generated`: product/title generation produced rows; run export next.
- `generate_failed`: generation produced no usable rows; stop.
- `ready_to_distribute`: batch file exists; ask human to review before distribution.
- `needs_review`: batch file may exist, but Manual Review Candidates or hard rejected rows need human review; stop and read `distribution-review.md`.
- `export_empty`: no rows were exported; stop.

## Never Do These

- Do not run SYCM queries in parallel.
- Do not distribute automatically after `flow daily`.
- Do not edit `data/pipeline/runs/*` manually.
- Do not ignore a non-ready status.
- Do not distribute when `mustReview` is `true`.
- Do not continue after `sycm_manual_action_required`.
- Do not invent the next step; use `allowedCommands[0]` or `nextCommand`.
- Read `requiresUserAction` and `userMessage` literally.
- Do not use a keyword in title generation if SYCM rejected it.

## How To Report Back

Use this exact shape:

```text
Run: <runId>
Status: <status>
Counts: candidates=<n>, verified=<n>, generated=<n>, readyToDistribute=<n>
Blockers: <blockers or none>
Batch: <distribution-batch.txt path or empty>
Next: <nextCommand>
```
