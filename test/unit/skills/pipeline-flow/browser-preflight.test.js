'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareSelectionBrowser } = require('../../../../skills/pipeline-flow/runtime/browser-preflight');
const { runPipelineRuntime } = require('../../../../skills/pipeline-flow/runtime/runner');
const { readRuntimeState } = require('../../../../skills/pipeline-flow/runtime/store');
const { createRuntimeView } = require('../../../../core/server/runtime-view');

const info = { Browser: 'Chrome', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/test' };

test('available CDP reuses Chrome without launching it', async () => {
  const result = await prepareSelectionBrowser({}, {
    getInfo: async () => info,
    launch: async () => assert.fail('must reuse existing browser')
  });
  assert.equal(result.status, 'browser_ready');
});

test('unavailable CDP launches with configured profile and verifies readiness', async () => {
  let checks = 0;
  const result = await prepareSelectionBrowser({ port: 9333, chromeProfileDir: '/test/profile' }, {
    getInfo: async (port) => { assert.equal(port, 9333); return ++checks === 1 ? {} : info; },
    launch: async (port, options) => {
      assert.equal(port, 9333);
      assert.equal(options.userDataDir, '/test/profile');
      return { success: true };
    }
  });
  assert.equal(checks, 2);
  assert.equal(result.status, 'browser_ready');
});

test('launch failure and false readiness remain actionable blockers', async () => {
  for (const launch of [async () => ({ success: false, message: '未安装 Chrome' }), async () => ({ success: true }), async () => { throw new Error('启动异常'); }]) {
    const result = await prepareSelectionBrowser({}, { getInfo: async () => ({}), launch });
    assert.equal(result.status, 'manual_action_required');
    assert.equal(result.stepIncomplete, true);
    assert.equal(result.nextRecommendedAction.action, 'retry-node');
  }
});

for (const mode of ['daily', 'keyword', 'root-keyword']) {
  test(`${mode} blocks at start before business steps and can retry preparation`, async (t) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-preflight-'));
    t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
    let businessCalls = 0;
    const options = {
      dataDir, runId: 'browser_test', mode, steps: ['mine'],
      stepFns: { mine: async () => { businessCalls++; return { status: 'completed' }; } },
      prepareBrowser: () => prepareSelectionBrowser({}, {
        getInfo: async () => ({}), launch: async () => ({ success: false, message: '启动失败' })
      })
    };
    const blocked = await runPipelineRuntime(options);
    assert.equal(blocked.runtimeStatus, 'blocked');
    assert.equal(businessCalls, 0);
    const state = readRuntimeState({ dataDir, runId: options.runId });
    assert.equal(state.activeStep, 'start');
    assert.equal(state.blocker, 'chrome_launch_failed');
    assert.equal(state.progress.start.status, 'blocked');
    const view = createRuntimeView({
      readRuntimeState: () => state,
      WORKFLOW_NODE_IDS: { start: 'start', mine: 'mine' }
    }).runtimeOnlyWorkflowSnapshot(options.runId);
    assert.equal(view.nodeStates.start.status, 'blocked');
    assert.equal(view.nodeStates.start.nextRecommendedAction.action, 'retry-node');
    assert.match(view.nodeStates.start.manualAction.userMessage, /启动失败/);
    const resumed = await runPipelineRuntime({ ...options, preserveRuntime: true, retryStep: 'start', prepareBrowser: async () => ({ status: 'browser_ready' }) });
    assert.equal(resumed.runtimeStatus, 'completed');
    assert.equal(businessCalls, 1);
  });
}
