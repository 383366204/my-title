# 1688 Distribution Agent Runbook

This file is for weaker agents. Follow it literally. Do not operate the page by sight unless the CLI tells you to.

## One Rule

Use the CLI first. Do not manually click `开始批量复制` unless the CLI flow is unavailable.

## Inputs

The input file must contain one product per line:

```text
https://detail.1688.com/offer/<id>.html<TAB>铺货标题
https://detail.1688.com/offer/<id>.html<TAB>铺货标题<TAB>生意参谋推荐类目
```

Plain URLs are accepted. Prefer `URL<TAB>标题<TAB>类目` in files when category is known. `URL$$标题` and `URL$$标题$$类目` are also accepted, but do not pass `$$` directly through bash because it expands to the shell process id.

If the category is needed, get it from SYCM keyword analysis:

```bash
node bin/cli.js sycm "<keyword>" --mode blue --json
```

Use `categoryAnalysis.recommendation.recommended.category`.

## Golden Path

1. Sync Hermes skill files if Hermes is the caller:

```bash
node bin/cli.js sync-hermes-skills --apply --json
```

2. Before submitting, show the exact distribution list to the user and wait for explicit confirmation.

Required pre-submit checklist:

- Copyright/IP precheck is done. See `references/ip-copyright-risk-db.md`.
- Risky brand/IP items are excluded or explicitly approved by the user.
- The user has replied with `确认` or an equivalent clear instruction after seeing the concrete list.
- Batch size is reasonable. Prefer 50 or fewer items per batch.

3. Validate the batch without touching the browser:

```bash
node bin/cli.js distribute --input-file "<distribution-batch.txt>" --dry-run --json
```

Success condition:

- JSON `ok` is `true`
- `total` is greater than 0
- every batch has `dryRun: true`

4. Check browser readiness and duplicate-submit risk:

```bash
node bin/cli.js distribute --input-file "<distribution-batch.txt>" --check --json
```

Success condition:

- JSON `ok` is `true`
- `status` is `ready`
- `browser.ok` is `true`
- `blockers` is empty

5. Submit the batch:

```bash
node bin/cli.js distribute --input-file "<distribution-batch.txt>" --json
```

Success condition:

- JSON `ok` is `true`
- each submitted batch has `logUrl`
- each submitted batch has `status: confirmed`
- `confirmation.foundOfferIds` contains every submitted offer id
- `confirmation.missingOfferIds` is empty

If JSON `ok` is `false` and a batch has `status: partial_confirmed` or `status: not_confirmed`, stop. Do not retry automatically. Report the missing offer ids and ask the user to inspect the copy log.

## Stop Conditions

Stop and report to the user if any of these happens:

- `--dry-run` returns invalid item errors.
- `--check` returns `browser_cdp_unavailable`.
- `--check` returns `recent_duplicate_batch`.
- The user has not confirmed the concrete distribution list.
- Copyright/IP precheck has not been done.
- The page asks for login, SMS, password, QR code, or authorization.
- The CLI reports `????` or lost Chinese text.
- The CLI says it cannot click `查看复制记录`.
- A batch returns `status: partial_confirmed` or `status: not_confirmed`.

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

- Do not open `air.1688.com` for distribution.
- Do not submit distribution before showing the concrete list and receiving explicit user confirmation.
- Do not include known brand/IP risk items unless the user explicitly approves after seeing the risk.
- Do not click any fuzzy `复制` entry. The target is `多店复制`.
- Do not click `开始批量复制` twice.
- Do not stop after clicking `开始批量复制`; always confirm `查看复制记录`.
- Do not create a new business tab for each batch.
