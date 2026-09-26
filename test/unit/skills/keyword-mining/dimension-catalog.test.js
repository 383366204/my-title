const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectDimensionInspirations, DEFAULT_DIMENSIONS } = require('../../../../skills/keyword-mining/src/dimension-catalog');
const { discoverInspirationRoots } = require('../../../../skills/keyword-mining/src/inspiration-engine');

test('free-form direction replaces preset dimensions and reaches AI intact', async () => {
  const direction = '面向租房青年，寻找厨房收纳用品；排除电器和大件家具';
  const customInputs = { direction: [direction], hobby: ['钓鱼'] };
  const rows = collectDimensionInspirations({ customInputs });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rawSourceText, direction);
  let received;
  const result = await discoverInspirationRoots({ customInputs, rootLimit: 8,
    llmClient: { productizeInspirations: async options => { received = options; return { roots: [] }; } },
    fetcher: () => { throw new Error('directed discovery must not fetch unrelated feeds'); }
  });
  assert.equal(received.inspirations.length, 1);
  assert.equal(received.inspirations[0].rawSourceText, direction);
  assert.equal(received.maxRootsPerInspiration, 8);
  assert.equal(result.stats.productizer.fallbackGenerated, 0);
  assert.equal(collectDimensionInspirations({ customInputs: { direction: ['  '] } }).length, 20);
});

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
