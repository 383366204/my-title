const { test } = require('node:test');
const assert = require('node:assert/strict');
const { researchPolicy } = require('../../../../skills/keyword-mining/src/research-policy');
const { fetchSycmWithFallback } = require('../../../../skills/pipeline-flow/src/sycm-verifier');
const { sanitizeWorkflowParams, buildPipelineCliArgs } = require('../../../../core/workflow/pipeline-params');

test('daily discovery page count is configurable and reaches CLI', () => {
  const params = sanitizeWorkflowParams('daily', { inspirationSycmPages: 7, candidateScreening: 'explore' });
  assert.equal(params.inspirationSycmPages, 7);
  assert.equal(params.candidateScreening, 'explore');
  const args = buildPipelineCliArgs('daily', params);
  assert.equal(args[args.indexOf('--inspiration-sycm-pages') + 1], '7');
  assert.equal(sanitizeWorkflowParams('daily', {}).inspirationSycmPages, 3);
  assert.equal(sanitizeWorkflowParams('daily', { inspirationSycmPages: 99 }).inspirationSycmPages, 10);
});

test('balanced retains lower demand candidates without labeling them high confidence', async () => {
  const policy = researchPolicy('balanced');
  assert.equal(policy.minSearchPopularity, 20);
  const calls = [];
  const result = await fetchSycmWithFallback('茶托', { verificationMode: policy.verificationMode, pages: 3,
    sycmExtractor: async (keyword, options) => {
      calls.push(options);
      return { data: [{ keyword, demandSupplyRatio: 0.6, searchPopularity: 30, clickRate: 10 }] };
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].maxPages, 3);
  assert.equal(result.sycmScore.passed, true);
  assert.equal(result.sycmScore.confidence, 'medium');
});

test('relaxed fallback does not query the same tier twice', async () => {
  const calls = [];
  await fetchSycmWithFallback('茶托', { verificationMode: 'blue_relaxed', sycmExtractor: async (keyword, options) => { calls.push(options.mode); return { data: [] }; } });
  assert.deepEqual(calls, ['blue', 'hot']);
});
