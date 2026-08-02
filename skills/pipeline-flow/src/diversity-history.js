const fs = require('fs');
const path = require('path');
const { buildHistoryKeys } = require('../../../core/history-record');
const { productFamily } = require('../../keyword-mining/src/product-words');

const STATUS_PRIORITY = {
  candidate: 1,
  verified: 2,
  generated: 3,
  pending_review: 4,
  distributed: 5
};

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (_error) {
    return fallback;
  }
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(line => {
      try {
        return [JSON.parse(line)];
      } catch (_error) {
        return [];
      }
    });
}

function runTimestamp(run = {}, runDir = '') {
  const parsed = Date.parse(run.updatedAt || run.startedAt || '');
  if (Number.isFinite(parsed)) return parsed;
  try {
    return fs.statSync(runDir).mtimeMs;
  } catch (_error) {
    return 0;
  }
}

/**
 * Create an empty diversity-history index.
 * @returns {object} Empty keyword and product history maps.
 */
function emptyHistory() {
  return {
    keywords: {},
    signatures: {},
    families: {},
    offers: {},
    suppliers: {},
    titles: {},
    stats: {
      runsScanned: 0,
      keywords: 0,
      signatures: 0,
      families: 0,
      offers: 0,
      suppliers: 0,
      titles: 0
    }
  };
}

function upsertEntity(target, key, { runId, lastSeenAt, status }) {
  if (!key) return;
  const existing = target[key];
  if (!existing) {
    target[key] = { key, lastSeenAt, status, seenCount: 1, runCount: 1, runIds: [runId] };
    return;
  }
  existing.seenCount += 1;
  if (!existing.runIds.includes(runId)) {
    existing.runIds.push(runId);
    existing.runCount += 1;
  }
  if (Date.parse(lastSeenAt) >= Date.parse(existing.lastSeenAt)) {
    existing.lastSeenAt = lastSeenAt;
    if ((STATUS_PRIORITY[status] || 0) >= (STATUS_PRIORITY[existing.status] || 0)) existing.status = status;
  }
}

function keywordHistoryInput(row = {}) {
  const keyword = row.keyword || row.rootKeyword || '';
  const coreProduct = row.coreProduct || row.productSignature || row.rootKeyword || '';
  return {
    ...row,
    keyword,
    coreProduct,
    familyKey: row.familyKey || productFamily(coreProduct) || coreProduct
  };
}

/**
 * Normalize a pipeline product row for history-key generation.
 * @param {object} row Pipeline artifact row.
 * @returns {object} Normalized product history input.
 */
function productHistoryInput(row = {}) {
  const product = row.product || row.selectedProduct || {};
  return {
    ...row,
    product,
    url: row.url || product['产品链接'] || product.url || product.detailUrl || '',
    sourceTitle: row.sourceTitle || product['链接原标题'] || product.subject || product.title || row.title || '',
    supplierId: row.supplierId || product.supplierId || product.sellerId || product.memberId || '',
    shopName: row.shopName || product.shopName || product.companyName || ''
  };
}

function recordKeywordRow(history, row, meta) {
  const keys = buildHistoryKeys(keywordHistoryInput(row));
  upsertEntity(history.keywords, keys.keywordKey, meta);
  upsertEntity(history.signatures, keys.signatureKey, meta);
  upsertEntity(history.families, keys.familyKey || keys.coreProductKey, meta);
}

function recordProductRow(history, row, meta) {
  const keys = buildHistoryKeys(productHistoryInput(row));
  upsertEntity(history.offers, keys.offerIdKey, meta);
  upsertEntity(history.suppliers, keys.supplierKey, meta);
  upsertEntity(history.titles, keys.titleFingerprintKey, meta);
}

function offerKeysFromItems(items = []) {
  return new Set(items
    .map(item => buildHistoryKeys(productHistoryInput(item)).offerIdKey)
    .filter(Boolean));
}

function distributedOfferKeys({ dataDir, runId, runDir, run }) {
  const job = readJson(path.join(dataDir, 'distribution-runs', `${runId}-distribution.json`), null);
  if (job?.status === 'completed' && Array.isArray(job.items) && job.items.length > 0) {
    return offerKeysFromItems(job.items);
  }
  const confirmed = Number(run.distribution?.confirmed || 0);
  const total = Number(run.distribution?.total || 0);
  const confirmedComplete = run.distribution?.status === 'completed' && total > 0 && confirmed >= total;
  if (!confirmedComplete) return new Set();
  const batchFile = path.join(runDir, 'distribution-batch.txt');
  if (!fs.existsSync(batchFile)) return new Set();
  return new Set(fs.readFileSync(batchFile, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => buildHistoryKeys({ url: line.split('$$')[0] }).offerIdKey)
    .filter(Boolean));
}

/**
 * Build a read-only diversity index from recent pipeline run artifacts.
 * @param {object} options History options.
 * @param {string} options.dataDir Pipeline data directory.
 * @returns {object} Recent keyword and product history maps.
 */
function buildPipelineDiversityHistory({
  dataDir,
  excludeRunId = '',
  ttlDays = 90,
  now = new Date().toISOString()
} = {}) {
  const history = emptyHistory();
  const runsDir = path.join(dataDir || '', 'runs');
  if (!dataDir || !fs.existsSync(runsDir)) return history;
  const cutoff = Date.parse(now) - Number(ttlDays || 90) * 86400000;

  for (const runId of fs.readdirSync(runsDir).sort()) {
    if (runId === excludeRunId) continue;
    const runDir = path.join(runsDir, runId);
    const run = readJson(path.join(runDir, 'run.json'), {});
    const timestamp = runTimestamp(run, runDir);
    if (!timestamp || timestamp < cutoff) continue;
    const lastSeenAt = new Date(timestamp).toISOString();
    const distributedOffers = distributedOfferKeys({ dataDir, runId, runDir, run });
    history.stats.runsScanned += 1;

    for (const row of readJsonl(path.join(runDir, 'root-candidates.jsonl'))) {
      if (row.status === 'selected') {
        recordKeywordRow(history, row, { runId, lastSeenAt, status: 'candidate' });
      }
    }
    for (const row of readJsonl(path.join(runDir, 'candidates.jsonl'))) {
      recordKeywordRow(history, row, { runId, lastSeenAt, status: 'candidate' });
    }
    for (const row of readJsonl(path.join(runDir, 'verified-keywords.jsonl'))) {
      recordKeywordRow(history, row, { runId, lastSeenAt, status: 'verified' });
    }
    const selectedRows = readJsonl(path.join(runDir, 'selected-products.jsonl'));
    const generatedRows = readJsonl(path.join(runDir, 'generated-products.jsonl'));
    for (const row of selectedRows) {
      recordKeywordRow(history, row, { runId, lastSeenAt, status: 'generated' });
      recordProductRow(history, row, { runId, lastSeenAt, status: 'generated' });
    }
    for (const row of generatedRows) {
      const keys = buildHistoryKeys(productHistoryInput(row));
      const status = distributedOffers.has(keys.offerIdKey) ? 'distributed' : 'generated';
      recordKeywordRow(history, row, { runId, lastSeenAt, status: status === 'distributed' ? 'distributed' : 'generated' });
      recordProductRow(history, row, { runId, lastSeenAt, status });
    }
  }

  for (const key of ['keywords', 'signatures', 'families', 'offers', 'suppliers', 'titles']) {
    history.stats[key] = Object.keys(history[key]).length;
  }
  return history;
}

module.exports = {
  buildPipelineDiversityHistory,
  emptyHistory,
  productHistoryInput
};
