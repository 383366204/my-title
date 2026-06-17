# Title Generation Reliability Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve title generation cache hit rate, LLM rate-limit stability, image-search timeout behavior, and browser preflight clarity without reducing distribution safety.

**Architecture:** Keep the current Node.js CLI and skill modules. Add small local helpers for stable hashing, promise concurrency, retry/backoff, and browser preflight instead of introducing LangChain/LangGraph. Risky fallbacks such as generic title generation must be marked as non-distributable and must never feed directly into `1688-distribution`.

**Tech Stack:** Node.js, `node:test`, existing `skills/title-gen` modules, existing `core/agent-response.js`, Chrome CDP checks.

---

## File Structure

- Modify: `skills/title-gen/src/pipeline.js`
  - Make product cache hashing stable by ignoring fast-changing price/sales fields.
- Modify: `skills/title-gen/test/index.test.js`
  - Add regression tests for cache hash stability and generic-title fallback behavior.
- Create: `skills/title-gen/src/llm-scheduler.js`
  - Local concurrency limiter and retry/backoff helper for LLM batch calls.
- Create: `skills/title-gen/test/llm-scheduler.test.js`
  - Unit tests for concurrency and retry behavior.
- Modify: `skills/title-gen/src/index.js`
  - Replace `Promise.all` batch generation with scheduler.
  - Add dynamic timeout when image search is enabled.
  - Add safe generic-title fallback when no 1688 products exist.
- Modify: `skills/title-gen/src/search-taobao-image.js`
  - Surface CAPTCHA/manual-challenge signals in a structured way.
- Modify: `bin/cli.js`
  - Add or reuse a title-gen/browser preflight command for image-search paths.
- Modify: `test/cli.test.js`
  - Verify preflight JSON has weak-agent fields.
- Modify: `skills/title-gen/SKILL.md`
  - Document weak-agent rules: image search preflight, timeout behavior, and non-distributable generic fallback.

---

## Phase 1: Low-Risk Reliability Fixes

### Task 1: Relax Product Cache Hash

**Files:**
- Modify: `skills/title-gen/src/pipeline.js`
- Test: `skills/title-gen/test/index.test.js`

- [ ] **Step 1: Add failing cache-hash test**

Append this test to `skills/title-gen/test/index.test.js`:

```js
test('hashProducts ignores volatile price changes when product ids are stable', () => {
  const { hashProducts } = require('../src/pipeline');
  const first = hashProducts([
    { id: '1001', title: '陶瓷摆件 招财猫', price: '9.90', sales: '100+' },
    { offerId: '1002', title: '陶瓷摆件 小花瓶', price: '12.30', sales: '200+' }
  ]);
  const second = hashProducts([
    { id: '1001', title: '陶瓷摆件 招财猫', price: '10.10', sales: '130+' },
    { offerId: '1002', title: '陶瓷摆件 小花瓶', price: '11.80', sales: '240+' }
  ]);

  assert.equal(first, second);
});
```

- [ ] **Step 2: Verify test fails**

Run:

```bash
node --test skills/title-gen/test/index.test.js --test-name-pattern 'hashProducts ignores volatile'
```

Expected: FAIL because current `hashProducts` includes `price`.

- [ ] **Step 3: Update `hashProducts`**

In `skills/title-gen/src/pipeline.js`, replace `hashProducts` normalization with:

```js
function stableProductId(product) {
  const url = product.url || product.link || product.productUrl || product['产品链接'] || '';
  const urlMatch = String(url).match(/offer\/(\d+)\.html/);
  return product.id || product.offerId || product.productId || product.itemId || (urlMatch ? urlMatch[1] : '');
}

function stableTitleToken(title) {
  return String(title || '')
    .replace(/\s+/g, '')
    .slice(0, 40);
}

function hashProducts(products) {
  if (!Array.isArray(products) || products.length === 0) return '';
  const normalized = products.map(p => ({
    id: stableProductId(p),
    title: stableTitleToken(p.title || p.subject || p.name || '')
  }));
  return crypto.createHash('md5').update(JSON.stringify(normalized)).digest('hex').slice(0, 8);
}
```

