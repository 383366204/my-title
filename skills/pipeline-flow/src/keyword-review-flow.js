'use strict';

const fs = require('fs');
const { appendJsonl, getRun, readJsonl, setRunStageMetrics, writeRun } = require('./run-store');
const { buildFlowCommand, flowResponse } = require('./flow-context');

function normalizeKeywordReviewDecision(row = {}, decision = 'approved', reason = '') {
  return {
    ...row,
    reviewStatus: decision === 'approved' ? 'approved' : 'rejected',
    status: decision === 'approved' ? 'keyword_approved' : 'keyword_rejected',
    reviewReason: reason,
    reviewedAt: new Date().toISOString()
  };
}

/**
 * Persist human keyword screening results before SYCM verification.
 * @param {object} [options] Review options.
 * @returns {object} Step result.
 */
function flowReviewCandidates(options = {}) {
  const { runDir, run } = getRun(options);
  const candidates = readJsonl(run.files.candidates);
  const manualKeywords = [...new Set((Array.isArray(options.manualKeywords) ? options.manualKeywords : [])
    .map(item => String(item || '').trim())
    .filter(Boolean))];
  const existingKeywords = new Set(candidates.map(row => String(row.keyword || '').trim()).filter(Boolean));
  const manualCandidates = manualKeywords
    .filter(keyword => !existingKeywords.has(keyword))
    .map(keyword => ({
      keyword,
      selectedKeyword: keyword,
      status: 'candidate',
      source: 'manual',
      reason: '用户手动添加',
      signature: keyword,
      addedAt: new Date().toISOString()
    }));
  const allCandidates = [...candidates, ...manualCandidates];
  if (manualCandidates.length > 0) {
    appendJsonl(run.files.candidates, manualCandidates);
    run.counts.candidates = allCandidates.length;
  }
  const approvedSet = new Set((options.approvedKeywords || []).map(item => String(item || '').trim()).filter(Boolean));
  const rejectedSet = new Set((options.rejectedKeywords || []).map(item => String(item || '').trim()).filter(Boolean));
  const hasExplicitDecision = approvedSet.size > 0 || rejectedSet.size > 0 || manualKeywords.length > 0 || options.approveAll === true;

  if (!hasExplicitDecision) {
    run.status = 'awaiting_keyword_review';
    run.counts.keywordReviewPending = allCandidates.length;
    setRunStageMetrics(run, 'keywordReview', {
      input: allCandidates.length,
      passed: 0,
      rejected: 0,
      pending: allCandidates.length
    });
    writeRun(runDir, run);
    return flowResponse({
      ok: true,
      runId: run.runId,
      status: run.status,
      candidates: allCandidates,
      reviewed: [],
      runDir,
      blockers: ['keyword_review_required'],
      allowedCommands: [buildFlowCommand('review', run.runId, { approveAll: true })],
      nextCommand: buildFlowCommand('review', run.runId, { approveAll: true })
    });
  }

  const reviewed = allCandidates.map(row => {
    const keyword = String(row.keyword || '').trim();
    const rejected = rejectedSet.has(keyword);
    const approved = options.approveAll === true || approvedSet.has(keyword) || (!rejected && approvedSet.size === 0);
    return normalizeKeywordReviewDecision(
      row,
      approved && !rejected ? 'approved' : 'rejected',
      rejected ? '人工筛除' : '人工确认通过'
    );
  });
  const approvedRows = reviewed.filter(row => row.reviewStatus === 'approved');
  const rejectedRows = reviewed.filter(row => row.reviewStatus === 'rejected');
  fs.writeFileSync(run.files.reviewedCandidates, '', 'utf8');
  appendJsonl(run.files.reviewedCandidates, reviewed);
  run.status = approvedRows.length > 0 ? 'keywords_reviewed' : 'keyword_review_empty';
  run.counts.keywordReviewApproved = approvedRows.length;
  run.counts.keywordReviewRejected = rejectedRows.length;
  run.counts.keywordReviewPending = 0;
  setRunStageMetrics(run, 'keywordReview', {
    input: reviewed.length,
    passed: approvedRows.length,
    rejected: rejectedRows.length,
    pending: 0
  }, {
    manually_rejected: rejectedRows.length
  });
  writeRun(runDir, run);
  return flowResponse({
    ok: true,
    runId: run.runId,
    status: run.status,
    reviewed,
    approved: approvedRows,
    rejected: rejectedRows,
    runDir,
    blockers: approvedRows.length > 0 ? [] : ['no_keyword_review_approved'],
    allowedCommands: [approvedRows.length > 0
      ? buildFlowCommand('verify', run.runId, { limit: options.verify || 20 })
      : buildFlowCommand('review', run.runId)],
    nextCommand: approvedRows.length > 0
      ? buildFlowCommand('verify', run.runId, { limit: options.verify || 20 })
      : buildFlowCommand('review', run.runId)
  });
}

module.exports = {
  flowReviewCandidates
};
