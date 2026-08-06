'use strict';

const fs = require('fs');
const path = require('path');
const { applySeedFeedback } = require('../../keyword-mining');
const { generateTitlePipeline } = require('../../title-gen');
const { searchAll } = require('../../alibaba1688');
const { getLLMProviderInfo } = require('../../../core/llm');
const { scoreProductOpportunity } = require('./opportunity-scoring');
const { appendOpportunity } = require('./opportunity-store');
const { appendJsonl, getRun, readJsonl, setRunStageMetrics, writeRun } = require('./run-store');
const { productTitle, productUrl } = require('./product-normalizer');
const { DEFAULT_PRODUCTS_PER_KEYWORD } = require('./flow-constants');
const {
  buildFlowCommand,
  flowResponse,
  isGenerationEligibleKeyword,
  resolveOpportunityDir
} = require('./flow-context');

/**
 * Generate titles and product rows for verified keywords.
 * @param {object} [options] Title generation options.
 * @returns {Promise<object>} Generation result.
 */
async function flowGenerate(options = {}) {
  const { runDir, run } = getRun(options);
  const verified = options.manualMode
    ? readJsonl(run.files.reviewedCandidates).filter(row => row.reviewStatus === 'approved' || row.status === 'keyword_approved')
    : readJsonl(run.files.verifiedKeywords);
  const selectedProducts = readJsonl(run.files.selectedProducts)
    .filter(row => row.status === 'selected' && row.product);
  const requireSelectedProducts = options.allowLegacyProductFallback !== true;
  let eligible = [];
  if (selectedProducts.length > 0) {
    eligible = Array.from(new Map(selectedProducts.map(row => [row.keyword, row])).values());
  } else if (!requireSelectedProducts) {
    eligible = options.includeReviewKeywords
      ? verified
      : verified.filter(isGenerationEligibleKeyword);
  }
  const limit = Number(options.limit || options.generate || eligible.length || 0);
  const selected = eligible.slice(0, limit);
  const generator = options.generator || generateTitlePipeline;
  const llmInfo = getLLMProviderInfo({ provider: options.llmProvider });
  const configuredTitleRunTimeoutMs = Number(options.titleRunTimeoutMs);
  const titleRunTimeoutMs = Number.isFinite(configuredTitleRunTimeoutMs) && configuredTitleRunTimeoutMs > 0
    ? Math.max(30000, configuredTitleRunTimeoutMs)
    : llmInfo.recommendedRunTimeoutMs;
  const generatedRows = [];

  fs.writeFileSync(run.files.generatedProducts, '', 'utf8');

  if (requireSelectedProducts && selectedProducts.length === 0) {
    const blockedRow = {
      status: 'generate_blocked',
      code: 'selected_products_required',
      error: '没有通过货源选品的商品，标题生成已停止',
      generatedAt: new Date().toISOString()
    };
    appendJsonl(run.files.generatedProducts, blockedRow);
    run.status = 'generate_failed';
    run.counts.titleGenerationInputs = 0;
    run.counts.generatedProducts = 0;
    run.counts.titleGenerationFailed = 1;
    setRunStageMetrics(run, 'generate', {
      input: 0,
      passed: 0,
      rejected: 1
    }, {
      selected_products_required: 1
    });
    writeRun(runDir, run);
    const nextCommand = buildFlowCommand('select', run.runId, { limit: options.select || options.generate || 10 });
    return flowResponse({
      ok: true,
      runId: run.runId,
      status: run.status,
      generated: [blockedRow],
      runDir,
      blockers: ['no_selected_products'],
      allowedCommands: [nextCommand],
      nextCommand
    });
  }

  for (const item of selected) {
    try {
      const productRowsForKeyword = selectedProducts.filter(row => row.keyword === item.keyword);
      const externalProducts = productRowsForKeyword.map(row => row.product);
      const result = await generator(item.keyword, {
        maxLength: Number(options.length || 60),
        limit: Number(options.productLimit || 0),
        silent: true,
        sycmData: item.sycmData || [],
        products: externalProducts,
        coreWord: item.coreWord || '',
        modifiers: item.modifiers || null,
        productLimit: externalProducts.length || undefined,
        runTimeoutMs: titleRunTimeoutMs,
        searchProducts: options.searchProducts || (({ coreWord, blueOceanWord, modifiers, semanticGroups }) =>
          searchAll(coreWord, blueOceanWord, modifiers, semanticGroups))
      });
      const products = Array.isArray(result.products) ? result.products : [];
      for (const product of products.slice(0, Number(options.productsPerKeyword || DEFAULT_PRODUCTS_PER_KEYWORD))) {
        const url = productUrl(product);
        const selectedProduct = productRowsForKeyword.find(row => row.url && row.url === url) || {};
        if (requireSelectedProducts && !selectedProduct.product) {
          generatedRows.push({
            status: 'generate_rejected',
            keyword: item.keyword,
            url,
            code: 'product_not_selected',
            error: '标题生成结果中的商品未通过货源选品',
            generatedAt: new Date().toISOString()
          });
          continue;
        }
        const mergedProduct = selectedProduct.product
          ? { ...selectedProduct.product, ...product }
          : product;
        const row = {
          status: 'generated',
          keyword: item.keyword,
          selectedKeyword: item.keyword,
          seed: item.seed || selectedProduct.seed || '',
          root: item.root || selectedProduct.root || item.seed || item.coreProduct || '',
          familyKey: item.familyKey || selectedProduct.familyKey || item.coreProduct || '',
          keywordOpportunity: item.keywordOpportunity || selectedProduct.keywordOpportunity,
          sycmScore: item.sycmScore || selectedProduct.sycmScore,
          sycmData: item.sycmData || [],
          recommendedCategory: options.manualMode
            ? (selectedProduct.recommendedCategory || item.recommendedCategory || '')
            : (item.recommendedCategory || selectedProduct.recommendedCategory || ''),
          verifyMode: item.verifyMode || selectedProduct.verifyMode || '',
          confidence: item.confidence || selectedProduct.confidence || '',
          usage: item.usage || selectedProduct.usage || '',
          fallbackUsed: !!item.fallbackUsed,
          fallbackReason: item.fallbackReason || selectedProduct.fallbackReason || '',
          selectedProduct,
          manualSelectionStatus: selectedProduct.manualSelectionStatus || '',
          product: mergedProduct,
          url,
          title: productTitle(mergedProduct),
          generatedAt: new Date().toISOString()
        };
        const productOpportunity = selectedProduct.productOpportunity || scoreProductOpportunity(mergedProduct, {
          keyword: item.keyword,
          verifyMode: item.verifyMode,
          confidence: item.confidence,
          usage: item.usage,
          sycmScore: item.sycmScore
        });
        row.productOpportunity = productOpportunity;
        row.opportunityScore = productOpportunity.score;
        row.decision = productOpportunity.decision;
        row.nextAction = productOpportunity.nextAction;
        generatedRows.push(row);
      }
    } catch (error) {
      generatedRows.push({
        status: 'generate_failed',
        keyword: item.keyword,
        error: error && error.message ? error.message : String(error),
        code: error && error.code ? error.code : '',
        source: error && error.source ? error.source : '',
        retryWith: error && error.retryWith ? error.retryWith : null,
        llmProvider: llmInfo.provider,
        llmProviderLabel: llmInfo.label,
        llmModel: llmInfo.model,
        generatedAt: new Date().toISOString()
      });
    }
  }

  appendJsonl(run.files.generatedProducts, generatedRows);
  appendOpportunity('products', generatedRows
    .filter(row => row.status === 'generated')
    .map(row => ({
      runId: run.runId,
      keyword: row.keyword,
      selectedKeyword: row.selectedKeyword || row.keyword,
      url: row.url,
      title: row.title,
      recommendedCategory: row.recommendedCategory,
      opportunityScore: row.opportunityScore,
      decision: row.decision,
      nextAction: row.nextAction,
      level: row.productOpportunity && row.productOpportunity.level,
      productOpportunity: row.productOpportunity,
      keywordOpportunity: row.keywordOpportunity
    })), { runId: run.runId, dataDir: resolveOpportunityDir(options) });
  run.status = generatedRows.some(row => row.status === 'generated') ? 'generated' : 'generate_failed';
  run.counts.generatedProducts = generatedRows.filter(row => row.status === 'generated').length;
  run.counts.titleGenerationInputs = selectedProducts.length;
  run.counts.titleGenerationFailed = generatedRows.filter(row => row.status !== 'generated').length;
  if (options.recordSeedFeedback === true && run.counts.generatedProducts > 0) {
    const generatedByRoot = new Map();
    for (const row of generatedRows.filter(item => item.status === 'generated')) {
      const root = row.root || row.seed || '';
      if (!root) continue;
      generatedByRoot.set(root, (generatedByRoot.get(root) || 0) + 1);
    }
    applySeedFeedback([...generatedByRoot].map(([root, generatedTitles]) => ({ root, generatedTitles })), {
      dataDir: options.keywordDataDir || path.join(process.cwd(), 'data', 'keyword-mining'),
      eventType: 'title-generation-outcome'
    });
  }
  const generationFailures = generatedRows
    .filter(row => row.status !== 'generated')
    .reduce((counts, row) => {
      const reason = String(row.code || row.status || 'title_generation_failed');
      counts[reason] = Number(counts[reason] || 0) + 1;
      return counts;
    }, {});
  setRunStageMetrics(run, 'generate', {
    input: selectedProducts.length,
    passed: run.counts.generatedProducts,
    rejected: run.counts.titleGenerationFailed
  }, generationFailures);
  writeRun(runDir, run);
  return flowResponse({
    ok: true,
    runId: run.runId,
    status: run.status,
    generated: generatedRows,
    runDir,
    blockers: run.counts.generatedProducts > 0 ? [] : ['no_generated_products'],
    allowedCommands: [run.counts.generatedProducts > 0
      ? buildFlowCommand('export', run.runId, { limit: options.export || 20 })
      : buildFlowCommand('inspect', run.runId)],
    nextCommand: run.counts.generatedProducts > 0
      ? buildFlowCommand('export', run.runId, { limit: options.export || 20 })
      : buildFlowCommand('inspect', run.runId)
  });
}

module.exports = {
  flowGenerate
};
