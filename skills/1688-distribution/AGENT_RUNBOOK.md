# 1688 Distribution Agent Runbook

This file is for weak agents. Follow it literally. Use the CLI first. Do not operate the page by sight unless the CLI reports that manual inspection is required.

## One Rule

Distribution is a final submit action. Never submit before showing the exact product list to the user and receiving explicit confirmation.

## Input Format

Use one product per line:

```text
https://detail.1688.com/offer/<id>.html<TAB><title>
https://detail.1688.com/offer/<id>.html<TAB><title><TAB><category>
```

Accepted alternatives:

```text
https://detail.1688.com/offer/<id>.html$$<title>
https://detail.1688.com/offer/<id>.html$$<title>$$<category>
```

Do not pass `$$` through bash unquoted because some shells expand it.

## Golden Path

1. On a new device, or after moving between macOS/Linux/Windows, run:

```bash
node bin/cli.js doctor --json
```

If it reports blockers, stop and fix them before distribution.

2. If Hermes is the caller, sync skills first:

```bash
node bin/cli.js sync-hermes-skills --apply --json
```

3. Show the concrete distribution list to the user.

Required before submit:

- Copyright/IP precheck is complete.
- Risky brand/IP products are excluded or explicitly approved.
- User has confirmed after seeing the list.
- Batch size is reasonable. Prefer 50 or fewer items per batch.

4. Validate input without touching the browser:

```bash
node bin/cli.js distribute --input-file "<distribution-batch.txt>" --dry-run --json
```

Success condition:

- `ok` is `true`.
- `total` is greater than 0.
- Every batch has `dryRun: true`.

5. Check browser readiness and duplicate-submit risk:

```bash
node bin/cli.js distribute --input-file "<distribution-batch.txt>" --check --json
```

Success condition:

- `ok` is `true`.
- `status` is `ready`.
- `browser.ok` is `true`.
- `blockers` is empty.

6. Submit only after user confirmation:

```bash
node bin/cli.js distribute --input-file "<distribution-batch.txt>" --submit --json
```

Success condition:

- `ok` is `true`.
- Each submitted batch has `logUrl`.
- Each submitted batch has `status: confirmed`.
- `confirmation.foundOfferIds` contains every submitted offer id.
- `confirmation.missingOfferIds` is empty.
- `confirmation.issueOfferIds` is empty.
- `confirmation.perOfferId` may show `batch` or `single`; both are acceptable confirmation sources.

7. To check final outcomes later without submitting:

```bash
node bin/cli.js distribute --input-file "<distribution-batch.txt>" --confirm-log --json
```

If status is `completed_with_issues`, report `confirmation.issueOfferIds` and per-offer statuses. Do not retry submit automatically.

## What The CLI Does

The CLI handles the fragile browser steps:

```text
reuse existing item.jnesoft.com tab
-> enter multi-store copy
-> fill product lines
-> choose random average distribution
-> select all shops
-> click the start-batch-copy button exactly once
-> click the view-copy-record button
-> confirm every offer id in the copy log
-> if batch search misses ids, search the missing offer ids one by one inside the copy log
```

Weak agents should not reimplement this flow unless the CLI is unavailable.

## Stop Conditions

Stop and report if any of these happens:

- `--dry-run` returns invalid item errors.
- `--check` returns `browser_cdp_unavailable`.
- `--check` returns `recent_duplicate_batch`.
- The user has not confirmed the concrete list.
- Copyright/IP precheck has not been done.
- The page asks for SMS, password, QR code, captcha, or any manual login challenge.
- The CLI reports garbled Chinese such as `????`.
- The CLI cannot click or confirm the view-copy-record button.
- A batch returns `partial_confirmed` or `not_confirmed`.
- A batch returns `completed_with_issues`.
- Any `confirmation.missingOfferIds` are present.
- Any `confirmation.issueOfferIds` are present.

Do not retry submit automatically after any stop condition.

## Browser Rules

- Use the existing logged-in Chrome/CDP session.
- The CLI may automatically click jnesoft `重新登录`, fall back to jnesoft `重新授权`, and click Taobao `授权并登录` when Taobao is already logged in.
- If Taobao asks for QR, SMS, password, captcha, or account switching, stop and ask the user to complete it manually.
- Use one business tab only.
- Do not open `air.1688.com` for this flow.
- Prefer `https://item.jnesoft.com/`.
- If currently on the copy-log page, use the CLI or browser history to return to the multi-store form; do not open a new tab.

## Category

If category is known, include it as the third field. Get it from SYCM:

```bash
node bin/cli.js sycm "<keyword>" --mode blue --pages 1 --json
```

Read:

```text
categoryAnalysis.recommendation.recommended.category
```

## Report Format

Use this exact shape:

```text
Distribution: <ready/submitted/blocked>
Total: <n>
Batches: <n>
Browser: <ok/blocked>
Blockers: <comma-separated blockers or none>
Logs: <logUrl values or none>
Next: <nextAction>
```

## Never Do These

- Do not submit before user confirmation.
- Do not click fuzzy copy entries. The target is multi-store copy.
- Do not click the start-batch-copy button twice.
- Do not stop after submit without checking the copy record.
- Do not create a new business tab per batch.
- Do not include known brand/IP risk items unless approved by the user.
