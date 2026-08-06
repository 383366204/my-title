'use strict';

const fs = require('fs');
const path = require('path');
const { withAgentResponseFields } = require('./agent-response');

const DEFAULT_PIPELINE_DIR = path.join(process.cwd(), 'data', 'pipeline');
const STAGE_ORDER = ['seed', 'mined', 'keyword_review', 'verified', 'selected', 'generated', 'review', 'ready', 'submitted'];

const STATUS_STAGE = {
  created: 'seed',
  mining_manual_action_required: 'mined',
  mining_empty: 'mined',
  mined: 'mined',
  awaiting_keyword_review: 'keyword_review',
  keywords_reviewed: 'keyword_review',
  keyword_review_empty: 'keyword_review',
  manual_action_required: 'verified',
  verified_partial_manual_required: 'verified',
  verified: 'verified',
  verified_empty: 'verified',
  verified_no_generation_eligible: 'verified',
  products_selected: 'selected',
  select_failed: 'selected',
  generated: 'generated',
  generate_failed: 'generated',
  needs_review: 'review',
  ready_to_distribute: 'ready',
  export_empty: 'review',
  awaiting_user_confirmation: 'ready',
  workflow_complete: 'submitted',
  unknown: 'seed'
};

const RUN_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const READ_CHUNK_BYTES = 64 * 1024;
const JSONL_PREVIEW_MAX_BYTES = 1024 * 1024;

/**
 * Convert a persisted workflow status into a UI stage name.
 * @param {string} status Pipeline status string.
 * @returns {string} Normalized stage.
 */
function pipelineStatusToStage(status) {
  return STATUS_STAGE[status] || 'seed';
}

/**
 * Read up to a limit of JSONL rows, skipping empty or malformed lines.
 * @param {string} file JSONL file path.
 * @param {number} limit Maximum rows to return.
 * @returns {Array<object>} Parsed JSON rows.
 */
function readJsonlPreview(file, limit = 20) {
  const maxRows = Math.max(0, Number(limit) || 0);
  if (!file || maxRows === 0) return [];
  const rows = [];
  let fd;
  let pending = '';
  let bytesReadTotal = 0;
  const parseLine = function(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      rows.push(JSON.parse(trimmed));
    } catch (_) {
      // Bad JSONL rows are ignored so one malformed line does not break the UI.
    }
  };
  try {
    fd = fs.openSync(file, 'r');
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    while (rows.length < maxRows && bytesReadTotal < JSONL_PREVIEW_MAX_BYTES) {
      const remaining = JSONL_PREVIEW_MAX_BYTES - bytesReadTotal;
      const chunkSize = Math.min(buffer.length, remaining);
      const bytesRead = fs.readSync(fd, buffer, 0, chunkSize, null);
      if (bytesRead <= 0) break;
      bytesReadTotal += bytesRead;
      const text = pending + buffer.toString('utf8', 0, bytesRead);
      const lines = text.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) {
        parseLine(line);
        if (rows.length >= maxRows) break;
      }
    }
    if (rows.length < maxRows && pending) parseLine(pending);
  } catch (_) {
    return [];
  } finally {
    if (typeof fd === 'number') {
      try {
        fs.closeSync(fd);
      } catch (_) {
        // Ignore close failures while producing a defensive preview.
      }
    }
  }
  return rows;
}

/**
 * Read and optionally truncate a text file.
 * @param {string} file Text file path.
 * @param {number} maxChars Maximum characters to return.
 * @returns {string} File preview, or an empty string when missing.
 */
function readTextPreview(file, maxChars = 5000) {
  const limit = Number(maxChars);
  if (!file || !Number.isFinite(limit) || limit <= 0) return '';
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(Math.ceil(limit));
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.toString('utf8', 0, bytesRead).slice(0, limit);
  } catch (_) {
    return '';
  } finally {
    if (typeof fd === 'number') {
      try {
        fs.closeSync(fd);
      } catch (_) {
        // Ignore close failures while producing a defensive preview.
      }
    }
  }
}

/**
 * Count non-empty lines in a text file.
 * @param {string} file Text file path.
 * @returns {number} Non-empty line count.
 */
function countNonEmptyLines(file) {
  if (!file) return 0;
  let fd;
  let count = 0;
  let lineHasContent = false;
  try {
    fd = fs.openSync(file, 'r');
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;
      for (let idx = 0; idx < bytesRead; idx += 1) {
        const char = buffer[idx];
        if (char === 10) {
          if (lineHasContent) count += 1;
          lineHasContent = false;
        } else if (char !== 13 && char !== 32 && char !== 9) {
          lineHasContent = true;
        }
      }
    }
    if (lineHasContent) count += 1;
  } catch (_) {
    return 0;
  } finally {
    if (typeof fd === 'number') {
      try {
        fs.closeSync(fd);
      } catch (_) {
        // Ignore close failures while producing a defensive count.
      }
    }
  }
  return count;
}

