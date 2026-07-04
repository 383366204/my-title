# Platform Access Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route Taobao, SYCM, and 1688 platform access through one conservative guard with cache, cooldown, cross-process locking, breaker state, and visible workflow/web status.

**Architecture:** Extend the existing `core/platform-access-guard.js` instead of creating a parallel scheduler. Add focused adapters around Taobao text/image search, improve SYCM blocker classification, persist 1688 rate-window state, then expose platform status through server APIs and workflow/runtime summaries.

**Tech Stack:** Node.js CommonJS, `node:test`, Express backend in `bin/server.js`, React web app in `apps/web`, JSON-backed persisted state under `data/platform-access`.

---

## File Structure

- Modify `core/platform-access-guard.js`: platform defaults, failure classification helper, optional persisted sliding-window helpers, normalized status response.
- Modify `core/test/platform-access-guard.test.js`: tests for Taobao defaults, hard blocker classification, persisted window behavior, and status shape.
- Modify `skills/title-gen/src/search-taobao.js`: wrap text search with `runWithPlatformGuard('taobao')`.
- Create `skills/title-gen/test/search-taobao.test.js`: tests for cache hits, guard wrapping, and failure classification.
- Modify `skills/title-gen/src/search-taobao-image.js`: guard real image-search batches or unique image URLs with `runWithPlatformGuard('taobao')`.
- Add tests to `skills/title-gen/test/search-taobao.test.js` or create `skills/title-gen/test/search-taobao-image.test.js` if image-search mocking needs isolation.
- Modify `skills/sycm-research/src/sycm-cdp-extractor.js`: map known browser extraction failures to platform statuses before they reach the guard.
- Add `skills/sycm-research/test/sycm-cdp-extractor.test.js`: focused tests for status classification through mocked raw extraction.
- Modify `skills/alibaba1688/src/rate-limiter.js`: add persisted rate-window support while preserving current in-memory API.
- Modify `skills/alibaba1688/src/client.js`: pass endpoint/body into persisted 1688 guard checks and keep 429 reporting.
- Modify `skills/alibaba1688/test/alibaba1688-client.test.js`: tests for persisted window and 429 breaker behavior.
- Modify `bin/server.js`: add `/api/platform/status` endpoint and include platform blocker details in platform-access error responses.
- Modify `apps/web/src/App.jsx`, `apps/web/src/WorkflowStudio.jsx`, and possibly `apps/web/src/pipeline-labels.js`: render platform access state in dashboard/workflow surfaces.
- Modify `skills/pipeline-flow/runtime/runner.js` and/or `skills/pipeline-flow/index.js`: treat platform cooldown/manual-action errors as blocked workflow states with resume-friendly messages.
- Modify `skills/pipeline-flow/test/runtime.test.js` and `skills/pipeline-flow/test/pipeline-flow.test.js`: verify platform blocker statuses are preserved.

---

### Task 1: Extend Platform Guard Status And Classification

**Files:**
- Modify: `core/platform-access-guard.js`
- Test: `core/test/platform-access-guard.test.js`

- [ ] **Step 1: Write failing tests for status shape and Taobao defaults**

Add tests to `core/test/platform-access-guard.test.js`:

```js
test('platform guard exposes normalized ready status for taobao', () => {
  const dataDir = tempDataDir();
  const status = getPlatformAccessStatus('taobao', { dataDir });

  assert.equal(status.platform, 'taobao');
  assert.equal(status.available, true);
  assert.equal(status.status, 'ready');
  assert.equal(status.cooldownRemainingMs, 0);
  assert.equal(status.manualAction, null);
  assert.equal(status.breaker.open, false);
});

test('platform guard classifies slider text as hard blocker status', async () => {
  const dataDir = tempDataDir();
  const err = new Error('淘宝出现滑块验证，请稍后重试');

  await assert.rejects(
    () => runWithPlatformGuard('taobao', {
      dataDir,
      cache: false,
      minCooldownMs: 0,
      maxCooldownMs: 0,
      breakerCooldownMs: 60_000
    }, async () => {
      throw err;
    }),
    /滑块验证/
  );

  const status = getPlatformAccessStatus('taobao', { dataDir });
  assert.equal(status.status, 'slider_required');
  assert.equal(status.available, false);
  assert.equal(status.manualAction.status, 'slider_required');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
node --test core/test/platform-access-guard.test.js
```

