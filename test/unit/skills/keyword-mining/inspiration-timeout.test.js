const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { productizeInspirations } = require('../../../../skills/keyword-mining/src/inspiration-productizer');
const axios = require('axios');

const inspirations = count => Array.from({ length: count }, (_, index) => ({ id: `i${index}`, inspirationWord: '收纳' }));
const timeout = () => Object.assign(new Error('timeout of 60000ms exceeded'), { code: 'ECONNABORTED' });

test('HTTP productizer accepts a top-level empty array', async t => {
  t.mock.method(axios, 'post', async () => ({ data: { choices: [{ message: { content: '[]' } }] } }));
  await productizeInspirations(inspirations(1), { llmClient: { apiKey: 'test-only', apiBase: 'https://example.test' } });
});

test('invalid root schema retries once then reports a recoverable Chinese error', async t => {
  const batchCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inspiration-format-'));
  t.after(() => fs.rmSync(batchCacheDir, { recursive: true, force: true }));
  let calls = 0;
  t.mock.method(axios, 'post', async () => {
    calls++;
    return { data: { choices: [{ message: { content: '{"roots":null}' } }] } };
  });
  await assert.rejects(productizeInspirations(inspirations(1), { batchCacheDir, llmClient: { apiKey: 'test-only', apiBase: 'https://example.test' } }),
    error => error.code === 'INSPIRATION_LLM_FORMAT' && error.message.includes('已完成批次会保留'));
  assert.equal(calls, 2);
});

test('invalid schema can recover on the second response', async t => {
  let calls = 0;
  t.mock.method(axios, 'post', async () => ({ data: { choices: [{ message: { content: ++calls === 1 ? '{"roots":[null]}' : '{"roots":[]}' } }] } }));
  await productizeInspirations(inspirations(1), { llmClient: { apiKey: 'test-only', apiBase: 'https://example.test' } });
  assert.equal(calls, 2);
});

test('default AI batches analyze one inspiration without waiting for larger batches to time out', async () => {
  const sizes = [];
  await productizeInspirations(inspirations(11), { llmClient: { productizeInspirations: async ({ inspirations: rows }) => {
    sizes.push(rows.length);
    return [];
  } } });
  assert.deepEqual(sizes, Array(11).fill(1));
});

test('HTTP timeout splits instead of retrying the same oversized request', async t => {
  let calls = 0;
  const progress = [];
  t.mock.method(axios, 'post', async () => {
    calls += 1;
    if (calls === 1) throw timeout();
    return { data: { choices: [{ message: { content: '{"roots":[]}' } }] } };
  });
  await productizeInspirations(inspirations(2), { batchSize: 2, llmClient: {
    apiKey: 'test-only', apiBase: 'https://example.test', model: 'test-model'
  }, onProgress: value => progress.push(value.message) });
  assert.equal(calls, 3);
  assert.ok(progress.some(value => value.includes('改为小批次')));
});

test('inspiration request timeout is independent of the general client timeout and can be overridden', async t => {
  const timeouts = [];
  t.mock.method(axios, 'post', async (_url, _body, options) => {
    timeouts.push(options.timeout);
    return { data: { choices: [{ message: { content: '{"roots":[]}' } }] } };
  });
  const llmClient = { apiKey: 'test-only', apiBase: 'https://example.test', _longTimeout: 60000 };
  await productizeInspirations(inspirations(1), { llmClient, requestTimeoutMs: 180000 });
  await productizeInspirations(inspirations(1), { llmClient, requestTimeoutMs: 90000 });
  await productizeInspirations(inspirations(1), { llmClient, requestTimeoutMs: NaN });
  assert.deepEqual(timeouts, [180000, 90000, 180000]);
});

test('reports waiting time and clears the heartbeat after a request completes', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const progress = [];
  let resolve;
  const pending = productizeInspirations(inspirations(1), {
    requestTimeoutMs: 180000,
    onProgress: event => progress.push(event.message),
    llmClient: { productizeInspirations: () => new Promise(done => { resolve = done; }) }
  });
  t.mock.timers.tick(10000);
  assert.ok(progress.some(message => message.includes('已等待 10 秒，单次上限 180 秒')));
  resolve([]);
  await pending;
  const count = progress.length;
  t.mock.timers.tick(10000);
  assert.equal(progress.length, count);
});

test('timed-out batches split serially and retain completed children on retry', async t => {
  const batchCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inspiration-timeout-'));
  t.after(() => fs.rmSync(batchCacheDir, { recursive: true, force: true }));
  const calls = [];
  let fail = true;
  const options = { batchSize: 4, batchCacheDir, llmClient: { model: 'test-model', productizeInspirations: async ({ inspirations: rows }) => {
    calls.push(rows.map(row => row.id).join(','));
    if (rows.length > 1 || (fail && rows[0].id === 'i1')) throw timeout();
    return [];
  } } };
  await assert.rejects(productizeInspirations(inspirations(4), options), error => error.code === 'INSPIRATION_LLM_TIMEOUT' && /test-model.*单条灵感/.test(error.message));
  fail = false;
  await productizeInspirations(inspirations(4), options);
  assert.equal(calls.filter(value => value === 'i0').length, 1);
  assert.equal(calls.filter(value => value === 'i0,i1,i2,i3').length, 1);
  assert.equal(calls.filter(value => value === 'i1').length, 2);
});

test('pause stops timeout splitting before another API request', async () => {
  let stop = false;
  let calls = 0;
  await assert.rejects(productizeInspirations(inspirations(2), { shouldStop: () => stop, llmClient: {
    productizeInspirations: async () => { calls += 1; stop = true; throw timeout(); }
  } }), /暂停/);
  assert.equal(calls, 1);
});
