# Platform Access Governance Design

## Goal

Unify Taobao, Shengyi Canmou (SYCM), and 1688 access behind one conservative platform guard so daily keyword mining and product listing automation cannot overload platform APIs, browser automation, or native desktop bridges.

## Current State

- `core/platform-access-guard.js` already provides persisted cache, per-platform cooldown, file locking, breaker state, and manual-action metadata.
- 1688 API calls already use both `runWithPlatformGuard('1688')` and the in-memory `skills/alibaba1688/src/rate-limiter.js`.
- 1688 web search already uses `runWithPlatformGuard('1688')`.
- SYCM extraction already uses `runWithPlatformGuard('sycm')`.
- Taobao text search in `skills/title-gen/src/search-taobao.js` does not use the guard.
- Taobao image search in `skills/title-gen/src/search-taobao-image.js` has an in-process lock and per-batch delay, but not a cross-process guard.
- Web endpoints can trigger platform access from mining, title generation, and pipeline steps, so backend safeguards must not depend on frontend button disabled states.

## Design

### Platform Guard Is The Required Boundary

Every external platform access path must call `runWithPlatformGuard(platform, options, operation)` before touching a platform. The guard remains in `core/platform-access-guard.js` and owns:

- cache lookup and writeback;
- cross-process file lock;
- randomized cooldown before real access;
- breaker checks;
- failure classification and manual-action files;
- status reporting for web UI and workflow runtime.

The existing guard should be extended instead of introducing another scheduler. That keeps CLI, MCP, web, and daily automation aligned.

### Platform Policies

Default policies should be conservative and overridable by environment variables.

| Platform | Cache TTL | Cooldown | Breaker | Notes |
|---|---:|---:|---:|---|
| `taobao` | 12 hours | 20-60 seconds | 30 minutes | Desktop/native bridge is fragile; default to one real access at a time. |
| `sycm` | 24 hours | 30-90 seconds | 15 minutes | Login, slider, missing feature, and permission errors immediately require manual action. |
| `1688` | 6 hours | API 2-6 seconds, web 10-30 seconds | 1 hour | HTTP 429 opens breaker and rejects queued work. |

The guard should expose a per-platform status shape that web code can render without understanding implementation details:

```json
{
  "platform": "taobao",
  "available": true,
  "status": "ready",
  "cooldownRemainingMs": 0,
  "queueLength": 0,
  "manualAction": null,
  "breaker": { "open": false }
}
```

### Failure Classification

Failures should be classified before they reach the breaker:

- `login_required`: platform asks for login or session is unavailable.
- `slider_required`: slider/captcha/verification text is detected.
- `rate_limited`: HTTP 429, native rate-limit message, or explicit platform throttle.
- `permission_required`: account lacks access to the feature.
- `transient_failure`: timeout, temporary network failure, or malformed response.

Hard blockers open the breaker immediately. Transient failures only open the breaker after the configured failure threshold.

### Taobao Integration

`searchTaobaoTitles(keyword, options)` should wrap the native call with `runWithPlatformGuard('taobao')`.

Cache key:

```js
{
  source: 'text',
  keyword: normalizedKeyword,
  maxResults: Number(options.maxResults || 10)
}
```

The guarded operation should return `{ titles }`, then the public function returns `titles` for backward compatibility. Cache hits should avoid launching or touching Taobao Desktop.

Image search should guard each unique image URL or image-search batch with `platform: 'taobao'`. The existing in-process lock can remain as a local optimization, but cross-process safety must come from the guard.

### SYCM Integration

`extractSycmData()` already uses the guard, so the work is to improve defaults and status visibility:

- use SYCM-specific env names instead of sharing generic `SYCM_*` defaults with Taobao;
- classify browser extraction failures into hard blockers vs transient failures;
- keep precheck flows serial or small-batch and cache keyword checks for the day;
- return platform blocker details to pipeline rows and web responses.

### 1688 Integration

The existing in-memory `GlobalRateLimiter` should be preserved for fast single-process protection, but cross-process protection must be added through guard state:

- persist a lightweight sliding-window counter in `data/platform-access/1688/window.json`;
- check the persisted window before API access;
- report 429 to `reportPlatformBlocker('1688')`;
- keep `API_RATE_LIMIT_MAX`, `API_RATE_LIMIT_WINDOW`, and `API_429_COOLDOWN` behavior compatible.

### Web And Workflow UX

The web app should show platform state in the Dashboard and workflow canvas:

- ready;
- using cache;
- queued;
- cooling down with remaining time;
- manual action required;
- platform blocked.

Workflow steps should not keep hammering a platform when the guard blocks access. They should either wait when the blocker is a cooldown, or stop with `manual_action_required` when the platform requires login, slider, permission, or rate-limit intervention.

## Out Of Scope

- No distributed queue service.
- No account rotation.
- No bypassing platform anti-bot checks.
- No new database requirement; persisted JSON files remain the first implementation.

## Acceptance Criteria

- Taobao text search and image search cannot perform concurrent real platform access from two Node processes.
- SYCM calls surface login/slider/rate-limit blockers as manual-action status.
- 1688 API rate-window state survives Node process restarts.
- Web status endpoints expose platform state for Taobao, SYCM, and 1688.
- Pipeline runtime displays platform cooldown/manual-action state instead of silently failing or repeatedly retrying.
- Existing CLI, MCP, and web behavior remains backward compatible.
