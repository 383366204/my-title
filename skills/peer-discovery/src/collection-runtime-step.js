'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { extractSourceProducts } = require('./source-extractor');
const { findSimilarProducts } = require('./similar-finder');
const { collectPeerProducts } = require('./collect-peer-products');
const { isPlatformBlocker } = require('./sourcing-matcher');

/**
 * Adapt source extraction to pipeline control/progress contract.
 * @param {object} options Run directory, params, client, reportProgress, shouldStop.
 * @returns {Promise<object>} Runtime completion, pause or blocked result.
 */
async function runPeerExtractStep(options) {
  const controller = new AbortController();
  let requestedAction = null;
  const checkControl = () => {
    const action = options.shouldStop?.();
    if (action === 'pause' || action === 'cancel') {
      requestedAction = action;
      controller.abort();
    }
  };
  checkControl();
  const timer = setInterval(checkControl, 200);
  timer.unref();
  const interrupted = () => ({ status: requestedAction === 'cancel' ? 'cancelled' : 'paused', stepIncomplete: true });
  const blocked = (message, details = {}) => ({
    status: 'manual_action_required', stepIncomplete: true, platform: 'taobao',
    ...details, manualAction: { userMessage: message },
    actionHint: message, nextRecommendedAction: 'retry',
  });

  try {
    if (requestedAction) return interrupted();
    const extract = options.extract || extractSourceProducts;
    const result = await extract({
      links: options.params?.links || options.links,
      rawLinks: options.params?.rawLinks || options.rawLinks,
      runDir: options.runDir,
      dataDir: options.dataDir,
      runId: options.runId,
      port: options.params?.port || options.port,
      client: options.client,
      signal: controller.signal,
      onProgress: progress => options.reportProgress?.({
        current: progress.current,
        total: progress.total,
        message: progress.message || `正在提取源商品 (${progress.current}/${progress.total})`
      })
    });
    checkControl();
    if (requestedAction) return interrupted();
    const products = result.products || result.sourceProducts || [];
    if (result.ok === false || result.status === 'manual_action_required' || products.length === 0) {
      const reason = (result.errors || []).map(error => error.message).filter(Boolean).join('；');
      return blocked(reason || result.message || '未提取到有效源商品，请检查商品链接后重试', {
        errors: result.errors || [], sourceProducts: products, validCount: products.length,
      });
    }
    return {
      status: 'completed',
      sourceProducts: products,
      validCount: products.length,
      total: result.total || products.length,
      errors: result.errors || []
    };
  } catch (error) {
    if (requestedAction) return interrupted();
    if (isPlatformBlocker(error)) {
      return blocked(error.message, { platformStatus: error.platformStatus || error.status || error.code || 'blocked' });
    }
    throw error;
  } finally {
    clearInterval(timer);
  }
}

/**
 * Adapt finding similar products and candidate shop aggregation to pipeline control/progress contract.
 * @param {object} options Run directory, params, imageSearcher, reportProgress, shouldStop.
 * @returns {Promise<object>} Runtime completion, pause or blocked result.
 */
async function runPeerSimilarStep(options) {
  const controller = new AbortController();
  let requestedAction = null;
  const checkControl = () => {
    const action = options.shouldStop?.();
    if (action === 'pause' || action === 'cancel') {
      requestedAction = action;
      controller.abort();
    }
  };
  checkControl();
  const timer = setInterval(checkControl, 200);
  timer.unref();
  const interrupted = () => ({ status: requestedAction === 'cancel' ? 'cancelled' : 'paused', stepIncomplete: true });
  const blocked = (message, details = {}) => ({
    status: 'manual_action_required', stepIncomplete: true, platform: 'taobao',
    ...details, manualAction: { userMessage: message },
    actionHint: message, nextRecommendedAction: 'retry',
  });

  try {
    if (requestedAction) return interrupted();
    const find = options.find || findSimilarProducts;
    const result = await find({
      sourceProducts: options.sourceProducts,
      runDir: options.runDir,
      dataDir: options.dataDir,
      runId: options.runId,
      maxCandidateShops: options.params?.maxCandidateShops ?? options.maxCandidateShops ?? 30,
      channel: options.params?.taobaoChannel || options.channel || 'auto',
      port: options.params?.port || options.port,
      imageSearcher: options.imageSearcher,
      signal: controller.signal,
      onProgress: progress => options.reportProgress?.({
        current: progress.current,
        total: progress.total,
        message: progress.message || `正在图搜同款 (${progress.current}/${progress.total})`
      })
    });
    checkControl();
    if (requestedAction) return interrupted();
    if (result.ok === false || result.status === 'manual_action_required') {
      return blocked(result.message || (result.errors || []).map(error => error.message).filter(Boolean).join('；') || '同款搜索失败，请重试', {
        errors: result.errors || [],
      });
    }
    return {
      status: 'completed',
      candidates: result.candidates || [],
      candidateCount: result.candidateCount || (result.candidates || []).length,
      similarCount: result.similarCount || (result.similarProducts || []).length,
      errors: result.errors || []
    };
  } catch (error) {
    if (requestedAction) return interrupted();
    if (isPlatformBlocker(error)) {
      return blocked(error.message, { platformStatus: error.platformStatus || error.status || error.code || 'blocked' });
    }
    throw error;
  } finally {
    clearInterval(timer);
  }
}

