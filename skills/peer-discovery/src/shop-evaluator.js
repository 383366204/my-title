'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { collectShopCandidates, parsePaymentSignal } = require('./shared-shop-collector');
const { matchSourcing, isPlatformBlocker } = require('./sourcing-matcher');
const { enrichCompetitorProduct } = require('../../competitor-analysis/src/collector');
const { resolveRuntimeTaobaoChannel: resolveTaobaoChannel } = require('./runtime-taobao-channel');

function hashConfig(obj) {
  const sorted = Object.keys(obj || {}).sort().reduce((acc, k) => {
    acc[k] = obj[k];
    return acc;
  }, {});
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 16);
}

/**
 * 原同行分支专用包装器：采集达标商品并做货源验证。
 * @param {object} shop 候选店铺
 * @param {object} options 采集与判定配置
 * @returns {Promise<object>}
 */
async function collectQualifiedProducts(shop, options = {}) {
  const minProducts = options.minProducts ?? 10;
  const snapshot = await collectShopCandidates(shop, options);
  const qualified = snapshot.products || [];
  const collectionCompleteness = snapshot.completeness || 'uncertain';

  if (qualified.length < minProducts) {
    return {
      status: 'insufficient_products',
      actual: qualified.length,
      required: minProducts,
      totalCollected: snapshot.totalCollected || 0,
      collectionCompleteness,
      collectionComplete: collectionCompleteness === 'reached_end',
      products: []
    };
  }

  const normalizedQualified = qualified.map(p => ({
    ...p,
    taobaoPrice: p.taobaoPrice ?? p.price ?? null,
    title: p.detailTitle || p.title,
    paymentLowerBound: parsePaymentSignal(p.paymentText).value
  }));

  const productsWithSourcing = [];
  for (const product of normalizedQualified) {
    let enriched = product;
    if (options.client) {
      try {
        enriched = await enrichCompetitorProduct(shop, product, { client: options.client });
        enriched.taobaoPrice = product.taobaoPrice;
        enriched.paymentLowerBound = product.paymentLowerBound;
      } catch (err) {
        if (isPlatformBlocker(err)) {
          err.platform = err.platform || 'taobao';
          err.platformStatus = err.status || err.code || 'unknown';
          err.actionHint = err.message || '淘宝客户端需要处理';
          throw err;
        }
        enriched = { ...product, enrichmentError: err.message };
      }
    }

    let sourcing;
    try {
      sourcing = await matchSourcing(enriched, options);
    } catch (err) {
      if (isPlatformBlocker(err)) {
        err.platform = err.platform || '1688';
        throw err;
      }
      sourcing = { level: 'inconclusive', reason: 'sourcing_error', error: err.message };
    }

    productsWithSourcing.push({
      title: enriched.title,
      productUrl: enriched.productUrl,
      paymentText: product.paymentText,
      paymentLowerBound: product.paymentLowerBound,
      taobaoPrice: product.taobaoPrice,
      sourcing
    });

    // 提前终止优化：若 confirmed 已达 minSourcing，无需继续验证剩余商品
    const confirmedSoFar = productsWithSourcing.filter(p => p.sourcing.level === 'confirmed').length;
    if (confirmedSoFar >= (options.minSourcing ?? 5)) break;
  }

  const verifiedCount = productsWithSourcing.length;
  const unverifiedCount = normalizedQualified.length - verifiedCount;

  return {
    status: 'collected',
    products: productsWithSourcing,
    collectionCompleteness,
    preEvaluated: true,
    stats: {
      totalCollected: snapshot.totalCollected || 0,
      paymentQualified: normalizedQualified.length,
      sourcingVerified: verifiedCount,
      sourcingUnverified: unverifiedCount
    }
  };
}

/**
 * 根据优先级汇总规则计算店铺判定结论。
 * @param {object} evaluation
 * @param {string} [completeness='reached_end']
 * @param {number} [minSourcing=5]
 * @returns {object}
 */
