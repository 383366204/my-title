'use strict';

const cleanCategory = value => typeof value === 'string' && !/[\r\n]|\$\$/.test(value) ? value.trim() : '';

/** @param {object} row 商品记录。 @returns {string} 原始货源类目，不读取铺货覆盖字段。 */
function sourceCategory(row = {}) {
  const product = row.product || {};
  return String(row.source1688Category ?? product.categoryListName ?? product.categoryName
    ?? product.stats?.categoryListName ?? product.stats?.categoryName ?? product.category ?? product['类目'] ?? '').trim();
}

/** @param {object} result 参谋查询结果。 @param {string} queryWord 实际查询词。 @returns {object} 可追溯类目证据。 */
function buildCategoryEvidence(result = {}, queryWord) {
  const analysis = result.categoryAnalysis || {};
  const recommendation = analysis.recommendation || {};
  const raw = recommendation.ranking || analysis.rows || analysis.data?.rows || [];
  const candidates = [...new Map([...(recommendation.recommended ? [recommendation.recommended] : []), ...raw]
    .filter(item => cleanCategory(item.category))
    .map(item => [cleanCategory(item.category), {
      category: cleanCategory(item.category),
      clickRatio: Number.isFinite(Number(item.clickRatio)) ? Number(item.clickRatio) : null,
      clickRate: Number.isFinite(Number(item.clickRate)) ? Number(item.clickRate) : null
    }])).values()];
  const hasMetrics = candidates.some(item => item.clickRatio > 0 || item.clickRate > 0);
  return { source: 'sycm', queryWord: String(queryWord || '').trim(), collectedAt: new Date().toISOString(),
    candidates, recommended: hasMetrics ? cleanCategory(recommendation.recommended?.category) : '' };
}

/** @param {object} row 商品记录。 @returns {object} 最终类目及状态；来源不明的旧值仅供参考。 */
function resolveFinalCategory(row = {}) {
  const keyword = String(row.selectedKeyword || row.keyword || '').trim();
  const evidence = row.sycmCategoryEvidence;
  const selection = row.categorySelection;
  const valid = evidence?.source === 'sycm' && Array.isArray(evidence.candidates);
  const candidates = valid ? evidence.candidates.filter(item => cleanCategory(item.category)) : [];
  const manual = valid && selection?.keyword === keyword && selection.queryWord === evidence.queryWord
    && candidates.some(item => item.category === selection.category);
  const automatic = valid && evidence.queryWord === keyword
    && candidates.some(item => item.category === evidence.recommended);
  const category = manual ? selection.category : automatic ? evidence.recommended : '';
  return { category, status: category ? 'ready' : candidates.length ? 'needs_confirmation' : 'missing',
    source: category ? (manual ? 'sycm_manual' : 'sycm') : '',
    queryWord: evidence?.queryWord || '', collectedAt: evidence?.collectedAt || '', candidates,
    source1688Category: sourceCategory(row),
    legacyCategory: !valid ? cleanCategory(row.recommendedCategory) : '' };
}

module.exports = { sourceCategory, buildCategoryEvidence, resolveFinalCategory };
