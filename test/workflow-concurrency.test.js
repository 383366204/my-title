const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const express = require('express');
const { createWorkbenchCoordinator } = require('../core/server/workbench-coordinator');
const { registerPipelineRoutes } = require('../core/server/pipeline-routes');
const { registerWorkflowControlRoutes } = require('../core/server/workflow-control-routes');
const { registerWorkbenchRoutes } = require('../core/server/workbench-routes');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function fixture() {
  const app = express();
  app.use(express.json());
  const workbench = createWorkbenchCoordinator();
  const states = new Map([['existing', { mode: 'keyword', status: 'paused', params: {}, steps: ['verify'], activeStep: 'verify' }]]);
  const writes = [];
  const calls = [];
  const children = [];
  let sequence = 0;
  app.locals.pipelineRuntimeRunner = async input => {
    states.set(input.runId, { ...input, status: 'completed' });
    return { runId: input.runId, status: 'completed' };
  };
  const dependencies = {
    workbench,
    parsePositiveNumber: (value, fallback) => Number(value) > 0 ? Number(value) : fallback,
    listPipelineRuns: () => ({ runs: [], latest: null }),
    summarizePipelineRun: ({ runId }) => states.has(runId) ? { runId } : null,
    withPipelineRuntimeFields: value => value,
    isValidWorkflowRunIdParam: value => /^[A-Za-z0-9_-]+$/.test(value),
    resolveProductionWorkflowLaunch: body => {
      if (body.invalid) throw new Error('未知 workflow mode');
      return { mode: body.mode || 'keyword', params: body.params || {} };
    },
    resolveManualShareParams: (mode, params) => app.locals.shareParamsResolver ? app.locals.shareParamsResolver(mode, params) : Promise.resolve(params),
    sanitizeWorkflowParams: (_mode, params) => params,
    createRunId: () => `fixture_${++sequence}`,
    resolveProductionWorkflowDefinition: () => ({ id: 'fixture' }),
    writeWorkflowDefinition: definition => writes.push(definition),
    // 必须在每次请求时读取，验证注册后更换 app.locals 仍然有效。
    getPipelineRuntimeRunner: () => input => { calls.push(input); return app.locals.pipelineRuntimeRunner(input); },
    originalLog() {}, originalError() {},
    readRuntimeState: ({ runId }) => states.get(runId) || null,
    appendRunCandidates: async () => ({ added: 0 }),
    requestRuntimePause: () => ({ action: 'pause' }),
    requestRuntimeCancel: () => ({ action: 'cancel' }),
    requestRuntimeResume: () => ({ action: 'resume' }),
    requestRuntimeRetryStep: () => ({ action: 'retry' }),
    pipelineRunResponse: runId => ({ runId, runtime: states.get(runId) }),
    runPipelineStep: (...args) => app.locals.stepRunner(...args),
    getSycmChromeAvailabilityChecker: () => async () => true,
    recoverSycmAccessAfterChrome: async () => ({ chromeReady: true }),
    retryWorkflowNode: (...args) => app.locals.legacyRunner?.(...args),
    resumeWorkflow: (...args) => app.locals.legacyRunner?.(...args),
    getRun: () => null, markRunPaused: () => null,
    buildWorkbenchCliArgs: () => ['fixture.js'],
    appendCappedOutput: (current, chunk) => current + chunk,
    spawn: () => {
      if (app.locals.spawnError) throw app.locals.spawnError;
      const child = new EventEmitter();
      Object.assign(child, { pid: 42, stdout: new EventEmitter(), stderr: new EventEmitter() });
      children.push(child);
      return child;
    }
  };
  registerWorkbenchRoutes(app, dependencies);
  registerPipelineRoutes(app, dependencies);
  registerWorkflowControlRoutes(app, dependencies);
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const post = async (path, body = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return { status: response.status, payload: await response.json() };
  };
  return { app, workbench, states, writes, calls, children, post, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}

for (const [first, second] of [['/api/pipeline/start', '/api/workflows/run'], ['/api/workflows/run', '/api/pipeline/start']]) {
  test(`${first} reserves before async preparation and blocks all launch entries`, { timeout: 10000 }, async () => {
    const f = await fixture();
    const entered = deferred();
    const preparation = deferred();
    const running = deferred();
    let request;
    try {
      f.app.locals.shareParamsResolver = () => { entered.resolve(); return preparation.promise; };
      f.app.locals.pipelineRuntimeRunner = input => {
        f.states.set(input.runId, { ...input, status: 'running' });
        return running.promise;
      };
      request = f.post(first);
      await entered.promise;
      for (const path of [second, '/api/workbench/run', '/api/pipeline/runs/existing/verify', '/api/pipeline/runs/existing/resume', '/api/workflows/runs/existing/retry-node', '/api/workflows/runs/legacy/resume', '/api/workflows/runs/legacy/retry-node']) {
        assert.equal((await f.post(path, { nodeId: 'verify' })).status, 409, path);
      }
      assert.equal(f.writes.length, 0);
      assert.equal(f.calls.length, 0);
      assert.equal(f.children.length, 0);
      preparation.resolve({});
      const started = await request;
      assert.equal(started.status, 200);
      assert.equal(f.calls.length, 1);
      assert.equal(f.writes.length, 1);
      const runId = started.payload.data.runId;
      assert.equal((await f.post(`/api/workflows/runs/${runId}/cancel`)).status, 200);
      assert.equal((await f.post(second)).status, 409, 'cancel request must not unlock a still-running task');
      running.resolve({ runId, status: 'cancelled' });
      await running.promise;
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(f.workbench.current, null);
      // 注册路由后替换 runner，确认没有捕获旧的测试注入。
      f.app.locals.pipelineRuntimeRunner = async input => ({ runId: input.runId, status: 'completed' });
      assert.equal((await f.post(second)).status, 200);
      assert.equal(f.calls.length, 2);
    } finally {
      preparation.resolve({}); running.resolve({ runId: 'cleanup', status: 'cancelled' });
      await request?.catch(() => {});
      await f.close();
    }
  });
}

test('validation, preparation and runner errors release only their own reservation', { timeout: 10000 }, async () => {
  const f = await fixture();
  try {
    for (const path of ['/api/pipeline/start', '/api/workflows/run']) {
      assert.equal((await f.post(path, { invalid: true })).status, 400);
      assert.equal(f.workbench.current, null);
      f.app.locals.shareParamsResolver = async () => { throw new Error('fixture resolution failed'); };
      assert.equal((await f.post(path)).status, 500);
      assert.equal(f.workbench.current, null);
      delete f.app.locals.shareParamsResolver;
      f.app.locals.pipelineRuntimeRunner = () => { throw new Error('fixture sync runner failed'); };
      assert.equal((await f.post(path)).status, 500);
      assert.equal(f.workbench.current, null);
      f.app.locals.pipelineRuntimeRunner = async () => { throw new Error('fixture async runner failed'); };
      assert.equal((await f.post(path)).status, 200);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(f.workbench.current, null);
    }
  } finally { await f.close(); }
});

test('CLI exit and error cannot release a later runtime task', { timeout: 10000 }, async () => {
  const f = await fixture();
  const running = deferred();
  try {
    f.app.locals.spawnError = new Error('fixture spawn failed');
    assert.equal((await f.post('/api/workbench/run')).status, 500);
    assert.equal(f.workbench.current, null);
    delete f.app.locals.spawnError;
    assert.equal((await f.post('/api/workbench/run')).status, 200);
    assert.equal((await f.post('/api/pipeline/start')).status, 409);
    const child = f.children[0];
    child.emit('error', new Error('fixture child error'));
    assert.equal(f.workbench.current, null);
    f.app.locals.pipelineRuntimeRunner = () => running.promise;
    assert.equal((await f.post('/api/workflows/run')).status, 200);
    const active = f.workbench.current;
    child.emit('exit', 1, null);
    assert.equal(f.workbench.current, active);
    assert.equal((await f.post('/api/workbench/run')).status, 409);
    running.resolve({ runId: active.runId, status: 'completed' });
    await running.promise;
    assert.equal((await f.post('/api/workbench/run')).status, 200);
    f.children[1].emit('exit', 0, null);
    assert.equal(f.workbench.current, null);
  } finally { running.resolve({ status: 'cancelled' }); await f.close(); }
});

test('legacy direct-step execution participates in shared occupancy and releases on failure', { timeout: 10000 }, async () => {
  const f = await fixture();
  const entered = deferred();
  const running = deferred();
  let request;
  try {
    f.app.locals.stepRunner = () => { entered.resolve(); return running.promise; };
    request = f.post('/api/pipeline/runs/existing/verify');
    await entered.promise;
    assert.equal((await f.post('/api/workflows/run')).status, 409);
    assert.equal((await f.post('/api/pipeline/start')).status, 409);
    running.reject(new Error('fixture step failed'));
    assert.equal((await request).status, 500);
    assert.equal(f.workbench.current, null);
    assert.equal((await f.post('/api/workflows/run')).status, 200);
  } finally { running.resolve({}); await request?.catch(() => {}); await f.close(); }
});

for (const action of ['resume', 'retry-node']) {
  test(`legacy ${action} shares the coordinator with modern pipeline routes`, { timeout: 10000 }, async () => {
    const f = await fixture();
    const entered = deferred();
    const running = deferred();
    let request;
    try {
      f.app.locals.legacyRunner = () => { entered.resolve(); return running.promise; };
      request = f.post(`/api/workflows/runs/legacy/${action}`, { nodeId: 'work' });
      await entered.promise;
      assert.equal((await f.post('/api/pipeline/start')).status, 409);
      assert.equal((await f.post('/api/workflows/runs/other/resume')).status, 409);
      running.reject(new Error('fixture legacy failure'));
      assert.equal((await request).status, 400);
      assert.equal(f.workbench.current, null);
      assert.equal((await f.post('/api/workflows/run')).status, 200);
    } finally { running.resolve({}); await request?.catch(() => {}); await f.close(); }
  });
}
