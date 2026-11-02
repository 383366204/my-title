'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const workflowDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-test-'));
process.env.ECOM_WORKFLOW_DATA_DIR = workflowDataDir;

const { createRun, getRun, updateRun, listRuns } = require('../../core/workflow/run-store');
const { getNodeDefinition, listNodeTypes } = require('../../core/workflow/registry');
const { startWorkflow, cancelWorkflow } = require('../../core/workflow/scheduler');
const { subscribeRun } = require('../../core/workflow/events');
const { validateWorkflow } = require('../../core/workflow/validator');

test('Workflow Registry - should contain standard nodes', (t) => {
  const nodeTypes = listNodeTypes();
  const types = nodeTypes.map(n => n.type);

  assert.ok(types.includes('keyword-input'));
  assert.ok(types.includes('input'));
  assert.ok(types.includes('keyword-mining'));
  assert.ok(types.includes('title-generator'));

  const inputDef = getNodeDefinition('input');
  assert.ok(inputDef);
  assert.strictEqual(typeof inputDef.execute, 'function');
});

test('Workflow Run Store - should create, read and update runs', (t) => {
  const mockWorkflow = {
    nodes: [
      { id: '1', type: 'input', data: { keyword: '测试项链', label: '输入' } }
    ],
    edges: []
  };

  const run = createRun(mockWorkflow);
  assert.ok(run.runId);
  assert.strictEqual(run.status, 'pending');
  assert.strictEqual(run.nodeStates['1'].status, 'idle');

  // Verify retrieval
  const retrieved = getRun(run.runId);
  assert.ok(retrieved);
  assert.strictEqual(retrieved.runId, run.runId);

  // Verify update
  updateRun(run.runId, { status: 'running' });
  const updated = getRun(run.runId);
  assert.strictEqual(updated.status, 'running');

  // Verify list
  const runs = listRuns();
  assert.ok(runs.length > 0);
  assert.ok(runs.some(r => r.runId === run.runId));

  // Clean up
  const runFile = path.join(workflowDataDir, `${run.runId}.json`);
  const logFile = path.join(workflowDataDir, `${run.runId}.log`);
  if (fs.existsSync(runFile)) fs.unlinkSync(runFile);
  if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
});

test('Workflow Scheduler - legacy DAG execution is retired per ADR v1.0', async () => {
  const demoWorkflow = {
    nodes: [
      { id: 'node_1', type: 'keyword-input', data: { keyword: '纯银耳环', maxLength: 60, label: '输入节点' } }
    ],
    edges: []
  };

  const run = createRun(demoWorkflow);
  await assert.rejects(async () => startWorkflow(run.runId), {
    code: 'SCHEDULER_RETIRED'
  });
});

test('Workflow Run Store - rejects unsafe run ids', () => {
  assert.throws(() => getRun('../outside'), /Invalid workflow run id/);
});

test('Workflow Validator - accepts the standard demo chain', () => {
  const result = validateWorkflow({
    nodes: [
      { id: 'node_1', type: 'keyword-input', data: { keyword: '纯银耳环', maxLength: 60 } },
      { id: 'node_2', type: 'keyword-mining', data: { count: 3 } },
      { id: 'node_3', type: 'title-generator', data: {} }
    ],
    edges: [
      { id: 'e1', source: 'node_1', target: 'node_2' },
      { id: 'e2', source: 'node_2', target: 'node_3' }
    ]
  });

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.errors, []);
});

test('Workflow Validator - rejects cycles and unknown node types', () => {
  const result = validateWorkflow({
    nodes: [
      { id: 'node_1', type: 'keyword-input', data: { keyword: '纯银耳环' } },
      { id: 'node_2', type: 'unknown-node', data: {} }
    ],
    edges: [
      { id: 'e1', source: 'node_1', target: 'node_2' },
      { id: 'e2', source: 'node_2', target: 'node_1' }
    ]
  });

  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some(error => error.code === 'unknown_node_type' && error.nodeId === 'node_2'));
  assert.ok(result.errors.some(error => error.code === 'cycle_detected'));
});