Expected: the new tests fail because `getPlatformAccessStatus()` does not yet expose `available/status/cooldownRemainingMs`, and text-only slider classification is not normalized to `slider_required`.

- [ ] **Step 3: Implement minimal guard status and classification**

In `core/platform-access-guard.js`, add:

```js
function classifyPlatformError(err) {
  const raw = [
    err && err.status,
    err && err.code,
    err && err.message,
    err && err.stderr,
    err && err.stdout
  ].filter(Boolean).join(' ').toLowerCase();

  if (/slider|captcha|验证|滑块|人机/.test(raw)) return 'slider_required';
  if (/login|登录|session|cookie/.test(raw)) return 'login_required';
  if (/429|rate.?limit|too many|限流|频率|风控/.test(raw)) return 'rate_limited';
  if (/permission|unauthorized|forbidden|权限|未订购|功能未开通/.test(raw)) return 'permission_required';
  return 'transient_failure';
}
```

Update `recordFailure()` so `status` uses `classifyPlatformError(err)` when `err.status` is missing. Update `getPlatformAccessStatus()` to return:

```js
const breaker = breakerStatus(platform, guardOptions);
const manualAction = readJson(files.manualAction, null);
const state = readJson(files.state, null);
const cooldownRemainingMs = breaker.cooldownRemainingMs || 0;
return {
  platform: normalizePlatform(platform),
  dataDir: files.dir,
  available: !breaker.open,
  status: breaker.open ? (breaker.status || 'blocked') : 'ready',
  cooldownRemainingMs,
  queueLength: 0,
  breaker,
  manualAction,
  state
};
```

- [ ] **Step 4: Run tests**

Run:

```bash
node --test core/test/platform-access-guard.test.js
```

Expected: all platform guard tests pass.

- [ ] **Step 5: Commit**

```bash
git add core/platform-access-guard.js core/test/platform-access-guard.test.js
git commit -m "feat: normalize platform access status"
```

---

### Task 2: Guard Taobao Text Search

**Files:**
- Modify: `skills/title-gen/src/search-taobao.js`
- Create: `skills/title-gen/test/search-taobao.test.js`

- [ ] **Step 1: Write failing tests**

Create `skills/title-gen/test/search-taobao.test.js`:

```js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, beforeEach, afterEach } = require('node:test');

const guard = require('../../../core/platform-access-guard');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'taobao-guard-'));
}

beforeEach(() => {
  guard.resetPlatformAccessState();
  delete require.cache[require.resolve('../src/search-taobao')];
});

afterEach(() => {
  delete process.env.ECOM_PLATFORM_GUARD_DIR;
});

test('searchTaobaoTitles caches by keyword and avoids duplicate native calls', async () => {
  const dataDir = tempDataDir();
  process.env.ECOM_PLATFORM_GUARD_DIR = dataDir;

  const taobaoUtilsPath = require.resolve('../src/taobao-utils');
  const original = require.cache[taobaoUtilsPath];
  let calls = 0;
  require.cache[taobaoUtilsPath] = {
    id: taobaoUtilsPath,
    filename: taobaoUtilsPath,
    loaded: true,
    exports: {
      isTaobaoNativeInstalled: () => true,
      ensureTaobaoDesktopReady: async () => true,
      runTaobaoNativeSync: () => {
        calls += 1;
        return JSON.stringify({ result: { products: [{ title: '纯银项链女高级感' }] } });
      }
    }
  };

  try {
    const { searchTaobaoTitles } = require('../src/search-taobao');
    const first = await searchTaobaoTitles('纯银项链', { maxResults: 10, guardMinCooldownMs: 0, guardMaxCooldownMs: 0 });
    const second = await searchTaobaoTitles('纯银项链', { maxResults: 10, guardMinCooldownMs: 0, guardMaxCooldownMs: 0 });

    assert.deepEqual(first, ['纯银项链女高级感']);
    assert.deepEqual(second, ['纯银项链女高级感']);
    assert.equal(calls, 1);
  } finally {
    if (original) require.cache[taobaoUtilsPath] = original;
    else delete require.cache[taobaoUtilsPath];
  }
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test skills/title-gen/test/search-taobao.test.js
```

Expected: FAIL because `searchTaobaoTitles()` does not use platform cache.

- [ ] **Step 3: Implement guarded Taobao text search**

