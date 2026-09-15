const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectDimensionInspirations, DEFAULT_DIMENSIONS } = require('../../../../skills/keyword-mining/src/dimension-catalog');

test('dimensions rotate deterministically and preserve custom inputs', () => {
  const options = { date: '2026-09-11', runAttempt: 1 };
  const first = collectDimensionInspirations(options);
  assert.equal(first.length, DEFAULT_DIMENSIONS.length * 4);
  assert.deepEqual(collectDimensionInspirations(options), first);
  assert.notDeepEqual(collectDimensionInspirations({ ...options, runAttempt: 2 }), first);
  const selected = collectDimensionInspirations({ ...options, enabledDimensions: ['hobby'], customInputs: { hobby: ['雕刻工具整理', '雕刻工具整理'] } });
  assert.equal(selected.length, 5);
  assert.ok(selected.every(row => row.dimension === 'hobby'));
  assert.equal(selected[0].sourceType, 'user_input');
  assert.deepEqual(collectDimensionInspirations({ enabledDimensions: [] }), []);
});
