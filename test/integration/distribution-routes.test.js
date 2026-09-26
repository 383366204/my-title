const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDistributionJobs } = require('../../core/server/distribution-jobs');
const { registerDistributionRoutes } = require('../../core/server/distribution-routes');
const { createDistributionShopStore } = require('../../core/distribution-shops');

test('partial recheck replaces stale counts without marking the workflow complete', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'distribution-counts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const jobs = createDistributionJobs({ jobDir: dir, getConfirmationReader: () => async () => ({
    ok: false, status: 'completed_with_issues', confirmation: { foundOfferIds: ['1'], issueOfferIds: ['2'] }
  }) });
  const job = jobs.writeDistributionJob({ jobId: 'partial', total: 3, completed: 0, failed: 3,
    items: ['1', '2', '3'].map(offerId => ({ offerId, url: `https://detail.1688.com/offer/${offerId}.html`, title: '测试商品' })) });
  const result = await jobs.recheckDistributionJob(job);
  assert.equal(result.completed, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.pending, 1);
  assert.equal(result.status, 'completed_with_issues');
});

test('multi-shop requests propagate mode, reject invalid targets and lock retry configuration', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'distribution-multi-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const shops = createDistributionShopStore(path.join(dir, 'shops.json'));
  const a = shops.save({ name: '一店', platformShopName: '甲店', port: 9222 });
  const b = shops.save({ name: '二店', platformShopName: '乙店', port: 9222 });
  const c = shops.save({ name: '三店', platformShopName: '丙店', port: 9223 });
  let checked, submitted, rechecked;
  const jobs = createDistributionJobs({ jobDir: dir, getConfirmationReader: () => async options => { rechecked = options; return { ok: false }; } });
  const app = express(); app.use(express.json());
  registerDistributionRoutes(app, {
    validateDistributionCategories: () => {},
    shops, jobs, parseItems: () => [{ offerId: '123', url: 'https://detail.1688.com/offer/123.html', title: '杯垫' }],
    checkDistributionReadiness: async options => { checked = options; return { canSubmit: true }; },
    distributeProducts: async options => { submitted = options; return { ok: false, batches: [] }; },
    parsePositiveNumber: (value, fallback) => Number(value) || fallback, createRunId: () => 'multi', originalError: () => {}
  });
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const post = (action, body) => fetch(`http://127.0.0.1:${server.address().port}/api/distribution/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const request = { input: 'fixture', confirm: true, shopIds: [a.id, b.id], shopRevisions: { [a.id]: a.revision, [b.id]: b.revision } };
  for (const shopIds of [[], [a.id, a.id], [a.id, c.id], ['missing'], 'invalid']) {
    assert.equal((await post('check', { ...request, shopIds })).status, 400);
  }
  assert.equal((await post('check', { ...request, distributionMode: 'bad' })).status, 400);
  assert.equal((await post('check', { ...request, shopRevisions: { [b.id]: 'stale' } })).status, 400);
  for (const distributionMode of ['sequential-average', 'random-average', 'random', 'repeat']) {
    const runId = `multi-${distributionMode}`;
    const response = await post('submit', { ...request, runId, distributionMode });
    assert.equal(response.status, 200);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(checked.targetShops, [a, b]);
    assert.deepEqual(submitted.targetShops, [a, b]);
    assert.equal(submitted.port, 9222);
    assert.equal(submitted.distributionMode, distributionMode);
    const job = jobs.readDistributionJob(`${runId}-distribution`);
    assert.equal(job.distributionMode, distributionMode);
    assert.equal((await post('submit', { ...request, runId, distributionMode, shopIds: [a.id] })).status, 409);
    assert.equal((await post('submit', { ...request, runId, distributionMode: distributionMode === 'repeat' ? 'random' : 'repeat' })).status, 409);
    assert.equal((await post(`runs/${runId}-distribution/recheck`, {})).status, 200);
    assert.deepEqual(rechecked.targetShops, [a, b]);
    assert.equal(rechecked.distributionMode, distributionMode);
  }
});

test('distribution submission preserves confirmation, control, failures and completion synchronization', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'distribution-routes-'));
  const shops = createDistributionShopStore(path.join(dir, 'shops.json'));
  const shop = shops.save({ name: '测试店', platformShopName: '平台测试店', port: 9223 });
  let runtime = { status: 'paused', progress: { mine: { status: 'completed' } } };
  let summary = { runId: 'fixture', status: 'ready_to_distribute' };
  let marked = 0;
  let events = 0;
  let ready = true;
  let checkGate = null;
  let enteredCheck;
  let releaseCheck;
  let checkFailure = false;
  let synchronousFailure = false;
  let runner;
  let resolveRun;
  let rejectRun;
  let confirmationReader = async () => ({ ok: false });
  const jobs = createDistributionJobs({
    jobDir: dir,
    getConfirmationReader: () => confirmationReader,
    summarizePipelineRun: () => summary,
    readRuntimeState: () => runtime,
    markRunDistributionComplete: () => { marked++; summary = { ...summary, status: 'workflow_complete' }; },
    updateRuntimeState: ({ patch }) => { runtime = { ...runtime, ...patch }; },
    appendRuntimeEvent: () => { events++; }
  });
  const app = express();
  app.use(express.json());
  registerDistributionRoutes(app, {
    validateDistributionCategories: () => {},
    jobs,
    shops,
    parseItems: input => input ? [{ offerId: '123', url: 'https://detail.1688.com/offer/123.html', title: 'fixture', category: 'fixture' }] : [],
    checkDistributionReadiness: async () => {
      enteredCheck?.();
      if (checkGate) await checkGate;
      if (checkFailure) throw new Error('fixture readiness failure');
      return { canSubmit: ready };
    },
    parsePositiveNumber: (value, fallback) => Number(value) > 0 ? Number(value) : fallback,
    createRunId: () => 'fixture',
    distributeProducts: options => {
      if (synchronousFailure) throw new Error('fixture synchronous failure');
      runner = options;
      return new Promise((resolve, reject) => { resolveRun = resolve; rejectRun = reject; });
    },
    summarizePipelineRun: () => summary,
    originalError: () => {}
  });
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/distribution`;
  const post = (suffix, body = {}) => fetch(base + suffix, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const submit = () => post('/submit', { confirm: true, input: 'fixture', runId: 'fixture', shopId: shop.id });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal((await post('/submit', { input: 'fixture' })).status, 400);
    assert.equal((await post('/submit', { confirm: true })).status, 400);
    assert.equal(runner, undefined);
    assert.equal((await post('/submit', { confirm: true, input: 'fixture' })).status, 400);
    assert.equal((await post('/submit', { confirm: true, input: 'fixture', shopId: shop.id, shopRevision: 'stale' })).status, 400);
    const configured = await (await fetch(`${base}/shops`)).json();
    assert.equal(configured.data[0].id, shop.id);
    assert.equal((await post('/shops', { name: '无效', platformShopName: '无效', port: 0 })).status, 400);
    ready = false;
    assert.equal((await submit()).status, 409);
    assert.equal(runner, undefined);
    ready = true;
    checkFailure = true;
    assert.equal((await submit()).status, 500);
    checkFailure = false;
    const checking = new Promise(resolve => { enteredCheck = resolve; });
    checkGate = new Promise(resolve => { releaseCheck = resolve; });
    const firstSubmit = submit();
    // 等待环境检查进入挂起状态，第二请求不能启动另一个检查。
    await checking;
    assert.equal((await submit()).status, 409);
    assert.equal((await submit()).status, 409, 'a rejected request cannot release the first preparation');
    releaseCheck();
    checkGate = null;
    assert.equal((await firstSubmit).status, 200);
    assert.deepEqual(runner.shop, shop);
    assert.equal(runner.port, 9223);
    assert.equal((await submit()).status, 409);
    assert.equal((await post('/runs/fixture-distribution/pause')).status, 200);
    assert.equal(await runner.shouldStop(), 'pause');
    assert.equal(jobs.readDistributionJob('fixture-distribution').status, 'submitting');
    resolveRun({ stoppedStatus: 'pause', batches: [] });
    await settle();
    assert.equal(jobs.readDistributionJob('fixture-distribution').status, 'paused');
    assert.equal(marked, 0);
    assert.equal((await submit()).status, 200);
    assert.equal((await post('/runs/fixture-distribution/cancel')).status, 200);
    assert.equal(await runner.shouldStop(), 'cancel');
    resolveRun({ stoppedStatus: 'cancel', batches: [] });
    await settle();
    assert.equal(jobs.readDistributionJob('fixture-distribution').status, 'cancelled');
    assert.equal(marked, 0);
    const other = shops.save({ name: '另一店', platformShopName: '另一平台店' });
    assert.equal((await post('/submit', { confirm: true, input: 'fixture', runId: 'fixture', shopId: other.id })).status, 409);
    await submit();
    rejectRun(new Error('fixture submit failure'));
    await settle();
    assert.equal(jobs.readDistributionJob('fixture-distribution').status, 'failed');
    assert.equal(jobs.activeDistributionJobs.size, 0);
    synchronousFailure = true;
    await submit();
    await settle();
    assert.equal(jobs.readDistributionJob('fixture-distribution').status, 'failed');
    assert.equal(jobs.activeDistributionJobs.size, 0);
    synchronousFailure = false;
    await submit();
    await runner.onProgress({ results: [{ status: 'confirmed', count: 1 }] });
    assert.equal(jobs.readDistributionJob('fixture-distribution').completed, 1);
    resolveRun({ ok: true, batches: [{ status: 'confirmed', count: 1 }] });
    await settle();
    assert.equal(runtime.status, 'completed');
    assert.equal(runtime.activeStep, 'end');
    assert.equal(runtime.progress.mine.status, 'completed');
    assert.equal(runtime.progress.end.status, 'completed');
    assert.equal(marked, 1);
    assert.equal(events, 1);
    await fetch(`${base}/runs/fixture-distribution`);
    assert.equal(marked, 1, 'reading a completed job does not complete the workflow twice');
    assert.equal((await submit()).status, 409);
    assert.equal((await post('/runs/fixture-distribution/pause')).status, 409);
    assert.equal((await post('/runs/missing/cancel')).status, 404);
    assert.throws(() => jobs.readDistributionJob('../invalid'), /无效/);

    jobs.updateDistributionJob('fixture-distribution', { status: 'completed_with_issues' });
    confirmationReader = async () => { throw new Error('fixture confirmation failure'); };
    assert.equal((await post('/runs/fixture-distribution/recheck')).status, 400);
    assert.equal(jobs.readDistributionJob('fixture-distribution').confirmationError, 'fixture confirmation failure');
    confirmationReader = async () => ({ ok: true, status: 'confirmed' });
    assert.equal((await post('/runs/fixture-distribution/recheck')).status, 200);
    assert.equal(jobs.readDistributionJob('fixture-distribution').status, 'completed');
  } finally {
    releaseCheck?.();
    resolveRun?.({ stoppedStatus: 'cancel', batches: [] });
    await settle();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
