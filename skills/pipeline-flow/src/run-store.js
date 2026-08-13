'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_FLOW_DIR = path.join(process.cwd(), 'data', 'pipeline');
const DEFAULT_PIPELINE_POLICY = Object.freeze({
  version: 2,
  reviewMode: 'auto',
  keywordPolicy: 'candidate_keyword',
  productGate: 'strict',
  exportFill: true
});

function pad(num) {
  return String(num).padStart(2, '0');
}

function stringifyAsciiJson(value, spaces = 0) {
  return JSON.stringify(value, null, spaces).replace(/[^\x00-\x7F]/g, ch => {
    return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
  });
}

/**
 * Create a filesystem-safe pipeline run identifier.
 * @param {Date} [date] Timestamp used by the identifier.
 * @returns {string} Run identifier.
 */
function createRunId(date = new Date()) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + '-' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
}

/**
 * Ensure a directory exists.
 * @param {string} dir Directory path.
 * @returns {void}
 */
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Append one or more records to a JSONL file.
 * @param {string} file JSONL file path.
 * @param {object|object[]} rows Records to append.
 * @returns {void}
 */
function appendJsonl(file, rows) {
  ensureDir(path.dirname(file));
  const lines = (Array.isArray(rows) ? rows : [rows])
    .map(row => stringifyAsciiJson(row, 0))
    .join('\n');
  if (lines) fs.appendFileSync(file, lines + '\n', 'utf8');
}

/**
 * Read all records from a JSONL file.
 * @param {string} file JSONL file path.
 * @returns {object[]} Parsed records.
 */
function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, stringifyAsciiJson(value, 2) + '\n', 'utf8');
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function resolveRunDir({ dataDir = DEFAULT_FLOW_DIR, runId } = {}) {
  const id = runId || createRunId();
  return {
    runId: id,
    dataDir,
    runDir: path.join(dataDir, 'runs', id)
  };
}

function ensureRunFiles(run, runDir) {
  run.files = run.files || {};
  run.files.inspirations = run.files.inspirations || path.join(runDir, 'inspirations.jsonl');
  run.files.rootCandidates = run.files.rootCandidates || path.join(runDir, 'root-candidates.jsonl');
  run.files.candidates = run.files.candidates || path.join(runDir, 'candidates.jsonl');
  run.files.reviewedCandidates = run.files.reviewedCandidates || path.join(runDir, 'reviewed-candidates.jsonl');
  run.files.sycmResults = run.files.sycmResults || path.join(runDir, 'sycm-results.jsonl');
  run.files.verifiedKeywords = run.files.verifiedKeywords || path.join(runDir, 'verified-keywords.jsonl');
  run.files.selectedProducts = run.files.selectedProducts || path.join(runDir, 'selected-products.jsonl');
  run.files.generatedProducts = run.files.generatedProducts || path.join(runDir, 'generated-products.jsonl');
  run.files.distributionBatch = run.files.distributionBatch || path.join(runDir, 'distribution-batch.txt');
  run.files.distributionReview = run.files.distributionReview || path.join(runDir, 'distribution-review.md');
  run.files.productRank = run.files.productRank || path.join(runDir, 'sycm-product-rank.jsonl');
  run.files.orderSheet = run.files.orderSheet || path.join(runDir, '商品排行刷单表.xlsx');
  run.files.reviewSource = run.files.reviewSource || path.join(runDir, 'uploaded-order-sheet.xlsx');
  run.files.reviewGroups = run.files.reviewGroups || path.join(runDir, 'review-order-groups.json');
  run.files.reviewDrafts = run.files.reviewDrafts || path.join(runDir, 'review-drafts.jsonl');
}

/**
 * Ensure quality-policy and funnel fields exist on new and historical runs.
 * @param {object} run Pipeline run state.
 * @param {object} [policy] Policy overrides used only when fields are absent.
 * @returns {object} Updated run state.
 */