- [ ] **Step 4: Verify**

Run:

```bash
node --test skills/title-gen/test/index.test.js --test-name-pattern 'hashProducts ignores volatile'
```

Expected: PASS.

---

### Task 2: Add LLM Batch Scheduler

**Files:**
- Create: `skills/title-gen/src/llm-scheduler.js`
- Create: `skills/title-gen/test/llm-scheduler.test.js`

- [ ] **Step 1: Write scheduler tests**

Create `skills/title-gen/test/llm-scheduler.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const { runLimited, retryWithBackoff, isRateLimitError } = require('../src/llm-scheduler');

test('runLimited never exceeds configured concurrency', async () => {
  let active = 0;
  let maxActive = 0;
  const items = Array.from({ length: 5 }, (_, index) => index);

  const result = await runLimited(items, async item => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 20));
    active -= 1;
    return item * 2;
  }, { concurrency: 2 });

  assert.equal(maxActive, 2);
  assert.deepEqual(result, [0, 2, 4, 6, 8]);
});

test('retryWithBackoff retries rate-limit errors', async () => {
  let attempts = 0;
  const result = await retryWithBackoff(async () => {
    attempts += 1;
    if (attempts < 3) {
      const error = new Error('rate limit');
      error.name = 'RateLimitError';
      throw error;
    }
    return 'ok';
  }, { retries: 3, baseDelayMs: 1 });

  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});

test('isRateLimitError detects common rate-limit shapes', () => {
  assert.equal(isRateLimitError(Object.assign(new Error('429 too many requests'), { status: 429 })), true);
  assert.equal(isRateLimitError(Object.assign(new Error('quota exceeded'), { code: 'rate_limit_exceeded' })), true);
  assert.equal(isRateLimitError(new Error('plain failure')), false);
});
```

- [ ] **Step 2: Verify tests fail**

Run:

```bash
node --test skills/title-gen/test/llm-scheduler.test.js
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement scheduler**

Create `skills/title-gen/src/llm-scheduler.js`:

```js
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRateLimitError(error) {
  const message = String(error && error.message || '').toLowerCase();
  const code = String(error && error.code || '').toLowerCase();
  return error && (
    error.name === 'RateLimitError' ||
    error.status === 429 ||
    code.includes('rate') ||
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('quota')
  );
}

async function retryWithBackoff(fn, options = {}) {
  const retries = Number(options.retries ?? 2);
  const baseDelayMs = Number(options.baseDelayMs ?? 800);
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!isRateLimitError(error) || attempt === retries) throw error;
      await sleep(baseDelayMs * Math.pow(2, attempt));
    }
  }
  throw new Error('unreachable retry state');
}

