'use strict';

const fs = require('fs');
const { filterKeywordMetrics } = require('./keyword-metric-filter');
const { getRun, readJsonl, appendJsonl, writeRun, setRunStageMetrics } = require('./run-store');

/** @param {object} row 带生意参谋证据的候选词。 @param {object} [config] 运行筛选配置。 @returns {object} 指标筛选结果，不生成评分。 */
function scoreRootReviewCandidate(row, config) {
  const data = Array.isArray(row.sycmData) ? row.sycmData.filter(item => item.keyword === row.keyword)
    : row.sycmData ? [{ ...row.sycmData, keyword: row.keyword }] : [];
  const mode = row.sycmEvidence?.mode === 'hot' ? 'hot' : 'blue';
  const results = data.map(item => filterKeywordMetrics(item, config));
  const metricFilter = results.find(result => result.status === 'failed')
    || results.find(result => result.status === 'review') || results[0] || filterKeywordMetrics({}, config);
  const clean = { ...row };
  for (const key of ['localScore', 'marketScore', 'opportunityScore', 'sycmScore', 'keywordOpportunity']) delete clean[key];
  const sycmScore = { passed: metricFilter.passed, mode, reason: metricFilter.reasons.join('；') };
  const keywordOpportunity = { decision: metricFilter.passed ? 'continue' : 'observe', nextAction: metricFilter.passed ? 'search_1688' : 'manual_review', reasons: metricFilter.reasons };
  return { ...clean, combinedOpportunityReview: true, sycmScore, metricFilter,
    reviewStatus: row.reviewStatus || 'pending', verifyMode: mode, reviewRecommended: metricFilter.passed,
    keywordOpportunity: { ...keywordOpportunity, ...(row.keywordOpportunity?.manualApproval
      ? { manualApproval: row.keywordOpportunity.manualApproval } : {}) } };
}

/** @param {object} options Run and explicit human decisions. @returns {object} Combined scoring and review result. */
function reviewRootOpportunities(options = {}) {
  const { run, runDir } = getRun(options);
  const candidates = readJsonl(run.files.candidates);
  const existing = new Set(candidates.map(row => row.keyword));
  const manual = [...new Set(options.manualKeywords || [])].map(word => String(word).trim()).filter(word => word && !existing.has(word))
    .map(keyword => ({ keyword, source: 'manual', reason: '人工添加，暂无生意参谋证据' }));
  if (manual.length) appendJsonl(run.files.candidates, manual);
  const previous = new Map(readJsonl(run.files.reviewedCandidates).map(row => [row.keyword, row]));
  const scored = [...candidates, ...manual].map(row => {
    const saved = previous.get(row.keyword);
    return scoreRootReviewCandidate({ ...saved, ...row,
      reviewStatus: saved?.reviewStatus || row.reviewStatus,
      ...(['approved', 'rejected'].includes(run.options?.keywordFilterDecisions?.[row.keyword])
        ? { reviewDraft: run.options.keywordFilterDecisions[row.keyword] } : {}) }, run.options?.keywordFilter);
  });
  const approvedSet = new Set(options.approvedKeywords || []);
  const rejectedSet = new Set(options.rejectedKeywords || []);
  const explicit = Array.isArray(options.approvedKeywords) || Array.isArray(options.rejectedKeywords) || options.approveAll === true;
  const reviewed = scored.map(row => {
    if (!explicit) return row;
    const approved = (approvedSet.has(row.keyword) || options.approveAll === true) && !rejectedSet.has(row.keyword);
    const reviewedAt = new Date().toISOString();
    return { ...row, reviewStatus: approved ? 'approved' : 'rejected', reviewDraft: approved ? 'approved' : 'rejected', status: approved ? 'keyword_approved' : 'keyword_rejected',
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
  run.options = { ...run.options, combinedOpportunityReview: true };
  if (explicit) run.options.keywordFilterDecisions = Object.fromEntries(reviewed.map(row => [row.keyword, row.reviewStatus]));
  run.counts.keywordReviewApproved = approved.length;
  run.counts.keywordReviewRejected = rejected.length;
  run.counts.keywordReviewPending = reviewed.filter(row => row.reviewStatus === 'pending').length;
  run.counts.sycmVerified = scored.filter(row => row.sycmScore.passed).length;
  run.counts.sycmRejected = scored.length - run.counts.sycmVerified;
  run.counts.sycmGenerationEligible = approved.length;
  run.counts.keywordFilterPassed = scored.filter(row => row.metricFilter.status === 'passed').length;
  run.counts.keywordFilterReview = scored.filter(row => row.metricFilter.status === 'review').length;
  run.counts.keywordFilterFailed = scored.filter(row => row.metricFilter.status === 'failed').length;
  run.status = !explicit ? 'awaiting_keyword_review' : approved.length ? 'keywords_reviewed' : 'keyword_review_empty';
  setRunStageMetrics(run, 'keywordReview', { input: scored.length, passed: approved.length, rejected: rejected.length, pending: run.counts.keywordReviewPending });
  writeRun(runDir, run);
  return { ok: true, runId: run.runId, runDir, status: run.status, stepIncomplete: !explicit || !approved.length,
    reviewed, approved, rejected, candidates: reviewed, combinedOpportunityReview: true,
    blockers: explicit && approved.length ? [] : ['keyword_review_required'] };
}

module.exports = { scoreRootReviewCandidate, reviewRootOpportunities };
