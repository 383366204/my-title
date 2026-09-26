'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { registerCategoryRoutes } = require('../../core/server/category-routes');
const { createWorkbenchCoordinator } = require('../../core/server/workbench-coordinator');
const { validateDistributionCategories } = require('../../core/server/distribution-category-validation');
const { initRun, appendJsonl, writeRun } = require('../../skills/pipeline-flow/src/run-store');
const { readCategoryState, saveCategoryState, categorySnapshot, prepareDistributionCategories } = require('../../skills/pipeline-flow/src/category-state');
const { flowExport } = require('../../skills/pipeline-flow/src/export-flow');

async function fixture(t, extractor) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'category-routes-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const options = { dataDir, runId: 'categories' };
  const { run, runDir } = initRun(options);
  run.status = 'needs_review';
  writeRun(runDir, run);
  const rows = [1, 2].map(id => ({ status: 'generated', keyword: '杯垫',
    url: `https://detail.1688.com/offer/${id}.html`,
    title: `家用杯垫茶杯隔热垫桌面防滑吸水耐热圆形创意茶托办公水杯防烫垫子${id}`,
    product: { categoryName: '1688旧类目' }, recommendedCategory: '来源未知旧类目' }));
  appendJsonl(run.files.generatedProducts, rows);
  const workbench = createWorkbenchCoordinator();
  let locked = false;
  const app = express(); app.use(express.json());
  registerCategoryRoutes(app, { ...options, workbench, extractor, jobs: { readDistributionJob: () => locked ? {} : null } });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/workflows/runs/categories/categories`;
  const get = async () => (await (await fetch(base)).json()).data;
  const post = async (body, suffix = '') => {
    const response = await fetch(base + suffix, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, ...(await response.json()) };
  };
  const wait = async () => { if (workbench.current?.promise) await workbench.current.promise; };
  return { options, rows, run, get, post, wait, workbench, lock: () => { locked = true; } };
}

const result = () => ({ categoryAnalysis: { recommendation: { ranking: [
  { category: '淘宝 > 杯垫', clickRatio: 80, clickRate: 30 },
  { category: '淘宝 > 茶托', clickRatio: 20, clickRate: 10 }
], recommended: { category: '淘宝 > 杯垫', clickRatio: 80, clickRate: 30 } } } });

test('query, confirmation, files, copy and submission share authoritative SYCM categories', async t => {
  let calls = 0;
  const f = await fixture(t, async (_word, config) => { calls++; assert.equal(config.guardMinCooldownMs, 45000); return result(); });
  let snapshot = await f.get();
  assert.equal(snapshot.rows[0].category, '');
  assert.equal(snapshot.rows[0].legacyCategory, '来源未知旧类目');
  assert.equal((await f.post({ format: 'full', items: f.rows }, '/copy')).status, 400);
  assert.equal((await f.post({ format: 'url', items: f.rows }, '/copy')).data.text, f.rows.map(row => row.url).join('\n'));
  assert.equal((await f.post({ action: 'query', version: snapshot.version, urls: f.rows.map(row => row.url) })).status, 200);
  await f.wait();
  snapshot = await f.get();
  assert.equal(calls, 1);
  assert.equal(snapshot.job.status, 'completed');
  assert.equal(snapshot.rows[0].category, '淘宝 > 杯垫');
  assert.match(fs.readFileSync(f.run.files.distributionBatch, 'utf8'), /\$\$淘宝 > 杯垫/);
  await flowExport({ ...f.options, limit: 1 });
  assert.equal((await f.post({ action: 'select', version: 0, url: f.rows[0].url, category: '淘宝 > 茶托' })).status, 409);
  assert.equal((await f.post({ action: 'select', version: snapshot.version, url: f.rows[0].url, category: '1688旧类目' })).status, 400);
  assert.equal((await f.post({ action: 'select', version: snapshot.version, url: f.rows[0].url, category: '淘宝 > 茶托' })).status, 200);
  assert.equal(fs.readFileSync(f.run.files.distributionBatch, 'utf8').trim().split('\n').length, 1);
  const copy = await f.post({ format: 'full', items: f.rows.map(row => ({ ...row, category: '不可信客户端类目' })) }, '/copy');
  assert.match(copy.data.text, /\$\$淘宝 > 茶托/);
  assert.ok(!copy.data.text.includes('不可信'));
  assert.throws(() => validateDistributionCategories(f.options.runId, [{ ...f.rows[0], category: '1688旧类目' }], f.options), /类目缺失或已变更/);
  assert.doesNotThrow(() => validateDistributionCategories(f.options.runId, [{ ...f.rows[0], category: '淘宝 > 茶托' }], f.options));
  assert.throws(() => validateDistributionCategories(f.options.runId, [{ ...f.rows[0], title: '短', category: '淘宝 > 茶托' }], f.options), /title_too_short/);
  f.lock();
  snapshot = await f.get();
  assert.equal(snapshot.locked, true);
  assert.equal((await f.post({ action: 'select', version: snapshot.version, url: f.rows[0].url, category: '淘宝 > 杯垫' })).status, 400);
});

test('pause preserves the in-flight barrier and custom query requires confirmation', async t => {
  let release;
  let calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, async () => { calls++; if (calls === 1) await gate; return result(); });
  let snapshot = await f.get();
  await f.post({ action: 'query', version: snapshot.version, urls: [f.rows[0].url], queryWord: '茶托' });
  snapshot = await f.get();
  assert.equal(snapshot.job.inFlight, true);
  await f.post({ action: 'pause', version: snapshot.version });
  snapshot = await f.get();
  assert.equal(snapshot.job.status, 'paused');
  assert.throws(() => validateDistributionCategories(f.options.runId, f.rows, f.options), /正在获取类目/);
  assert.equal((await f.post({ action: 'resume', version: snapshot.version })).status, 400);
  release(); await f.wait();
  snapshot = await f.get();
  assert.equal(snapshot.rows[0].category, '');
  assert.equal(snapshot.rows[0].status, 'needs_confirmation');
  assert.equal(snapshot.rows[0].queryWord, '茶托');
  assert.equal((await f.post({ action: 'select', version: snapshot.version, url: f.rows[0].url, category: '淘宝 > 茶托' })).status, 200);
});

test('paused queue resumes only unprocessed keywords', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const calls = [];
  const f = await fixture(t, async word => { calls.push(word); if (calls.length === 1) await gate; return result(); });
  f.rows[1].keyword = '茶托';
  fs.writeFileSync(f.run.files.generatedProducts, f.rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  await f.post({ action: 'query', version: 0, urls: f.rows.map(row => row.url) });
  let snapshot = await f.get();
  await f.post({ action: 'pause', version: snapshot.version });
  release(); await f.wait();
  snapshot = await f.get();
  assert.equal(snapshot.job.status, 'paused');
  assert.deepEqual(calls, ['杯垫']);
  await f.post({ action: 'resume', version: snapshot.version });
  await f.wait();
  assert.deepEqual(calls, ['杯垫', '茶托']);
  assert.equal((await f.get()).job.status, 'completed');
});

test('runtime-owned category query is not misclassified as a restarted server task', async t => {
  const f = await fixture(t, async () => result());
  const context = readCategoryState(f.options);
  context.state.job = { status: 'running', completed: 0, requests: [] };
  saveCategoryState(context);
  const reservation = f.workbench.tryAcquire({ runId: f.options.runId });
  assert.equal((await f.get()).job.status, 'running');
  f.workbench.release(reservation);
  assert.equal((await f.get()).job.status, 'paused');
});

test('preparation deduplicates queries and preserves all-zero candidates for manual selection', async t => {
  const f = await fixture(t);
  let calls = 0;
  const extractor = async () => { calls++; return { categoryAnalysis: { rows: [{ category: '杯垫', clickRatio: 0, clickRate: 0 }] } }; };
  await prepareDistributionCategories({ ...f.options, extractor });
  await prepareDistributionCategories({ ...f.options, extractor });
  assert.equal(calls, 1);
  const snapshot = categorySnapshot(readCategoryState(f.options));
  assert.equal(snapshot.rows[0].status, 'needs_confirmation');
});
