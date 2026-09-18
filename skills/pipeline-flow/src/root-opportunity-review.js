'use strict';

const fs = require('fs');
const { scoreSycmRows } = require('./sycm-verifier');
const { scoreKeywordOpportunity } = require('./opportunity-scoring');
const { getRun, readJsonl, appendJsonl, writeRun, setRunStageMetrics } = require('./run-store');

/** @param {object} row Candidate with collected SYCM evidence. @returns {object} Advisory scores; never promotes failed evidence. */
function scoreRootReviewCandidate(row) {
  const data = row.sycmData && !Array.isArray(row.sycmData) ? [{ ...row.sycmData, keyword: row.keyword }] : [];
  const mode = row.sycmEvidence?.mode === 'hot' ? 'hot' : 'blue';
  const sycmScore = scoreSycmRows(data, { mode });
  const keywordOpportunity = scoreKeywordOpportunity({ ...row, sycmScore, sycmData: data });
  return { ...row, combinedOpportunityReview: true, sycmScore, keywordOpportunity, opportunityScore: keywordOpportunity.score,
    reviewStatus: 'pending', verifyMode: mode, reviewRecommended: sycmScore.passed && keywordOpportunity.decision === 'continue' };
}

/** @param {object} options Run and explicit human decisions. @returns {object} Combined scoring and review result. */
function reviewRootOpportunities(options = {}) {
  const { run, runDir } = getRun(options);
  const candidates = readJsonl(run.files.candidates);
  const existing = new Set(candidates.map(row => row.keyword));
  const manual = [...new Set(options.manualKeywords || [])].map(word => String(word).trim()).filter(word => word && !existing.has(word))
    .map(keyword => ({ keyword, source: 'manual', reason: '人工添加，暂无生意参谋证据' }));
  if (manual.length) appendJsonl(run.files.candidates, manual);
  const scored = [...candidates, ...manual].map(scoreRootReviewCandidate);
  const approvedSet = new Set(options.approvedKeywords || []);
  const rejectedSet = new Set(options.rejectedKeywords || []);
  const explicit = Array.isArray(options.approvedKeywords) || Array.isArray(options.rejectedKeywords) || options.approveAll === true;
  const reviewed = scored.map(row => {
    if (!explicit) return row;
    const approved = (approvedSet.has(row.keyword) || options.approveAll === true) && !rejectedSet.has(row.keyword);
    const reviewedAt = new Date().toISOString();
    return { ...row, reviewStatus: approved ? 'approved' : 'rejected', status: approved ? 'keyword_approved' : 'keyword_rejected',
      reviewedAt, reviewReason: approved ? (row.reviewRecommended ? '人工确认通过' : '人工确认风险后放行') : '人工筛除',
      keywordOpportunity: { ...row.keywordOpportunity, ...(approved ? { manualApproval: { approved: true, reviewedAt, reason: '人工确认关键词用于后续选品' } } : {}) } };
  });
  const approved = reviewed.filter(row => row.reviewStatus === 'approved');
  const rejected = reviewed.filter(row => row.reviewStatus === 'rejected');
  fs.writeFileSync(run.files.reviewedCandidates, '');
  appendJsonl(run.files.reviewedCandidates, reviewed);
  fs.writeFileSync(run.files.verifiedKeywords, '');
  appendJsonl(run.files.verifiedKeywords, approved);
  run.counts.candidates = scored.length;
  run.counts.keywordReviewApproved = approved.length;
  run.counts.keywordReviewRejected = rejected.length;
  run.counts.keywordReviewPending = explicit ? 0 : scored.length;
  run.counts.sycmVerified = scored.filter(row => row.sycmScore.passed).length;
  run.counts.sycmRejected = scored.length - run.counts.sycmVerified;
  run.counts.sycmGenerationEligible = approved.length;
  run.status = !explicit ? 'awaiting_keyword_review' : approved.length ? 'keywords_reviewed' : 'keyword_review_empty';
  setRunStageMetrics(run, 'keywordReview', { input: scored.length, passed: approved.length, rejected: rejected.length, pending: explicit ? 0 : scored.length });
  writeRun(runDir, run);
  return { ok: true, runId: run.runId, runDir, status: run.status, stepIncomplete: !approved.length,
    reviewed, approved, rejected, candidates: reviewed, combinedOpportunityReview: true,
    blockers: approved.length ? [] : ['keyword_review_required'] };
}

module.exports = { scoreRootReviewCandidate, reviewRootOpportunities };
