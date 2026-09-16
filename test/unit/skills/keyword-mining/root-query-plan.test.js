const test = require('node:test');
const assert = require('node:assert/strict');
const { rootQueryVariants, buildRootQueryPlan } = require('../../../../skills/keyword-mining/src/root-query-plan');
const { clusterBySignature } = require('../../../../skills/keyword-mining/src/pipeline');

test('attribute roots keep the full query and produce meaningful product queries', () => {
  const root = { rootKeyword: '硅藻土浴室吸水脚垫', queryCore: '脚垫', queryAttributes: {
    material: ['硅藻土'], scene: ['浴室'], function: ['吸水'], audience: ['儿童']
  } };
  assert.deepEqual(rootQueryVariants(root).map(row => row.keyword), ['硅藻土浴室吸水脚垫', '硅藻土脚垫', '浴室脚垫', '吸水脚垫']);
  const tasks = buildRootQueryPlan([root, root]);
  assert.equal(tasks.length, 8);
  assert.deepEqual(tasks.slice(0, 2).map(row => row.queryMode), ['hot', 'blue']);
  assert.equal(tasks[0].querySources.length, 2);
});

test('unreliable decomposition preserves only the original', () => {
  assert.equal(rootQueryVariants({ rootKeyword: '一次性餐桌布', queryCore: '桌', queryAttributes: { scene: ['餐'] } }).length, 1);
});

test('same keyword keeps both mode observations without mixing metrics', () => {
  const rows = ['hot', 'blue'].map(mode => ({ keyword: '吸水脚垫', localScore: 50, sycmEvidence: { mode, raw: { searchPopularity: mode === 'hot' ? 200 : 100 } } }));
  const result = clusterBySignature(rows);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].sycmEvidenceRows.map(row => row.raw.searchPopularity), [200, 100]);
});
