'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { summaryInterventionForNode } = require('../../../core/workflow/pipeline-node-diagnostics');

test('legacy 502 selection records expose query failure rather than score rejection', () => {
  const action = summaryInterventionForNode({ status: 'select_failed', counts: { productsEvaluated: 0 },
    previews: { selectedProducts: [{ status: 'select_failed', error: 'Request failed with status code 502' }] }
  }, 'select');
  assert.equal(action.blocker, 'product_search_failed');
  assert.match(action.actionHint, /502/);
  assert.equal(action.nextRecommendedAction.action, 'retry-node');
  assert.doesNotMatch(action.actionHint, /评分|生意参谋/);
});
