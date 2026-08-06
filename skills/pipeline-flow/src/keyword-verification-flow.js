'use strict';

const fs = require('fs');
const path = require('path');
const { applySeedFeedback } = require('../../keyword-mining');
const { extractSycmData } = require('../../sycm-research');
const { scoreKeywordOpportunity } = require('./opportunity-scoring');
const { appendOpportunity } = require('./opportunity-store');
const { fetchSycmWithFallback, scoreSycmRows } = require('./sycm-verifier');
const { appendJsonl, getRun, readJsonl, setRunStageMetrics, writeRun } = require('./run-store');
const { sycmRecommendedCategory } = require('./product-normalizer');
const {
  buildFlowCommand,
  flowResponse,
  isGenerationEligibleKeyword,
  resolveOpportunityDir
} = require('./flow-context');

/**
 * Verify candidates against SYCM in a strict serial queue.
 * @param {object} [options] Flow options.
 * @returns {Promise<object>} Step result.
 */
async function flowVerify(options = {}) {
  const { runDir, run } = getRun(options);
  const reviewedCandidates = readJsonl(run.files.reviewedCandidates);
  const approvedReviewedCandidates = reviewedCandidates.filter(row => row.reviewStatus === 'approved' || row.status === 'keyword_approved');
  const candidates = approvedReviewedCandidates.length > 0 ? approvedReviewedCandidates : readJsonl(run.files.candidates);
  const limit = Number(options.limit || options.verify || candidates.length || 0);
  const executableCandidates = candidates.filter(item => {
    const action = item && item.nextAction;
    return !action || action === 'sycm_verify' || action === 'direct_product_search';
  });
  const selected = executableCandidates.slice(0, limit);
  const reserveLimit = options.autoExpandVerify === true
    ? Math.max(0, Number(options.verifyReserve || 8))
    : 0;
  const reserveCandidates = executableCandidates.slice(limit, limit + reserveLimit);
  const verified = [];
  const rejected = [];
  const sycmResults = [];
  const sycmExtractor = options.sycmExtractor || extractSycmData;

  fs.writeFileSync(run.files.sycmResults, '', 'utf8');
  fs.writeFileSync(run.files.verifiedKeywords, '', 'utf8');

  const verifyCandidate = async (candidate, phase = 'primary') => {
    try {
      const reuseInspirationMetrics = candidate.source === 'inspiration'
        && candidate.sycmData
        && options.reuseInspirationSycmData !== false;
      const cachedData = reuseInspirationMetrics
        ? [{ keyword: candidate.keyword, ...candidate.sycmData }]
        : [];
      const sycmAttempt = reuseInspirationMetrics
        ? {
            result: { keyword: candidate.keyword, data: cachedData },
            data: cachedData,
            sycmScore: scoreSycmRows(cachedData, { mode: 'blue' }),
            verifyMode: 'inspiration_cached',
            fallbackUsed: false,
            fallbackReason: '',
            attempts: [{
              mode: 'inspiration_cached',
              totalCount: cachedData.length,
              passed: scoreSycmRows(cachedData, { mode: 'blue' }).passed
            }]
          }
        : await fetchSycmWithFallback(candidate.keyword, { ...options, sycmExtractor });
      const data = sycmAttempt.data;
      const sycmScore = sycmAttempt.sycmScore;
      const row = {
        ...candidate,
        status: sycmScore.passed ? 'verified' : 'rejected_low_score',
        sycmScore,
        verifyMode: sycmAttempt.verifyMode,
        confidence: sycmScore.confidence,
        usage: sycmScore.usage,
        fallbackUsed: sycmAttempt.fallbackUsed,
        fallbackReason: sycmAttempt.fallbackReason || '',
        recommendedCategory: sycmRecommendedCategory(sycmAttempt.result)
          || candidate.recommendedCategory
          || candidate.category
          || '',
        categorySource: sycmRecommendedCategory(sycmAttempt.result)
          ? 'sycm'
          : (candidate.categorySource || (candidate.recommendedCategory || candidate.category ? 'candidate' : '')),
        sycmData: data,
        checkedAt: new Date().toISOString()
      };
      const keywordOpportunity = scoreKeywordOpportunity(row);
      row.keywordOpportunity = keywordOpportunity;
      row.opportunityScore = keywordOpportunity.score;
      row.decision = keywordOpportunity.decision;
      row.nextAction = keywordOpportunity.nextAction;
      sycmResults.push({
        keyword: candidate.keyword,
        ok: true,
        phase,
        mode: sycmAttempt.verifyMode,
        fallbackUsed: sycmAttempt.fallbackUsed,
        fallbackReason: sycmAttempt.fallbackReason || '',
        attempts: sycmAttempt.attempts,
        totalCount: data.length,
        sycmScore,
        data
      });
      if (sycmScore.passed) verified.push(row);
      else rejected.push(row);
    } catch (error) {
      const row = {
        ...candidate,
        status: error && error.status ? error.status : 'sycm_failed',
        error: error && error.message ? error.message : String(error),
        manualAction: error && error.details ? error.details : null,
        checkedAt: new Date().toISOString()
      };
      rejected.push(row);
      sycmResults.push({
        keyword: candidate.keyword,
        ok: false,
        phase,
        status: row.status,
        error: row.error,
        manualAction: row.manualAction
      });
      if (error && ['login_required', 'slider_required', 'sycm_feature_required'].includes(error.status)) {
        return false;
      }
    }
    return true;
  };

  for (let index = 0; index < selected.length; index += 1) {
    const canContinue = await verifyCandidate(selected[index]);
    options.onProgress?.({
      current: index + 1,
      total: selected.length + reserveCandidates.length,
      message: `生意参谋验真 ${index + 1}/${selected.length}`
    });
    if (!canContinue) break;
  }

  const strictEligibleAfterPrimary = verified.filter(row => {
    const decision = row.keywordOpportunity && row.keywordOpportunity.decision;
    return !decision || decision === 'continue';
  });
  const hasManualActionAfterPrimary = rejected.some(row => (
    ['login_required', 'slider_required', 'sycm_feature_required'].includes(row.status)
  ));

  // 严格机会词为零时才补验备用词，避免无节制提高平台请求频率。
  if (strictEligibleAfterPrimary.length === 0 && !hasManualActionAfterPrimary) {
    for (let index = 0; index < reserveCandidates.length; index += 1) {
      const canContinue = await verifyCandidate(reserveCandidates[index], 'reserve');
      options.onProgress?.({
        current: selected.length + index + 1,
        total: selected.length + reserveCandidates.length,
        message: `补充候选词验真 ${index + 1}/${reserveCandidates.length}`
      });
      if (!canContinue) break;
    }
  }

  appendJsonl(run.files.sycmResults, sycmResults);
  const strictGenerationEligible = verified.filter(row => {
    const decision = row.keywordOpportunity && row.keywordOpportunity.decision;
    return !decision || decision === 'continue';
  });
  const autoFallbackRows = strictGenerationEligible.length === 0 && options.autoAllowReviewKeywords === true
    ? verified
      .filter(row => row.keywordOpportunity?.decision === 'observe')
      .sort((left, right) => Number(right.opportunityScore || 0) - Number(left.opportunityScore || 0))
      .slice(0, Math.max(1, Number(options.reviewKeywordLimit || 2)))
    : [];
  for (const row of autoFallbackRows) {
    row.autoFallbackEligible = true;
    row.autoFallbackReason = '严格机会词为空，已作为可复核备用词继续选品和标题生成';
  }
  appendJsonl(run.files.verifiedKeywords, verified);
  const generationEligible = verified.filter(isGenerationEligibleKeyword);
  const opportunityReview = verified.filter(row => {
    const decision = row.keywordOpportunity && row.keywordOpportunity.decision;
    return decision && decision !== 'continue';
  });
  if (options.recordSeedFeedback === true && verified.length > 0) {
    const outcomes = new Map();
    for (const row of verified) {
      const root = row.root || row.seed || row.coreProduct || '';
      if (!root) continue;
      const current = outcomes.get(root) || { root, verified: 0, generationEligible: 0 };
      current.verified += 1;
      if (isGenerationEligibleKeyword(row)) current.generationEligible += 1;
      outcomes.set(root, current);
    }
    applySeedFeedback([...outcomes.values()], {
      dataDir: options.keywordDataDir || path.join(process.cwd(), 'data', 'keyword-mining'),
      eventType: 'verification-outcome'
    });
  }
  const manualStatuses = ['login_required', 'slider_required', 'sycm_feature_required'];
  const hasManualAction = rejected.some(row => manualStatuses.includes(row.status));
  appendOpportunity('keywords', verified.map(row => ({
    runId: run.runId,
    keyword: row.keyword,
    signature: row.signature,
    coreProduct: row.coreProduct,
    status: row.status,
    opportunityScore: row.opportunityScore,
    decision: row.decision,
    nextAction: row.nextAction,
    verifyMode: row.verifyMode,
    confidence: row.confidence,
    usage: row.usage,
    fallbackUsed: row.fallbackUsed,
    sycmScore: row.sycmScore
  })), { runId: run.runId, dataDir: resolveOpportunityDir(options) });
  appendOpportunity('rejected', rejected.map(row => ({
    runId: run.runId,
    keyword: row.keyword,
    signature: row.signature,
    status: row.status,
    opportunityScore: row.opportunityScore || 0,
    decision: row.decision || 'reject',
    nextAction: row.nextAction || 'stop',
    reason: row.error || (row.sycmScore && row.sycmScore.reason) || ''
  })), { runId: run.runId, dataDir: resolveOpportunityDir(options) });
  run.status = hasManualAction
    ? (verified.length > 0 ? 'verified_partial_manual_required' : 'manual_action_required')
    : (verified.length > 0
      ? (generationEligible.length > 0 ? 'verified' : 'verified_no_generation_eligible')
      : 'verified_empty');
  run.counts.sycmVerified = verified.length;
  run.counts.sycmGenerationEligible = generationEligible.length;
  run.counts.sycmOpportunityReview = opportunityReview.length;
  run.counts.sycmReserveChecked = sycmResults.filter(row => row.phase === 'reserve').length;
  run.counts.sycmAutoFallbackEligible = autoFallbackRows.length;
  run.counts.sycmRejected = rejected.length;
  const verificationFailures = rejected.reduce((counts, row) => {
    const reason = String(row.status || 'sycm_rejected');
    counts[reason] = Number(counts[reason] || 0) + 1;
    return counts;
  }, {});
  setRunStageMetrics(run, 'verify', {
    input: verified.length + rejected.length,
    passed: verified.length,
    generationEligible: generationEligible.length,
    review: opportunityReview.length,
    rejected: rejected.length
  }, verificationFailures);
  writeRun(runDir, run);
  const nextCommand = hasManualAction
    ? buildFlowCommand('inspect', run.runId)
    : (generationEligible.length > 0
      ? buildFlowCommand('select', run.runId, { limit: options.select || options.generate || 10 })
      : buildFlowCommand('inspect', run.runId));
  return flowResponse({
    ok: true,
    runId: run.runId,
    status: run.status,
    verified,
    rejected,
    runDir,
    blockers: hasManualAction
      ? ['sycm_manual_action_required']
      : (verified.length > 0
        ? (generationEligible.length > 0 ? [] : ['no_generation_eligible_keywords'])
        : ['no_verified_keywords']),
    allowedCommands: [nextCommand],
    nextCommand
  });
}

module.exports = {
  flowVerify
};
