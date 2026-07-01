function normalizeKeyword(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

export function historyRecordFromCandidate(candidate = {}) {
  const normalizedKeyword = normalizeKeyword(candidate.keyword);
  const signature = candidate.signature || normalizedKeyword;
  return {
    id: `sig:${signature}`,
    keyword: candidate.keyword,
    normalizedKeyword,
    keywordKey: `kw:${normalizedKeyword}`,
    signature,
    signatureKey: `sig:${signature}`,
    coreProduct: candidate.coreProduct || '',
    coreProductKey: candidate.coreProduct ? `core:${candidate.coreProduct}` : '',
    status: candidate.status || candidate.gateStatus || 'candidate',
    gateStatus: candidate.gateStatus || candidate.status || 'candidate',
    canDistribute: Boolean(candidate.canDistribute),
    marketMetrics: candidate.marketMetrics || candidate.sycmData || null,
    source: candidate.source || 'unknown',
    lastReason: candidate.lastReason || candidate.gateReason || ''
  };
}

export function duplicateDecision(existing) {
  if (!existing || !existing.lastSeenAt) return { duplicate: false, record: existing || null };
  const ageDays = Math.abs(Date.now() - new Date(existing.lastSeenAt).getTime()) / 86400000;
  const status = existing.status || existing.gateStatus || '';
  if (status === 'rejected' && ageDays < 90) return { duplicate: true, reason: 'recent_rejected_signature', ageDays, record: existing };
  if (status === 'distributed' && ageDays < 90) return { duplicate: true, reason: 'recent_distributed_signature', ageDays, record: existing };
  if ((status === 'generated' || status === 'pending_review') && ageDays < 30) return { duplicate: true, reason: 'recent_generated_signature', ageDays, record: existing };
  return { duplicate: false, record: existing };
}

export class HistoryService {
  constructor(store) {
    this.store = store;
  }

  async recordCandidates(candidates) {
    const records = (candidates || []).map(historyRecordFromCandidate);
    if (typeof this.store.upsertSeenBatch === 'function') return this.store.upsertSeenBatch(records);
    const rows = [];
    for (const record of records) rows.push(await this.store.upsertSeen(record));
    return rows;
  }

  async findDuplicate(candidate) {
    const record = historyRecordFromCandidate(candidate);
    return duplicateDecision(await this.store.findBySignature(record.signatureKey));
  }

  async markGenerated(candidate, payload = {}) {
    const record = historyRecordFromCandidate(candidate);
    await this.store.upsertSeen({ ...record, status: 'generated', lastAction: 'generated' });
    return this.store.markAction(record.id, 'generated', payload);
  }

  async markPendingReview(candidate, payload = {}) {
    const record = historyRecordFromCandidate(candidate);
    await this.store.upsertSeen({ ...record, status: 'pending_review', lastAction: 'pending_review' });
    return this.store.markAction(record.id, 'pending_review', payload);
  }

  async markRejected(candidate, reason = '') {
    const record = historyRecordFromCandidate(candidate);
    await this.store.upsertSeen({ ...record, status: 'rejected', lastAction: 'rejected', lastReason: reason });
    return this.store.markAction(record.id, 'rejected', { keyword: record.keyword, reason });
  }
}