In `skills/title-gen/src/search-taobao.js`, import:

```js
const { runWithPlatformGuard } = require('../../../core/platform-access-guard');
```

Wrap the existing native-search body:

```js
async function searchTaobaoTitles(keyword, options = {}) {
  const normalizedKeyword = String(keyword || '').trim();
  const timeout = options.timeout || 30000;

  if (!normalizedKeyword) return [];
  if (!isTaobaoNativeInstalled()) {
    console.warn('[taobao] taobao-native CLI 未安装，请使用 --peer-titles 手动提供同行标题');
    return [];
  }

  try {
    const guarded = await runWithPlatformGuard('taobao', {
      cacheKey: {
        source: 'text',
        keyword: normalizedKeyword,
        maxResults: Number(options.maxResults || 10)
      },
      dataDir: options.guardDataDir,
      cache: options.guardCache === false ? false : undefined,
      cacheTtlMs: options.guardCacheTtlMs,
      minCooldownMs: options.guardMinCooldownMs,
      maxCooldownMs: options.guardMaxCooldownMs,
      breakerCooldownMs: options.guardBreakerCooldownMs
    }, async () => {
      const titles = await rawSearchTaobaoTitles(normalizedKeyword, { ...options, timeout });
      return { titles };
    });
    return Array.isArray(guarded.titles) ? guarded.titles : [];
  } catch (error) {
    // keep current backward-compatible empty-result behavior
    console.warn('[taobao] peer title search failed: ' + (error ? error.message : error));
    console.warn('[taobao] 请使用 --peer-titles 手动提供同行标题');
    return [];
  }
}
```

Move the current try block contents into `rawSearchTaobaoTitles(keyword, options)`.

- [ ] **Step 4: Run tests**

Run:

```bash
node --test skills/title-gen/test/search-taobao.test.js
node --test skills/title-gen/test/index.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/title-gen/src/search-taobao.js skills/title-gen/test/search-taobao.test.js
git commit -m "feat: guard taobao text search"
```

---

### Task 3: Guard Taobao Image Search

**Files:**
- Modify: `skills/title-gen/src/search-taobao-image.js`
- Test: `skills/title-gen/test/search-taobao.test.js`

- [ ] **Step 1: Write failing test for image-search guard cache**

Add a test that imports a small exported helper from image search. If no helper exists yet, the test should expect a new exported `guardTaobaoImageSearch()` function:

```js
test('guardTaobaoImageSearch caches image search result by image url', async () => {
  const dataDir = tempDataDir();
  let calls = 0;
  const { guardTaobaoImageSearch } = require('../src/search-taobao-image');

  const first = await guardTaobaoImageSearch('https://img.example/a.jpg', {
    guardDataDir: dataDir,
    guardMinCooldownMs: 0,
    guardMaxCooldownMs: 0,
    operation: async () => {
      calls += 1;
      return { hasMatch: true, peerTitles: ['同款项链'], priceRange: { min: 10, max: 20 } };
    }
  });

  const second = await guardTaobaoImageSearch('https://img.example/a.jpg', {
    guardDataDir: dataDir,
    guardMinCooldownMs: 0,
    guardMaxCooldownMs: 0,
    operation: async () => {
      calls += 1;
      return { hasMatch: false, peerTitles: [] };
    }
  });

  assert.equal(calls, 1);
  assert.equal(first.peerTitles[0], '同款项链');
  assert.equal(second.peerTitles[0], '同款项链');
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test skills/title-gen/test/search-taobao.test.js
```

Expected: FAIL because `guardTaobaoImageSearch()` is not exported.

- [ ] **Step 3: Implement image-search guard helper**

In `skills/title-gen/src/search-taobao-image.js`, import:

```js
const { runWithPlatformGuard } = require('../../../core/platform-access-guard');
```

Add:

```js
async function guardTaobaoImageSearch(imageUrl, options = {}) {
  const normalizedUrl = String(imageUrl || '').split('?')[0];
  return runWithPlatformGuard('taobao', {
    cacheKey: {
      source: 'image',
      imageUrl: normalizedUrl
    },
    dataDir: options.guardDataDir,
    cache: options.guardCache === false ? false : undefined,
    cacheTtlMs: options.guardCacheTtlMs,
    minCooldownMs: options.guardMinCooldownMs,
    maxCooldownMs: options.guardMaxCooldownMs,
    breakerCooldownMs: options.guardBreakerCooldownMs
  }, options.operation);
}
```

