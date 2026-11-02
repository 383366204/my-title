'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const workflowDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-observability-test-'));
process.env.ECOM_WORKFLOW_DATA_DIR = workflowDataDir;
process.env.ECOM_PLATFORM_GUARD_DIR = path.join(workflowDataDir, 'platform-access');

const { createRun, getRun } = require('../../core/workflow/run-store');
const { resumeWorkflow, startWorkflow } = require('../../core/workflow/scheduler');
const { normalizeNodeStatus, normalizePlatformError } = require('../../core/workflow/state-helper');
const { registerNode } = require('../../core/workflow/registry');

const { PlatformAccessError, reportPlatformBlocker } = require('../../core/platform-access-guard');

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

test('Workflow Observability - Scheduler Platform Blocker Mapping & Failed Node Fields is retired per ADR v1.0', async () => {
  const mockWorkflow = {
    nodes: [
      { id: 'node_block', type: 'input', data: { label: '输入' } }
    ],
    edges: []
  };

  const run = createRun(mockWorkflow);
  await assert.rejects(async () => startWorkflow(run.runId), {
    code: 'SCHEDULER_RETIRED'
  });
});

test('Workflow Recovery - resume keeps manual node blocked is retired per ADR v1.0', async () => {
  const run = createRun({
    nodes: [{ id: 'manual', type: 'input', data: {} }],
    edges: []
  });

  await assert.rejects(async () => resumeWorkflow(run.runId), {
    code: 'SCHEDULER_RETIRED'
  });
});