test('Workflow Validator - rejects missing required params and isolated processor nodes', () => {
  const result = validateWorkflow({
    nodes: [
      { id: 'input_1', type: 'keyword-input', data: { keyword: '' } },
      { id: 'mine_1', type: 'keyword-mining', data: { count: 3 } },
      { id: 'title_1', type: 'title-generator', data: {} }
    ],
    edges: [
      { id: 'e1', source: 'input_1', target: 'mine_1' }
    ]
  });

  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some(error => error.code === 'missing_required_param' && error.nodeId === 'input_1'));
  assert.ok(result.errors.some(error => error.code === 'isolated_node' && error.nodeId === 'title_1'));
});

test('Workflow Run Store - can pause and reset a failed node for retry', () => {
  const workflow = {
    nodes: [
      { id: 'start', type: 'keyword-input', data: { keyword: '银耳环' } },
      { id: 'mine', type: 'keyword-mining', data: { count: 2 } },
      { id: 'title', type: 'title-generator', data: {} }
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'mine' },
      { id: 'e2', source: 'mine', target: 'title' }
    ]
  };

  const run = createRun(workflow);
  updateRun(run.runId, {
    status: 'failed',
    nodeStates: {
      ...run.nodeStates,
      start: {
        ...run.nodeStates.start,
        status: 'completed',
        output: { keyword: '银耳环' }
      },
      mine: {
        ...run.nodeStates.mine,
        status: 'retryable',
        output: { keywords: ['银耳环女'] },
        error: 'temporary network error',
        blocker: 'network_transient_failure',
        actionHint: '可以重试',
        progress: { status: 'retryable', current: 0, total: 0, percent: 100, message: '等待重试' }
      },
      title: {
        ...run.nodeStates.title,
        status: 'completed',
        output: { titles: ['旧标题'] }
      }
    }
  });

  const { markRunPaused, resetRunNodeForRetry } = require('../../core/workflow/run-store');
  updateRun(run.runId, {
    nodeStates: {
      ...getRun(run.runId).nodeStates,
      mine: {
        ...getRun(run.runId).nodeStates.mine,
        status: 'running',
        progress: { status: 'running', current: 0, total: 0, percent: 25, message: '执行中' }
      }
    }
  });
  const paused = markRunPaused(run.runId);
  assert.strictEqual(paused.status, 'paused');
  assert.strictEqual(paused.nodeStates.mine.status, 'paused');
  assert.deepStrictEqual(paused.nodeStates.mine.progress, {
    status: 'paused',
    current: 0,
    total: 0,
    percent: 25,
    message: '执行中'
  });

  const reset = resetRunNodeForRetry(run.runId, 'mine');
  assert.strictEqual(reset.status, 'pending');
  assert.strictEqual(reset.nodeStates.start.status, 'completed');
  assert.strictEqual(reset.nodeStates.mine.status, 'idle');
  assert.strictEqual(reset.nodeStates.mine.output, null);
  assert.strictEqual(reset.nodeStates.mine.error, null);
  assert.strictEqual(reset.nodeStates.mine.blocker, null);
  assert.strictEqual(reset.nodeStates.title.status, 'idle');
  assert.strictEqual(reset.nodeStates.title.output, null);
  assert.deepStrictEqual(reset.nodeStates.mine.progress, {
    status: 'idle',
    current: 0,
    total: 0,
    percent: 0,
    message: ''
  });

  const runFile = path.join(workflowDataDir, `${run.runId}.json`);
  const logFile = path.join(workflowDataDir, `${run.runId}.log`);
  if (fs.existsSync(runFile)) fs.unlinkSync(runFile);
  if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
});

test('Workflow Scheduler - legacy retry is retired per ADR v1.0', async () => {
  const { retryWorkflowNode } = require('../../core/workflow/scheduler');
  const workflow = {
    nodes: [
      { id: 'start', type: 'keyword-input', data: { keyword: '珍珠耳环' } }
    ],
    edges: []
  };

  const run = createRun(workflow);
  await assert.rejects(async () => retryWorkflowNode(run.runId, 'start'), {
    code: 'SCHEDULER_RETIRED'
  });
});
