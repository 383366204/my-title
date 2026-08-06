import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getWorkflowCommandAction,
  getWorkflowActionRoute,
  WORKFLOW_ACTION_KINDS,
  WORKFLOW_OVERLAYS
} from './workflow-action-registry.js';

test('workflow action registry routes workbenches to canvas overlays', () => {
  assert.deepEqual(getWorkflowActionRoute('manual-input'), {
    kind: WORKFLOW_ACTION_KINDS.OVERLAY,
    overlay: WORKFLOW_OVERLAYS.START_CONFIG
  });
  assert.deepEqual(getWorkflowActionRoute('product-review'), {
    kind: WORKFLOW_ACTION_KINDS.OVERLAY,
    overlay: WORKFLOW_OVERLAYS.PRODUCT_SELECT
  });
  assert.deepEqual(getWorkflowActionRoute('confirm-distribution'), {
    kind: WORKFLOW_ACTION_KINDS.OVERLAY,
    overlay: WORKFLOW_OVERLAYS.DISTRIBUTION
  });
});

test('workflow action registry keeps immediate operations as commands', () => {
  for (const action of ['pause', 'resume', 'resume-after-manual', 'continue-or-fix-sycm', 'mine-more', 'retry-node', 'start-sycm-chrome', 'pause-distribution']) {
    assert.deepEqual(getWorkflowActionRoute(action), { kind: WORKFLOW_ACTION_KINDS.COMMAND });
  }
  assert.equal(getWorkflowCommandAction('resume-after-manual'), 'resume');
  assert.equal(getWorkflowCommandAction('continue-or-fix-sycm'), 'resume');
  assert.equal(getWorkflowCommandAction('mine-more'), 'mine-more');
});

test('workflow action registry safely falls back to node selection', () => {
  assert.deepEqual(getWorkflowActionRoute('unknown-action'), { kind: WORKFLOW_ACTION_KINDS.SELECT });
});