function readJson(file, fallback = null) {
  if (!file || !fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function assertValidRunId(runId) {
  if (!RUN_ID_PATTERN.test(String(runId || ''))) {
    throw new Error('Invalid runId: only letters, numbers, underscore, and hyphen are allowed');
  }
}

function resolveRunId(dataDir, runId) {
  if (runId) {
    assertValidRunId(runId);
    return runId;
  }
  const latest = readJson(path.join(dataDir, 'latest.json'), null);
  if (!latest || !latest.runId) return '';
  assertValidRunId(latest.runId);
  return latest.runId;
}

function isInsideDir(parentDir, targetFile) {
  const relative = path.relative(parentDir, targetFile);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function safeRunFile(runDir, persistedPath, fallbackName) {
  const resolvedRunDir = path.resolve(runDir);
  const fallback = path.join(resolvedRunDir, fallbackName);
  if (!persistedPath) return fallback;
  const resolvedFile = path.resolve(resolvedRunDir, String(persistedPath));
  return isInsideDir(resolvedRunDir, resolvedFile) ? resolvedFile : fallback;
}

function defaultFiles(runDir, files = {}) {
  return {
    inspirations: safeRunFile(runDir, files.inspirations, 'inspirations.jsonl'),
    rootCandidates: safeRunFile(runDir, files.rootCandidates, 'root-candidates.jsonl'),
    candidates: safeRunFile(runDir, files.candidates, 'candidates.jsonl'),
    reviewedCandidates: safeRunFile(runDir, files.reviewedCandidates, 'reviewed-candidates.jsonl'),
    sycmResults: safeRunFile(runDir, files.sycmResults, 'sycm-results.jsonl'),
    verifiedKeywords: safeRunFile(runDir, files.verifiedKeywords, 'verified-keywords.jsonl'),
    selectedProducts: safeRunFile(runDir, files.selectedProducts, 'selected-products.jsonl'),
    generatedProducts: safeRunFile(runDir, files.generatedProducts, 'generated-products.jsonl'),
    distributionBatch: safeRunFile(runDir, files.distributionBatch, 'distribution-batch.txt'),
    distributionReview: safeRunFile(runDir, files.distributionReview, 'distribution-review.md')
  };
}

function buildNextCommand(status, runId, files) {
  const runPart = runId ? ` --run ${runId}` : '';
  if (status === 'created') return `node bin/cli.js flow mine${runPart} --json`;
  if (status === 'mined' || status === 'awaiting_keyword_review' || status === 'keyword_review_empty') return `node bin/cli.js flow review${runPart} --approve-all --json`;
  if (status === 'keywords_reviewed') return `node bin/cli.js flow verify${runPart} --json`;
  if (status === 'verified') return `node bin/cli.js flow select${runPart} --json`;
  if (status === 'products_selected') return `node bin/cli.js flow generate${runPart} --json`;
  if (status === 'select_failed') return `node bin/cli.js flow select${runPart} --json`;
  if (status === 'verified_empty' || status === 'verified_no_generation_eligible') return `node bin/cli.js flow inspect${runPart} --json`;
  if (status === 'generated' || status === 'generate_failed' || status === 'export_empty') return `node bin/cli.js flow export${runPart} --json`;
  if (status === 'needs_review') return files.distributionReview ? `Review ${files.distributionReview}` : '';
  if (status === 'ready_to_distribute') {
    return files.distributionBatch
      ? `node bin/cli.js distribute --input-file "${files.distributionBatch}" --dry-run --json`
      : '';
  }
  if (status === 'awaiting_user_confirmation') return 'node bin/cli.js workflow resume --confirm-submit --json';
  return '';
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean).map(String)));
}

/**
 * Summarize one persisted pipeline run for workbench and monitor UIs.
 * @param {object} options Summary options.
 * @param {string} [options.dataDir] Pipeline data directory.
 * @param {string} [options.runId] Run id to summarize.
 * @param {number} [options.previewLimit] JSONL preview row limit.
 * @param {number} [options.reviewChars] Review report preview character limit.
 * @returns {object|null} UI-friendly summary, or null when run.json is missing.
 */
