'use strict';

const fs = require('fs');
const { parse1688Url } = require('../../alibaba1688');
const { flowResponse } = require('./flow-context');
const {
  appendJsonl,
  getRun,
  initRun,
  readJsonl,
  setRunStageMetrics,
  writeRun
} = require('./run-store');
const {
  createManualDetailFetcher,
  normalizeManualOfferDetail
} = require('./product-normalizer');

/**
 * Create a run from manually entered keywords and 1688 URLs.
 * @param {object} [options] Manual workflow options.
 * @returns {object} Initialized run result.
 */
function flowManualStart(options = {}) {
  const inputItems = Array.isArray(options.items) ? options.items : [];
  if (inputItems.length === 0) throw new Error('至少输入一个关键词和 1688 商品链接');
  const normalizedItems = inputItems.map((item, index) => {
    const inputUrl = String(item?.url || '');
    let inputHostname = '';
    try {
      inputHostname = new URL(inputUrl).hostname;
    } catch (_error) {
      inputHostname = '';
    }
    const validHostname = inputHostname === '1688.com' || inputHostname.endsWith('.1688.com');
    const parsed = validHostname ? parse1688Url(inputUrl) : null;
    const keyword = String(item?.keyword || options.defaultKeyword || '').trim();
    if (!parsed) throw new Error(`第 ${index + 1} 个 1688 商品链接无效`);
    if (!keyword) throw new Error(`第 ${index + 1} 个商品缺少关键词`);
    return {
      clientId: String(item?.clientId || `manual-${parsed.offerId}`),
      keyword,
      selectedKeyword: keyword,
      offerId: parsed.offerId,
      url: `https://detail.1688.com/offer/${parsed.offerId}.html`,
      title: String(item?.title || '').trim(),
      category: String(item?.category || '').trim()
    };
  });
  const keywords = [...new Set(normalizedItems.map(item => item.keyword))];
  const { runDir, run } = initRun({
    ...options,
    options: { ...(options.options || {}), mode: 'manual', workflowVersion: 2 }
  });
  const candidates = keywords.map(keyword => ({
    keyword,
    selectedKeyword: keyword,
    status: 'keyword_approved',
    source: 'manual',
    reason: '用户手动输入',
    reviewStatus: 'approved',
    nextAction: 'fetch_product_details',
    signature: keyword,
    addedAt: new Date().toISOString()
  }));
  fs.writeFileSync(run.files.candidates, '', 'utf8');
  appendJsonl(run.files.candidates, candidates);
  fs.writeFileSync(run.files.reviewedCandidates, '', 'utf8');
  appendJsonl(run.files.reviewedCandidates, candidates);
  fs.writeFileSync(run.files.selectedProducts, '', 'utf8');
  appendJsonl(run.files.selectedProducts, normalizedItems.map(item => ({
    ...item,
    status: 'manual_input_pending',
    source: 'manual_url',
    product: {
      offerId: item.offerId,
      url: item.url,
      detailUrl: item.url,
      title: item.title,
      subject: item.title,
      category: item.category,
      '产品链接': item.url,
      '链接原标题': item.title,
      '类目': item.category
    },
    inputAt: new Date().toISOString()
  })));
  run.status = 'manual_products_received';
  run.counts.candidates = candidates.length;
  run.counts.keywordReviewApproved = candidates.length;
  run.counts.keywordReviewPending = 0;
  run.counts.manualInputProducts = normalizedItems.length;
  setRunStageMetrics(run, 'keywordReview', {
    input: candidates.length,
    passed: candidates.length,
    rejected: 0,
    pending: 0
  });
  writeRun(runDir, run);
  return flowResponse({
    ok: true,
    runId: run.runId,
    status: run.status,
    candidates,
    items: normalizedItems,
    runDir,
    blockers: [],
    nextActionCode: 'fetch_product_details',
    userMessage: `已录入 ${normalizedItems.length} 个商品，开始获取商品资料。`
  });
}

/**
 * Fetch product details for manually supplied 1688 URLs.
 * @param {object} [options] Manual product enrichment options.
 * @returns {Promise<object>} Enriched product result.
 */