async function runLimited(items, handler, options = {}) {
  const concurrency = Math.max(1, Number(options.concurrency || 1));
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await handler(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

module.exports = { runLimited, retryWithBackoff, isRateLimitError };
```

- [ ] **Step 4: Verify**

Run:

```bash
node --test skills/title-gen/test/llm-scheduler.test.js
```

Expected: PASS.

---

### Task 3: Use Scheduler in `_generateTitles`

**Files:**
- Modify: `skills/title-gen/src/index.js`
- Test: `skills/title-gen/test/index.test.js`

- [ ] **Step 1: Add batch concurrency regression test**

Append this test to `skills/title-gen/test/index.test.js`:

```js
test('run limits concurrent selectAndGenerate batches', async () => {
  const { run } = require('../src');
  let active = 0;
  let maxActive = 0;
  const products = Array.from({ length: 45 }, (_, index) => ({
    id: `offer-${index}`,
    title: `陶瓷摆件 商品 ${index}`,
    url: `https://detail.1688.com/offer/${100000 + index}.html`
  }));

  const glmClient = {
    async selectAndGenerate() {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 20));
      active -= 1;
      return {
        selectedProducts: [],
        titles: [{ title: '陶瓷摆件 家用桌面装饰创意小摆件客厅玄关装饰品' }]
      };
    },
    async generateTitles() {
      return ['陶瓷摆件 家用桌面装饰创意小摆件客厅玄关装饰品'];
    }
  };

  await run('陶瓷摆件', {
    products,
    peerTitles: ['陶瓷摆件 家用桌面装饰'],
    coreWord: '摆件',
    modifiers: [{ word: '陶瓷', type: 'rigid' }],
    glmClient,
    llmConcurrency: 2,
    runTimeoutMs: 10000,
    silent: true
  });

  assert.ok(maxActive <= 2);
});
```

- [ ] **Step 2: Verify test fails or hangs at old behavior**

Run:

```bash
node --test skills/title-gen/test/index.test.js --test-name-pattern 'limits concurrent'
```

Expected: FAIL because `llmConcurrency` is not wired and `Promise.all` can run all batches at once.

- [ ] **Step 3: Wire scheduler**

At the top of `skills/title-gen/src/index.js`:

```js
const { runLimited, retryWithBackoff } = require('./llm-scheduler');
```

Add `llmConcurrency = 2` and `llmRetries = 2` to `run` options:

```js
const { ..., llmConcurrency = 2, llmRetries = 2 } = options;
```

Pass them into `_generateTitles`:

```js
_generateTitles({ ..., llmConcurrency, llmRetries })
```

Add params to `_generateTitles` and replace batch `Promise.all` with:

```js
const batchResults = await runLimited(batches, async ({ index, products: batch }) => {
  try {
    const response = await retryWithBackoff(() => glmClient.selectAndGenerate({
      blueOceanWord,
      coreWord,
      modifiers,
      peerTitles: cleanedPeerTitles,
      products: batch,
      maxLength,
      semanticGroups: effectiveSemanticGroups
    }), { retries: llmRetries });
    log(`  第 ${index + 1}/${batches.length} 批完成`);
    return response;
  } catch (err) {
    warn(`  ⚠️ 第 ${index + 1}/${batches.length} 批(${batch.length}个产品)处理失败:`, err.message);
    return { selectedProducts: [], titles: [] };
  }
}, { concurrency: llmConcurrency });
```

- [ ] **Step 4: Verify**

Run:

```bash
node --test skills/title-gen/test/llm-scheduler.test.js skills/title-gen/test/index.test.js --test-name-pattern 'limits concurrent|llm-scheduler'
```

Expected: PASS.

---

### Task 4: Dynamic Timeout for Image Search

**Files:**
- Modify: `skills/title-gen/src/index.js`
- Test: `skills/title-gen/test/index.test.js`

- [ ] **Step 1: Add timeout calculation helper test**

Append this test to `skills/title-gen/test/index.test.js`:

```js
test('computeEffectiveRunTimeout expands when image search is enabled', () => {
  const { computeEffectiveRunTimeout } = require('../src');
  assert.equal(computeEffectiveRunTimeout({ runTimeoutMs: 120000, useImageSearch: false, maxImageSearch: 10, productCount: 10 }), 120000);
  assert.equal(computeEffectiveRunTimeout({ runTimeoutMs: 120000, useImageSearch: true, maxImageSearch: 4, productCount: 10 }), 160000);
  assert.equal(computeEffectiveRunTimeout({ runTimeoutMs: 60000, useImageSearch: true, maxImageSearch: 0, productCount: 3 }), 135000);
});
```

- [ ] **Step 2: Verify test fails**

Run:

```bash
node --test skills/title-gen/test/index.test.js --test-name-pattern 'computeEffectiveRunTimeout'
```

Expected: FAIL because helper is not exported.

- [ ] **Step 3: Implement helper**

In `skills/title-gen/src/index.js`:

```js
function computeEffectiveRunTimeout({ runTimeoutMs, useImageSearch, maxImageSearch, productCount }) {
  const base = Math.max(30000, parseInt(runTimeoutMs, 10) || DEFAULT_RUN_TIMEOUT);
  if (!useImageSearch) return base;
  const count = maxImageSearch > 0 ? Math.min(Number(maxImageSearch), Number(productCount || 0)) : Number(productCount || 0);
  return Math.max(base, 60000 + count * 25000);
}
```

Replace:

```js
const effectiveRunTimeoutMs = Math.max(30000, parseInt(runTimeoutMs, 10) || DEFAULT_RUN_TIMEOUT);
```

with:

```js
const effectiveRunTimeoutMs = computeEffectiveRunTimeout({
  runTimeoutMs,
  useImageSearch,
  maxImageSearch,
  productCount: products.length
});
stats.estimatedRunTimeoutMs = effectiveRunTimeoutMs;
```

Export:

```js
module.exports = { run, computeEffectiveRunTimeout };
```

- [ ] **Step 4: Verify**

Run:

```bash
node --test skills/title-gen/test/index.test.js --test-name-pattern 'computeEffectiveRunTimeout'
```

Expected: PASS.

---

### Task 5: Browser Preflight for Image Search

**Files:**
- Modify: `bin/cli.js`
- Test: `test/cli.test.js`
- Modify: `skills/title-gen/SKILL.md`

- [ ] **Step 1: Add CLI preflight test**

Append to `test/cli.test.js`:

```js
it('title-gen-preflight --json returns weak-agent browser diagnostics', async () => {
  const result = await runCli(['title-gen-preflight', '--json', '--port', '9']);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.status, 'cdp_unavailable');
  assert.equal(typeof payload.nextActionCode, 'string');
  assert.equal(typeof payload.requiresUserAction, 'boolean');
  assert.ok(Array.isArray(payload.blockers));
  assert.match(payload.userMessage, /Chrome|CDP/i);
});
```

- [ ] **Step 2: Verify test fails**

Run:

```bash
node --test test/cli.test.js --test-name-pattern 'title-gen-preflight'
```

Expected: FAIL because command does not exist.

- [ ] **Step 3: Add command**

In `bin/cli.js`, add:

```js
program
  .command('title-gen-preflight')
  .description('Check browser readiness before title-gen image search')
  .option('--port <number>', 'Chrome remote debugging port', process.env.BROWSER_CDP_PORT || process.env.CHROME_DEBUG_PORT || '9222')
  .option('--json', 'JSON output')
  .action(async function(options, command) {
    const mainOpts = command && command.parent ? command.parent.opts() : {};
    const jsonMode = !!options.json || !!mainOpts.json;
    const port = parseInt(options.port, 10) || 9222;
    try {
      const info = await fetchJson(`http://127.0.0.1:${port}/json/version`, 2000);
      const payload = withAgentResponseFields({
        ok: true,
        status: 'ready',
        port,
        cdp: { ok: true, browser: info.Browser || '' },
        nextActionCode: 'title_gen_browser_ready',
        userMessage: 'Chrome CDP is ready for title-gen browser features.'
      });
      if (jsonMode) writeAsciiJson(payload);
      else console.log(payload.userMessage);
    } catch (error) {
      const payload = withAgentResponseFields({
        ok: false,
        status: 'cdp_unavailable',
        port,
        blockers: ['browser_cdp_unavailable'],
        error: error.message,
        nextActionCode: 'start_debug_chrome_manually',
        userMessage: 'Chrome CDP is unavailable. Start Chrome with remote debugging before image search.'
      });
      if (jsonMode) writeAsciiJson(payload);
      else console.error(payload.userMessage);
    }
  });