function summarizePipelineRun({ dataDir = DEFAULT_PIPELINE_DIR, runId, previewLimit = 20, reviewChars = 5000 } = {}) {
  const targetRunId = resolveRunId(dataDir, runId);
  if (!targetRunId) return null;
  const runDir = path.join(dataDir, 'runs', targetRunId);
  const runFile = path.join(runDir, 'run.json');
  const run = readJson(runFile, null);
  if (!run) return null;

  const status = run.status || 'unknown';
  const stage = pipelineStatusToStage(status);
  const files = defaultFiles(runDir, run.files || {});
  const counts = { ...(run.counts || {}) };
  const batchFile = files.distributionBatch;
  const reviewFile = files.distributionReview;
  const batchExists = Boolean(batchFile && fs.existsSync(batchFile));
  const reviewExists = Boolean(reviewFile && fs.existsSync(reviewFile));
  const blockers = uniqueStrings(run.blockers || []);
  const mustReview = status === 'needs_review' || run.mustReview === true;

  if (status === 'needs_review' && blockers.length === 0) blockers.push('review_rejected_rows');
  if (status === 'mining_manual_action_required' || status === 'mining_empty') {
    blockers.push(run.discovery?.blocker || 'no_inspiration_candidates');
  }
  if (status === 'manual_action_required' || status === 'verified_partial_manual_required') {
    blockers.push('sycm_manual_action_required');
  }
  if (status === 'verified_no_generation_eligible') blockers.push('no_generation_eligible_keywords');
  if (status === 'awaiting_keyword_review') blockers.push('keyword_review_required');
  if (status === 'keyword_review_empty') blockers.push('no_keyword_review_approved');
  if (status === 'select_failed') blockers.push('no_selected_products');

  const nextCommand = run.nextCommand || buildNextCommand(status, targetRunId, files);
  const payload = withAgentResponseFields({
    ok: true,
    runId: run.runId || targetRunId,
    status,
    stage,
    stageIndex: STAGE_ORDER.indexOf(stage),
    startedAt: run.startedAt || '',
    updatedAt: run.updatedAt || run.startedAt || '',
    counts,
    policy: run.policy || {},
    funnel: run.funnel || {},
    failureReasons: run.failureReasons || {},
    diversity: run.diversity || {},
    discovery: run.discovery || null,
    files,
    batchCount: countNonEmptyLines(batchFile),
    batchFile,
    reviewFile,
    batchExists,
    reviewExists,
    canSubmit: run.canSubmit === true || (status === 'ready_to_distribute' && Number(counts.readyToDistribute || 0) > 0),
    mustReview,
    blockers: uniqueStrings(blockers),
    nextCommand,
    previews: {
      inspirations: readJsonlPreview(files.inspirations, previewLimit),
      rootCandidates: readJsonlPreview(files.rootCandidates, previewLimit),
      candidates: readJsonlPreview(files.candidates, previewLimit),
      reviewedCandidates: readJsonlPreview(files.reviewedCandidates, previewLimit),
      verifiedKeywords: readJsonlPreview(files.verifiedKeywords, previewLimit),
      selectedProducts: readJsonlPreview(files.selectedProducts, previewLimit),
      generatedProducts: readJsonlPreview(files.generatedProducts, previewLimit),
      distributionReview: readTextPreview(reviewFile, reviewChars)
    }
  });

  return payload;
}

/**
 * List pipeline runs sorted by recency for UI selectors.
 * @param {object} options List options.
 * @param {string} [options.dataDir] Pipeline data directory.
 * @param {number} [options.limit] Maximum summaries to return.
 * @returns {{runs: Array<object>, latest: object|null}} Sorted summaries and latest run.
 */
function listPipelineRuns({ dataDir = DEFAULT_PIPELINE_DIR, limit = 20 } = {}) {
  const runsDir = path.join(dataDir, 'runs');
  const maxRuns = Math.max(0, Number(limit) || 0);
  if (!fs.existsSync(runsDir) || maxRuns === 0) return { runs: [], latest: null };
  const runs = fs.readdirSync(runsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && RUN_ID_PATTERN.test(entry.name))
    .map(entry => summarizePipelineRun({ dataDir, runId: entry.name }))
    .filter(Boolean)
    .sort((a, b) => {
      const byUpdatedAt = String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
      if (byUpdatedAt !== 0) return byUpdatedAt;
      return String(b.runId || '').localeCompare(String(a.runId || ''));
    })
    .slice(0, maxRuns);
  return {
    runs,
    latest: runs[0] || null
  };
}

module.exports = {
  DEFAULT_PIPELINE_DIR,
  STAGE_ORDER,
  pipelineStatusToStage,
  summarizePipelineRun,
  listPipelineRuns,
  readJsonlPreview,
  readTextPreview,
  countNonEmptyLines
};