function applyShopVerdict(evaluation, completeness = 'reached_end', minSourcing = 5) {
  if (evaluation.verdict === 'blocked') return evaluation;

  const C = evaluation.sourcingConfirmedCount || 0;
  const S = evaluation.sourcingSuspectedCount || 0;
  const I = evaluation.sourcingInconclusiveCount || 0;
  const U = evaluation.sourcingUnverifiedCount || 0;
  const Q = evaluation.paymentQualifiedCount || 0;
  const minProducts = evaluation.minProducts || 10;

  // 规则 2 & 3: 商品数量不足
  if (Q < minProducts) {
    if (completeness === 'reached_end') {
      evaluation.verdict = 'unqualified';
      evaluation.reason = `付款达标商品 ${Q} 个，不足 ${minProducts} 个（采集完整）`;
    } else {
      evaluation.verdict = 'inconclusive';
      evaluation.reason = `付款达标商品 ${Q} 个，不足 ${minProducts} 个，但采集不完整（${completeness}）`;
    }
    return evaluation;
  }

  // 规则 4: confirmed 已达标 → qualified
  if (C >= minSourcing) {
    evaluation.verdict = 'qualified';
    evaluation.reason = null;
    return evaluation;
  }

  // 规则 5: 已验证的全部加起来仍不足，且没有未验证的商品 → unqualified
  if (C + S + I < minSourcing && U === 0) {
    if (completeness === 'reached_end') {
      evaluation.verdict = 'unqualified';
      evaluation.reason = `已验证全部 ${C + S + I + (evaluation.sourcingRejectedCount || 0)} 件达标商品，确认货源 ${C} 个，不足 ${minSourcing} 个（采集完整）`;
    } else {
      evaluation.verdict = 'inconclusive';
      evaluation.reason = `当前采集范围内确认货源 ${C} 个，不足 ${minSourcing} 个，但采集不完整（${completeness}），未采到的商品可能满足`;
    }
    return evaluation;
  }

  // 规则 6: 有未验证商品或未知项可能补足 → inconclusive
  evaluation.verdict = 'inconclusive';
  const parts = [];
  if (U > 0) parts.push(`未验证 ${U} 件`);
  if (S > 0) parts.push(`疑似 ${S} 件`);
  if (I > 0) parts.push(`无法判定 ${I} 件`);
  evaluation.reason = `已确认货源 ${C} 个，不足 ${minSourcing} 个，${parts.join('、')}可能补足`;
  return evaluation;
}

/**
 * 评估单个候选店铺。
 * @param {object} shop 候选店铺
 * @param {object} options 判定配置
 * @returns {Promise<object>}
 */
async function evaluateShop(shop, options = {}) {
  const minProducts = options.minProducts ?? 10;
  const minSourcing = options.minSourcing ?? 5;

  let collection;
  try {
    collection = await collectQualifiedProducts(shop, options);
  } catch (err) {
    if (isPlatformBlocker(err)) {
      return {
        ...shop,
        verdict: 'blocked',
        reason: err.message,
        platform: err.platform || 'taobao',
        platformStatus: err.platformStatus || 'unknown',
        actionHint: err.actionHint || err.message,
        paymentQualifiedCount: 0,
        sourcingConfirmedCount: 0,
        products: []
      };
    }
    return {
      ...shop,
      verdict: 'inconclusive',
      reason: `采集异常: ${err.message}`,
      paymentQualifiedCount: 0,
      sourcingConfirmedCount: 0,
      products: []
    };
  }

  if (collection.status === 'insufficient_products') {
    const evaluation = {
      ...shop,
      paymentQualifiedCount: collection.actual,
      minProducts,
      minSourcing,
      products: []
    };
    return applyShopVerdict(evaluation, collection.collectionCompleteness, minSourcing);
  }

  const products = collection.products || [];
  const confirmed = products.filter(p => p.sourcing?.level === 'confirmed').length;
  const suspected = products.filter(p => p.sourcing?.level === 'suspected').length;
  const inconclusive = products.filter(p => p.sourcing?.level === 'inconclusive').length;
  const rejected = products.filter(p => p.sourcing?.level === 'rejected').length;

  const evaluation = {
    ...shop,
    paymentQualifiedCount: collection.stats?.paymentQualified || products.length,
    sourcingVerifiedCount: collection.stats?.sourcingVerified || products.length,
    sourcingUnverifiedCount: collection.stats?.sourcingUnverified || 0,
    sourcingConfirmedCount: confirmed,
    sourcingSuspectedCount: suspected,
    sourcingInconclusiveCount: inconclusive,
    sourcingRejectedCount: rejected,
    minProducts,
    minSourcing,
    products
  };

  return applyShopVerdict(evaluation, collection.collectionCompleteness, minSourcing);
}

