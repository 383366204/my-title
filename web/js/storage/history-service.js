'use strict';

function normalizeBrowserKeyword(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

function historyRecordFromCandidate(candidate) {
  const normalizedKeyword = normalizeBrowserKeyword(candidate.keyword);
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
    canDistribute: !!candidate.canDistribute,
    marketMetrics: candidate.marketMetrics || null,
    source: candidate.source || 'unknown',
    lastReason: candidate.lastReason || candidate.gateReason || ''
  };
}

function historyAgeDays(lastSeenAt) {
  const last = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(last)) return Infinity;
  return Math.abs(Date.now() - last) / 86400000;
}

function duplicateDecision(existing) {
  if (!existing || !existing.lastSeenAt) return { duplicate: false, record: existing || null };
  const ageDays = historyAgeDays(existing.lastSeenAt);
  const status = existing.status || existing.gateStatus || '';
  if (status === 'rejected' && ageDays < 90) {
    return { duplicate: true, reason: 'recent_rejected_signature', ageDays, record: existing };
  }
  if (status === 'distributed' && ageDays < 90) {
    return { duplicate: true, reason: 'recent_distributed_signature', ageDays, record: existing };
  }
  if ((status === 'generated' || status === 'pending_review') && ageDays < 30) {
    return { duplicate: true, reason: 'recent_generated_signature', ageDays, record: existing };
  }
  return { duplicate: false, record: existing };
}

class HistoryService {
  constructor(store) {
    this.store = store;
  }

  async recordCandidates(candidates) {
    const records = (candidates || []).map(historyRecordFromCandidate);
    if (typeof this.store.upsertSeenBatch === 'function') {
      return this.store.upsertSeenBatch(records);
    }
    const rows = [];
    for (const record of records) rows.push(await this.store.upsertSeen(record));
    return rows;
  }

  async findDuplicate(candidate) {
    const record = historyRecordFromCandidate(candidate);
    const existing = await this.store.findBySignature(record.signatureKey);
    return duplicateDecision(existing);
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
    const rejected = {
      ...record,
      status: 'rejected',
      gateStatus: candidate.gateStatus || record.gateStatus,
      lastAction: 'rejected',
      lastReason: reason || candidate.gateReason || '用户手动拒绝'
    };
    await this.store.upsertSeen(rejected);
    return this.store.markAction(rejected.id, 'rejected', { keyword: rejected.keyword, reason: rejected.lastReason });
  }
}

class MemoryHistoryStore {
  constructor() {
    this.records = new Map();
    this.actions = [];
  }

  async upsertSeen(record) {
    const existing = this.records.get(record.id);
    const now = new Date().toISOString();
    const next = {
      ...record,
      firstSeenAt: existing && existing.firstSeenAt ? existing.firstSeenAt : (record.firstSeenAt || now),
      lastSeenAt: record.lastSeenAt || now,
      seenCount: existing && Number.isFinite(existing.seenCount) ? existing.seenCount + 1 : (record.seenCount || 1)
    };
    this.records.set(next.id, next);
    return next;
  }

  async upsertSeenBatch(records) {
    const output = [];
    for (const record of records || []) output.push(await this.upsertSeen(record));
    return output;
  }

  async findBySignature(signatureKey) {
    return this.records.get(signatureKey) || null;
  }

  async markAction(recordId, action, payload = {}) {
    const row = { id: this.actions.length + 1, recordId, action, payload, createdAt: new Date().toISOString() };
    this.actions.push(row);
    return row;
  }
}

function createHistoryStore() {
  if (!window.indexedDB || !window.BrowserIndexedDbHistoryStore) return new MemoryHistoryStore();
  return new window.BrowserIndexedDbHistoryStore();
}

window.HistoryService = HistoryService;
window.MemoryHistoryStore = MemoryHistoryStore;
window.historyService = new HistoryService(createHistoryStore());
