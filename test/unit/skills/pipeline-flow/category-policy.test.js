'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCategoryEvidence, resolveFinalCategory } = require('../../../../skills/pipeline-flow/src/category-policy');
const { _recommendCategory } = require('../../../../skills/sycm-research/src/sycm-cdp-extractor');

test('original 1688 and unproven legacy categories cannot become final categories', () => {
  const result = resolveFinalCategory({ keyword: '杯垫', recommendedCategory: '旧类目', product: { categoryName: '1688类目' } });
  assert.equal(result.category, '');
  assert.equal(result.source1688Category, '1688类目');
  assert.equal(result.legacyCategory, '旧类目');
});

test('all-zero or absent category metrics require manual confirmation', () => {
  for (const metrics of [{ clickRatio: 0, clickRate: 0 }, {}]) {
    const recommendation = _recommendCategory({ rows: [{ category: '杯垫', ...metrics }] });
    assert.equal(recommendation.recommended, null);
    const sycmCategoryEvidence = buildCategoryEvidence({ categoryAnalysis: { recommendation } }, '杯垫');
    assert.equal(sycmCategoryEvidence.recommended, '');
    assert.equal(resolveFinalCategory({ keyword: '杯垫', sycmCategoryEvidence }).category, '');
    assert.equal(resolveFinalCategory({ keyword: '杯垫', sycmCategoryEvidence,
      categorySelection: { category: '杯垫', queryWord: '杯垫', keyword: '杯垫' } }).category, '杯垫');
  }
});

test('ranking metrics survive a minimal recommendation and evidence stays bound to its keyword', () => {
  const sycmCategoryEvidence = buildCategoryEvidence({ categoryAnalysis: { recommendation: {
    ranking: [{ category: '餐具 > 杯垫', clickRatio: 60, clickRate: 20 }], recommended: { category: '餐具 > 杯垫' }
  } } }, '杯垫');
  assert.equal(sycmCategoryEvidence.candidates[0].clickRatio, 60);
  assert.equal(resolveFinalCategory({ keyword: '杯垫', sycmCategoryEvidence }).category, '餐具 > 杯垫');
  assert.equal(resolveFinalCategory({ keyword: '地垫', sycmCategoryEvidence }).category, '');
  assert.equal(resolveFinalCategory({ keyword: '地垫', sycmCategoryEvidence,
    categorySelection: { keyword: '杯垫', queryWord: '杯垫', category: '餐具 > 杯垫' } }).category, '');
});