/**
 * 批量评估所有候选店铺。
 * @param {object} options
 * @returns {Promise<object>}
 */
async function evaluateAllShops(options = {}) {
  const { runDir, onProgress, shouldStop } = options;
  if (!runDir) throw new Error('运行目录缺失');

  const candidatesFile = path.join(runDir, 'candidate-shops.jsonl');
  let candidates = [];
  try {
    const content = await fs.readFile(candidatesFile, 'utf8');
    candidates = content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  } catch (_) {
    candidates = [];
  }

  const stateFile = path.join(runDir, 'shop-eval-state.json');
  const controlFile = path.join(runDir, 'runtime-control.json');

  function shouldCancel() {
    if (typeof shouldStop === 'function') {
      const act = shouldStop();
      if (act === 'cancel') return true;
    }
    try {
      const control = JSON.parse(fsSync.readFileSync(controlFile, 'utf8'));
      return control.requestedAction === 'cancel';
    } catch { return false; }
  }

  let state = {
    finalized: [],
    blocked: [],
    judgeConfigHash: null,
    collectConfigHash: null,
    searchConfigHash: null
  };
  try {
    state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  } catch (_) {}

  const currentJudgeConfigHash = hashConfig({
    similarityThreshold: options.similarityThreshold ?? 0.45,
    priceRatioThreshold: options.priceRatioThreshold ?? 0.7,
    minProducts: options.minProducts ?? 10,
    minSourcing: options.minSourcing ?? 5,
    minPayment: options.minPayment ?? 10
  });
  const currentCollectConfigHash = hashConfig({
    channel: resolveTaobaoChannel(options),
    sortType: 'hot',
    collectLimit: options.collectLimit ?? 40,
    scrollPages: 3
  });
  const currentSearchConfigHash = hashConfig({
    searchMaxProducts: options.searchMaxProducts ?? 10,
    searchMaxPages: options.searchMaxPages ?? 1,
    port: options.port ?? 9222
  });

  const judgeChanged = state.judgeConfigHash && state.judgeConfigHash !== currentJudgeConfigHash;
  const collectChanged = state.collectConfigHash && state.collectConfigHash !== currentCollectConfigHash;
  const searchChanged = state.searchConfigHash && state.searchConfigHash !== currentSearchConfigHash;

  if (judgeChanged || collectChanged || searchChanged) {
    state.finalized = [];
    state.blocked = [];
  }

  state.judgeConfigHash = currentJudgeConfigHash;
  state.collectConfigHash = currentCollectConfigHash;
  state.searchConfigHash = currentSearchConfigHash;

  const finalizedSet = new Set(state.finalized || []);
  const evalsFile = path.join(runDir, 'shop-evaluations.jsonl');

  const evaluations = [];
  const unqualified = [];
  const inconclusive = [];
  const blocked = [];
  const errors = [];

  for (let i = 0; i < candidates.length; i++) {
    if (shouldCancel()) {
      return {
        status: 'cancelled',
        evaluations,
        unqualified,
        inconclusive,
        blocked,
        errors,
        message: `用户取消，已完成 ${evaluations.length + unqualified.length + inconclusive.length + blocked.length}/${candidates.length} 家店铺评估`
      };
    }

    const shop = candidates[i];
    if (finalizedSet.has(shop.shopKey)) {
      continue;
    }

    onProgress?.({
      current: i + 1,
      total: candidates.length,
      message: `正在评估 ${shop.shopName || shop.shopKey} (${i + 1}/${candidates.length})`
    });

    let evalResult;
    try {
      evalResult = await evaluateShop(shop, {
        ...options,
        judgeConfigHash: currentJudgeConfigHash,
        collectConfigHash: currentCollectConfigHash,
        searchConfigHash: currentSearchConfigHash
      });
    } catch (err) {
      if (isPlatformBlocker(err)) {
        evalResult = {
          ...shop,
          verdict: 'blocked',
          reason: err.message,
          platform: err.platform || 'taobao',
          platformStatus: err.platformStatus || 'unknown',
          actionHint: err.actionHint || err.message,
          judgeConfigHash: currentJudgeConfigHash,
          collectConfigHash: currentCollectConfigHash,
          searchConfigHash: currentSearchConfigHash,
          evaluatedAt: new Date().toISOString()
        };
      } else {
        errors.push({ shopKey: shop.shopKey, error: err.message });
        continue;
      }
    }

    evalResult.judgeConfigHash = currentJudgeConfigHash;
    evalResult.collectConfigHash = currentCollectConfigHash;
    evalResult.searchConfigHash = currentSearchConfigHash;
    evalResult.evaluatedAt = new Date().toISOString();

    // 写入日志
    await fs.appendFile(evalsFile, JSON.stringify(evalResult) + '\n', 'utf8');

    if (evalResult.verdict === 'qualified') {
      evaluations.push(evalResult);
      state.finalized.push(shop.shopKey);
    } else if (evalResult.verdict === 'unqualified') {
      unqualified.push(evalResult);
      state.finalized.push(shop.shopKey);
    } else if (evalResult.verdict === 'blocked') {
      blocked.push(evalResult);
      // 平台故障暂停整条流水线
      await fs.writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8');
      return {
        status: 'manual_action_required',
        platform: evalResult.platform,
        platformStatus: evalResult.platformStatus,
        actionHint: evalResult.actionHint,
        evaluations,
        unqualified,
        inconclusive,
        blocked,
        errors
      };
    } else {
      inconclusive.push(evalResult);
    }

    await fs.writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8');
  }

  return {
    status: 'completed',
    evaluations,
    unqualified,
    inconclusive,
    blocked,
    errors
  };
}

