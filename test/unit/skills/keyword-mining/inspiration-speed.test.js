const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const axios = require('axios');
const { productizeInspirations } = require('../../../../skills/keyword-mining/src/inspiration-productizer');
const { discoverInspirationRoots } = require('../../../../skills/keyword-mining/src/inspiration-engine');

const rows = Array.from({ length: 6 }, (_, i) => ({ id: `speed-${i}`, inspirationWord: `场景${i}`, dimension: 'direction' }));
const client = { provider: 'minimax', model: 'MiniMax-M3', apiBase: 'https://example.test', apiKey: 'test' };

test('only M3 inspiration calls disable thinking; cache separates model and endpoint', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inspiration-speed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bodies = [];
  t.mock.method(axios, 'post', async (_url, body) => {
    bodies.push(body);
    return { data: { choices: [{ message: { content: '{"roots":[]}' } }] } };
  });
  const options = { llmClient: client, batchCacheDir: dir };
  await productizeInspirations(rows.slice(0, 1), options);
  const cached = await productizeInspirations(rows.slice(0, 1), options);
  assert.equal(cached.meta.cacheHits, 1);
  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0].thinking, { type: 'disabled' });
  await productizeInspirations(rows.slice(0, 1), { ...options, llmClient: { ...client, apiBase: 'https://other.test' } });
  await productizeInspirations(rows.slice(0, 1), { ...options, llmClient: { ...client, model: 'MiniMax-M2.7-highspeed' } });
  assert.equal(bodies.length, 3);
  assert.equal(bodies[2].thinking, undefined);
});

test('concurrency is bounded at two even for an oversized setting', async () => {
  let active = 0;
  let peak = 0;
  await productizeInspirations(rows, { concurrency: 20, llmClient: { productizeInspirations: async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return [];
  } } });
  assert.equal(peak, 2);
});

test('rate limiting reduces subsequent waves to one request', async t => {
  let calls = 0;
  const progress = [];
  t.mock.method(axios, 'post', async () => {
    if (++calls === 1) throw Object.assign(new Error('rate limited'), { response: { status: 429 } });
    return { data: { choices: [{ message: { content: '{"roots":[]}' } }] } };
  });
  const result = await productizeInspirations(rows, { llmClient: client, onProgress: event => progress.push(event.message) });
  assert.equal(result.meta.rateLimited, true);
  assert.ok(progress.slice(1).every(message => message.includes('并发 1')));
  assert.equal(result.meta.fallbackGenerated, 0);
});

test('empty AI output does not silently substitute fixed local roots', async () => {
  const result = await productizeInspirations([{ id: 'kitchen', inspirationWord: '厨房' }], {
    llmClient: { productizeInspirations: async () => ({ roots: [] }) }
  });
  assert.deepEqual(result.roots, []);
  assert.equal(result.meta.fallbackGenerated, 0);
});

test('pause aborts active HTTP requests and starts no further wave', async t => {
  let stop = false;
  let calls = 0;
  t.mock.method(axios, 'post', (_url, _body, options) => new Promise((_resolve, reject) => {
    calls++;
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'ERR_CANCELED' })));
  }));
  const pending = productizeInspirations(rows, { llmClient: client, shouldStop: () => stop });
  stop = true;
  await assert.rejects(pending, error => error.code === 'INSPIRATION_STOPPED');
  assert.equal(calls, 2);
});

test('discovery stops after meeting the target and exposes partial results', async () => {
  let calls = 0;
  let partials = 0;
  const result = await discoverInspirationRoots({ rootLimit: 2, enabledDimensions: [], newsFeedUrls: [],
    llmClient: { productizeInspirations: async ({ inspirations }) => {
      calls++;
      return { roots: inspirations.map(item => ({ inspirationId: item.id, rootKeyword: `测试商品${calls}`, category: `类目${calls}`, productForm: '实体用品', productUse: '日常使用', relationReason: '需求明确' })) };
    } }, onPartial: () => { partials++; } });
  assert.equal(calls, 4);
  assert.equal(partials, 1);
  assert.equal(result.selectedRoots.length, 2);
  assert.equal(result.stats.stopReason, 'target_reached');
  assert.ok(result.stats.analyzedInspirationCount < result.stats.safeInspirationCount);
});

test('a material budget reports shortfall instead of silently reaching the target', async () => {
  const result = await discoverInspirationRoots({ rootLimit: 8, materialBudget: 2, enabledDimensions: [], newsFeedUrls: [],
    llmClient: { productizeInspirations: async () => ({ roots: [] }) } });
  assert.equal(result.stats.analyzedInspirationCount, 2);
  assert.equal(result.stats.targetReached, false);
  assert.equal(result.stats.stopReason, 'material_budget_reached');
});
