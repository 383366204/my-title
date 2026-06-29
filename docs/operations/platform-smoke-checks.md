# Platform Smoke Checks

Use this runbook before relying on live Taobao, 1688, SYCM, or image-search flows.

## Baseline

```bash
node bin/cli.js doctor --json
```

Expected ready state:

```json
{
  "ok": true,
  "status": "ready",
  "nextActionCode": "doctor_ready",
  "requiresUserAction": false,
  "blockers": []
}
```

If the command returns `requiresUserAction=true`, complete the `userMessage` instruction before continuing.

## SYCM Readiness

```bash
node bin/cli.js sycm-status --json
```

Ready means Chrome CDP is reachable. Login and slider state are still verified by a real query:

```bash
node bin/cli.js sycm "项链" --mode blue --pages 1 --json
```

Stop and ask the user to act when any of these statuses appear:

- `login_required`
- `slider_required`
- `sycm_feature_required`
- `manual_action_required`

Do not attempt password login, SMS login, QR login, or slider dragging from automation.

## Title Generation Preflight

```bash
node bin/cli.js title-gen-preflight --json
```

Use this before `use_image_search=true`. If Chrome CDP is blocked, start Chrome with remote debugging and rerun the preflight.

## Text Title Generation

```bash
node bin/cli.js "纯银项链女高级感" --length 60 --format json
```

Expected:

- JSON parses successfully.
- `ok` is true or the payload includes actionable blockers.
- Generated titles do not contain platform-banned words.

## Manual Peer Titles Fallback

```bash
node bin/cli.js "纯银项链女高级感" --peer-titles "925纯银项链女锁骨链简约百搭,韩版项链女设计感小众" --format json
```

Expected:

- The run does not require Taobao desktop search.
- Output still includes generated titles or an actionable degraded status.

## Image Search Title Generation

```bash
node bin/cli.js "纯银项链女高级感" --use-image-search --max-image-search 3 --format json
```

Expected:

- Image search either returns peer titles or degrades to text/manual peer-title paths.
- `captcha_required`, `login_required`, or account-access errors are surfaced as manual action states.
- The process exits without hanging beyond the configured run timeout.

## Web UI Smoke

```bash
npm run ui:react
```

Open:

```text
http://localhost:3000/
http://localhost:3000/workflow/
```

Verify:

- The dashboard opens as the main daily workbench.
- The workbench can load recent `/api/workbench/runs` summaries, even when there are no runs yet.
- The `流程监控` navigation opens `/workflow/` in the same tab.
- `/workflow/` defaults to the read-only pipeline monitor.
- Monitor nodes show `种子/启动 -> 挖词 -> 多指标验真 -> 标题货源 -> 人工复核 -> 待铺货批次 -> 已提交`.
- The `节点实验` toggle still exposes the demo canvas.
- In `节点实验`, templates load and validation rejects invalid graphs.
