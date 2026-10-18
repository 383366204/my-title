'use strict';

/**
 * Classify server-timestamped evidence without extending its original expiry.
 * @param {object} evidence Evidence with millisecond observedAt/expiresAt.
 * @param {object} options Server now and configured maximum age.
 * @returns {string} current, expired or invalid.
 */
function evidenceStatus(evidence, { now = Date.now(), maxAgeMs = 86400000 } = {}) {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) throw new Error('非法证据时间配置');
  const { observedAt, expiresAt } = evidence || {};
  if (!Number.isSafeInteger(observedAt) || !Number.isSafeInteger(expiresAt)
      || observedAt < 0 || observedAt > now || expiresAt <= observedAt) return 'invalid';
  return now >= expiresAt || now - observedAt >= maxAgeMs ? 'expired' : 'current';
}

/**
 * Verify whether a candidate and its verdict evidence are current.
 * @param {object} candidate
 * @param {object} options
 * @returns {boolean}
 */
function isCandidateCurrent(candidate, options = {}) {
  if (!candidate || typeof candidate !== 'object') return false;
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? 86400000;
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) {
    throw new Error('非法证据时间配置');
  }

  // 缺失或非法时间戳不是可复用证据，不能跳过检查。
  if (evidenceStatus(candidate, { now, maxAgeMs }) !== 'current') return false;

  // 2. 检查 candidate.verdict 判定证据有效期
  if (candidate.verdict !== undefined) {
    const verdict = candidate.verdict;
    if (!verdict || typeof verdict !== 'object' || Array.isArray(verdict)) return false;
    // 当前判定器只输出 expiresAt；未单列 observedAt 时沿用候选采集时间。
    const observedAt = verdict.observedAt === undefined ? candidate.observedAt : verdict.observedAt;
    if (evidenceStatus({ observedAt, expiresAt: verdict.expiresAt }, { now, maxAgeMs }) !== 'current') return false;
  }

  return true;
}

/**
 * Select latest matching evidence and retain explicit stale/missing diagnostics.
 * @param {object[]} products Current productKey/snapshotRevision manifest entries.
 * @param {object[]} rows Persisted validation rows in append order.
 * @param {object} options Required search/judge hashes and time policy.
 * @returns {object} Current results plus products requiring validation/refresh.
 */
function selectCurrentImageResults(products, rows, options) {
  const { searchConfigHash, judgeConfigHash } = options;
  if (!searchConfigHash || !judgeConfigHash) throw new Error('缺少验证指纹');
  const current = new Map();
  for (const product of products) {
    if (!product.productKey || !product.snapshotRevision || current.has(product.productKey)) throw new Error('商品版本缺失或重复');
    current.set(product.productKey, product.snapshotRevision);
  }
  const latest = new Map();
  for (const row of rows) {
    if (!row || !current.has(row.productKey) || row.snapshotRevision !== current.get(row.productKey)
        || row.searchConfigHash !== searchConfigHash || row.judgeConfigHash !== judgeConfigHash) continue;
    latest.set(row.productKey, row);
  }
  const results = [];
  const pending = [];
  for (const product of products) {
    const row = latest.get(product.productKey);
    let reason = row ? evidenceStatus(row, options) : 'missing';
    if (reason === 'current' && Array.isArray(row.candidates) && row.candidates.length > 0) {
      const candidates = row.candidates;
      const level = c => c.verdict?.level || c.level;
      const hasConfirmed = candidates.some(c => level(c) === 'confirmed');
      if (hasConfirmed) {
        if (!candidates.some(c => level(c) === 'confirmed' && isCandidateCurrent(c, options))) {
          reason = 'expired';
        }
      } else {
        if (candidates.some(c => !isCandidateCurrent(c, options))) {
          reason = 'expired';
        }
      }
    }
    // 最新证据失效后不能回退旧confirmed，也不能当作无货。
    if (reason === 'current') results.push(row);
    else pending.push({ productKey: product.productKey, reason });
  }
  return { results, pending };
}

module.exports = { evidenceStatus, isCandidateCurrent, selectCurrentImageResults };
