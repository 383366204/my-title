'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Setup environment variables before requiring any modules
const workflowDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-api-recovery-test-'));
process.env.ECOM_WORKFLOW_DATA_DIR = workflowDataDir;
process.env.NODE_ENV = 'test';

const {
  createRun,
  getRun,
  registerNode,
  updateRun
} = require('../core/workflow');

const app = require('../bin/server');

test('workflow recovery APIs - pause, resume, and retry', async (t) => {
  registerNode('api-start-node', {
    execute: async () => {
      return { status: 'ok' };
    }
  });

  registerNode('api-success-node', {
    execute: async () => {
      return { success: true };
    }
  });

  const successWorkflow = {
    nodes: [
      { id: 'start', type: 'api-start-node', data: {} },
      { id: 'work', type: 'api-success-node', data: {} }
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'work' }
    ]
  };

  let server;
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();

  try {
    // Test Case 1: pause a running workflow (mock state first)
    await t.test('POST /api/workflows/runs/:runId/pause', async () => {
      const run = createRun(successWorkflow);
      // Mock run as running with start completed and flaky running
      updateRun(run.runId, {
        status: 'running',
        nodeStates: {
          ...run.nodeStates,
          start: {
            ...run.nodeStates.start,
            status: 'completed',
            output: { status: 'ok' }
          },
          work: {
            ...run.nodeStates.work,
            status: 'running',
            progress: { status: 'running', current: 0, total: 0, percent: 50, message: 'running' }
          }
        }
      });

      const res = await fetch(`http://127.0.0.1:${port}/api/workflows/runs/${run.runId}/pause`, {
        method: 'POST'
      });
      assert.strictEqual(res.status, 200);
      const payload = await res.json();
      assert.strictEqual(payload.ok, true);
      assert.strictEqual(payload.run.status, 'paused');
      assert.strictEqual(payload.run.nodeStates.work.status, 'paused');

      // Test pause non-existent run
      const resNonExistent = await fetch(`http://127.0.0.1:${port}/api/workflows/runs/nonexistent-run-id/pause`, {
        method: 'POST'
      });
      assert.strictEqual(resNonExistent.status, 404);
      const payloadNonExistent = await resNonExistent.json();
      assert.strictEqual(payloadNonExistent.ok, false);
    });

    // Test Case 2: resume a paused workflow
    await t.test('POST /api/workflows/runs/:runId/resume', async () => {
      const run = createRun(successWorkflow);
      // Mock run as paused
      updateRun(run.runId, {
        status: 'paused',
        nodeStates: {
          ...run.nodeStates,
          start: {
            ...run.nodeStates.start,
            status: 'completed',
            output: { status: 'ok' }
          },
          work: {
            ...run.nodeStates.work,
            status: 'paused',
            progress: { status: 'paused', current: 0, total: 0, percent: 0, message: '' }
          }
        }
      });

      const res = await fetch(`http://127.0.0.1:${port}/api/workflows/runs/${run.runId}/resume`, {
        method: 'POST'
      });
      assert.strictEqual(res.status, 200);
      const payload = await res.json();
      assert.strictEqual(payload.ok, true);
      assert.strictEqual(payload.run.status, 'completed');
      assert.strictEqual(payload.run.nodeStates.work.status, 'completed');

      // Test resume non-existent run
      const resNonExistent = await fetch(`http://127.0.0.1:${port}/api/workflows/runs/nonexistent-run-id/resume`, {
        method: 'POST'
      });
      assert.strictEqual(resNonExistent.status, 400);
      const payloadNonExistent = await resNonExistent.json();
      assert.strictEqual(payloadNonExistent.ok, false);
    });

    // Test Case 3: retry a node
    await t.test('POST /api/workflows/runs/:runId/retry-node', async () => {
      let retryCalls = 0;
      registerNode('api-retry-node', {
        execute: async () => {
          retryCalls += 1;
          return { success: true, retryCalls };
        }
      });
      const retryWorkflow = {
        nodes: [
          { id: 'start', type: 'api-start-node', data: {} },
          { id: 'flaky', type: 'api-retry-node', data: {} }
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'flaky' }
        ]
      };
      const run = createRun(retryWorkflow);
      // Mock run as failed/retryable
      updateRun(run.runId, {
        status: 'retryable',
        nodeStates: {
          ...run.nodeStates,
          start: {
            ...run.nodeStates.start,
            status: 'completed',
            output: { status: 'ok' }
          },
          flaky: {
            ...run.nodeStates.flaky,
            status: 'retryable',
            error: 'transient error'
          }
        }
      });

      // Test missing nodeId in request body
      const resMissingNode = await fetch(`http://127.0.0.1:${port}/api/workflows/runs/${run.runId}/retry-node`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.strictEqual(resMissingNode.status, 400);
      const payloadMissingNode = await resMissingNode.json();
      assert.strictEqual(payloadMissingNode.ok, false);
      assert.match(payloadMissingNode.error, /nodeId is required/);

      // Test successful retry
      const res = await fetch(`http://127.0.0.1:${port}/api/workflows/runs/${run.runId}/retry-node`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: 'flaky' })
      });
      assert.strictEqual(res.status, 200);
      const payload = await res.json();
      assert.strictEqual(payload.ok, true);
      // Flaky node will succeed this time (second call) -> run status should be completed
      assert.strictEqual(payload.run.status, 'completed');
      assert.strictEqual(payload.run.nodeStates.flaky.status, 'completed');

      // Test retry non-existent run
      const resNonExistent = await fetch(`http://127.0.0.1:${port}/api/workflows/runs/nonexistent-run-id/retry-node`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: 'flaky' })
      });
      assert.strictEqual(resNonExistent.status, 400);
      const payloadNonExistent = await resNonExistent.json();
      assert.strictEqual(payloadNonExistent.ok, false);
    });

    await t.test('production pipeline pause resume and retry endpoints', async () => {
      const runId = 'api_pipeline_recovery_run';
      const baseUrl = `http://127.0.0.1:${port}`;
      const {
        initRuntimeState,
        readRuntimeState,
        updateRuntimeState
      } = require('../skills/pipeline-flow/runtime/store');
      const pipelineDataDir = path.join(process.cwd(), 'data', 'pipeline');
      const runDir = path.join(pipelineDataDir, 'runs', runId);
      fs.rmSync(runDir, { recursive: true, force: true });
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({
        runId,
        status: 'mined',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        counts: {},
        files: {}
      }, null, 2), 'utf8');
      initRuntimeState({
        dataDir: pipelineDataDir,
        runId,
        mode: 'daily',
        params: { mine: 11, verify: 7, generate: 3, productsPerKeyword: 2 },
        steps: ['mine', 'verify', 'generate', 'export', 'review']
      });
      updateRuntimeState({
        dataDir: pipelineDataDir,
        runId,
        patch: {
          activeStep: 'verify'
        }
      });
      const originalRunner = app.locals.pipelineRuntimeRunner;
      const runnerCalls = [];
      app.locals.pipelineRuntimeRunner = async (options) => {
        runnerCalls.push(options);
        updateRuntimeState({
          dataDir: pipelineDataDir,
          runId: options.runId,
          patch: {
            status: 'completed',
            activeStep: options.retryStep || options.resumeFromStep || 'mine'
          }
        });
        return { runId: options.runId, status: 'completed', runtimeStatus: 'completed' };
      };

      try {
        const pauseRes = await fetch(`${baseUrl}/api/pipeline/runs/${runId}/pause`, { method: 'POST' });
        const pausePayload = await pauseRes.json();
        assert.strictEqual(pauseRes.status, 200);
        assert.strictEqual(pausePayload.ok, true);
        assert.strictEqual(pausePayload.data.control.requestedAction, 'pause');

        const retryRes = await fetch(`${baseUrl}/api/pipeline/runs/${runId}/verify/retry`, { method: 'POST' });
        const retryPayload = await retryRes.json();
        assert.strictEqual(retryRes.status, 200);
        assert.strictEqual(retryPayload.ok, true);
        assert.strictEqual(retryPayload.data.control.requestedAction, 'retry-step');
        assert.strictEqual(retryPayload.data.control.step, 'verify');

        await new Promise((resolve) => setImmediate(resolve));

        const resumeRes = await fetch(`${baseUrl}/api/pipeline/runs/${runId}/resume`, { method: 'POST' });
        const resumePayload = await resumeRes.json();
        assert.strictEqual(resumeRes.status, 200);
        assert.strictEqual(resumePayload.ok, true);
        assert.strictEqual(resumePayload.data.control.requestedAction, 'resume');

        const runtime = readRuntimeState({ dataDir: pipelineDataDir, runId });
        assert.ok(runtime);
        assert.strictEqual(runnerCalls.length, 2);
        assert.strictEqual(runnerCalls[0].retryStep, 'verify');
        assert.deepStrictEqual(runnerCalls[0].params, { mine: 11, verify: 7, generate: 3, productsPerKeyword: 2 });
        assert.strictEqual(runnerCalls[1].resumeFromStep, 'verify');
        assert.deepStrictEqual(runnerCalls[1].params, { mine: 11, verify: 7, generate: 3, productsPerKeyword: 2 });
      } finally {
        app.locals.pipelineRuntimeRunner = originalRunner;
        fs.rmSync(runDir, { recursive: true, force: true });
      }
    });

    await t.test('workflow endpoints proxy production runtime pause resume and retry', async () => {
      const runId = 'api_workflow_runtime_proxy_run';
      const baseUrl = `http://127.0.0.1:${port}`;
      const {
        initRuntimeState,
        readRuntimeState,
        updateRuntimeState
      } = require('../skills/pipeline-flow/runtime/store');
      const pipelineDataDir = path.join(process.cwd(), 'data', 'pipeline');
      const runDir = path.join(pipelineDataDir, 'runs', runId);
      fs.rmSync(runDir, { recursive: true, force: true });
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({
        runId,
        status: 'mined',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        counts: {},
        files: {}
      }, null, 2), 'utf8');
      initRuntimeState({
        dataDir: pipelineDataDir,
        runId,
        mode: 'daily',
        params: { mine: 13, verify: 8, generate: 5, productsPerKeyword: 3 },
        steps: ['mine', 'verify', 'generate', 'export', 'review']
      });
      updateRuntimeState({
        dataDir: pipelineDataDir,
        runId,
        patch: {
          activeStep: 'generate'
        }
      });
      const originalRunner = app.locals.pipelineRuntimeRunner;
      const runnerCalls = [];
      app.locals.pipelineRuntimeRunner = async (options) => {
        runnerCalls.push(options);
        updateRuntimeState({
          dataDir: pipelineDataDir,
          runId: options.runId,
          patch: {
            status: 'completed',
            activeStep: options.retryStep || options.resumeFromStep || 'mine'
          }
        });
        return { runId: options.runId, status: 'completed', runtimeStatus: 'completed' };
      };

      try {
        const pauseRes = await fetch(`${baseUrl}/api/workflows/runs/${runId}/pause`, { method: 'POST' });
        const pausePayload = await pauseRes.json();
        assert.strictEqual(pauseRes.status, 200);
        assert.strictEqual(pausePayload.ok, true);
        assert.strictEqual(pausePayload.data.control.requestedAction, 'pause');

        const retryRes = await fetch(`${baseUrl}/api/workflows/runs/${runId}/retry-node`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodeId: 'generate' })
        });
        const retryPayload = await retryRes.json();
        assert.strictEqual(retryRes.status, 200);
        assert.strictEqual(retryPayload.ok, true);
        assert.strictEqual(retryPayload.data.control.requestedAction, 'retry-step');
        assert.strictEqual(retryPayload.data.control.step, 'generate');

        await new Promise((resolve) => setImmediate(resolve));

        updateRuntimeState({
          dataDir: pipelineDataDir,
          runId,
          patch: {
            activeStep: 'verify'
          }
        });
        const resumeRes = await fetch(`${baseUrl}/api/workflows/runs/${runId}/resume`, { method: 'POST' });
        const resumePayload = await resumeRes.json();
        assert.strictEqual(resumeRes.status, 200);
        assert.strictEqual(resumePayload.ok, true);
        assert.strictEqual(resumePayload.data.control.requestedAction, 'resume');

        const unsupportedRes = await fetch(`${baseUrl}/api/workflows/runs/${runId}/retry-node`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodeId: 'review' })
        });
        assert.strictEqual(unsupportedRes.status, 400);

        const runtime = readRuntimeState({ dataDir: pipelineDataDir, runId });
        assert.ok(runtime);
        assert.strictEqual(runnerCalls.length, 2);
        assert.strictEqual(runnerCalls[0].retryStep, 'generate');
        assert.deepStrictEqual(runnerCalls[0].params, { mine: 13, verify: 8, generate: 5, productsPerKeyword: 3 });
        assert.strictEqual(runnerCalls[1].resumeFromStep, 'verify');
        assert.deepStrictEqual(runnerCalls[1].params, { mine: 13, verify: 8, generate: 5, productsPerKeyword: 3 });
      } finally {
        app.locals.pipelineRuntimeRunner = originalRunner;
        fs.rmSync(runDir, { recursive: true, force: true });
      }
    });

    await t.test('POST /api/workflows/sycm/chrome/start launches Chrome through injectable launcher', async () => {
      const originalLauncher = app.locals.sycmChromeLauncher;
      const originalPageOpener = app.locals.sycmChromePageOpener;
      const originalStatusReader = app.locals.sycmAccessStatusReader;
      const originalBlockerClearer = app.locals.sycmAccessBlockerClearer;
      const calls = [];
      const opened = [];
      const cleared = [];
      app.locals.sycmChromeLauncher = async (port, options) => {
        calls.push({ port, options });
        return { success: true, message: 'Chrome 已启动并就绪' };
      };
      app.locals.sycmChromePageOpener = async (port, url) => {
        opened.push({ port, url });
        return { success: true, url };
      };
      app.locals.sycmAccessStatusReader = () => ({
        breaker: { open: true, reason: 'No Chrome tab found on port 9222' }
      });
      app.locals.sycmAccessBlockerClearer = (platform) => {
        cleared.push(platform);
        return { available: true, breaker: { open: false } };
      };

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/workflows/sycm/chrome/start`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ port: 9333, runId: 'run_api_sycm', nodeId: 'verify' })
        });
        const payload = await res.json();

        assert.strictEqual(res.status, 200);
        assert.strictEqual(payload.ok, true);
        assert.strictEqual(payload.status, 'ready');
        assert.strictEqual(payload.port, 9333);
        assert.match(payload.userMessage, /已打开生意参谋页面/);
        assert.deepStrictEqual(calls, [{
          port: 9333,
          options: { userDataDir: undefined }
        }]);
        assert.deepStrictEqual(opened, [{
          port: 9333,
          url: 'https://sycm.taobao.com/mc/free/search_analysis'
        }]);
        assert.deepStrictEqual(cleared, ['sycm']);
      } finally {
        app.locals.sycmChromeLauncher = originalLauncher;
        app.locals.sycmChromePageOpener = originalPageOpener;
        app.locals.sycmAccessStatusReader = originalStatusReader;
        app.locals.sycmAccessBlockerClearer = originalBlockerClearer;
      }
    });

    await t.test('DELETE /api/workflows/runs/:runId removes persisted pipeline history', async () => {
      const runId = 'api_delete_history_run';
      const pipelineDataDir = path.join(process.cwd(), 'data', 'pipeline');
      const runDir = path.join(pipelineDataDir, 'runs', runId);
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({
        runId,
        status: 'mined',
        startedAt: '2026-06-29T04:00:00.000Z',
        updatedAt: '2026-06-29T04:10:00.000Z',
        counts: { candidates: 1 },
        files: { candidates: path.join(runDir, 'candidates.jsonl') }
      }), 'utf8');
      fs.writeFileSync(path.join(runDir, 'candidates.jsonl'), '{"keyword":"项链"}\n', 'utf8');
      fs.writeFileSync(path.join(pipelineDataDir, 'latest.json'), JSON.stringify({ runId, runDir }), 'utf8');

      const res = await fetch(`http://127.0.0.1:${port}/api/workflows/runs/${runId}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: true })
      });
      const payload = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(payload.ok, true);
      assert.strictEqual(payload.data.runId, runId);
      assert.strictEqual(fs.existsSync(runDir), false);
      assert.strictEqual(fs.existsSync(path.join(pipelineDataDir, 'latest.json')), false);
    });

  } finally {
    await new Promise((resolve) => server.close(resolve));
    // clean up temporary files in directory
    try {
      fs.rmSync(workflowDataDir, { recursive: true, force: true });
    } catch (_) {}
  }
});
