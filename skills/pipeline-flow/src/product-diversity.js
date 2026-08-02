const {
  buildHistoryKeys,
  historyRecencyWeight
} = require('../../../core/history-record');

/**
 * Create mutable state shared while selecting one product batch.
 * @returns {object} Empty batch diversity state.
 */
function createProductDiversityState() {
  return {
    offerIds: new Set(),
    titleFingerprints: [],
    supplierCounts: new Map()
  };
}

function charBigrams(value) {
  const text = String(value || '');
  if (text.length < 2) return new Set(text ? [text] : []);
  const pairs = new Set();
  for (let index = 0; index < text.length - 1; index++) pairs.add(text.slice(index, index + 2));
  return pairs;
}

/**
 * Compare normalized product titles using bigram Jaccard similarity.
 * @param {string} left First title.
 * @param {string} right Second title.
 * @returns {number} Similarity from 0 to 1.
 */
function titleSimilarity(left, right) {
  const a = charBigrams(left);
  const b = charBigrams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/**
 * Build stable offer, supplier, and title keys for a product row.
 * @param {object} row Product or wrapped pipeline row.
 * @returns {object} Normalized history keys.
 */
function productKeys(row = {}) {
  const product = row.product || row;
  return buildHistoryKeys({
    ...row,
    product,
    url: row.url || product['产品链接'] || product.detailUrl || product.productUrl || product.url || '',
    sourceTitle: row.sourceTitle || product['链接原标题'] || product.subject || product.title || row.title || '',
    supplierId: row.supplierId || product.supplierId || product.sellerId || product.memberId || '',
    shopName: row.shopName || product.shopName || product.companyName || ''
  });
}

function evaluateProduct(row, history, state, options) {
  const keys = productKeys(row);
  const offerRecord = history.offers?.[keys.offerIdKey] || null;
  const supplierRecord = history.suppliers?.[keys.supplierKey] || null;
  const titleRecord = history.titles?.[keys.titleFingerprintKey] || null;
  const distributedWeight = offerRecord?.status === 'distributed'
    ? historyRecencyWeight(offerRecord, { now: options.now, cooldownDays: options.distributedOfferCooldownDays })
    : 0;
  const generatedWeight = offerRecord?.status !== 'distributed'
    ? historyRecencyWeight(offerRecord, { now: options.now, cooldownDays: options.generatedOfferCooldownDays })
    : 0;
  const titleHistoryWeight = historyRecencyWeight(titleRecord, { now: options.now, cooldownDays: 30 });
  const supplierHistoryWeight = historyRecencyWeight(supplierRecord, { now: options.now, cooldownDays: 14 });
  const supplierCount = keys.supplierKey ? Number(state.supplierCounts.get(keys.supplierKey) || 0) : 0;
  const nearestTitleSimilarity = keys.titleFingerprint
    ? state.titleFingerprints.reduce((max, title) => Math.max(max, titleSimilarity(keys.titleFingerprint, title)), 0)
    : 0;
  let hardReason = '';
  if (keys.offerId && state.offerIds.has(keys.offerId)) hardReason = 'duplicate_offer_in_batch';
  else if (distributedWeight > 0) hardReason = 'recent_distributed_offer';
  else if (nearestTitleSimilarity >= options.titleSimilarityThreshold) hardReason = 'similar_title_in_batch';
  else if (keys.supplierKey && supplierCount >= options.maxPerSupplier) hardReason = 'supplier_batch_limit';

  const historyPenalty = generatedWeight * 18 + titleHistoryWeight * 10 + supplierHistoryWeight * 4;
  const batchPenalty = supplierCount * 6 + nearestTitleSimilarity * 8;
  const newOfferBonus = offerRecord ? 0 : 3;
  const score = Number((Number(row.opportunityScore || 0) + newOfferBonus - historyPenalty - batchPenalty).toFixed(2));
  return {
    keys,
    score,
    hardReason,
    historyPenalty: Number(historyPenalty.toFixed(2)),
    batchPenalty: Number(batchPenalty.toFixed(2)),
    historicalOfferCount: Number(offerRecord?.runCount || 0),
    historicalSupplierCount: Number(supplierRecord?.runCount || 0),
    nearestTitleSimilarity: Number(nearestTitleSimilarity.toFixed(4)),
    noveltyStatus: !offerRecord
      ? 'new_offer'
      : generatedWeight > 0
        ? 'recent_generated_offer'
        : 'returning_offer'
  };
}

function commitProduct(item, state) {
  if (item.evaluation.keys.offerId) state.offerIds.add(item.evaluation.keys.offerId);
  if (item.evaluation.keys.titleFingerprint) state.titleFingerprints.push(item.evaluation.keys.titleFingerprint);
  if (item.evaluation.keys.supplierKey) {
    state.supplierCounts.set(
      item.evaluation.keys.supplierKey,
      Number(state.supplierCounts.get(item.evaluation.keys.supplierKey) || 0) + 1
    );
  }
}

function decorateProduct(item, historyFallback = false) {
  const { row, evaluation } = item;
  return {
    ...row,
    offerId: evaluation.keys.offerId,
    supplierKey: evaluation.keys.supplierKey,
    supplierName: evaluation.keys.supplier,
    titleFingerprint: evaluation.keys.titleFingerprint,
    productDiversity: {
      score: evaluation.score,
      noveltyStatus: historyFallback ? 'history_fallback' : evaluation.noveltyStatus,
      historyPenalty: evaluation.historyPenalty,
      batchPenalty: evaluation.batchPenalty,
      historicalOfferCount: evaluation.historicalOfferCount,
      historicalSupplierCount: evaluation.historicalSupplierCount,
      nearestTitleSimilarity: evaluation.nearestTitleSimilarity,
      historyFallback,
      fallbackReason: historyFallback ? evaluation.hardReason : ''
    }
  };
}

/**
 * Select diverse products from one keyword while sharing batch-level state.
 * @param {Array<object>} rows Scored product rows.
 * @param {object} options Product diversity options.
 * @returns {{selected:Array<object>,stats:object,state:object}}
 */
function selectDiverseProducts(rows = [], {
  history = {},
  state = createProductDiversityState(),
  limit = 12,
  now = new Date().toISOString(),
  maxPerSupplier = 2,
  titleSimilarityThreshold = 0.92,
  generatedOfferCooldownDays = 7,
  distributedOfferCooldownDays = 30,
  allowHistoryFallback = true
} = {}) {
  const options = {
    now,
    maxPerSupplier,
    titleSimilarityThreshold,
    generatedOfferCooldownDays,
    distributedOfferCooldownDays
  };
  const evaluated = rows.map((row, index) => ({ row, index, evaluation: evaluateProduct(row, history, state, options) }));
  const eligible = evaluated
    .filter(item => !item.evaluation.hardReason)
    .sort((a, b) => b.evaluation.score - a.evaluation.score || b.row.opportunityScore - a.row.opportunityScore || a.index - b.index);
  const selected = [];
  for (const item of eligible) {
    if (selected.length >= Number(limit || 0)) break;
    const refreshed = { ...item, evaluation: evaluateProduct(item.row, history, state, options) };
    if (refreshed.evaluation.hardReason) continue;
    selected.push(decorateProduct(refreshed));
    commitProduct(refreshed, state);
  }

  let historyFallbackCount = 0;
  if (selected.length === 0 && allowHistoryFallback) {
    const fallback = evaluated
      .filter(item => ['recent_distributed_offer', 'supplier_batch_limit'].includes(item.evaluation.hardReason))
      .filter(item => !item.evaluation.keys.offerId || !state.offerIds.has(item.evaluation.keys.offerId))
      .filter(item => item.evaluation.nearestTitleSimilarity < titleSimilarityThreshold)
      .sort((a, b) => b.evaluation.score - a.evaluation.score || a.index - b.index)[0];
    if (fallback) {
      selected.push(decorateProduct(fallback, true));
      commitProduct(fallback, state);
      historyFallbackCount = 1;
    }
  }

  const reasons = evaluated.reduce((counts, item) => {
    if (item.evaluation.hardReason) counts[item.evaluation.hardReason] = Number(counts[item.evaluation.hardReason] || 0) + 1;
    return counts;
  }, {});
  const hardFiltered = Object.values(reasons).reduce((sum, value) => sum + Number(value || 0), 0);
  return {
    selected,
    state,
    stats: {
      input: rows.length,
      requested: Number(limit || 0),
      selected: selected.length,
      shortfall: Math.max(0, Number(limit || 0) - selected.length),
      hardFiltered,
      notSelected: Math.max(0, rows.length - selected.length),
      filteredReasons: reasons,
      newOffers: selected.filter(item => item.productDiversity?.noveltyStatus === 'new_offer').length,
      historyFallbackCount
    }
  };
}

module.exports = {
  createProductDiversityState,
  productKeys,
  selectDiverseProducts,
  titleSimilarity
};
