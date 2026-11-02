'use strict';

/**
 * @file submission-ledger.js
 * @description 铺货提交幂等账本 (SubmissionLedger)
 * 记录外部写操作的批次提交指纹与状态，防止网络中断、进程重启或意外重试导致向外部平台重复发单。
 * 符合 ADR v1.0 (D8)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  resolveDataDir,
  writeJsonAtomic,
  assertRuntimeRunId
} = require('../../skills/pipeline-flow/runtime/store');

function getLedgerPath(dataDir, runId) {
  assertRuntimeRunId(runId);
  return path.join(resolveDataDir(dataDir), 'runs', runId, 'submission-ledger.json');
}

function readJsonFile(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (_) {
    return fallback;
  }
}

/**
 * 递归键排序规范化序列化
 * @param {*} value
 * @returns {string}
 */
function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalStringify).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalStringify(value[k])).join(',') + '}';
}

/**
 * 计算批次提交指纹 (Fingerprint)
 * @param {Array<object>} batchItems
 * @param {string|Array<string>} [targetShopId]
 * @param {string} [distributionMode]
 * @returns {string} 64位十六进制 SHA-256
 */
function computeBatchFingerprint(batchItems = [], targetShopId = '', distributionMode = '') {
  const normalized = {
    shops: Array.isArray(targetShopId) ? [...targetShopId].sort() : [String(targetShopId || '')],
    distributionMode: String(distributionMode || ''),
    items: (Array.isArray(batchItems) ? batchItems : []).map(item => ({
      offerId: String(item.offerId || item.id || ''),
      url: String(item.url || item.offerUrl || ''),
      title: String(item.title || ''),
      category: String(item.category || '')
    })).sort((a, b) => a.offerId.localeCompare(b.offerId) || a.url.localeCompare(b.url))
  };
  return crypto.createHash('sha256').update(canonicalStringify(normalized)).digest('hex');
}

/**
 * 获取提交账本记录
 * @param {object} options
 * @param {string} [options.dataDir]
 * @param {string} options.runId
 * @returns {object}
 */
function getSubmissionLedger({ dataDir, runId }) {
  const file = getLedgerPath(dataDir, runId);
  return readJsonFile(file, { version: 1, runId, entries: {} });
}

/**
 * 记录一次外部提交尝试（幂等防重）
 * 若该批次已处于 submitted 状态且指纹一致，直接返回 duplicate=true，防止双花。
 * @param {object} options
 * @param {string} [options.dataDir]
 * @param {string} options.runId
 * @param {string} options.batchId 批次标识 (如 batch_0, batch_1)
 * @param {string} options.fingerprint 批次数据指纹
 * @param {object} [options.metadata] 附加元数据（如店铺名、商品数等）
 * @returns {{duplicate: boolean, inFlight: boolean, record: object}}
 */
function recordSubmissionAttempt({ dataDir, runId, batchId, fingerprint, metadata = {} }) {
  const ledger = getSubmissionLedger({ dataDir, runId });
  const existing = ledger.entries[batchId];

  if (existing && existing.status === 'submitted' && existing.fingerprint === fingerprint) {
    return { duplicate: true, inFlight: false, record: existing };
  }

  if (existing && existing.status === 'submitting') {
    // 检查是否已经在提交中
    return { duplicate: false, inFlight: true, record: existing };
  }

  const attempt = (existing?.attempt || 0) + 1;
  const record = {
    batchId,
    fingerprint,
    status: 'submitting',
    attempt,
    startedAt: new Date().toISOString(),
    completedAt: null,
    failedAt: null,
    externalTaskId: null,
    error: null,
    metadata
  };

  ledger.entries[batchId] = record;
  ledger.updatedAt = new Date().toISOString();
  writeJsonAtomic(getLedgerPath(dataDir, runId), ledger);

  return { duplicate: false, inFlight: false, record };
}

/**
 * 标记批次提交成功
 * @param {object} options
 * @param {string} [options.dataDir]
 * @param {string} options.runId
 * @param {string} options.batchId
 * @param {string} [options.externalTaskId]
 * @param {*} [options.result]
 * @returns {object}
 */
function recordSubmissionSuccess({ dataDir, runId, batchId, externalTaskId, result }) {
  const ledger = getSubmissionLedger({ dataDir, runId });
  const existing = ledger.entries[batchId] || { batchId, attempt: 1 };

  existing.status = 'submitted';
  existing.completedAt = new Date().toISOString();
  existing.externalTaskId = externalTaskId || null;
  existing.result = result || null;
  existing.error = null;

  ledger.entries[batchId] = existing;
  ledger.updatedAt = new Date().toISOString();
  writeJsonAtomic(getLedgerPath(dataDir, runId), ledger);

  return existing;
}

/**
 * 标记批次提交失败
 * @param {object} options
 * @param {string} [options.dataDir]
 * @param {string} options.runId
 * @param {string} options.batchId
 * @param {Error|string} options.error
 * @returns {object}
 */
function recordSubmissionFailure({ dataDir, runId, batchId, error }) {
  const ledger = getSubmissionLedger({ dataDir, runId });
  const existing = ledger.entries[batchId] || { batchId, attempt: 1 };

  existing.status = 'failed';
  existing.failedAt = new Date().toISOString();
  existing.error = error?.message || String(error);

  ledger.entries[batchId] = existing;
  ledger.updatedAt = new Date().toISOString();
  writeJsonAtomic(getLedgerPath(dataDir, runId), ledger);

  return existing;
}

/**
 * 判断指定批次是否已成功提交过
 * @param {object} options
 * @param {string} [options.dataDir]
 * @param {string} options.runId
 * @param {string} options.batchId
 * @param {string} [options.fingerprint]
 * @returns {boolean}
 */
function isBatchSubmitted({ dataDir, runId, batchId, fingerprint }) {
  const ledger = getSubmissionLedger({ dataDir, runId });
  const entry = ledger.entries[batchId];
  if (!entry || entry.status !== 'submitted') return false;
  if (fingerprint && entry.fingerprint !== fingerprint) return false;
  return true;
}

module.exports = {
  computeBatchFingerprint,
  getSubmissionLedger,
  recordSubmissionAttempt,
  recordSubmissionSuccess,
  recordSubmissionFailure,
  isBatchSubmitted
};
