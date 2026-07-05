'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const workflowDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-observability-test-'));
process.env.ECOM_WORKFLOW_DATA_DIR = workflowDataDir;
process.env.ECOM_PLATFORM_GUARD_DIR = path.join(workflowDataDir, 'platform-access');

const {
  createRun,
  getRun,
  resumeWorkflow,
  startWorkflow,
  normalizeNodeStatus,
  normalizePlatformError,
  registerNode
} = require('../core/workflow');

const {
  PlatformAccessError,
  reportPlatformBlocker
} = require('../core/platform-access-guard');

test('Workflow Observability - Run Store Initialization Fields', (t) => {
  const mockWorkflow = {
    nodes: [
      { id: 'start', type: 'input', data: { keyword: '测试' } }
    ],
    edges: []
  };

  const run = createRun(mockWorkflow);
  assert.ok(run.runId);
  
  const nodeState = run.nodeStates['start'];
  assert.ok(nodeState);
  assert.strictEqual(nodeState.status, 'idle');
  assert.deepStrictEqual(nodeState.progress, {
    status: 'idle',
    current: 0,
    total: 0,
    percent: 0,
    message: ''
  });
  assert.strictEqual(nodeState.blocker, null);
  assert.strictEqual(nodeState.actionHint, null);
  assert.strictEqual(nodeState.platform, null);
  assert.strictEqual(nodeState.platformStatus, null);
  assert.strictEqual(nodeState.durationMs, null);
  assert.strictEqual(nodeState.outputSummary, null);

  // Clean up
  const runFile = path.join(workflowDataDir, `${run.runId}.json`);
  const logFile = path.join(workflowDataDir, `${run.runId}.log`);
  if (fs.existsSync(runFile)) fs.unlinkSync(runFile);
  if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
});

test('Workflow Observability - State Normalization Helper', (t) => {
  // 1. Normalizing status values
  assert.strictEqual(normalizeNodeStatus('idle'), 'idle');
  assert.strictEqual(normalizeNodeStatus('RUNNING'), 'running');
  assert.strictEqual(normalizeNodeStatus('completed'), 'completed');
  assert.strictEqual(normalizeNodeStatus('waiting_manual'), 'waiting_manual');
  assert.strictEqual(normalizeNodeStatus('invalid_state'), 'failed');

  // 2. Normalizing platform errors
  // Login required
  const errLogin = new PlatformAccessError('Need to login', { status: 'login_required', platform: 'taobao' });
  const normLogin = normalizePlatformError(errLogin);
  assert.strictEqual(normLogin.status, 'waiting_manual');
  assert.strictEqual(normLogin.blocker, 'login_required');
  assert.strictEqual(normLogin.platform, 'taobao');
  assert.match(normLogin.actionHint, /需要人工登录/);

  // Rate limit
  const errRate = { status: 'rate_limited', platform: '1688', cooldownRemainingMs: 30000 };
  const normRate = normalizePlatformError(errRate);
  assert.strictEqual(normRate.status, 'blocked');
  assert.strictEqual(normRate.blocker, 'platform_cooldown');
  assert.strictEqual(normRate.platform, '1688');
  assert.match(normRate.actionHint, /访问受限/);
  assert.strictEqual(normRate.cooldownRemainingMs, 30000);
});

test('Workflow Observability - Scheduler Platform Blocker Mapping & Failed Node Fields', async (t) => {
  // Register a node type that fails with a PlatformAccessError
  registerNode('test-platform-blocked-node', {
    execute: async (inputs, params, context) => {
      throw new PlatformAccessError('Slide required', {
        status: 'slider_required',
        platform: 'sycm'
      });
    }
  });

  const mockWorkflow = {
    nodes: [
      { id: 'node_block', type: 'test-platform-blocked-node', data: { label: '滑块节点' } }
    ],
    edges: []
  };

  const run = createRun(mockWorkflow);

  // Start executing the workflow and expect it to fail due to platform block
  try {
    await startWorkflow(run.runId);
  } catch (err) {
    // Expected exception
  }

  const finalRun = getRun(run.runId);
  assert.ok(finalRun);
  
  const blockedNodeState = finalRun.nodeStates['node_block'];
  assert.ok(blockedNodeState);
  assert.strictEqual(blockedNodeState.status, 'waiting_manual');
  assert.strictEqual(blockedNodeState.blocker, 'captcha_required');
  assert.match(blockedNodeState.actionHint, /完成 SYCM 的验证码/);
  assert.strictEqual(blockedNodeState.platform, 'sycm');
  assert.strictEqual(blockedNodeState.error, 'Slide required');
  assert.ok(blockedNodeState.durationMs >= 0);
  assert.strictEqual(blockedNodeState.progress.status, 'waiting_manual');
  assert.strictEqual(blockedNodeState.progress.percent, 100);

  // Clean up
  const runFile = path.join(workflowDataDir, `${run.runId}.json`);
  const logFile = path.join(workflowDataDir, `${run.runId}.log`);
  if (fs.existsSync(runFile)) fs.unlinkSync(runFile);
  if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
});

test('Workflow Recovery - resume keeps manual node blocked when platform is unavailable', async (t) => {
  registerNode('test-manual-platform-node', {
    execute: async () => {
      throw new PlatformAccessError('Need login again', {
        status: 'login_required',
        platform: 'taobao'
      });
    }
  });

  const run = createRun({
    nodes: [{ id: 'manual', type: 'test-manual-platform-node', data: {} }],
    edges: []
  });

  await startWorkflow(run.runId);
  const blocked = getRun(run.runId);
  assert.strictEqual(blocked.status, 'waiting_manual');
  assert.strictEqual(blocked.nodeStates.manual.status, 'waiting_manual');
  assert.strictEqual(blocked.nodeStates.manual.platform, 'taobao');
  assert.strictEqual(blocked.nodeStates.manual.platformStatus, 'login_required');

  reportPlatformBlocker('taobao', {
    status: 'login_required',
    userMessage: '请先重新登录淘宝账号',
    cooldownMs: 60_000
  });

  await resumeWorkflow(run.runId);
  const resumed = getRun(run.runId);
  assert.strictEqual(resumed.status, 'waiting_manual');
  assert.strictEqual(resumed.nodeStates.manual.status, 'waiting_manual');
  assert.strictEqual(resumed.nodeStates.manual.platform, 'taobao');
  assert.strictEqual(resumed.nodeStates.manual.platformStatus, 'login_required');
  assert.strictEqual(resumed.nodeStates.manual.blocker, 'login_required');
  assert.match(resumed.nodeStates.manual.actionHint, /重新登录淘宝/);
  assert.ok(resumed.nodeStates.manual.cooldownRemainingMs > 0);

  const runFile = path.join(workflowDataDir, `${run.runId}.json`);
  const logFile = path.join(workflowDataDir, `${run.runId}.log`);
  if (fs.existsSync(runFile)) fs.unlinkSync(runFile);
  if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
});