function ensureRunQualityState(run, policy = {}) {
  run.policy = {
    ...DEFAULT_PIPELINE_POLICY,
    ...policy,
    ...(run.policy || {})
  };
  if (!run.funnel || typeof run.funnel !== 'object' || Array.isArray(run.funnel)) run.funnel = {};
  if (!run.failureReasons || typeof run.failureReasons !== 'object' || Array.isArray(run.failureReasons)) {
    run.failureReasons = {};
  }
  return run;
}

/**
 * Replace one stage's funnel snapshot and failure reasons.
 * @param {object} run Pipeline run state.
 * @param {string} stage Pipeline stage.
 * @param {object} funnel Stage input/pass/reject counts.
 * @param {object} [failureReasons] Stable reason counts for this stage.
 * @returns {object} Updated run state.
 */
function setRunStageMetrics(run, stage, funnel, failureReasons = {}) {
  ensureRunQualityState(run);
  run.funnel[stage] = Object.fromEntries(Object.entries(funnel || {}).map(([key, value]) => [
    key,
    Math.max(0, Number(value) || 0)
  ]));
  run.failureReasons[stage] = Object.fromEntries(Object.entries(failureReasons || {})
    .filter(([, value]) => Number(value) > 0)
    .map(([key, value]) => [key, Number(value)]));
  return run;
}

/**
 * Persist a pipeline run and refresh its update timestamp.
 * @param {string} runDir Run directory.
 * @param {object} run Run state.
 * @returns {void}
 */
function writeRun(runDir, run) {
  run.updatedAt = new Date().toISOString();
  writeJson(path.join(runDir, 'run.json'), run);
}

/**
 * Initialize or reopen a pipeline run.
 * @param {object} [options] Run options.
 * @param {string} [options.dataDir] Pipeline data directory.
 * @param {string} [options.runId] Existing run identifier.
 * @param {object} [options.options] Persisted workflow options.
 * @returns {{runId:string,dataDir:string,runDir:string,run:object}} Run context.
 */
function initRun({ dataDir = DEFAULT_FLOW_DIR, runId, options = {} } = {}) {
  const resolved = resolveRunDir({ dataDir, runId });
  ensureDir(resolved.runDir);
  const runFile = path.join(resolved.runDir, 'run.json');
  const existing = readJson(runFile, null);
  const requestedPolicy = {
    ...(options.policy || {}),
    ...(options.reviewMode ? { reviewMode: options.reviewMode } : {})
  };
  const run = existing || {
    runId: resolved.runId,
    status: 'created',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    options,
    policy: { ...DEFAULT_PIPELINE_POLICY, ...requestedPolicy },
    funnel: {},
    failureReasons: {},
    counts: {
      candidates: 0,
      keywordReviewApproved: 0,
      keywordReviewRejected: 0,
      sycmVerified: 0,
      sycmRejected: 0,
      selectedProducts: 0,
      generatedProducts: 0,
      readyToDistribute: 0
    },
    files: {
      inspirations: path.join(resolved.runDir, 'inspirations.jsonl'),
      rootCandidates: path.join(resolved.runDir, 'root-candidates.jsonl'),
      candidates: path.join(resolved.runDir, 'candidates.jsonl'),
      reviewedCandidates: path.join(resolved.runDir, 'reviewed-candidates.jsonl'),
      sycmResults: path.join(resolved.runDir, 'sycm-results.jsonl'),
      verifiedKeywords: path.join(resolved.runDir, 'verified-keywords.jsonl'),
      selectedProducts: path.join(resolved.runDir, 'selected-products.jsonl'),
      generatedProducts: path.join(resolved.runDir, 'generated-products.jsonl'),
      distributionBatch: path.join(resolved.runDir, 'distribution-batch.txt'),
      distributionReview: path.join(resolved.runDir, 'distribution-review.md'),
      productRank: path.join(resolved.runDir, 'sycm-product-rank.jsonl'),
      orderSheet: path.join(resolved.runDir, '商品排行刷单表.xlsx'),
      reviewSource: path.join(resolved.runDir, 'uploaded-order-sheet.xlsx'),
      reviewGroups: path.join(resolved.runDir, 'review-order-groups.json'),
      reviewDrafts: path.join(resolved.runDir, 'review-drafts.jsonl')
    }
  };
  ensureRunQualityState(run, requestedPolicy);
  ensureRunFiles(run, resolved.runDir);
  writeRun(resolved.runDir, run);
  writeJson(path.join(dataDir, 'latest.json'), {
    runId: resolved.runId,
    runDir: resolved.runDir,
    updatedAt: run.updatedAt
  });
  return { ...resolved, run };
}

