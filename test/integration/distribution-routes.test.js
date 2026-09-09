const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDistributionJobs } = require('../../core/server/distribution-jobs');
const { registerDistributionRoutes } = require('../../core/server/distribution-routes');

test('distribution submission preserves confirmation, control, failures and completion synchronization', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'distribution-routes-'));
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
    jobs,
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
  const submit = () => post('/submit', { confirm: true, input: 'fixture', runId: 'fixture' });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal((await post('/submit', { input: 'fixture' })).status, 400);
    assert.equal((await post('/submit', { confirm: true })).status, 400);
    assert.equal(runner, undefined);
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
