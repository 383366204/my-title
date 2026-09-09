const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const express = require('express');
const { registerSeedRoutes } = require('../../core/server/seed-routes');
const { registerResearchRoutes } = require('../../core/server/research-routes');
const { registerPlatformRoutes } = require('../../core/server/platform-routes');

async function serve(t, register, dependencies) {
  const app = express();
  app.use(express.json());
  register(app, dependencies);
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return (url, body) => fetch(`http://127.0.0.1:${server.address().port}${url}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
}

test('seed routes keep lifecycle, preview, stats and cache-clean contracts in isolated storage', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-route-test-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let seeds = [];
  const events = [];
  const checkDir = dir => assert.equal(dir, dataDir);
  const request = await serve(t, registerSeedRoutes, {
    DEFAULT_DATA_DIR: dataDir, fs, path,
    listSeeds: options => { checkDir(options.dataDir); return structuredClone(seeds); },
    loadSeeds: dir => { checkDir(dir); return structuredClone(seeds); },
    saveSeeds: (next, dir) => { checkDir(dir); seeds = structuredClone(next); },
    addSeed: (keyword, options) => {
      checkDir(options.dataDir);
      if (!keyword) throw new Error('fixture missing keyword');
      const seed = { keyword, status: 'active', source: options.source };
      seeds.push(seed); return seed;
    },
    auditSeedPool: profiles => ({ profiles }),
    recordSeedEvent: (event, dir) => { checkDir(dir); events.push(event); },
    prepareSeedSuggestions: (candidates, options) => ({ candidates, max: options.maxSuggestions }),
    buildSeedReplenishmentPlan: (sources, options) => ({ sources, max: options.maxSuggestions })
  });
  assert.equal((await request('/api/seeds', {})).status, 400);
  assert.equal((await request('/api/seeds', { keyword: 'fixture' })).status, 200);
  assert.equal((await (await request('/api/seeds')).json()).data.length, 1);
  assert.equal((await (await request('/api/seeds/audit')).json()).data.profiles.length, 1);
  assert.equal((await (await request('/api/seeds/fixture/toggle', {})).json()).data.status, 'paused');
  assert.equal((await request('/api/seeds/missing/toggle', {})).status, 404);
  assert.equal((await request('/api/seeds/fixture/status', { status: 'invalid' })).status, 400);
  assert.equal((await request('/api/seeds/missing/status', { status: 'active' })).status, 404);
  assert.equal((await request('/api/seeds/fixture/status', { status: 'cooling', reason: 'fixture' })).status, 200);
  assert.equal(events[0].status, 'cooling');
  assert.equal((await (await request('/api/seeds/suggestions/preview', { candidates: [], maxSuggestions: 2 })).json()).data.max, 2);
  assert.equal((await (await request('/api/seeds/replenishment/preview', { sources: [], maxSuggestions: 3 })).json()).data.max, 3);
  const file = path.join(dataDir, 'verify-cache.jsonl');
  fs.writeFileSync(file, '{}\n{}\n');
  assert.equal((await (await request('/api/status')).json()).data.files.cacheCount, 2);
  assert.equal((await request('/api/config/clean', { type: '../seeds' })).status, 400);
  assert.equal((await request('/api/config/clean', { type: 'cache' })).status, 200);
  assert.equal(fs.readFileSync(file, 'utf8'), '');
  const url = (await request('/api/seeds')).url;
  assert.equal((await fetch(`${url}/fixture`, { method: 'DELETE' })).status, 200);
  assert.equal((await fetch(`${url}/fixture`, { method: 'DELETE' })).status, 404);
});

test('research routes retain verification, title adapter and share parsing contracts without platform IO', async t => {
  const calls = [];
  let verifyFailure = false;
  const request = await serve(t, registerResearchRoutes, {
    logStorage: new AsyncLocalStorage(), originalLog() {}, DEFAULT_DATA_DIR: '/unused-fixture',
    mineKeywords: async () => ({ candidates: [] }),
    searchTaobaoTitles: async keyword => keyword === 'empty' ? [] : ['fixture title'],
    extractNouns: () => [{ word: 'fixture', count: 2 }],
    precheckCandidates: async () => {
      if (verifyFailure) throw new Error('fixture verification unavailable');
      return { passed: [{ keyword: 'fixture', searchPopularity: 100 }] };
    },
    fetchOpportunities: async () => ({ opportunityOffers: [{ title: 'fixture' }] }),
    extractSycmData: async (_keyword, options) => {
      calls.push(options);
      return { data: [{ keyword: 'fixture', searchPopularity: '2,000', demandSupplyRatio: '20%' }] };
    },
    searchAll: async (...args) => { calls.push(args); return []; },
    generateTitlePipeline: async (keyword, options) => {
      await options.searchProducts({ coreWord: keyword, blueOceanWord: 'fixture-blue', modifiers: [], semanticGroups: [] });
      return { titles: [], maxLength: options.maxLength };
    },
    resolve1688ShareText: async input => input === 'bad' ? null : { url: 'https://detail.1688.com/offer/123.html' }
  });
  assert.equal((await request('/api/miner/peer', {})).status, 400);
  const empty = await (await request('/api/miner/peer', { keyword: 'empty' })).json();
  assert.deepEqual(empty.data, []);
  assert.ok(empty.warning);
  const peer = await (await request('/api/miner/peer', { keyword: 'fixture' })).json();
  assert.deepEqual(peer.data, [{ word: 'fixture', count: 2, searchPopularity: 100 }]);
  assert.equal((await request('/api/miner/opportunities', {})).status, 200);
  verifyFailure = true;
  assert.equal((await request('/api/miner/peer', { keyword: 'fixture' })).status, 502);
  assert.equal((await request('/api/miner/opportunities', {})).status, 502);
  const market = await (await request('/api/miner/sycm-market', { keyword: 'fixture' })).json();
  assert.deepEqual(market.data, [{ word: 'fixture', searchPopularity: 2000, demandSupplyRatio: 0.2 }]);
  assert.deepEqual(calls[0], { mode: 'hot', maxPages: 1, port: 9222 });
  assert.equal((await request('/api/title/generate', {})).status, 400);
  assert.equal((await (await request('/api/title/generate', { keyword: 'fixture', maxLength: 40 })).json()).data.maxLength, 40);
  assert.deepEqual(calls[1], ['fixture', 'fixture-blue', [], []]);
  assert.equal((await request('/api/1688/resolve-share', {})).status, 400);
  assert.equal((await request('/api/1688/resolve-share', { input: 'x'.repeat(8193) })).status, 400);
  assert.equal((await request('/api/1688/resolve-share', { input: 'bad' })).status, 422);
  assert.equal((await request('/api/1688/resolve-share', { input: 'fixture' })).status, 200);
});

test('mining SSE keeps the injected async context and result/error frames', async t => {
  const logStorage = new AsyncLocalStorage();
  let failure = false;
  const contexts = [];
  const request = await serve(t, registerResearchRoutes, {
    logStorage, originalLog() {}, DEFAULT_DATA_DIR: '/isolated',
    mineKeywords: async options => {
      const context = logStorage.getStore();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(logStorage.getStore(), context);
      assert.equal(typeof context.write, 'function');
      contexts.push(context);
      assert.equal(options.dataDir, '/isolated');
      assert.equal(options.count, 3);
      if (failure) throw new Error('fixture mining failed');
      return { candidates: [] };
    }
  });
  const responses = await Promise.all([request('/api/mine/run?count=3'), request('/api/mine/run?count=3')]);
  for (const response of responses) {
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    assert.match(await response.text(), /"type":"result"/);
  }
  assert.notEqual(contexts[0], contexts[1]);
  failure = true;
  assert.match(await (await request('/api/mine/run?count=3')).text(), /"type":"error","message":"fixture mining failed"/);
});

test('platform recovery preserves dynamic launchers and explicit failure statuses', async t => {
  let launch = async () => ({ success: true });
  let open = async () => ({ success: true });
  let nativeError = null;
  let nativeReady = true;
  const request = await serve(t, registerPlatformRoutes, {
    getPlatformAccessStatus: platform => ({ platform, available: true }),
    parsePositiveNumber: (value, fallback) => Number(value) > 0 ? Number(value) : fallback,
    isValidWorkflowRunIdParam: () => true,
    readRuntimeState: () => null,
    SYCM_SELECTORS: { SEARCH_URL: 'https://sycm.taobao.com/' },
    getSycmChromeLauncher: () => launch,
    getSycmChromePageOpener: () => open,
    recoverSycmAccessAfterChrome: async () => ({ chromeReady: true }),
    launchTaobaoDesktop: async () => nativeReady,
    TaobaoNativeClient: class { async navigate() { if (nativeError) throw nativeError; return {}; } }
  });
  assert.equal((await (await request('/api/platform/status')).json()).data.sycm.available, true);
  for (const route of ['/api/workflows/sycm/chrome/start', '/api/distribution/chrome/start']) {
    launch = async () => ({ success: false, message: 'fixture not ready' });
    assert.equal((await request(route, { port: 9001 })).status, 500);
    launch = async () => ({ success: true });
    open = async () => { throw new Error('fixture open failed'); };
    assert.equal((await (await request(route, { port: 9001 })).json()).openStatus, 'open_page_failed');
    open = async () => ({ success: true });
    const ready = await (await request(route, { port: 9001 })).json();
    assert.equal(ready.port, 9001);
    assert.equal(ready.openStatus, 'opened');
  }
  assert.equal((await request('/api/workflows/taobao-native/start', {})).status, 200);
  nativeError = Object.assign(new Error('fixture login'), { code: 'TAOBAO_LOGIN_REQUIRED' });
  assert.equal((await (await request('/api/workflows/taobao-native/start', {})).json()).status, 'login_required');
  nativeReady = false;
  assert.equal((await request('/api/workflows/taobao-native/start', {})).status, 500);
});
