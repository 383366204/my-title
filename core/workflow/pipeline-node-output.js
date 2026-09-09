'use strict';

const fs = require('fs');
const { WORKFLOW_NODE_IDS } = require('./pipeline-definition-common');

/**
 * @param {string} id 画布节点 ID。
 * @param {object} summary 业务运行摘要。
 * @returns {object|null} 节点产物摘要，不读取完整文件。
 */
function outputForNode(id, summary) {
  const counts = summary.counts || {};
  if (id === WORKFLOW_NODE_IDS.start) return { runId: summary.runId };
  if (id === WORKFLOW_NODE_IDS.mine) return {
    count: Number(counts.candidates || 0),
    inspirationCount: Number(counts.inspirations || 0),
    inspirationRejected: Number(counts.inspirationRejected || 0),
    productizedRoots: Number(counts.productizedRoots || 0),
    selectedRoots: Number(counts.selectedRoots || 0),
    file: summary.files?.candidates || '',
    inspirationFile: summary.files?.inspirations || '',
    rootCandidatesFile: summary.files?.rootCandidates || '',
    discovery: summary.discovery || null,
    diversity: summary.diversity?.keyword || null
  };
  if (id === WORKFLOW_NODE_IDS.keywordReview) {
    return {
      approved: Number(counts.keywordReviewApproved || 0),
      rejected: Number(counts.keywordReviewRejected || 0),
      pending: Number(counts.keywordReviewPending || 0),
      file: summary.files?.reviewedCandidates || ''
    };
  }
  if (id === WORKFLOW_NODE_IDS.verify) {
    return {
      verified: Number(counts.sycmVerified || 0),
      assignedProducts: Number(counts.sycmVerifiedProducts || counts.sycmVerified || 0) + Number(counts.manualKeywordFallback || 0),
      manualReview: Number(counts.manualKeywordFallback || 0),
      rejected: Number(counts.sycmRejected || 0),
      generationEligible: Number(counts.sycmGenerationEligible || 0),
      opportunityReview: Number(counts.sycmOpportunityReview || 0),
      file: summary.files?.verifiedKeywords || ''
    };
  }
  if (id === WORKFLOW_NODE_IDS.select) {
    const hasSelectedFile = Boolean(summary.files?.selectedProducts && fs.existsSync(summary.files.selectedProducts));
    const count = Number(counts.selectedProducts || (!hasSelectedFile ? counts.generatedProducts : 0) || 0);
    return {
      count,
      productCount: count,
      failed: Number(counts.productEnrichFailed || 0),
      file: summary.files?.selectedProducts || '',
      diversity: summary.diversity?.product || null
    };
  }
  if (id === WORKFLOW_NODE_IDS.generate) {
    const count = Number(counts.generatedProducts || 0);
    return {
      count,
      recordCount: count,
      titleCount: count,
      sourceCount: count,
      file: summary.files?.generatedProducts || ''
    };
  }
  if (id === WORKFLOW_NODE_IDS.export) {
    return {
      count: Number(summary.batchCount || counts.readyToDistribute || 0),
      batchFile: summary.batchFile || summary.files?.distributionBatch || '',
      reviewFile: summary.reviewFile || summary.files?.distributionReview || '',
      mustReview: !!summary.mustReview
    };
  }
  if (id === WORKFLOW_NODE_IDS.collectRank) {
    return {
      count: Number(counts.productRank || 0),
      pages: Number(counts.productRankPages || summary.productRank?.pagesCollected || 0),
      file: summary.files?.productRank || '',
      period: summary.productRank?.period || '',
      dateMode: summary.productRank?.dateMode || '',
      startDate: summary.productRank?.startDate || '',
      endDate: summary.productRank?.endDate || '',
      sort: summary.productRank?.sort || '',
      sortMetric: summary.productRank?.sortMetric || '',
      sortLabel: summary.productRank?.sortLabel || '',
      storeName: summary.productRank?.storeName || '',
      statDate: summary.productRank?.statDate || '',
      inputMode: summary.productRank?.inputMode || summary.options?.inputMode || 'rank',
      rankCount: Number(counts.rankCount ?? summary.productRank?.rankCount ?? counts.productRank ?? 0),
      manualCount: Number(counts.manualCount ?? summary.productRank?.manualCount ?? 0)
    };
  }
  if (id === WORKFLOW_NODE_IDS.confirmProducts) {
    return {
      groupCount: Number(counts.orderGroups ?? summary.productRank?.groupCount ?? summary.orderGroups?.length ?? 0),
      productCount: Number(counts.productRank ?? counts.confirmedProducts ?? summary.productRank?.totalCount ?? 0),
      file: summary.files?.productGroups || summary.files?.productRank || '',
      status: summary.status || ''
    };
  }
  if (id === WORKFLOW_NODE_IDS.importSheet) {
    return {
      groupCount: Number(counts.reviewGroups || 0),
      productCount: Number(counts.reviewSourceProducts || 0),
      file: summary.files?.reviewGroups || ''
    };
  }
  if (id === WORKFLOW_NODE_IDS.generateReviews) {
    const quality = summary.reviewGeneration?.qualitySummary || {};
    const missing = Number(quality.missing || 0);
    return {
      count: Number(counts.reviewDrafts || 0),
      degraded: summary.reviewGeneration?.degraded === true,
      missing,
      blocked: Math.max(0, Number(quality.blocked || 0) - missing),
      warning: Number(quality.warning || 0),
      file: summary.files?.reviewDrafts || ''
    };
  }
  if (id === WORKFLOW_NODE_IDS.generateSheet) {
    return {
      count: Number(counts.orderSheetRows || 0),
      imageCount: Number(counts.orderSheetImages || 0),
      skippedCount: Number(counts.orderSheetSkipped || 0),
      sheetType: summary.options?.sheetType === 'review' ? 'review' : 'order',
      includeRawData: summary.options?.includeRawData !== false,
      file: summary.files?.orderSheet || ''
    };
  }
  if (id === WORKFLOW_NODE_IDS.resolveShops) {
    return {
      count: Number(counts.competitorShops || 0),
      failed: Number(counts.competitorResolveFailed || 0),
      file: summary.files?.competitorShops || ''
    };
  }
  if (id === WORKFLOW_NODE_IDS.collectCompetitors) {
    return {
      count: Number(counts.competitorHotProducts || 0) + Number(counts.competitorNewProducts || 0),
      hotCount: Number(counts.competitorHotProducts || 0),
      newCount: Number(counts.competitorNewProducts || 0),
      failed: Number(counts.competitorCollectFailed || 0),
      file: summary.files?.competitorHotProducts || '',
      newFile: summary.files?.competitorNewProducts || ''
    };
  }
  if (id === WORKFLOW_NODE_IDS.enrichCompetitors) {
    return {
      count: Number(counts.competitorProductDetails || 0),
      failed: Number(counts.competitorProductLinkFailed || 0),
      file: summary.files?.competitorProductDetails || ''
    };
  }
  if (id === WORKFLOW_NODE_IDS.analyzeCompetitors) {
    return {
      count: Number(counts.competitorOpportunityKeywords || 0),
      file: summary.files?.competitorAnalysis || ''
    };
  }
  if (id === WORKFLOW_NODE_IDS.competitorReport) {
    return {
      count: Number(counts.competitorReportRows || 0),
      file: summary.files?.competitorReport || ''
    };
  }
  if (id === WORKFLOW_NODE_IDS.review) {
    return { reviewFile: summary.reviewFile || summary.files?.distributionReview || '', mustReview: !!summary.mustReview };
  }
  if (id === WORKFLOW_NODE_IDS.end) return { canSubmit: !!summary.canSubmit, runId: summary.runId || '' };
  return null;
}

module.exports = { outputForNode };
