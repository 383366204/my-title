---
name: 1688-distribution
description: "Submit prepared 1688 product lines to item.jnesoft.com multi-store copy flow."
version: 1.0.0
platforms: [linux, macos, windows]
---

# 1688-distribution

Use this skill to submit a prepared distribution batch through `https://item.jnesoft.com/`.

This is a final submit action. It is designed for weak agents, but weak agents must use the CLI first and follow `AGENT_RUNBOOK.md`.

## Golden Path

1. Show the concrete distribution list to the user and wait for explicit confirmation.
2. Validate input:

```bash
node bin/cli.js distribute --input-file "<distribution-batch.txt>" --dry-run --json
```

3. Check browser/CDP and duplicate-submit risk:

```bash
node bin/cli.js distribute --input-file "<distribution-batch.txt>" --check --json
```

4. Submit after confirmation:

```bash
node bin/cli.js distribute --input-file "<distribution-batch.txt>" --submit --json
```

If Hermes is the caller, sync first:

```bash
node bin/cli.js sync-hermes-skills --apply --json
```

## Input Format

One product per line:

```text
https://detail.1688.com/offer/<id>.html<TAB><title>
https://detail.1688.com/offer/<id>.html<TAB><title><TAB><category>
```

Also accepted:

```text
https://detail.1688.com/offer/<id>.html$$<title>
https://detail.1688.com/offer/<id>.html$$<title>$$<category>
```

Use category from SYCM when available:

```bash
node bin/cli.js sycm "<keyword>" --mode blue --pages 1 --json
```

Read:

```text
categoryAnalysis.recommendation.recommended.category
```

## What The CLI Does

The CLI handles the browser flow:

```text
reuse existing item.jnesoft.com tab
-> open the copy-upload menu
-> enter multi-store copy
-> fill product lines
-> choose random average distribution
-> select all shops
-> click the start-batch-copy button exactly once
-> click the view-copy-record button
-> verify all offer ids in copy log, retrying missing ids one by one inside the log search
```

Weak agents should not implement this manually.

## Success Criteria

Submit is successful only if:

- JSON `ok` is `true`.
- each submitted batch has `status: confirmed`.
- each submitted batch has `logUrl`.
- `confirmation.missingOfferIds` is empty.
- every submitted offer id appears in `confirmation.foundOfferIds`.
Current confirmation must come from the copy log opened after submit. If only old rows are visible, stop and report `partial_confirmed`; do not submit again automatically.

## Stop Conditions

Stop and report if:

- User has not confirmed the exact list.
- IP/copyright risk precheck has not been done.
- `--dry-run` returns invalid items.
- `--check` returns `browser_cdp_unavailable`.
- `--check` returns `recent_duplicate_batch`.
- Browser asks for login, QR, SMS, password, or authorization.
- CLI reports garbled Chinese such as `????`.
- CLI cannot click or confirm the view-copy-record button.
- batch status is `partial_confirmed` or `not_confirmed`.
- `confirmation.missingOfferIds` is non-empty.

Do not retry submit automatically after a stop condition.

## Browser Rules

- Reuse the user's logged-in Chrome/CDP session.
- Use one business tab only.
- Do not open `air.1688.com` for this flow.
- Prefer `https://item.jnesoft.com/`.
- Do not create a new tab for each batch.
- If currently in copy log, return to the multi-store form before the next batch.

## Never Do These

- Do not submit before user confirmation.
- Do not click fuzzy copy entries. The target is multi-store copy.
- Do not click the start-batch-copy button twice.
- Do not stop after submit without checking the copy record.
- Do not include known brand/IP risk items unless the user explicitly approved the risk.
