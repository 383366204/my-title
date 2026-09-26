'use strict';

const fs = require('fs');
const path = require('path');
const { applySeedFeedback } = require('../../keyword-mining/src/seed-feedback');
const { extractKeywords } = require('../../title-gen/src/extract-core');
const { searchAll } = require('../../alibaba1688/src/search-1688');
const { scoreProductOpportunity } = require('./opportunity-scoring');
const { buildPipelineDiversityHistory } = require('./diversity-history');
const { createProductDiversityState, selectDiverseProducts } = require('./product-diversity');
const { DEFAULT_FLOW_DIR, appendJsonl, getRun, readJsonl, setRunStageMetrics, writeRun } = require('./run-store');
const { productCategory, productImage, productPrice, productSales, productTitle, productUrl } = require('./product-normalizer');
const { DEFAULT_PRODUCTS_PER_KEYWORD } = require('./flow-constants');
const { sourceCategory } = require('./category-policy');
const { buildFlowCommand, flowResponse, isGenerationEligibleKeyword } = require('./flow-context');

/**
 * Select and score 1688 products for confirmed or user-specified keywords.
 * @param {object} [options] Product selection options.
 * @returns {Promise<object>} Selection result.
 */
async function flowSelectProducts(options = {}) {
  const { runDir, run } = getRun(options);
  // 精确词代表用户的选品意图，直接使用输入记录，不伪造生意参谋验真结果。
  const exactMode = run.options?.mode === 'keyword';
  const keywords = exactMode
    ? readJsonl(run.files.candidates)
    : options.manualMode
    ? readJsonl(run.files.reviewedCandidates).filter(row => row.reviewStatus === 'approved' || row.status === 'keyword_approved')
    : readJsonl(run.files.verifiedKeywords);
  const eligible = exactMode || options.includeReviewKeywords
    ? keywords
    : keywords.filter(isGenerationEligibleKeyword);
  const limit = Number(options.limit || options.select || options.generate || eligible.length || 0);
  const selectedKeywords = eligible.slice(0, limit);
  const productsPerKeyword = Number(options.productsPerKeyword || DEFAULT_PRODUCTS_PER_KEYWORD);
  const selectedRows = [];
  const diversityHistory = options.diversityHistory || buildPipelineDiversityHistory({
    dataDir: options.dataDir || DEFAULT_FLOW_DIR,
    excludeRunId: run.runId,
    ttlDays: options.diversityHistoryDays || 90
  });
  const diversityState = createProductDiversityState();
  const diversityStats = {
    input: 0,
    selected: 0,
    newOffers: 0,
    historyFallbackCount: 0,
    filteredReasons: {}
  };
  const gateStats = {
    input: 0,
    passed: 0,
    review: 0,
    rejected: 0,
    notSelected: 0
  };

  fs.writeFileSync(run.files.selectedProducts, '', 'utf8');

  options.onProgress?.({ current: 0, total: selectedKeywords.length, message: '开始查询 1688 货源' });
  for (const [index, item] of selectedKeywords.entries()) {
    let failureStage = 'extract';
    options.onProgress?.({ current: index, total: selectedKeywords.length, message: `正在查询货源：${item.keyword}` });
    try {
      const extracted = await (options.extractKeywords || extractKeywords)('keyword', { data: item.keyword });
      const coreWord = extracted.coreWord || item.coreProduct || item.keyword;
      const modifiers = Array.isArray(extracted.modifiers) ? extracted.modifiers : [];
      const semanticGroups = extracted.semanticGroups || {};
      failureStage = 'search';
      const products = await (options.searchProducts || searchAll)(
        coreWord,
        item.keyword,
        modifiers,
        semanticGroups,
        options.searchOptions || {}
      );
      failureStage = 'scoring';
      const scoredProducts = (Array.isArray(products) ? products : []).map(product => {
        const normalizedProduct = {
          ...product,
          url: productUrl(product),
          imageUrl: productImage(product)
        };
        const opportunity = scoreProductOpportunity(normalizedProduct, {
          keyword: item.keyword,
          verifyMode: item.verifyMode,
          confidence: item.confidence,
          usage: item.usage,
          sycmScore: item.sycmScore
        });
        return {
          status: 'evaluated',
          keyword: item.keyword,
          selectedKeyword: item.keyword,
          seed: item.seed || '',
          root: item.root || item.seed || item.coreProduct || '',
          familyKey: item.familyKey || item.coreProduct || '',
          coreWord,
          modifiers,
          keywordOpportunity: item.keywordOpportunity,
          sycmScore: item.sycmScore,
          sycmData: item.sycmData || [],
          recommendedCategory: productCategory(normalizedProduct, item),
          source1688Category: sourceCategory({ product: normalizedProduct }),
          sycmCategoryEvidence: item.sycmCategoryEvidence,
          categorySelection: item.categorySelection,
          verifyMode: item.verifyMode || '',
          confidence: item.confidence || '',
          usage: item.usage || '',
          fallbackUsed: !!item.fallbackUsed,
          fallbackReason: item.fallbackReason || '',
          product: normalizedProduct,
          url: normalizedProduct.url,
          sourceTitle: productTitle(normalizedProduct),
          title: productTitle(normalizedProduct),
          price: productPrice(normalizedProduct),
          sales30days: productSales(normalizedProduct),
          imageUrl: normalizedProduct.imageUrl,
          productOpportunity: opportunity,
          opportunityScore: opportunity.score,
          decision: opportunity.decision,
          nextAction: opportunity.nextAction,
          selectedAt: new Date().toISOString()
        };
      });
      const passedGate = scoredProducts.filter(row => row.decision === 'continue');
      const reviewGate = scoredProducts.filter(row => row.decision === 'review');
      const rejectedGate = scoredProducts.filter(row => row.decision === 'reject');
      const selectionPool = options.includeReviewProducts === true
        ? [...passedGate, ...reviewGate]
        : passedGate;
      const diverseProducts = selectDiverseProducts(selectionPool, {
        history: diversityHistory,
        state: diversityState,
        limit: productsPerKeyword,
        maxPerSupplier: Number(options.maxProductsPerSupplier || 2),
        titleSimilarityThreshold: Number(options.productTitleSimilarityThreshold || 0.92),
        generatedOfferCooldownDays: Number(options.generatedOfferCooldownDays || 7),
        distributedOfferCooldownDays: Number(options.distributedOfferCooldownDays || 30),
        allowHistoryFallback: options.allowProductHistoryFallback !== false
      });
      const selectedForKeyword = diverseProducts.selected.map(row => ({
        ...row,
        status: 'selected',
        selectionDecision: row.decision === 'review' ? 'manual_override_pool' : 'strict_gate'
      }));
      const selectedUrls = new Set(selectedForKeyword.map(row => row.url).filter(Boolean));
      const notSelectedRows = scoredProducts
        .filter(row => !selectedUrls.has(row.url))
        .map(row => ({
          ...row,
          status: row.decision === 'reject'
            ? 'product_rejected'
            : row.decision === 'review'
              ? 'product_review'
              : 'product_not_selected',
          selectionDecision: row.decision === 'reject'
            ? 'opportunity_gate_rejected'
            : row.decision === 'review'
              ? 'manual_review_required'
              : 'diversity_or_limit'
        }));
      selectedRows.push(...selectedForKeyword, ...notSelectedRows);
      gateStats.input += scoredProducts.length;
      gateStats.passed += passedGate.length;
      gateStats.review += reviewGate.length;
      gateStats.rejected += rejectedGate.length;
      gateStats.notSelected += notSelectedRows.filter(row => row.status === 'product_not_selected').length;
      diversityStats.input += diverseProducts.stats.input;
      diversityStats.selected += diverseProducts.stats.selected;
      diversityStats.newOffers += diverseProducts.stats.newOffers;
      diversityStats.historyFallbackCount += diverseProducts.stats.historyFallbackCount;
      for (const [reason, count] of Object.entries(diverseProducts.stats.filteredReasons || {})) {
        diversityStats.filteredReasons[reason] = Number(diversityStats.filteredReasons[reason] || 0) + Number(count || 0);
      }
    } catch (error) {
      selectedRows.push({
        status: 'select_failed',
        failureStage,
        httpStatus: Number(error.response?.status || error.status) || null,
        keyword: item.keyword,
        selectedKeyword: item.keyword,
        error: error && error.message ? error.message : String(error),
        selectedAt: new Date().toISOString()
      });
    }
    options.onProgress?.({ current: index + 1, total: selectedKeywords.length,
      message: `货源查询 ${index + 1}/${selectedKeywords.length}，取得 ${gateStats.input} 个商品，${selectedRows.filter(row => row.status === 'select_failed').length} 个词查询失败` });
  }

  appendJsonl(run.files.selectedProducts, selectedRows);
  const selectedCount = selectedRows.filter(row => row.status === 'selected').length;
  if (options.recordSeedFeedback === true && selectedCount > 0) {
    const selectedByRoot = new Map();
    for (const row of selectedRows.filter(item => item.status === 'selected')) {
      const root = row.root || row.seed || '';
      if (!root) continue;
      selectedByRoot.set(root, (selectedByRoot.get(root) || 0) + 1);
    }
    applySeedFeedback([...selectedByRoot].map(([root, selectedProducts]) => ({ root, selectedProducts })), {
      dataDir: options.keywordDataDir || path.join(process.cwd(), 'data', 'keyword-mining'),
      eventType: 'product-selection-outcome'
    });
  }
  run.status = selectedCount > 0 ? 'products_selected' : 'select_failed';
  run.counts.selectedProducts = selectedCount;
  run.counts.productsEvaluated = gateStats.input;
  run.counts.productSearchFailures = selectedRows.filter(row => row.status === 'select_failed').length;
  run.counts.productGatePassed = gateStats.passed;
  run.counts.productReviewCandidates = gateStats.review;
  run.counts.productRejected = gateStats.rejected;
  run.diversity = {
    ...(run.diversity || {}),
    product: {
      ...diversityStats,
      suppliers: diversityState.supplierCounts.size,
      uniqueOffers: diversityState.offerIds.size,
      historyRunsScanned: Number(diversityHistory.stats?.runsScanned || 0)
    }
  };
  setRunStageMetrics(run, 'select', {
    input: gateStats.input,
    passedGate: gateStats.passed,
    selected: selectedCount,
    review: gateStats.review,
    rejected: gateStats.rejected,
    notSelected: gateStats.notSelected
  }, {
    product_opportunity_reject: gateStats.rejected,
    product_opportunity_review: gateStats.review,
    diversity_or_limit: gateStats.notSelected,
    ...diversityStats.filteredReasons
  });
  writeRun(runDir, run);
  return flowResponse({
    ok: true,
    runId: run.runId,
    status: run.status,
    selected: selectedRows,
    evaluated: selectedRows,
    diversity: run.diversity.product,
    runDir,
    blockers: selectedCount > 0 ? [] : ['no_selected_products'],
    allowedCommands: [selectedCount > 0
      ? buildFlowCommand('generate', run.runId, { limit: options.generate || 10 })
      : buildFlowCommand('inspect', run.runId)],
    nextCommand: selectedCount > 0
      ? buildFlowCommand('generate', run.runId, { limit: options.generate || 10 })
      : buildFlowCommand('inspect', run.runId)
  });
}

module.exports = {
  flowSelectProducts
};
