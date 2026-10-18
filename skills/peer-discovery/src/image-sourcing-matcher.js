'use strict';

const { belowPriceRatio, normalizePriceRatio } = require('./price-comparison');
const { evidenceStatus } = require('./evidence');

/**
 * Judge one image-search candidate from explicit comparable evidence only.
 * @param {object} source Source with priceText, currency and timestamp evidence.
 * @param {object} candidate Normalized candidate with independent spec/price evidence.
 * @param {object} options Ratio, minimum similarity and server clock policy.
 * @returns {object} Four-level verdict with reasons and evidence expiry.
 */
function judgeImageCandidate(source, candidate, options = {}) {
  const ratio = normalizePriceRatio(options.imagePriceRatioThreshold ?? '1');
  const similarityThreshold = options.similarityThreshold ?? 0.45;
  if (!Number.isFinite(similarityThreshold) || similarityThreshold < 0 || similarityThreshold > 1) throw new Error('相似度门槛必须在0-1之间');
  const result = (level, reason) => ({
    offerId: candidate?.offerId || '', level, reason, imagePriceRatioThreshold: ratio,
    expiresAt: Math.min(source?.expiresAt ?? 0, candidate?.expiresAt ?? 0)
  });
  if (evidenceStatus(source, options) !== 'current' || evidenceStatus(candidate, options) !== 'current') return result('inconclusive', 'evidence_needs_refresh');
  if (!candidate.offerId || !source.imageDigest) return result('inconclusive', 'missing_identity_or_image');
  if (candidate.specStatus === 'inconsistent') return result('rejected', 'specification_mismatch');
  if (!Number.isFinite(candidate.similarity) || candidate.similarity < 0 || candidate.similarity > 1) return result('inconclusive', 'missing_similarity');
  if (candidate.similarity < similarityThreshold) return result('rejected', 'similarity_below_threshold');
  if (candidate.available === false) return result('rejected', 'source_unavailable');
  if (candidate.available !== true) return result('inconclusive', 'availability_unknown');
  if (!source.currency || candidate.currency !== source.currency || source.singlePiecePriceVerified !== true || candidate.singlePiecePriceVerified !== true) return result('inconclusive', 'price_not_comparable');
  let cheaper;
  try {
    cheaper = belowPriceRatio(candidate.priceText, source.priceText, ratio);
  } catch (_error) {
    return result('inconclusive', 'missing_comparable_price');
  }
  if (!cheaper) return result('rejected', 'price_ratio_not_below_threshold');
  if (candidate.specStatus !== 'consistent') return result('suspected', 'specification_unknown');
  return result('confirmed', 'comparable_source_confirmed');
}

/**
 * Verify all candidates from an injected, independently validated image provider.
 * @param {object} source Source snapshot.
 * @param {object} options Provider, signal and judgement policy.
 * @returns {Promise<object>} Candidate verdicts; incomplete results cannot imply no sources.
 */
async function verifyImageSources(source, options = {}) {
  options.signal?.throwIfAborted();
  if (typeof options.provider?.search !== 'function') {
    throw Object.assign(new Error('1688网页图搜尚未通过真实探针，不能使用文字搜索替代'), { code: 'IMAGE_SEARCH_PROVIDER_UNAVAILABLE', platform: '1688' });
  }
  const response = await options.provider.search(source, { signal: options.signal });
  options.signal?.throwIfAborted();
  if (!response || response.ok !== true || !Array.isArray(response.candidates)) {
    throw Object.assign(new Error('1688图搜返回异常，不能视为无货源'), { code: response?.code || 'IMAGE_SEARCH_INVALID_RESPONSE', platform: '1688' });
  }
  // 图搜器返回实际上传图片的摘要，不能因上游列表未携带摘要而丢弃该证据。
  const verifiedSource = response.imageDigest ? { ...source, imageDigest: response.imageDigest } : source;
  const results = response.candidates.map(candidate => ({ ...candidate, verdict: judgeImageCandidate(verifiedSource, candidate, options) }));
  return {
    results,
    complete: response.complete === true,
    confirmedCount: results.filter(row => row.verdict.level === 'confirmed').length,
    noSources: response.complete === true && results.length === 0
  };
}

module.exports = { judgeImageCandidate, verifyImageSources };
