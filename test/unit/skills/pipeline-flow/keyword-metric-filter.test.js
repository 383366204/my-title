const { test } = require('node:test');
const assert = require('node:assert/strict');
const { filterKeywordMetrics } = require('../../../../skills/pipeline-flow/src/keyword-metric-filter');
const { normalizeSycmMetrics } = require('../../../../skills/sycm-research/src/metric-parser');
const { scoreRootReviewCandidate } = require('../../../../skills/pipeline-flow/src/root-opportunity-review');
const valid = { demandSupplyRatio: 1.1, searchPopularity: 51, conversionRate: '1.1%', tmallClickShare: '49%' };
const { normalizeKeywordFilter } = require('../../../../skills/pipeline-flow/src/keyword-metric-filter');
const { keywordFilterCollectionStatus, keywordFilterConditions } = require('../../../../skills/pipeline-flow/src/keyword-metric-filter');

test('recollection compares confirmed platform minima, not local Tmall rules', () => {
  const config = normalizeKeywordFilter();
  const evidence = [{ sycmEvidence: { filterApplied: true, filterConditions: keywordFilterConditions(config) } }];
  assert.equal(keywordFilterCollectionStatus(evidence, config).requiresRecollection, false);
  config.tmallClickShare.value = 99;
  config.searchPopularity.value = 100;
  assert.equal(keywordFilterCollectionStatus(evidence, config).requiresRecollection, false);
  config.searchPopularity.enabled = false;
  assert.equal(keywordFilterCollectionStatus(evidence, config).requiresRecollection, true);
  assert.equal(keywordFilterCollectionStatus([{ sycmEvidence: { filterConditions: keywordFilterConditions() } }], config).collectionEvidenceUnknown, true);
  assert.equal(keywordFilterConditions(config).searchPopularity, 0);
  assert.equal(keywordFilterConditions(config).conversionRate, 1);
  const hot = [{ sycmEvidence: { mode: 'hot', filterApplied: false,
    filterConditions: { demandSupplyRatio: 0, searchPopularity: 0, conversionRate: 0, buyerCount: 0, referencePrice: 0 } } }];
  assert.equal(keywordFilterCollectionStatus(hot, config).requiresRecollection, false);
});

test('configuration validates percent units, disabling and failure precedence', () => {
  const config = normalizeKeywordFilter();
  config.conversionRate.value = 2;
  assert.equal(filterKeywordMetrics(valid, config).status, 'failed');
  config.conversionRate.enabled = false;
  assert.equal(filterKeywordMetrics(valid, config).checks.find(check => check.key === 'conversionRate').reason, '未启用');
  assert.equal(filterKeywordMetrics({ ...valid, conversionRate: undefined }, config).status, 'passed');
  assert.equal(filterKeywordMetrics({ searchPopularity: 1 }, config).status, 'failed');
  assert.equal(filterKeywordMetrics({}, config).status, 'review');
  for (const setting of Object.values(config)) setting.enabled = false;
  assert.equal(filterKeywordMetrics({}, config).status, 'passed');
  for (const value of [-1, 101, NaN, Infinity, '1', null]) {
    assert.throws(() => normalizeKeywordFilter({ ...config, conversionRate: { enabled: true, value } }));
  }
  assert.throws(() => normalizeKeywordFilter({}));
  assert.throws(() => normalizeKeywordFilter(null));
  assert.equal(normalizeKeywordFilter().conversionRate.enabled, true);
});

test('all four strict conditions must pass, including normalized percent values', () => {
  assert.equal(filterKeywordMetrics(valid).passed, true);
  assert.equal(filterKeywordMetrics(normalizeSycmMetrics(valid)).passed, true);
  for (const [key, value] of Object.entries({ demandSupplyRatio: 1, searchPopularity: 50, conversionRate: '1%', tmallClickShare: '50%' })) {
    const result = filterKeywordMetrics({ ...valid, [key]: value });
    assert.equal(result.passed, false, key);
    assert.equal(result.checks.find(check => check.key === key).status, 'failed');
  }
});

test('missing shares and uncertain ranges are never treated as passing zero', () => {
  for (const value of [undefined, '--', '40%~60%']) {
    const result = filterKeywordMetrics({ ...valid, tmallClickShare: value });
    assert.equal(result.passed, false);
    assert.equal(result.checks.find(check => check.key === 'tmallClickShare').status, 'review');
  }
  assert.equal(filterKeywordMetrics({ ...valid, tmallClickShare: '20%~49%' }).passed, true);
  assert.equal(filterKeywordMetrics({ ...valid, searchPopularity: '40~60' }).passed, false);
});

test('keyword confirmation ignores old scores and applies the same rules to hot and blue', () => {
  for (const mode of ['hot', 'blue']) {
    const row = scoreRootReviewCandidate({ keyword: '杯垫', localScore: 0, opportunityScore: 0, sycmEvidence: { mode }, sycmData: valid });
    assert.equal(row.reviewRecommended, true);
    assert.equal(row.opportunityScore, undefined);
    assert.equal(row.keywordOpportunity.score, undefined);
    assert.equal(row.sycmScore.score, undefined);
    assert.equal(scoreRootReviewCandidate({ keyword: '杯垫', localScore: 100, sycmData: { ...valid, tmallClickShare: '90%' } }).reviewRecommended, false);
  }
});