Change `handleItem()` so the real `imageSearchSingle()` call happens inside `guardTaobaoImageSearch(item.url, { ...options, operation })`. Keep the current retry behavior, but guard each real attempt.

Export the helper:

```js
module.exports = {
  searchPeerTitlesByImage,
  imageSearchSingle,
  guardTaobaoImageSearch
};
```

- [ ] **Step 4: Run tests**

Run:

```bash
node --test skills/title-gen/test/search-taobao.test.js
node --test skills/title-gen/test/index.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/title-gen/src/search-taobao-image.js skills/title-gen/test/search-taobao.test.js
git commit -m "feat: guard taobao image search"
```

---

### Task 4: Strengthen SYCM Blocker Classification

**Files:**
- Modify: `skills/sycm-research/src/sycm-cdp-extractor.js`
- Create: `skills/sycm-research/test/sycm-cdp-extractor.test.js`

- [ ] **Step 1: Write failing classification tests**

Create `skills/sycm-research/test/sycm-cdp-extractor.test.js`:

```js
const assert = require('assert');
const { test } = require('node:test');

const { classifySycmError } = require('../src/sycm-cdp-extractor');

test('classifySycmError detects login blocker', () => {
  const err = new Error('请先登录千牛或生意参谋');
  assert.equal(classifySycmError(err).status, 'login_required');
});

test('classifySycmError detects slider blocker', () => {
  const err = new Error('页面出现滑块验证');
  assert.equal(classifySycmError(err).status, 'slider_required');
});

test('classifySycmError detects feature permission blocker', () => {
  const err = new Error('该功能未开通或无权限访问');
  assert.equal(classifySycmError(err).status, 'sycm_feature_required');
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test skills/sycm-research/test/sycm-cdp-extractor.test.js
```

Expected: FAIL because `classifySycmError` is not exported.

- [ ] **Step 3: Implement classifier and wrap raw extraction errors**

In `skills/sycm-research/src/sycm-cdp-extractor.js`, add:

```js
function classifySycmError(err) {
  const raw = String((err && err.status) || '') + ' ' +
    String((err && err.code) || '') + ' ' +
    String((err && err.message) || '');

  if (/滑块|captcha|slider|验证/.test(raw)) {
    return { status: 'slider_required', userMessage: '生意参谋需要滑块验证，请人工处理后继续。' };
  }
  if (/登录|login|session|cookie/.test(raw)) {
    return { status: 'login_required', userMessage: '生意参谋登录状态失效，请重新登录后继续。' };
  }
  if (/未开通|无权限|permission|forbidden|feature/.test(raw)) {
    return { status: 'sycm_feature_required', userMessage: '当前账号没有该生意参谋功能权限。' };
  }
  return { status: 'transient_failure', userMessage: '生意参谋暂时访问失败，可稍后重试。' };
}
```

Inside the operation passed to `runWithPlatformGuard('sycm')`, catch raw errors, attach `status` and `details`, then rethrow:

```js
return _rawExtractSycmData(keyword, options).catch(function(err) {
  var classified = classifySycmError(err);
  err.status = err.status || classified.status;
  err.details = Object.assign({}, err.details || {}, classified);
  throw err;
});
```

Export `classifySycmError` alongside existing exports.

- [ ] **Step 4: Run tests**

Run:

```bash
node --test skills/sycm-research/test/sycm-cdp-extractor.test.js
node --test core/test/platform-access-guard.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/sycm-research/src/sycm-cdp-extractor.js skills/sycm-research/test/sycm-cdp-extractor.test.js
git commit -m "feat: classify sycm platform blockers"
```

---

### Task 5: Persist 1688 Rate Window Across Processes

**Files:**
- Modify: `skills/alibaba1688/src/rate-limiter.js`
- Modify: `skills/alibaba1688/test/alibaba1688-client.test.js`

- [ ] **Step 1: Write failing persisted-window test**

Add to `skills/alibaba1688/test/alibaba1688-client.test.js` or a new focused `skills/alibaba1688/test/rate-limiter.test.js`:

