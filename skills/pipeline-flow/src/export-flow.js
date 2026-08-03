'use strict';

const fs = require('fs');
const { appendOpportunity } = require('./opportunity-store');
const { getRun, readJsonl, writeRun } = require('./run-store');
const {
  DEFAULT_HOT_EXPORT_LIMIT,
  DEFAULT_MIN_TITLE_LENGTH,
  classifyExportStatus,
  distributionLine,
  validateGeneratedRow,
  writeDistributionReview
} = require('./export-validator');
const {
  buildFlowCommand,
  flowResponse,
  resolveOpportunityDir
} = require('./flow-context');

/**
 * Export generated products into the distribution batch format.
 * @param {object} [options] Export options.
 * @returns {Promise<object>} Export result.
 */
async function flowExport(options = {}) {
  const { runDir, run } = getRun(options);
  const rows = readJsonl(run.files.generatedProducts)
    .filter(row => row.status === 'generated' && row.url && row.title);
  const limit = Number(options.limit || options.export || rows.length || 0);
  const selected = rows.slice(0, limit);
  const seenUrls = new Set();
  const seenTitles = new Set();
  const hotExportLimit = Number(options.hotExportLimit || DEFAULT_HOT_EXPORT_LIMIT);
  let hotUsed = 0;
  const reviewed = selected.map(row => {
    const validation = validateGeneratedRow(row, {
      minTitleLength: options.minTitleLength || DEFAULT_MIN_TITLE_LENGTH,
      hotExportLimit,
      hotUsed,
      seenUrls,
      seenTitles,
      manualMode: options.manualMode === true || run.options?.mode === 'manual'
    });
    const exportRow = {
      ...row,
      exportStatus: classifyExportStatus(validation),
      exportReasons: validation.reasons,
      categoryConfidence: validation.categoryConfidence,
      categoryReason: validation.categoryReason,
      recommendedCategory: row.recommendedCategory || validation.recommendedCategory,
      productCategory: validation.productCategory
    };
    if (validation.ok) {
      seenUrls.add(row.url);
      seenTitles.add(row.title);
      if (row.verifyMode === 'hot') hotUsed += 1;
    }
    return exportRow;
  });
  const readyRows = reviewed.filter(row => row.exportStatus === 'ready');
  const reviewRows = reviewed.filter(row => row.exportStatus === 'review_candidate');
  const rejectedRows = reviewed.filter(row => row.exportStatus !== 'ready');
  const hardRejectedRows = reviewed.filter(row => row.exportStatus === 'rejected_before_distribution');
  appendOpportunity('rejected', rejectedRows.map(row => ({
    runId: run.runId,
    keyword: row.keyword,
    selectedKeyword: row.selectedKeyword || row.keyword,
    url: row.url,
    title: row.title,
    status: row.exportStatus,
    opportunityScore: row.opportunityScore || 0,
    decision: row.decision || 'reject',
    nextAction: 'manual_review',
    reason: (row.exportReasons || []).join(',')
  })), { runId: run.runId, dataDir: resolveOpportunityDir(options) });
  const lines = readyRows.map(row => distributionLine(row));
  fs.writeFileSync(run.files.distributionBatch, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
  writeDistributionReview(run.files.distributionReview, reviewed);
  run.status = lines.length > 0
    ? (rejectedRows.length > 0 ? 'needs_review' : 'ready_to_distribute')
    : (reviewed.length > 0 ? 'needs_review' : 'export_empty');
  run.counts.readyToDistribute = lines.length;
  run.counts.reviewCandidates = reviewRows.length;
  run.counts.rejectedBeforeDistribution = hardRejectedRows.length;
  writeRun(runDir, run);
  return flowResponse({
    ok: true,
    runId: run.runId,
    status: run.status,
    count: lines.length,
    reviewCandidates: reviewRows.length,
    rejected: hardRejectedRows.length,
    canSubmit: lines.length > 0 && rejectedRows.length === 0,
    mustReview: rejectedRows.length > 0,
    blockers: rejectedRows.length > 0 ? ['review_rejected_rows'] : [],
    file: run.files.distributionBatch,
    reviewFile: run.files.distributionReview,
    runDir,
    allowedCommands: lines.length > 0
      ? [`node bin/cli.js distribute --input-file "${run.files.distributionBatch}" --dry-run --json`]
      : [buildFlowCommand('inspect', run.runId)],
    nextCommand: lines.length > 0
      ? `人工检查 distribution-batch.txt 后调用 1688-distribution: node bin/cli.js distribute --input-file "${run.files.distributionBatch}" --dry-run --json`
      : buildFlowCommand('inspect', run.runId)
  });
}

module.exports = {
  flowExport
};
