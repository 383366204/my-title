---
name: pipeline-flow
description: "Daily product-selection pipeline: keyword mining -> SYCM verification -> title/product generation -> distribution batch export."
version: 0.1.0
platforms: [linux, macos, windows]
---

# pipeline-flow

Use this skill to connect the daily product-selection flow. It orchestrates existing skills and does not replace them.

This skill is designed for weak agents. Read `AGENT_RUNBOOK.md` first and follow the returned `nextCommand`.

## Golden Path

Run the whole pipeline:

```bash
node bin/cli.js flow daily --mine 50 --verify 20 --generate 10 --export 20 --json
```

Step-by-step:

```bash
node bin/cli.js flow mine --limit 50 --json
node bin/cli.js flow verify --run <runId> --limit 20 --json
node bin/cli.js flow generate --run <runId> --limit 10 --json
node bin/cli.js flow export --run <runId> --limit 20 --json
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
- `flow verify`: calls `sycm-research` serially. It tries strict blue mode, relaxed blue mode, then hot mode when allowed.
- `flow generate`: calls `title-gen` only for SYCM-verified keywords.
- `flow export`: writes a distribution batch and review report. It does not submit distribution.

## Weak Agent Rules

- Do not run SYCM queries in parallel.
- Always read `status`, `blockers`, `allowedCommands`, and `nextCommand`.
- Do not invent the next step.
- Do not generate titles when `verified` is 0.
- Do not continue after `sycm_manual_action_required`.
- Do not distribute unless `status` is `ready_to_distribute` and the user has confirmed the concrete list.
- If `mustReview` is `true` or `status` is `needs_review`, stop and read `distribution-review.md`.

## Status Meanings

- `mined`: candidates are ready; run verify next.
- `verified`: SYCM verified at least one keyword; run generate next.
- `verified_empty`: no keyword passed SYCM; stop.
- `manual_action_required`: SYCM needs login, slider completion, or feature opening; stop.
- `verified_partial_manual_required`: some keywords passed, but a later SYCM query needs manual action; stop before generation.
- `generated`: product/title generation produced rows; run export next.
- `generate_failed`: no usable generated products; stop.
- `ready_to_distribute`: batch file exists; ask user to review/confirm before distribution.
- `needs_review`: some rows were blocked by quality gates; stop and read the review file.
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