```js
const { GlobalRateLimiter, _resetInstance } = require('../src/rate-limiter');

test('1688 rate limiter can persist request window across instances', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), '1688-window-'));
  const first = new GlobalRateLimiter({
    maxRequests: 1,
    windowMs: 60_000,
    cooldownMs: 60_000,
    maxQueueSize: 0,
    persist: true,
    dataDir
  });
  assert.deepEqual(await first.acquire(), { allowed: true, waitMs: 0 });

  const second = new GlobalRateLimiter({
    maxRequests: 1,
    windowMs: 60_000,
    cooldownMs: 60_000,
    maxQueueSize: 0,
    persist: true,
    dataDir
  });
  const result = await second.acquire();
  assert.equal(result.allowed, false);
  assert.equal(result.queueFull, true);
  assert.ok(result.waitMs > 0);

  _resetInstance();
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test skills/alibaba1688/test/alibaba1688-client.test.js
```

Expected: FAIL because `GlobalRateLimiter` is not exported and persistence does not exist.

- [ ] **Step 3: Implement persisted window support**

In `skills/alibaba1688/src/rate-limiter.js`, export `GlobalRateLimiter`. Add optional constructor fields:

```js
const fs = require('fs');
const path = require('path');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}
```

When `options.persist` is true, read timestamps from:

```js
this.persistFile = path.join(options.dataDir || process.env.ECOM_PLATFORM_GUARD_DIR || path.join(__dirname, '..', '..', '..', 'data', 'platform-access'), '1688', 'window.json');
```

Before `hasSlot()` and after `record()`, sync `this._limiter.timestamps` to disk. If `maxQueueSize` is `0`, return `{ allowed: false, waitMs: estimatedWait, queueFull: true }` instead of enqueueing.

Update module exports:

```js
module.exports = { getRateLimiter, RateLimitError, GlobalRateLimiter, _resetInstance };
```

- [ ] **Step 4: Wire persistence into default singleton**

In `getRateLimiter(options)`, pass default persistence:

```js
_instance = new GlobalRateLimiter({
  persist: true,
  ...(options || {})
});
```

Keep tests that rely on `_resetInstance()` isolated by temp dirs when needed.

- [ ] **Step 5: Run tests**

Run:

```bash
node --test skills/alibaba1688/test/alibaba1688-client.test.js
node --test skills/alibaba1688/test/search-1688.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/alibaba1688/src/rate-limiter.js skills/alibaba1688/test/alibaba1688-client.test.js
git commit -m "feat: persist 1688 rate window"
```

---

### Task 6: Expose Platform Status API

**Files:**
- Modify: `bin/server.js`
- Test: `test/smoke.test.js` or a new `test/server-platform-status.test.js`

- [ ] **Step 1: Write failing endpoint test**

Add a server test consistent with existing server test style:

```js
test('GET /api/platform/status returns taobao sycm and 1688 states', async () => {
  const res = await fetch(`${baseUrl}/api/platform/status`);
  const payload = await res.json();

  assert.equal(res.status, 200);
  assert.equal(payload.ok, true);
  assert.ok(payload.data.taobao);
  assert.ok(payload.data.sycm);
  assert.ok(payload.data['1688']);
  assert.equal(payload.data.taobao.platform, 'taobao');
});
```

- [ ] **Step 2: Run test to verify failure**

Run the matching server test command used by the existing suite:

```bash
npm test
```

Expected: FAIL because the endpoint does not exist.

- [ ] **Step 3: Implement endpoint**

In `bin/server.js`, import:

```js
const { getPlatformAccessStatus } = require('../core/platform-access-guard');
```

Add:

```js
app.get('/api/platform/status', (req, res) => {
  try {
    res.json({
      ok: true,
      data: {
        taobao: getPlatformAccessStatus('taobao'),
        sycm: getPlatformAccessStatus('sycm'),
        '1688': getPlatformAccessStatus('1688')
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add bin/server.js test/smoke.test.js
git commit -m "feat: expose platform access status"
```

---

### Task 7: Surface Platform Status In Web And Workflow

**Files:**
- Modify: `apps/web/src/App.jsx`
- Modify: `apps/web/src/WorkflowStudio.jsx`
- Modify: `apps/web/src/pipeline-labels.js`
- Modify: `skills/pipeline-flow/runtime/runner.js`
- Test: `skills/pipeline-flow/test/runtime.test.js`

- [ ] **Step 1: Add runtime test for platform blocker**

In `skills/pipeline-flow/test/runtime.test.js`, add:

