# sycm-research

Use this skill to query Taobao Shengyicanmou (SYCM) search-analysis data through an existing Chrome DevTools Protocol session.

This skill is designed for weak agents. Reuse the user's logged-in Chrome. Do not perform password login, SMS login, QR login, or slider dragging.

## Weak Agent Golden Path

Check Chrome/CDP:

```bash
node bin/cli.js sycm-status --json
```

Query blue-ocean related words:

```bash
node bin/cli.js sycm "<keyword>" --mode blue --pages 1 --json
```

Query hot-search related words:

```bash
node bin/cli.js sycm "<keyword>" --mode hot --pages 1 --json
```

Use hot mode when blue-ocean rows are insufficient:

```bash
node bin/cli.js sycm "<keyword>" --mode hot --pages 1 --json
```

## Required Browser State

- Chrome must expose CDP on port `9222` unless another port is passed.
- The user must already be logged in to SYCM in that Chrome profile.
- Cloud/server deployment should use a persistent Chrome profile directory.

Example Windows launch:

```powershell
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\Users\<User>\AppData\Local\ecom-ai-tools-chrome"
```

## Success Criteria

A query is successful only if:

- `ok !== false`.
- `data` is a non-empty array.
- Each useful row has `keyword`.
- Blue mode should prefer rows with higher `demandSupplyRatio`.
- Hot mode should prefer rows with real `searchPopularity` and `clickRate`.

Useful fields:

- `keyword`
- `demandSupplyRatio`
- `searchPopularity`
- `clickRate`
- `conversionRate`
- `buyerCount`
- `tmallClickShare`
- `categoryAnalysis.recommendation.recommended.category`

## Manual Action Statuses

If any of these statuses appear, stop the current flow and report to the user.

### `login_required`

Meaning: Chrome is not logged in to SYCM.

Action:

```text
Please open the Chrome profile connected to CDP, log in to SYCM manually, then tell me to retry.
```

### `slider_required`

Meaning: Taobao/SYCM showed a slider, captcha, or security verification.

Action:

```text
Please complete the slider/security verification manually in the current Chrome page. I will retry after you confirm.
```

Do not let an agent drag the slider.

### `sycm_feature_required`

Meaning: The account may be on a SYCM feature claim/opening page.

Action:

```text
Please manually click the claim/open/free-use button in SYCM, then tell me to retry.
```

## Query Modes

- `blue`: related blue-ocean words. Good for strict opportunity selection.
- `hot`: related hot-search words. Good when blue rows are too few or when finding demand directions.

Recommended weak-agent rule:

```text
Try blue first. If too few rows pass, try hot. Label hot results as trend data, not strict blue-ocean data.
```

## Category For Distribution

When distribution needs `URL$$title$$category`, use:

```bash
node bin/cli.js sycm "<keyword>" --mode blue --pages 1 --json
```

Read:

```text
categoryAnalysis.recommendation.recommended.category
```

If category analysis is missing, leave category empty and report that manual category review is needed.

## Never Do These

- Do not run many SYCM queries in parallel.
- Do not attempt automatic login.
- Do not drag sliders.
- Do not continue a pipeline after `slider_required`, `login_required`, or `sycm_feature_required`.
- Do not call hot-search rows strict blue-ocean rows.

## Public API

```js
const { extractSycmData } = require("./skills/sycm-research");

const result = await extractSycmData("戒指", {
  mode: "blue",
  maxPages: 1,
  port: 9222,
  loginMode: "manual"
});
```