```

- [ ] **Step 4: Document weak-agent rule**

In `skills/title-gen/SKILL.md`, add:

```md
When planning to use `--use-image-search`, first run preflight as an independent step:

```bash
node bin/cli.js title-gen-preflight --json
```

If it returns `requiresUserAction=true` or exits non-zero, stop before image search and show `userMessage`. Do not wait for the main title command to time out.
```

- [ ] **Step 5: Verify**

Run:

```bash
node --test test/cli.test.js --test-name-pattern 'title-gen-preflight'
```

Expected: PASS.

---

## Phase 2: Controlled Availability Enhancements

### Task 6: Add Non-Distributable Generic Title Fallback

**Files:**
- Modify: `skills/title-gen/src/index.js`
- Test: `skills/title-gen/test/index.test.js`
- Modify: `skills/title-gen/SKILL.md`

- [ ] **Step 1: Add generic fallback test**

Append to `skills/title-gen/test/index.test.js`:

```js
test('run can return non-distributable generic titles when no 1688 products exist', async () => {
  const { run } = require('../src');
  const glmClient = {
    async generateTitles() {
      return ['陶瓷摆件 桌面装饰家居客厅玄关创意小摆件礼品'];
    }
  };

  const result = await run('陶瓷摆件', {
    products: [],
    peerTitles: ['陶瓷摆件 家居桌面装饰'],
    allowGenericTitlesWhenNoProducts: true,
    coreWord: '摆件',
    modifiers: [{ word: '陶瓷', type: 'rigid' }],
    glmClient,
    silent: true
  });

  assert.equal(result.status, 'no_products_fallback_titles');
  assert.equal(result.canDistribute, false);
  assert.equal(result.products.length, 0);
  assert.ok(result.titles.length > 0);
});
```

- [ ] **Step 2: Verify test fails**

Run:

```bash
node --test skills/title-gen/test/index.test.js --test-name-pattern 'non-distributable generic'
```

Expected: FAIL because current code returns empty early.

- [ ] **Step 3: Implement guarded fallback**

In `skills/title-gen/src/index.js`, replace the early empty-products return with:

```js
if (!Array.isArray(products) || products.length === 0) {
  log('  ⚠️  没有找到匹配的商品');
  if (!options.allowGenericTitlesWhenNoProducts) {
    return {
      coreWord,
      blueOceanWord,
      modifiers,
      products: [],
      titles: [],
      status: 'no_products',
      canDistribute: false,
      stats: { trace, matchedProducts: 0, modifiers: modifiers.map(m => m.word) }
    };
  }
  const fallbackTitles = await glmClient.generateTitles({
    blueOceanWord,
    coreWord,
    modifiers,
    peerTitles: finalTaobaoTitles.length ? finalTaobaoTitles : peerTitles,
    products: [],
    maxLength,
    semanticGroups
  }).catch(() => []);
  return {
    coreWord,
    blueOceanWord,
    modifiers,
    products: [],
    titles: fallbackTitles,
    status: 'no_products_fallback_titles',
    canDistribute: false,
    blockers: ['no_1688_products'],
    userMessage: '没有找到可铺货的 1688 商品，仅生成通用标题候选，禁止直接铺货。',
    stats: { trace, matchedProducts: 0, degraded: 'generic_titles_only', modifiers: modifiers.map(m => m.word) }
  };
}
```

Use the actual in-scope options variable name in the implementation.

- [ ] **Step 4: Document safety rule**

In `skills/title-gen/SKILL.md`, add:

```md
If result `status` is `no_products_fallback_titles`, these are generic title ideas only. Do not export them to distribution and do not call `1688-distribution`.
```

- [ ] **Step 5: Verify**

Run:

```bash
node --test skills/title-gen/test/index.test.js --test-name-pattern 'non-distributable generic'
```

Expected: PASS.

---

### Task 7: Add Local Custom Banned Words Overlay

**Files:**
- Modify: `core/banned-words.js`
- Test: `core/test/banned-words.test.js`
- Modify: `skills/title-gen/SKILL.md`

- [ ] **Step 1: Add test**

Create `core/test/banned-words.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('custom banned words overlay is loaded from env path', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'banned-')), 'custom.json');
  fs.writeFileSync(file, JSON.stringify({ custom: ['测试禁词'] }));
  process.env.ECOM_BANNED_WORDS_EXTRA = file;
  delete require.cache[require.resolve('../banned-words')];
  const { checkBannedWords } = require('../banned-words');

  const result = checkBannedWords('这是一个测试禁词标题');
  assert.equal(result.valid, false);
  assert.ok(result.words.includes('测试禁词'));
});
```

- [ ] **Step 2: Verify test fails**

Run:

```bash
node --test core/test/banned-words.test.js
```

Expected: FAIL because overlay is not loaded.

- [ ] **Step 3: Implement overlay**

In `core/banned-words.js`, load optional extra file and merge it before building `allBanned` and `bannedRegexes`:

```js
function loadExtraBannedWords() {
  const file = process.env.ECOM_BANNED_WORDS_EXTRA;
  if (!file) return {};
  try {
    return require(file);
  } catch (error) {
    console.warn('[banned-words] 额外违禁词文件加载失败:', error.message);
    return {};
  }
}

