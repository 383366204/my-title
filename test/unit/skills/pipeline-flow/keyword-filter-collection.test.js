'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchSycmWithFallback } = require('../../../../skills/pipeline-flow/src/sycm-verifier');
const { normalizeKeywordFilter } = require('../../../../skills/pipeline-flow/src/keyword-metric-filter');

test('custom filters do not repeat the same blue query during fallback', async () => {
  const calls = [];
  await fetchSycmWithFallback('杯垫', {
    keywordFilter: normalizeKeywordFilter(),
    sycmExtractor: async (_keyword, options) => { calls.push(options); return { data: [] }; }
  });
  assert.deepEqual(calls.map(options => options.mode), ['blue', 'hot']);
  assert.equal(calls[0].filterConditions.conversionRate, 1);
});
