---
name: pipeline-flow
description: "Daily product-selection pipeline: keyword mining -> SYCM verification -> title/product generation -> distribution batch export."
version: 0.1.0
platforms: [linux, macos, windows]
---

# pipeline-flow

Use this skill to connect the daily product-selection flow. It orchestrates existing skills and does not replace them.

This skill is designed for weak agents. Prefer the deterministic workflow command, then read `nextActionCode`, `requiresUserAction`, `blockers`, and `userMessage` literally.

## Preferred Command

For a user-provided exact product keyword:

```bash
node bin/cli.js workflow run --keyword "<user keyword>" --json
```

Decision table:

- `requiresUserAction=true`: stop and show `userMessage`.
- `nextActionCode=confirm_before_submit`: ask the user to confirm the concrete product list before submitting.
- `nextActionCode=manual_action_required`: ask the user to complete login, slider, or authorization, then run the suggested `nextCommand`.
- `nextActionCode=workflow_complete`: report the result.

Only after explicit confirmation:

```bash
node bin/cli.js workflow resume --confirm-submit --json
```

## Golden Path

On a new device or after moving between macOS/Linux/Windows, check the local runtime first:

```bash
node bin/cli.js doctor --json
```

Run the whole pipeline. The default keeps a practical review pool instead of a tiny sample:

```bash
node bin/cli.js flow daily --mine 50 --verify 20 --generate 10 --export 20 --products-per-keyword 12 --json
```

Step-by-step:

```bash
node bin/cli.js flow mine --limit 50 --json
node bin/cli.js flow verify --run <runId> --limit 20 --json
node bin/cli.js flow generate --run <runId> --limit 10 --json
node bin/cli.js flow export --run <runId> --limit 20 --json
```

For a user-provided exact product keyword, do not rewrite or shorten the keyword. Use:

```bash
node bin/cli.js flow keyword "<user keyword>" --export 20 --products-per-keyword 12 --json
```

Inspect latest opportunities:

```bash
node bin/cli.js flow opportunities --json
```

## Flow

```text
flow mine
-> flow verify
-> flow generate
-> flow export
-> human review
-> 1688-distribution
```

## What Each Step Does

- `flow mine`: calls `keyword-mining`.
- `flow keyword`: creates a one-keyword run from the exact user keyword, then calls SYCM, title/product generation, and export. Use this for requests like "用这个词选品".
- `flow verify`: calls `sycm-research` serially. It tries strict blue mode, relaxed blue mode, then hot mode when allowed. It must preserve `categoryAnalysis.recommendation.recommended.category` as `recommendedCategory`.
- `flow generate`: calls `title-gen` only for SYCM-verified keywords.
- `flow export`: writes a distribution batch and review report. It does not submit distribution.
  - `distribution-batch.txt` contains only Recommended Submit rows.
  - Recommended Submit rows must include category when SYCM or product category is available, using `URL$$title$$category`.
  - Rows with no SYCM category and no product category are blocked with `missing_category`.
  - `distribution-review.md` also contains Manual Review Candidates that are not auto-exported; show these to the user as optional add-ons instead of discarding them silently.

## Weak Agent Rules

- Do not run SYCM queries in parallel.
- Always read `status`, `nextActionCode`, `requiresUserAction`, `blockers`, `allowedCommands`, `nextCommand`, and `userMessage`.
- Do not invent the next step.
- If `doctor --json` reports blockers, fix them before browser-dependent steps.
- If the user gave a concrete keyword, use `flow keyword "<keyword>" --json`; do not simplify the keyword before SYCM or 1688 search.
- Do not create manual distribution batch files from raw 1688 results unless you also add the category field.
- Do not generate titles when `verified` is 0.
- Do not continue after `sycm_manual_action_required`.
- Do not distribute unless the user has confirmed the concrete Recommended Submit list.
- If `mustReview` is `true` or `status` is `needs_review`, stop and read `distribution-review.md`; report both Recommended Submit and Manual Review Candidates.

## Status Meanings

- `mined`: candidates are ready; run verify next.
- `verified`: SYCM verified at least one keyword; run generate next.
- `verified_empty`: no keyword passed SYCM; stop.
- `manual_action_required`: SYCM needs login, slider completion, or feature opening; stop.
- `verified_partial_manual_required`: some keywords passed, but a later SYCM query needs manual action; stop before generation.
- `generated`: product/title generation produced rows; run export next.
- `generate_failed`: no usable generated products; stop.
- `ready_to_distribute`: batch file exists; ask user to review/confirm before distribution.
- `needs_review`: batch file may exist, but Manual Review Candidates or rejected rows require human review; stop and read the review file.
- `export_empty`: no rows were exported; stop.

## Files

Each run writes:

```text
data/pipeline/runs/<runId>/
  run.json
  candidates.jsonl
  sycm-results.jsonl
  verified-keywords.jsonl
  generated-products.jsonl
  distribution-batch.txt
  distribution-review.md
```

The export file uses:

```text
https://detail.1688.com/offer/<id>.html$$<title>
https://detail.1688.com/offer/<id>.html$$<title>$$<category>
```

Prefer the three-field form. The category should come from SYCM `categoryAnalysis.recommendation.recommended.category` first, then from the 1688 product category.

## Opportunity Fields

- `opportunityScore`: 0-100 score.
- `decision`: `continue`, `observe`, `review`, or `reject`.
- `nextAction`: next safe action.
- `keywordOpportunity`: keyword-level reason.
- `productOpportunity`: product-level reason.

Only `decision: "continue"` should move forward automatically.

## Relation To Other Skills

- `keyword-mining` can still be used alone.
- `sycm-research` can still be used alone.
- `title-gen` can still be used alone.
- `1688-distribution` is separate and must only run after export plus human confirmation.
