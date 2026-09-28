import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_RUN_STATUSES,
  PAUSABLE_RUN_STATUSES,
  ATTENTION_NODE_STATUSES,
  BLOCKED_NODE_STATUSES,
  ACTIVE_NODE_STATUSES,
  TERMINAL_RUN_STATUSES
} from '../../../apps/web/src/features/workflow/workflow-statuses.js';

describe('workflow-statuses', () => {
  it('ACTIVE_RUN_STATUSES contains expected statuses', () => {
    assert.ok(ACTIVE_RUN_STATUSES.has('running'));
    assert.ok(ACTIVE_RUN_STATUSES.has('pending'));
    assert.ok(ACTIVE_RUN_STATUSES.has('awaiting_keyword_review'));
    assert.ok(ACTIVE_RUN_STATUSES.has('products_selected'));
    assert.ok(!ACTIVE_RUN_STATUSES.has('completed'));
    assert.ok(!ACTIVE_RUN_STATUSES.has('failed'));
  });

  it('PAUSABLE_RUN_STATUSES includes keywords_reviewed but not products_selected', () => {
    assert.ok(PAUSABLE_RUN_STATUSES.has('keywords_reviewed'));
    assert.ok(!PAUSABLE_RUN_STATUSES.has('products_selected'));
    assert.ok(!PAUSABLE_RUN_STATUSES.has('awaiting_product_review'));
  });

  it('ATTENTION_NODE_STATUSES covers warn-tone statuses', () => {
    assert.ok(ATTENTION_NODE_STATUSES.has('needs_review'));
    assert.ok(ATTENTION_NODE_STATUSES.has('waiting_confirmation'));
    assert.ok(ATTENTION_NODE_STATUSES.has('paused'));
    assert.ok(ATTENTION_NODE_STATUSES.has('retryable'));
    assert.ok(!ATTENTION_NODE_STATUSES.has('completed'));
  });

  it('BLOCKED_NODE_STATUSES is a subset used for blocker gate', () => {
    assert.ok(BLOCKED_NODE_STATUSES.has('blocked'));
    assert.ok(BLOCKED_NODE_STATUSES.has('failed'));
    assert.ok(BLOCKED_NODE_STATUSES.has('paused'));
    assert.ok(!BLOCKED_NODE_STATUSES.has('needs_review'));
  });

  it('ACTIVE_NODE_STATUSES covers running/resuming/retrying', () => {
    assert.equal(ACTIVE_NODE_STATUSES.size, 3);
    assert.ok(ACTIVE_NODE_STATUSES.has('running'));
    assert.ok(ACTIVE_NODE_STATUSES.has('resuming'));
    assert.ok(ACTIVE_NODE_STATUSES.has('retrying'));
  });

  it('TERMINAL_RUN_STATUSES covers end states', () => {
    assert.ok(TERMINAL_RUN_STATUSES.has('completed'));
    assert.ok(TERMINAL_RUN_STATUSES.has('failed'));
    assert.ok(TERMINAL_RUN_STATUSES.has('cancelled'));
    assert.ok(TERMINAL_RUN_STATUSES.has('workflow_complete'));
    assert.ok(!TERMINAL_RUN_STATUSES.has('running'));
  });

  it('sets are wrapped in Object.freeze for intent signaling', () => {
    // Object.freeze on a Set prevents reassignment of the variable but does
    // not prevent Set mutation (add/delete). This is a known JS limitation.
    // The freeze signals "do not modify" intent to developers and linters.
    assert.ok(Object.isFrozen(ACTIVE_RUN_STATUSES), 'set should be frozen');
    assert.ok(Object.isFrozen(PAUSABLE_RUN_STATUSES), 'set should be frozen');
  });
});