/**
 * Read a pipeline run by id or from the latest pointer.
 * @param {object} [options] Lookup options.
 * @param {string} [options.dataDir] Pipeline data directory.
 * @param {string} [options.runId] Run identifier.
 * @returns {{runId:string,dataDir:string,runDir:string,run:object}} Run context.
 */
function getRun({ dataDir = DEFAULT_FLOW_DIR, runId } = {}) {
  let targetRunId = runId;
  if (!targetRunId) {
    const latest = readJson(path.join(dataDir, 'latest.json'), null);
    targetRunId = latest && latest.runId;
  }
  if (!targetRunId) throw new Error('未找到 run，请先执行 flow daily 或指定 --run');
  const resolved = resolveRunDir({ dataDir, runId: targetRunId });
  const run = readJson(path.join(resolved.runDir, 'run.json'), null);
  if (!run) throw new Error('run.json 不存在: ' + resolved.runDir);
  ensureRunQualityState(run);
  ensureRunFiles(run, resolved.runDir);
  return { ...resolved, run };
}

/**
 * Read candidate keywords produced by recent pipeline runs.
 * @param {object} [options] History options.
 * @param {string} [options.dataDir] Pipeline data directory.
 * @param {number} [options.ttlDays] History window in days.
 * @param {string} [options.excludeRunId] Run to exclude.
 * @returns {string[]} Recent keywords.
 */
function readRecentPipelineCandidateKeywords({ dataDir = DEFAULT_FLOW_DIR, ttlDays = 30, excludeRunId = '' } = {}) {
  const runsDir = path.join(dataDir, 'runs');
  if (!fs.existsSync(runsDir)) return [];
  const cutoff = Date.now() - Number(ttlDays || 30) * 86400000;
  const keywords = new Set();
  for (const runId of fs.readdirSync(runsDir)) {
    if (runId === excludeRunId) continue;
    const runDir = path.join(runsDir, runId);
    const run = readJson(path.join(runDir, 'run.json'), {});
    const timestamp = Date.parse(run.updatedAt || run.startedAt || '');
    if (Number.isFinite(timestamp) && timestamp < cutoff) continue;
    for (const row of readJsonl(path.join(runDir, 'candidates.jsonl'))) {
      if (row.keyword) keywords.add(row.keyword);
    }
  }
  return [...keywords];
}

/**
 * Mark a run as completed after distribution confirmation.
 * @param {object} options Completion options.
 * @param {string} options.runId Run identifier.
 * @param {object} [options.distributionResult] Distribution summary.
 * @param {string} [options.dataDir] Pipeline data directory.
 * @returns {object} Updated run state.
 */
function markRunDistributionComplete({ dataDir = DEFAULT_FLOW_DIR, runId, distributionResult = {} } = {}) {
  const resolved = getRun({ dataDir, runId });
  const run = resolved.run;
  run.status = 'workflow_complete';
  run.requiresUserAction = false;
  run.mustReview = false;
  run.blockers = [];
  run.nextActionCode = 'workflow_complete';
  run.nextCommand = '';
  run.distribution = {
    status: 'completed',
    method: String(distributionResult.method || distributionResult.mode || 'automatic'),
    completedAt: new Date().toISOString(),
    total: Number(distributionResult.total || run.counts?.readyToDistribute || 0),
    confirmed: Number(distributionResult.confirmed || distributionResult.total || 0)
  };
  writeRun(resolved.runDir, run);
  return run;
}

module.exports = {
  DEFAULT_PIPELINE_POLICY,
  DEFAULT_FLOW_DIR,
  appendJsonl,
  createRunId,
  ensureDir,
  ensureRunQualityState,
  getRun,
  initRun,
  markRunDistributionComplete,
  readJsonl,
  readRecentPipelineCandidateKeywords,
  setRunStageMetrics,
  writeRun
};
