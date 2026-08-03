'use strict';

const fs = require('fs');
const path = require('path');
const { applySeedFeedback } = require('../../keyword-mining');
const { extractKeywords } = require('../../title-gen/src/extract-core');
const { searchAll } = require('../../alibaba1688');
const { scoreProductOpportunity } = require('./opportunity-scoring');
const { buildPipelineDiversityHistory } = require('./diversity-history');
const { createProductDiversityState, selectDiverseProducts } = require('./product-diversity');
const {
  DEFAULT_FLOW_DIR,
  appendJsonl,
  getRun,
  readJsonl,
  writeRun
} = require('./run-store');
const {
  productImage,
  productPrice,
  productSales,
  productTitle,
  productUrl
} = require('./product-normalizer');
const { DEFAULT_PRODUCTS_PER_KEYWORD } = require('./flow-constants');
const {
  buildFlowCommand,
  flowResponse,
  isGenerationEligibleKeyword
} = require('./flow-context');

/**
 * Select and score 1688 products for verified keywords.
 * @param {object} [options] Product selection options.
 * @returns {Promise<object>} Selection result.
 */
async function flowSelectProducts(options = {}) {
  const { runDir, run } = getRun(options);
  const verified = options.manualMode
    ? readJsonl(run.files.reviewedCandidates).filter(row => row.reviewStatus === 'approved' || row.status === 'keyword_approved')
    : readJsonl(run.files.verifiedKeywords);
  const eligible = options.includeReviewKeywords
    ? verified
    : verified.filter(isGenerationEligibleKeyword);
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

  fs.writeFileSync(run.files.selectedProducts, '', 'utf8');

  for (const item of selectedKeywords) {
    try {
      const extracted = await extractKeywords('keyword', { data: item.keyword });
      const coreWord = extracted.coreWord || item.coreProduct || item.keyword;
      const modifiers = Array.isArray(extracted.modifiers) ? extracted.modifiers : [];
      const semanticGroups = extracted.semanticGroups || {};
      const products = await (options.searchProducts || searchAll)(
        coreWord,
        item.keyword,
        modifiers,
        semanticGroups,
        options.searchOptions || {}
      );
      const scoredProducts = (Array.isArray(products) ? products : []).map(product => {
        const opportunity = scoreProductOpportunity(product, {
          keyword: item.keyword,
          verifyMode: item.verifyMode,
          confidence: item.confidence,
          usage: item.usage,
          sycmScore: item.sycmScore
        });
        return {
          status: 'selected',
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
          recommendedCategory: item.recommendedCategory || '',
          verifyMode: item.verifyMode || '',
          confidence: item.confidence || '',
          usage: item.usage || '',
          fallbackUsed: !!item.fallbackUsed,
          fallbackReason: item.fallbackReason || '',
          product,
          url: productUrl(product),
          sourceTitle: productTitle(product),
          title: productTitle(product),
          price: productPrice(product),
          sales30days: productSales(product),
          imageUrl: productImage(product),
          productOpportunity: opportunity,
          opportunityScore: opportunity.score,
          decision: opportunity.decision,
          nextAction: opportunity.nextAction,
          selectedAt: new Date().toISOString()
        };
      });
      const diverseProducts = selectDiverseProducts(scoredProducts, {
        history: diversityHistory,
        state: diversityState,
        limit: productsPerKeyword,
        maxPerSupplier: Number(options.maxProductsPerSupplier || 2),
        titleSimilarityThreshold: Number(options.productTitleSimilarityThreshold || 0.92),
        generatedOfferCooldownDays: Number(options.generatedOfferCooldownDays || 7),
        distributedOfferCooldownDays: Number(options.distributedOfferCooldownDays || 30),
        allowHistoryFallback: options.allowProductHistoryFallback !== false
      });
      selectedRows.push(...diverseProducts.selected);
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
        keyword: item.keyword,
        selectedKeyword: item.keyword,
        error: error && error.message ? error.message : String(error),
        selectedAt: new Date().toISOString()
      });
    }
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
  run.diversity = {
    ...(run.diversity || {}),
    product: {
      ...diversityStats,
      suppliers: diversityState.supplierCounts.size,
      uniqueOffers: diversityState.offerIds.size,
      historyRunsScanned: Number(diversityHistory.stats?.runsScanned || 0)
    }
  };
  writeRun(runDir, run);
  return flowResponse({
    ok: true,
    runId: run.runId,
    status: run.status,
    selected: selectedRows,
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