/**
 * Adapt durable collection to the existing pipeline control/progress contract.
 * @param {object} options Run directory, shops, channel, params and runtime callbacks.
 * @returns {Promise<object>} Existing runtime completion, pause or blocked result.
 */
async function runPeerCollectionStep(options) {
  const controller = new AbortController();
  let requestedAction = null;
  const checkControl = () => {
    const action = options.shouldStop?.();
    if (action === 'pause' || action === 'cancel') {
      requestedAction = action;
      controller.abort();
    }
  };
  checkControl();
  const timer = setInterval(checkControl, 200);
  timer.unref();
  const interrupted = () => ({ status: requestedAction === 'cancel' ? 'cancelled' : 'paused', stepIncomplete: true });
  const blocked = (message, details = {}) => ({
    status: 'manual_action_required', stepIncomplete: true, platform: 'taobao',
    ...details, manualAction: { userMessage: message },
    actionHint: message, nextRecommendedAction: 'retry',
  });
  try {
    if (requestedAction) return interrupted();
    let shops = options.shops;
    if (!shops && options.runDir) {
      try {
        const content = await fs.readFile(path.join(options.runDir, 'candidate-shops.jsonl'), 'utf8');
        shops = content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      } catch (_) {
        shops = [];
      }
    }
    const channel = options.channel || options.params?.resolvedTaobaoChannel || (options.params?.taobaoChannel === 'web' ? 'web' : 'native');
    const collect = options.collect || collectPeerProducts;
    const result = await collect({
      runDir: options.runDir, shops, channel,
      params: options.params, signal: controller.signal,
      onProgress: progress => options.reportProgress?.({
        current: progress.current, total: progress.total,
        message: progress.shopKey
          ? `店铺 ${progress.shopKey}：已采集 ${progress.collected ?? 0} 个商品`
          : '正在采集同行商品',
      }),
    });
    checkControl();
    if (requestedAction) return interrupted();
    if (result.status === 'needs_attention') return {
      ...result, ...blocked('部分店铺加载停滞或超时，已保存采集结果，请检查浏览器后重试当前节点'),
    };
    if (result.status !== 'completed') throw new Error('同行采集返回未知状态');
    return result;
  } catch (error) {
    if (requestedAction) return interrupted();
    if (isPlatformBlocker(error)) {
      return blocked(error.message, { platformStatus: error.platformStatus || error.status || error.code || 'blocked' });
    }
    throw error;
  } finally {
    clearInterval(timer);
  }
}

const { runPeerVerifyImageSourcesStep } = require('./verify-image-sources-step');
const { runPeerPrepareListingDraftsStep } = require('./listing-draft-preparer');
const { runPeerReviewListingsStep } = require('./peer-listing-adapter');
const { runPeerProductReportStep } = require('./peer-product-report-writer');
const { runPeerEvaluateShopsStep } = require('./shop-evaluator');
const { runPeerReportStep } = require('./peer-report-writer');

module.exports = {
  runPeerExtractStep,
  runPeerSimilarStep,
  runPeerCollectionStep,
  runPeerVerifyImageSourcesStep,
  runPeerPrepareListingDraftsStep,
  runPeerReviewListingsStep,
  runPeerProductReportStep,
  runPeerEvaluateShopsStep,
  runPeerReportStep
};