/**
 * Runner step adapter for evaluateShops.
 * @param {object} options
 * @returns {Promise<object>}
 */
async function runPeerEvaluateShopsStep(options = {}) {
  const { runDir, reportProgress, shouldStop } = options;
  if (!runDir) throw new Error('运行目录缺失');

  const result = await evaluateAllShops({
    ...options,
    ...options.params,
    channel: resolveTaobaoChannel(options),
    onProgress: reportProgress,
    shouldStop
  });

  if (result.status === 'manual_action_required') {
    return {
      status: 'manual_action_required',
      stepIncomplete: true,
      platform: result.platform || 'taobao',
      platformStatus: result.platformStatus || 'blocked',
      manualAction: { userMessage: result.actionHint || '平台需要处理验证后重试' },
      actionHint: result.actionHint,
      nextRecommendedAction: 'retry'
    };
  }

  if (result.status === 'cancelled') {
    return {
      status: 'cancelled',
      stepIncomplete: true
    };
  }

  return {
    status: 'completed',
    qualifiedCount: result.evaluations.length,
    unqualifiedCount: result.unqualified.length,
    inconclusiveCount: result.inconclusive.length,
    blockedCount: result.blocked.length,
    errors: result.errors
  };
}

module.exports = {
  hashConfig,
  collectQualifiedProducts,
  applyShopVerdict,
  evaluateShop,
  evaluateAllShops,
  runPeerEvaluateShopsStep
};
