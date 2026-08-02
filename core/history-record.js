'use strict';

function normalizeHistoryKeyword(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

function normalizeHistoryValue(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function normalizeOfferId(input = {}) {
  const direct = input.offerId || input.productId || input.id || '';
  const directMatch = String(direct).match(/\d{5,}/);
  if (directMatch) return directMatch[0];
  const url = input.url || input.productUrl || input.detailUrl || input['产品链接'] || '';
  const urlMatch = String(url).match(/\/offer\/(\d+)\.html/i);
  return urlMatch ? urlMatch[1] : '';
}

function normalizeTitleFingerprint(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\u3400-\u9fffa-z0-9]/g, '')
    .trim();
}

/**
 * 构建历史记录使用的稳定索引键。
 * @param {object} input - 候选词或历史记录输入。
 * @returns {object} Keyword, family, product, supplier, and title keys.
 */
function buildHistoryKeys(input = {}) {
  const normalizedKeyword = normalizeHistoryKeyword(input.keyword);
  const signature = String(input.signature || normalizedKeyword).trim();
  const coreProduct = String(input.coreProduct || '').trim();
  const rawFamily = String(input.family || input.familyKey || coreProduct).replace(/^family:/, '').trim();
  const family = normalizeHistoryValue(rawFamily);
  const offerId = normalizeOfferId(input) || normalizeOfferId(input.product || {});
  const supplier = normalizeHistoryValue(
    input.supplierId || input.sellerId || input.memberId || input.shopName || input.companyName
      || input.product?.supplierId || input.product?.sellerId || input.product?.memberId
      || input.product?.shopName || input.product?.companyName || ''
  );
  const sourceTitle = input.sourceTitle || input.title || input.subject || input.productTitle
    || input.product?.sourceTitle || input.product?.title || input.product?.subject || input.product?.['链接原标题'] || '';
  const titleFingerprint = normalizeTitleFingerprint(sourceTitle);
  return {
    normalizedKeyword,
    signature,
    coreProduct,
    family,
    offerId,
    supplier,
    titleFingerprint,
    keywordKey: normalizedKeyword ? `kw:${normalizedKeyword}` : '',
    signatureKey: signature ? `sig:${signature}` : '',
    coreProductKey: coreProduct ? `core:${coreProduct}` : '',
    familyKey: family ? `family:${family}` : '',
    offerIdKey: offerId ? `offer:${offerId}` : '',
    supplierKey: supplier ? `supplier:${supplier}` : '',
    titleFingerprintKey: titleFingerprint ? `title:${titleFingerprint}` : ''
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
  const id = input.id || keys.signatureKey || keys.offerIdKey || keys.titleFingerprintKey || keys.keywordKey;
  return {
    id,
    keyword: String(input.keyword || '').trim(),
    normalizedKeyword: keys.normalizedKeyword,
    keywordKey: keys.keywordKey,
    signature: keys.signature,
    signatureKey: keys.signatureKey,
    coreProduct: keys.coreProduct,
    coreProductKey: keys.coreProductKey,
    family: keys.family,
    familyKey: keys.familyKey,
    offerId: keys.offerId,
    offerIdKey: keys.offerIdKey,
    supplier: keys.supplier,
    supplierKey: keys.supplierKey,
    titleFingerprint: keys.titleFingerprint,
    titleFingerprintKey: keys.titleFingerprintKey,
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
 * Return a linear recency weight within a cooldown window.
 * @param {object|null} record Historical entity record.
 * @param {object} options Recency options.
 * @returns {number} Value from 0 (expired) to 1 (just seen).
 */
function historyRecencyWeight(record, {
  now = new Date().toISOString(),
  cooldownDays = 0
} = {}) {
  if (!record || !record.lastSeenAt || cooldownDays <= 0) return 0;
  const ageDays = daysBetween(record.lastSeenAt, now);
  if (!Number.isFinite(ageDays) || ageDays >= cooldownDays) return 0;
  return Number(Math.max(0, 1 - ageDays / cooldownDays).toFixed(4));
}

/**
 * Decide whether one history entity is still inside its hard cooldown.
 * @param {object|null} record Historical entity record.
 * @param {object} options Entity cooldown options.
 * @returns {{suppress:boolean,reason:string,ageDays?:number,weight:number}}
 */
function shouldSuppressHistoryEntity(record, {
  now = new Date().toISOString(),
  entityType = 'signature',
  cooldownDays = 0,
  reason = ''
} = {}) {
  if (!record || !record.lastSeenAt || cooldownDays <= 0) {
    return { suppress: false, reason: '', weight: 0 };
  }
  const ageDays = daysBetween(record.lastSeenAt, now);
  const suppress = ageDays < cooldownDays;
  return {
    suppress,
    reason: suppress ? (reason || `recent_${entityType}`) : '',
    ageDays,
    weight: historyRecencyWeight(record, { now, cooldownDays })
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
  normalizeOfferId,
  normalizeTitleFingerprint,
  buildHistoryKeys,
  normalizeHistoryRecord,
  historyRecencyWeight,
  shouldSuppressHistoryEntity,
  shouldSuppressHistoryRecord
};