async function flowEnrichManualProducts(options = {}) {
  const { runDir, run } = getRun(options);
  const rows = readJsonl(run.files.selectedProducts)
    .filter(row => ['manual_input_pending', 'enrich_failed', 'selected'].includes(row.status));
  const fetchDetail = createManualDetailFetcher(options);
  const enriched = [];
  for (const [index, row] of rows.entries()) {
    if (row.status === 'selected' && row.enrichStatus === 'completed' && options.retryCompleted !== true) {
      enriched.push(row);
      options.onProgress?.({
        current: index + 1,
        total: rows.length,
        message: `已保留 ${index + 1} / ${rows.length} 个商品资料`
      });
      continue;
    }
    options.onProgress?.({
      current: index,
      total: rows.length,
      message: `正在获取第 ${index + 1} / ${rows.length} 个商品资料`
    });
    try {
      const raw = await fetchDetail(row.offerId, row);
      const detail = normalizeManualOfferDetail(raw, row);
      if (!detail.title) throw new Error('1688 返回结果中没有商品标题');
      const product = {
        ...(row.product || {}),
        offerId: row.offerId,
        id: row.offerId,
        url: row.url,
        detailUrl: row.url,
        title: detail.title,
        subject: detail.title,
        category: detail.category,
        imageUrl: detail.imageUrl,
        price: detail.price,
        '产品链接': row.url,
        '链接原标题': detail.title,
        '主图链接': detail.imageUrl,
        '商品原价': detail.price,
        '类目': detail.category
      };
      enriched.push({
        ...row,
        status: 'selected',
        title: detail.title,
        sourceTitle: detail.title,
        recommendedCategory: detail.category,
        imageUrl: detail.imageUrl,
        price: detail.price,
        product,
        manualSelectionStatus: 'approved',
        enrichStatus: 'completed',
        enrichedAt: new Date().toISOString(),
        enrichError: ''
      });
    } catch (error) {
      enriched.push({
        ...row,
        status: 'enrich_failed',
        enrichStatus: 'failed',
        enrichError: error?.message || String(error),
        enrichErrorCode: error?.code || '',
        enrichedAt: new Date().toISOString()
      });
    }
    options.onProgress?.({
      current: index + 1,
      total: rows.length,
      message: `已处理 ${index + 1} / ${rows.length} 个商品`
    });
  }
  fs.writeFileSync(run.files.selectedProducts, '', 'utf8');
  appendJsonl(run.files.selectedProducts, enriched);
  const selected = enriched.filter(row => row.status === 'selected');
  const failed = enriched.filter(row => row.status === 'enrich_failed');
  run.status = selected.length > 0 ? 'products_selected' : 'select_failed';
  run.counts.selectedProducts = selected.length;
  run.counts.productEnrichFailed = failed.length;
  setRunStageMetrics(run, 'select', {
    input: enriched.length,
    passedGate: selected.length,
    selected: selected.length,
    review: 0,
    rejected: failed.length,
    notSelected: 0
  }, {
    product_detail_fetch_failed: failed.length
  });
  writeRun(runDir, run);
  return flowResponse({
    ok: selected.length > 0,
    runId: run.runId,
    status: run.status,
    selected,
    failed,
    runDir,
    blockers: selected.length > 0 ? [] : ['product_detail_fetch_failed'],
    userMessage: failed.length > 0
      ? `成功获取 ${selected.length} 个商品资料，${failed.length} 个失败。`
      : `成功获取 ${selected.length} 个商品资料。`
  });
}

/**
 * Persist manual product choices and optional hand-entered products.
 * @param {object} [options] Product review options.
 * @returns {object} Reviewed product result.
 */
function flowReviewProducts(options = {}) {
  const { runDir, run } = getRun(options);
  const rows = readJsonl(run.files.selectedProducts);
  const approvedIds = new Set((options.approvedProductIds || []).map(item => String(item || '').trim()).filter(Boolean));
  const manualProducts = Array.isArray(options.manualProducts) ? options.manualProducts : [];
  const identity = row => String(row.url || row.productUrl || row.product?.['产品链接'] || row.product?.url || row.offerId || '').trim();
  if (approvedIds.size === 0 && manualProducts.length === 0 && options.approveAll !== true) {
    run.status = 'awaiting_product_review';
    run.counts.productReviewPending = rows.length;
    setRunStageMetrics(run, 'select', {
      input: rows.length,
      passedGate: 0,
      selected: 0,
      review: rows.length,
      rejected: 0,
      notSelected: 0
    });
    writeRun(runDir, run);
    return flowResponse({ ok: true, runId: run.runId, status: run.status, products: rows, blockers: ['product_review_required'], runDir });
  }
  const selected = rows
    .filter(row => (
      options.approveAll === true
        ? row.status === 'selected'
        : approvedIds.has(identity(row))
    ))
    .map(row => ({
      ...row,
      status: 'selected',
      manualSelectionPreviousStatus: row.status,
      manualSelectionStatus: 'approved',
      selectionDecision: 'manual_approved',
      selectedAt: new Date().toISOString()
    }));
  for (const raw of manualProducts) {
    const url = String(raw.url || raw.productUrl || '').trim();
    const title = String(raw.title || raw.sourceTitle || '').trim();
    const category = String(raw.category || raw.recommendedCategory || '').trim();
    if (!url) continue;
    selected.push({
      status: 'selected',
      keyword: String(raw.keyword || options.keyword || '').trim(),
      selectedKeyword: String(raw.keyword || options.keyword || '').trim(),
      url,
      title,
      sourceTitle: title,
      recommendedCategory: category,
      product: { ...raw, url, title, subject: title, category },
      manualSelectionStatus: 'approved',
      selectedAt: new Date().toISOString()
    });
  }
  const unique = [...new Map(selected.map(row => [identity(row) || `${row.keyword}:${row.title}`, row])).values()];
  fs.writeFileSync(run.files.selectedProducts, '', 'utf8');
  appendJsonl(run.files.selectedProducts, unique);
  run.status = unique.length > 0 ? 'products_selected' : 'select_failed';
  run.counts.selectedProducts = unique.length;
  run.counts.productReviewPending = 0;
  setRunStageMetrics(run, 'select', {
    input: rows.length + manualProducts.length,
    passedGate: unique.length,
    selected: unique.length,
    review: 0,
    rejected: Math.max(0, rows.length + manualProducts.length - unique.length),
    notSelected: 0
  }, {
    manual_product_rejected: Math.max(0, rows.length + manualProducts.length - unique.length)
  });
  writeRun(runDir, run);
  return flowResponse({ ok: unique.length > 0, runId: run.runId, status: run.status, selected: unique, runDir, blockers: unique.length > 0 ? [] : ['no_selected_products'] });
}

module.exports = {
  flowEnrichManualProducts,
  flowManualStart,
  flowReviewProducts
};
