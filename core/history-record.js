'use strict';

function normalizeHistoryKeyword(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

/**
 * 构建历史记录使用的稳定索引键。
 * @param {object} input - 候选词或历史记录输入。
 * @returns {{normalizedKeyword: string, signature: string, coreProduct: string, keywordKey: string, signatureKey: string, coreProductKey: string}}
 */
function buildHistoryKeys(input = {}) {
  const normalizedKeyword = normalizeHistoryKeyword(input.keyword);
  const signature = String(input.signature || normalizedKeyword).trim();
  const coreProduct = String(input.coreProduct || '').trim();
  return {
    normalizedKeyword,
    signature,
    coreProduct,
    keywordKey: `kw:${normalizedKeyword}`,
    signatureKey: `sig:${signature}`,
    coreProductKey: coreProduct ? `core:${coreProduct}` : ''
  };
}

/**
 * 标准化候选词历史记录，供浏览器 IndexedDB 与未来桌面端共享。
 * @param {object} input - 候选词或历史记录输入。
 * @param {object} options - 归一化选项。
 * @param {string} options.now - 当前时间 ISO 字符串。
 * @param {object|null} options.existing - 已存在的历史记录。
 * @returns {object} 标准化后的历史记录。
 */
function normalizeHistoryRecord(input = {}, { now = new Date().toISOString(), existing = null } = {}) {
  const keys = buildHistoryKeys(input);
  const id = keys.signatureKey || keys.keywordKey;
  return {
    id,
    keyword: String(input.keyword || '').trim(),
    normalizedKeyword: keys.normalizedKeyword,
    keywordKey: keys.keywordKey,
    signature: keys.signature,
    signatureKey: keys.signatureKey,
    coreProduct: keys.coreProduct,
    coreProductKey: keys.coreProductKey,
    status: input.status || input.gateStatus || 'candidate',
    gateStatus: input.gateStatus || input.status || 'candidate',
    canDistribute: !!input.canDistribute,
    marketMetrics: input.marketMetrics || null,
    source: input.source || 'unknown',
    firstSeenAt: existing && existing.firstSeenAt ? existing.firstSeenAt : now,
    lastSeenAt: now,
    seenCount: existing && Number.isFinite(existing.seenCount) ? existing.seenCount + 1 : 1,
    lastAction: input.lastAction || '',
    lastReason: input.lastReason || input.gateReason || ''
  };
}

/**
 * 计算两个 ISO 时间之间相隔天数。
 * @param {string} leftIso - 左侧时间。
 * @param {string} rightIso - 右侧时间。
 * @returns {number} 相隔天数，无法解析时返回 Infinity。
 */
function daysBetween(leftIso, rightIso) {
  const left = new Date(leftIso).getTime();
  const right = new Date(rightIso).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Infinity;
  return Math.abs(right - left) / 86400000;
}

/**
 * 判断历史记录是否应在近期去重中被压制。
 * @param {object|null} record - 已存在的历史记录。
 * @param {object} options - 冷却期配置。
 * @returns {{suppress: boolean, reason: string, ageDays?: number}} 去重决策。
 */
function shouldSuppressHistoryRecord(record, {
  now = new Date().toISOString(),
  candidateCooldownDays = 0,
  generatedCooldownDays = 30,
  distributedCooldownDays = 90,
  rejectedCooldownDays = 90
} = {}) {
  if (!record || !record.lastSeenAt) return { suppress: false, reason: '' };
  const ageDays = daysBetween(record.lastSeenAt, now);
  const status = record.status || record.gateStatus || '';
  if (status === 'rejected' && ageDays < rejectedCooldownDays) {
    return { suppress: true, reason: 'recent_rejected_signature', ageDays };
  }
  if (status === 'distributed' && ageDays < distributedCooldownDays) {
    return { suppress: true, reason: 'recent_distributed_signature', ageDays };
  }
  if ((status === 'generated' || status === 'pending_review') && ageDays < generatedCooldownDays) {
    return { suppress: true, reason: 'recent_generated_signature', ageDays };
  }
  if (status === 'candidate' && candidateCooldownDays > 0 && ageDays < candidateCooldownDays) {
    return { suppress: true, reason: 'recent_signature', ageDays };
  }
  return { suppress: false, reason: '', ageDays };
}

module.exports = {
  normalizeHistoryKeyword,
  buildHistoryKeys,
  normalizeHistoryRecord,
  shouldSuppressHistoryRecord
};
