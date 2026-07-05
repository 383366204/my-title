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

  } finally {
    await new Promise((resolve) => server.close(resolve));
    // clean up temporary files in directory
    try {
      fs.rmSync(workflowDataDir, { recursive: true, force: true });
    } catch (_) {}
  }
});