try {
  bannedWords = require('../skills/title-gen/data/banned-words.json');
  const extra = loadExtraBannedWords();
  bannedWords = { ...bannedWords, ...extra };

  allBanned = [...new Set(Object.values(bannedWords).flat())].sort((a, b) => b.length - a.length);
  bannedRegexes = allBanned.map(w =>
    new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
  );
  if (allBanned.length === 0) {
    console.warn('[banned-words] 警告: 违禁词列表为空，请检查 skills/title-gen/data/banned-words.json');
  }
} catch (err) {
  console.error('[banned-words] 加载违禁词文件失败:', err && err.message ? err.message : err);
  bannedWords = {};
  allBanned = [];
  bannedRegexes = [];
}
```

Do not merge extra words after `allBanned` or `bannedRegexes` has already been constructed.

- [ ] **Step 4: Document**

In `skills/title-gen/SKILL.md`, add:

```md
Set `ECOM_BANNED_WORDS_EXTRA=/path/to/custom-banned-words.json` to add local custom banned words. This is safer than remote auto-sync.
```

- [ ] **Step 5: Verify**

Run:

```bash
node --test core/test/banned-words.test.js core/test/types.test.js
```

Expected: PASS.

---

## Final Verification

- [ ] **Step 1: Run focused tests**

```bash
node --test \
  skills/title-gen/test/llm-scheduler.test.js \
  skills/title-gen/test/index.test.js \
  test/cli.test.js \
  core/test/banned-words.test.js
```

Expected: PASS.

- [ ] **Step 2: Run full suite**

```bash
node --test
```

Expected: PASS.

- [ ] **Step 3: Run diagnostics**

```bash
node bin/cli.js doctor --json
node bin/cli.js title-gen-preflight --json
```

Expected: JSON includes `nextActionCode`, `requiresUserAction`, `blockers`, and `userMessage`.

- [ ] **Step 4: Sync Hermes wrapper skills**

```bash
node bin/cli.js sync-hermes-skills --mode wrapper --apply --json
```

Expected: Hermes wrapper mode remains active and points to the live project checkout.

---

## Self-Review

- Spec coverage: Covers Gemini's cache, LLM rate-limit, image-search timeout, CDP preflight, no-product fallback, and banned-word freshness suggestions.
- Risk control: Generic titles are explicitly `canDistribute: false`; no fallback path writes distribution files.
- Placeholder scan: No task relies on unspecified implementation. Every task has exact files, commands, and expected behavior.
- Type consistency: New response fields use existing weak-agent conventions: `status`, `blockers`, `userMessage`, `requiresUserAction`, and `nextActionCode`.
