'use strict';

const fs = require('fs');
const { appendOpportunity } = require('./opportunity-store');
const { getRun, readJsonl, setRunStageMetrics, writeRun } = require('./run-store');
const {
  DEFAULT_HOT_EXPORT_LIMIT,
  DEFAULT_MIN_TITLE_LENGTH,
  categoryAssessment,
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

function exportPriority(row) {
  const category = categoryAssessment(row);
  const categoryScore = category.confidence === 'high'
    ? 15
    : category.confidence === 'medium'
      ? 8
      : category.confidence === 'low'
        ? -15
        : -20;
  return Number(row.productOpportunity?.score || row.opportunityScore || 0)
    + Number(row.keywordOpportunity?.score || 0) * 0.35
    + Number(row.productDiversity?.score || row.selectedProduct?.productDiversity?.score || 0) * 0.1
    + categoryScore;
}

function normalizedExportReason(reason) {
  return String(reason || 'export_rejected').split(':')[0];
}

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
  const ranked = rows
    .map((row, index) => ({ row, index, priority: exportPriority(row) }))
    .sort((left, right) => right.priority - left.priority || left.index - right.index);
  const seenUrls = new Set();
  const seenTitles = new Set();
  const hotExportLimit = Number(options.hotExportLimit || DEFAULT_HOT_EXPORT_LIMIT);
  let hotUsed = 0;
  let eligibleReserveCount = 0;
  const reviewed = [];
  const readyRows = [];
  for (const item of ranked) {
    const row = item.row;
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
      productCategory: validation.productCategory,
      exportPriority: Math.round(item.priority * 10) / 10
    };
    if (validation.ok) {
      if (readyRows.length < limit) {
        seenUrls.add(row.url);
        seenTitles.add(row.title);
        if (row.verifyMode === 'hot') hotUsed += 1;
        readyRows.push(exportRow);
        reviewed.push(exportRow);
      } else {
        eligibleReserveCount += 1;
      }
    } else {
      reviewed.push(exportRow);
    }
  }
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
    ? (reviewRows.length > 0 ? 'needs_review' : 'ready_to_distribute')
    : (reviewed.length > 0 ? 'needs_review' : 'export_empty');
  run.counts.readyToDistribute = lines.length;
  run.counts.reviewCandidates = reviewRows.length;
  run.counts.rejectedBeforeDistribution = hardRejectedRows.length;
  run.counts.exportEvaluated = rows.length;
  run.counts.exportEligibleReserve = eligibleReserveCount;
  const exportFailures = rejectedRows.reduce((counts, row) => {
    for (const reason of row.exportReasons || []) {
      const key = normalizedExportReason(reason);
      counts[key] = Number(counts[key] || 0) + 1;
    }
    return counts;
  }, {});
  setRunStageMetrics(run, 'export', {
    input: rows.length,
    passed: readyRows.length,
    review: reviewRows.length,
    rejected: hardRejectedRows.length,
    reserve: eligibleReserveCount
  }, exportFailures);
  const mustReview = reviewRows.length > 0 || (readyRows.length === 0 && hardRejectedRows.length > 0);
  const blockers = reviewRows.length > 0
    ? ['review_candidates_pending']
    : readyRows.length === 0 && hardRejectedRows.length > 0
      ? ['no_export_ready_products']
      : [];
  run.canSubmit = lines.length > 0 && reviewRows.length === 0;
  run.mustReview = mustReview;
  run.blockers = blockers;
  writeRun(runDir, run);
  return flowResponse({
    ok: true,
    runId: run.runId,
    status: run.status,
    count: lines.length,
    reviewCandidates: reviewRows.length,
    rejected: hardRejectedRows.length,
    canSubmit: run.canSubmit,
    mustReview,
    blockers,
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
