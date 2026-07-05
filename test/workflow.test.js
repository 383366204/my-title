'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const workflowDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-test-'));
process.env.ECOM_WORKFLOW_DATA_DIR = workflowDataDir;

const {
  createRun,
  getRun,
  updateRun,
  listRuns,
  getNodeDefinition,
  listNodeTypes,
  startWorkflow,
  cancelWorkflow,
  subscribeRun,
  validateWorkflow
} = require('../core/workflow');

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

test('Workflow Scheduler - should run standard demo chain', async (t) => {
  const demoWorkflow = {
    nodes: [
      { id: 'node_1', type: 'keyword-input', data: { keyword: '纯银耳环', maxLength: 60, label: '输入节点' } },
      { id: 'node_2', type: 'keyword-mining', data: { count: 3, label: '挖掘节点' } },
      { id: 'node_3', type: 'title-generator', data: { label: '标题节点' } }
    ],
    edges: [
      { id: 'e1', source: 'node_1', target: 'node_2' },
      { id: 'e2', source: 'node_2', target: 'node_3' }
    ]
  };

  const run = createRun(demoWorkflow);

  const events = [];
  const unsubscribe = subscribeRun(run.runId, (evt) => {
    events.push(evt);
  });

  // Start executing
  await startWorkflow(run.runId);

  unsubscribe();

  const finalRun = getRun(run.runId);
  assert.strictEqual(finalRun.status, 'completed');
  assert.strictEqual(finalRun.nodeStates['node_1'].status, 'completed');
  assert.strictEqual(finalRun.nodeStates['node_2'].status, 'completed');
  assert.strictEqual(finalRun.nodeStates['node_3'].status, 'completed');

  // Check inputs/outputs pass through
  const node2Output = finalRun.nodeStates['node_2'].output;
  assert.ok(node2Output.keywords);
  assert.ok(Array.isArray(node2Output.keywords));

  const node3Output = finalRun.nodeStates['node_3'].output;
  assert.ok(node3Output.titles);
  assert.ok(Array.isArray(node3Output.titles));

  // Verify that events were dispatched
  assert.ok(events.length > 0);
  assert.ok(events.some(e => e.event === 'status_change'));
  assert.ok(events.some(e => e.event === 'node_change'));
  assert.ok(events.some(e => e.event === 'log'));

  // Clean up
  const runFile = path.join(workflowDataDir, `${run.runId}.json`);
  const logFile = path.join(workflowDataDir, `${run.runId}.log`);
  // Temporarily keep files if they fail, delete only if succeed
  if (fs.existsSync(runFile)) fs.unlinkSync(runFile);
  if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
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

  const { markRunPaused, resetRunNodeForRetry } = require('../core/workflow');
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

test('Workflow Scheduler - resumes from first non-completed node after retry reset', async () => {
  let failingCalls = 0;
  const { registerNode, retryWorkflowNode } = require('../core/workflow');
  registerNode('test-flaky-recovery-node', {
    execute: async (inputs) => {
      failingCalls += 1;
      if (failingCalls === 1) {
        const err = new Error('temporary timeout');
        err.status = 'transient_failure';
        err.retryable = true;
        throw err;
      }
      return { ...inputs, recovered: true };
    }
  });

  const workflow = {
    nodes: [
      { id: 'start', type: 'keyword-input', data: { keyword: '珍珠耳环' } },
      { id: 'flaky', type: 'test-flaky-recovery-node', data: { label: '临时失败节点' } },
      { id: 'title', type: 'title-generator', data: { label: '标题节点' } }
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'flaky' },
      { id: 'e2', source: 'flaky', target: 'title' }
    ]
  };

  const run = createRun(workflow);
  await startWorkflow(run.runId);

  let failed = getRun(run.runId);
  assert.strictEqual(failed.status, 'retryable');
  assert.strictEqual(failed.nodeStates.start.status, 'completed');
  assert.strictEqual(failed.nodeStates.flaky.status, 'retryable');

  await retryWorkflowNode(run.runId, 'flaky');

  const finalRun = getRun(run.runId);
  assert.strictEqual(finalRun.status, 'completed');
  assert.strictEqual(finalRun.nodeStates.start.status, 'completed');
  assert.strictEqual(finalRun.nodeStates.flaky.status, 'completed');
  assert.strictEqual(finalRun.nodeStates.title.status, 'completed');
  assert.strictEqual(failingCalls, 2);

  const runFile = path.join(workflowDataDir, `${run.runId}.json`);
  const logFile = path.join(workflowDataDir, `${run.runId}.log`);
  if (fs.existsSync(runFile)) fs.unlinkSync(runFile);
  if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
});