```js
it('marks runtime blocked when a step returns platform manual action status', async () => {
  const result = await runPipelineRuntime({
    runId: 'platform-blocked-test',
    mode: 'manual',
    dataDir,
    steps: ['verify'],
    handlers: {
      verify: async () => ({
        status: 'manual_action_required',
        platform: 'taobao',
        manualAction: { status: 'slider_required', userMessage: '淘宝需要滑块验证' }
      })
    }
  });

  assert.equal(result.status, 'manual_action_required');
  assert.equal(result.runtimeStatus, 'blocked');
});
```

- [ ] **Step 2: Run test**

Run:

```bash
node --test skills/pipeline-flow/test/runtime.test.js
```

Expected: PASS if current STOP status handling already covers it; otherwise FAIL and update runner.

- [ ] **Step 3: Update labels**

In `apps/web/src/pipeline-labels.js`, add labels:

```js
platform_cooling_down: '平台冷却中',
platform_queued: '平台排队中',
manual_action_required: '需要人工处理',
rate_limited: '平台限流',
slider_required: '需要滑块验证',
login_required: '需要重新登录',
permission_required: '权限不足'
```

- [ ] **Step 4: Fetch platform status in dashboard**

In `apps/web/src/App.jsx`, include `/api/platform/status` in the dashboard refresh path and render a compact platform strip with each platform's `status`, `cooldownRemainingMs`, and `manualAction.userMessage`.

Implementation shape:

```jsx
function PlatformStatusStrip({ platforms }) {
  const entries = Object.entries(platforms || {});
  if (!entries.length) return null;
  return (
    <section className="platform-status-strip">
      {entries.map(([id, state]) => (
        <div key={id} className={`platform-status platform-status-${state.status || 'ready'}`}>
          <strong>{id === '1688' ? '1688' : id === 'sycm' ? '生意参谋' : '淘宝'}</strong>
          <span>{labelPipelineStatus(state.status || 'ready')}</span>
          {state.cooldownRemainingMs > 0 && <small>{Math.ceil(state.cooldownRemainingMs / 60000)} 分钟后重试</small>}
          {state.manualAction?.userMessage && <small>{state.manualAction.userMessage}</small>}
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 5: Render platform blockers in workflow canvas**

In `apps/web/src/WorkflowStudio.jsx`, when active run summary includes `manualAction` or platform fields, show a node note:

```jsx
{data.manualAction?.userMessage && (
  <div className="monitor-node-hint">{data.manualAction.userMessage}</div>
)}
```

- [ ] **Step 6: Run web build**

Run:

```bash
npm run web:build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/App.jsx apps/web/src/WorkflowStudio.jsx apps/web/src/pipeline-labels.js skills/pipeline-flow/runtime/runner.js skills/pipeline-flow/test/runtime.test.js
git commit -m "feat: show platform access status in workflow"
```

---

### Task 8: Full Verification

**Files:**
- No source changes unless verification finds a bug.

- [ ] **Step 1: Run focused platform tests**

Run:

```bash
node --test core/test/platform-access-guard.test.js skills/title-gen/test/search-taobao.test.js skills/sycm-research/test/sycm-cdp-extractor.test.js skills/alibaba1688/test/alibaba1688-client.test.js
```

Expected: PASS.

- [ ] **Step 2: Run project suites**

Run:

```bash
npm test
npm run test:core-skills
npm run web:build
```

Expected: all pass.

- [ ] **Step 3: Manual smoke**

Start:

```bash
npm run ui
```

Verify:

- dashboard shows Taobao, 生意参谋, and 1688 platform states;
-挖词页淘宝同行词搜索 does not duplicate native search when repeated for the same keyword;
- workflow canvas shows manual-action/cooldown state when a platform breaker is open;
- title generation still works with cached Taobao peer titles.

- [ ] **Step 4: Final commit if verification fixes were needed**

```bash
git add <changed-files>
git commit -m "fix: stabilize platform access governance"
```

---

## Self-Review

- Spec coverage: Taobao text/image guard, SYCM blocker classification, 1688 persisted rate window, status API, and web/workflow visibility each map to a task.
- Placeholder scan: no empty placeholder markers remain.
- Type consistency: platform status fields use `platform`, `available`, `status`, `cooldownRemainingMs`, `queueLength`, `breaker`, `manualAction`, and `state` consistently.
- Scope check: this is one coherent platform-governance change; no external queue, database, or anti-bot bypass is included.
