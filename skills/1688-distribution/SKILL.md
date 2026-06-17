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

On a new device or after moving between macOS/Linux/Windows, check the runtime first:

```bash
node bin/cli.js doctor --json
```

For login/authorization troubleshooting, use the read-only deep check:

```bash
node bin/cli.js doctor --deep --json
```

If item.jnesoft.com reports expired login, the CLI may click `重新登录`, fall back to `重新授权`, switch to the Taobao authorization page, click `授权并登录`, and return to readiness checks. If the page requires QR code, slider, SMS, password, captcha, or another manual verification, stop and show `userMessage`.

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

5. To re-check final copy-log outcomes later without submitting:

```bash
node bin/cli.js distribute --input-file "<distribution-batch.txt>" --confirm-log --json
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
- `confirmation.issueOfferIds` is empty.
If the status is `completed_with_issues`, report which offer ids were skipped or failed; do not submit again automatically.
Current confirmation must come from the copy log opened after submit. If only old rows are visible, stop and report `partial_confirmed`; do not submit again automatically.

## Stop Conditions

Stop and report if:

- User has not confirmed the exact list.
- IP/copyright risk precheck has not been done.
- `--dry-run` returns invalid items.
- `doctor --json` returns blockers.
- `--check` returns `browser_cdp_unavailable`.
- `--check` returns `recent_duplicate_batch`.
- Browser asks for QR, SMS, password, captcha, or any manual login challenge.
- CLI reports garbled Chinese such as `????`.
- CLI cannot click or confirm the view-copy-record button.
- batch status is `partial_confirmed` or `not_confirmed`.
- batch status is `completed_with_issues`.
- `confirmation.missingOfferIds` is non-empty.
- `confirmation.issueOfferIds` is non-empty.

Do not retry submit automatically after a stop condition.

## Browser Rules

- Reuse the user's logged-in Chrome/CDP session.
- If the jnesoft session expires but Taobao is still logged in, the CLI may click `重新登录`, fall back to `重新授权`, and then click Taobao `授权并登录` automatically.
- If Taobao requires QR, SMS, password, captcha, or account switching, stop and ask the user to complete it manually.
- On macOS, if CDP is unavailable, start a separate Chrome instance with `open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir="$HOME/.hermes/chrome-profiles/1688" --no-first-run --no-default-browser-check`, then verify `curl -s http://127.0.0.1:9222/json/version`.
- On Linux, if CDP is unavailable, start `google-chrome`, `google-chrome-stable`, `chromium-browser`, or `chromium` with `--remote-debugging-port=9222 --user-data-dir="$HOME/.hermes/chrome-profiles/1688" --no-first-run --no-default-browser-check`, then verify `curl -s http://127.0.0.1:9222/json/version`.
- In Hermes terminal, do not append `&` to foreground commands. Use `terminal(background=true)` for long-running Chrome processes, or use macOS `open -na` which returns immediately.
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
