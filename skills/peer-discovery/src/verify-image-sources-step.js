'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createPeerStateStore, fingerprint } = require('./state-store');
const { verifyImageSources } = require('./image-sourcing-matcher');
const { createImageSearchProvider } = require('./image-search-provider');
const { selectCurrentImageResults, evidenceStatus, isCandidateCurrent } = require('./evidence');
const { collectShopCandidates } = require('./shared-shop-collector');
const { normalizePeerDiscoveryParams } = require('./params');

const { invalidateDownstreamState } = require('./downstream-invalidation');

/**
 * Execute 1688 image sourcing verification for all collected peer products.
 * @param {object} options
 * @returns {Promise<object>}
 */
async function runPeerVerifyImageSourcesStep(options = {}) {
  const { runDir, reportProgress, shouldStop } = options;
  if (!runDir) throw new Error('运行目录缺失');
  const params = normalizePeerDiscoveryParams(options.params);

  const controller = new AbortController();
  let requestedAction = null;
  const checkControl = () => {
    const action = shouldStop?.();
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
    status: 'manual_action_required', stepIncomplete: true, platform: '1688',
    ...details, manualAction: { userMessage: message },
    actionHint: message, nextRecommendedAction: 'retry',
  });

  let store = null;
  try {
    if (requestedAction) return interrupted();

    store = options.store || createPeerStateStore(runDir);
    let state = await store.read().catch(() => store.initialize(params));
    // 重跑开始就撤销旧提交依据，解析失败、暂停等路径也不能保留旧计划。
    state = await invalidateDownstreamState(store, runDir, { status: 'running', reason: 'verification_started' });

    // 1. 始终以 state.shopManifest 为真理源构建待验证商品列表
    const peerProductsFile = path.join(runDir, 'peer-products.jsonl');
    let products = [];

    if (state?.shopManifest && typeof state.shopManifest === 'object') {
      const manifestEntries = Object.entries(state.shopManifest);
      for (const [shopKey, entry] of manifestEntries) {
        if (!entry?.snapshotRevision) {
          await invalidateDownstreamState(store, runDir, { reason: 'snapshot_missing', shopKey });
          return blocked(`店铺 [${shopKey}] 缺少商品快照版本，请重新采集该店铺商品`, {
            reason: 'snapshot_missing',
            shopKey
          });
        }
        let snapshot;
        try {
          snapshot = await store.readSnapshot(entry.snapshotRevision);
        } catch (err) {
          await invalidateDownstreamState(store, runDir, { reason: 'snapshot_corrupted', shopKey, snapshotRevision: entry.snapshotRevision });
          return blocked(`店铺 [${shopKey}] 的权威商品快照 (${entry.snapshotRevision}) 缺失或损坏，请重新采集该店铺商品: ${err.message}`, {
            reason: 'snapshot_corrupted',
            shopKey,
            snapshotRevision: entry.snapshotRevision
          });
        }
        const eligible = await collectShopCandidates({ shopKey, shopUrl: entry.shopUrl }, {
          snapshot,
          minPayment: params.minPayment,
          signal: controller.signal
        });
        if (eligible?.products?.length) {
          products.push(...eligible.products.map(product => ({
            ...product,
            shopKey,
            snapshotRevision: entry.snapshotRevision
          })));
        }
      }
      // 保持派生文件与真理源严格一致（即使为空也覆盖旧派生文件）
      const lines = products.map(p => JSON.stringify(p)).join('\n') + (products.length ? '\n' : '');
      await fs.writeFile(peerProductsFile, lines, 'utf8').catch(() => {});
    } else {
      // 仅在无 shopManifest 时降级读取派生文件（兼容独立测试）
      try {
        const content = await fs.readFile(peerProductsFile, 'utf8');
        products = content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await invalidateDownstreamState(store, runDir, { reason: 'products_missing' });
        return blocked('商品采集结果缺失，请先重新采集同行商品', { reason: 'products_missing' });
      }
    }

    if (!products.length) {
      await invalidateDownstreamState(store, runDir, { status: 'completed', reason: 'no_products' });
      return {
        status: 'completed',
        totalProducts: 0,
        verifiedCount: 0,
        confirmedCount: 0,
        results: [],
        message: '没有待验证的同行商品'
      };
    }

    // 2. 指纹计算
    const searchConfigHash = fingerprint({ provider: '1688-image-search-v1', port: params.port });
    const judgeConfigHash = fingerprint({
      imagePriceRatioThreshold: params.imagePriceRatioThreshold,
      similarityThreshold: params.similarityThreshold
    });

    // 3. 读取已有验证结果
    const resultsFile = path.join(runDir, 'image-sourcing-results.jsonl');
    let existingRows = [];
    try {
      const content = await fs.readFile(resultsFile, 'utf8');
      existingRows = content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    const normalizedProducts = products.map((p, idx) => ({
      productKey: p.itemId || p.productId || `prod_${idx}`,
      snapshotRevision: p.snapshotRevision || fingerprint(p),
      ...p
    }));

    const timeOptions = { maxAgeMs: params.evidenceMaxAgeMs };

    const selection = selectCurrentImageResults(normalizedProducts, existingRows, {
      searchConfigHash,
      judgeConfigHash,
      ...timeOptions
    });

    const isResolved = row => {
      if (!Array.isArray(row.candidates) || evidenceStatus(row, timeOptions) !== 'current') return false;
      const level = candidate => candidate.verdict?.level || candidate.level;
      return row.candidates.some(candidate => level(candidate) === 'confirmed' && isCandidateCurrent(candidate, timeOptions))
        || (row.complete === true && row.candidates.every(candidate => level(candidate) === 'rejected' && isCandidateCurrent(candidate, timeOptions)));
    };
    const completedMap = new Map();
    for (const res of selection.results) {
      if (isResolved(res)) completedMap.set(res.productKey, res);
    }

    const provider = options.provider || createImageSearchProvider({ port: params.port });
    const allResults = [];
    let confirmedCount = 0;

    for (const [index, product] of normalizedProducts.entries()) {
      checkControl();
      if (requestedAction) return interrupted();

      reportProgress?.({
        current: index + 1,
        total: normalizedProducts.length,
        message: `正在图搜货源 (${index + 1}/${normalizedProducts.length}): [${product.productKey}]`
      });

      // 如果已有当前有效验证结果，直接复用
      if (completedMap.has(product.productKey) && isResolved(completedMap.get(product.productKey))) {
        const cached = completedMap.get(product.productKey);
        allResults.push(cached);
        if (cached.candidates.some(candidate => (candidate.verdict?.level || candidate.level) === 'confirmed' && isCandidateCurrent(candidate, timeOptions))) {
          confirmedCount++;
        }
        continue;
      }

      // 执行真实图搜判定
      let verified;
      try {
        verified = await verifyImageSources(product, {
          provider,
          imagePriceRatioThreshold: params.imagePriceRatioThreshold,
          similarityThreshold: params.similarityThreshold,
          signal: controller.signal
        });
      } catch (err) {
        checkControl();
        if (requestedAction) return interrupted();
        if (err.code === 'PLATFORM_ACCESS_BLOCKED' || err.code === 'PLATFORM_ACCESS_LOCK_TIMEOUT' || err.name === 'PlatformAccessError' || err.platform === '1688') {
          await invalidateDownstreamState(store, runDir, { reason: 'platform_blocked', platform: '1688', error: err.message });
          return blocked(err.message, { platformStatus: err.status || 'blocked' });
        }
        throw err;
      }

      const candidateExpiries = (verified.results || []).flatMap(c => [c.expiresAt, c.verdict?.expiresAt]).filter(Number.isSafeInteger);
      const rowExpiresAt = candidateExpiries.length ? Math.min(Date.now() + params.evidenceMaxAgeMs, ...candidateExpiries) : Date.now() + params.evidenceMaxAgeMs;

      const row = {
        productKey: product.productKey,
        snapshotRevision: product.snapshotRevision,
        searchConfigHash,
        judgeConfigHash,
        observedAt: Date.now(),
        expiresAt: rowExpiresAt,
        source: {
          itemId: product.itemId,
          title: product.title,
          priceText: product.priceText || String(product.price || ''),
          imageUrl: product.imageUrl || product.mainImageUrl,
          currency: product.currency || 'CNY'
        },
        candidates: verified.results || [],
        confirmed: verified.confirmedCount > 0,
        confirmedCount: verified.confirmedCount,
        complete: verified.complete
      };

      allResults.push(row);
      if (row.confirmed) confirmedCount++;

      // 实时追加落盘
      await fs.appendFile(resultsFile, JSON.stringify(row) + '\n', 'utf8');

      // 更新断点状态
      state = await store.transact(state.revision, draft => {
        draft.checkpoints.verifyImageSources = {
          status: 'running',
          completed: index + 1,
          total: normalizedProducts.length,
          confirmedCount
        };
      }, { signal: controller.signal });
    }

    // 长批次结束时重新按当前时刻检查，不沿用查询前的时间或过期计数。
    confirmedCount = allResults.filter(row => evidenceStatus(row, timeOptions) === 'current'
      && row.candidates.some(candidate => (candidate.verdict?.level || candidate.level) === 'confirmed' && isCandidateCurrent(candidate, timeOptions))).length;
    const pendingEvidence = allResults.filter(row => !isResolved(row))
      .map(row => ({ productKey: row.productKey, reasons: [...new Set([
        ...(evidenceStatus(row, timeOptions) !== 'current' ? ['evidence_needs_refresh'] : []),
        ...row.candidates
          .filter(candidate => (candidate.verdict?.level || candidate.level) !== 'rejected' || !isCandidateCurrent(candidate, timeOptions))
          .map(candidate => !isCandidateCurrent(candidate, timeOptions) ? 'evidence_needs_refresh' : candidate.verdict?.reason || 'evidence_inconclusive'),
        ...(row.complete !== true ? ['search_incomplete'] : []),
      ])], complete: row.complete }));
    state = await store.transact(state.revision, draft => {
      draft.checkpoints.verifyImageSources = {
        status: pendingEvidence.length ? 'blocked' : 'completed',
        completed: normalizedProducts.length,
        total: normalizedProducts.length,
        confirmedCount,
        pendingEvidence
      };
      if (pendingEvidence.length) {
        draft.bundle = { draftRevision: `evidence_${fingerprint(pendingEvidence)}`, activeDrafts: [], reviewState: 'needs_evidence', pendingEvidence, updatedAt: Date.now() };
        delete draft.allocationPlan;
        delete draft.checkpoints.prepareListingDrafts;
      }
    }, { signal: controller.signal });

    if (pendingEvidence.length) {
      await fs.rm(path.join(runDir, 'peer-allocation-plan.json'), { force: true }).catch(() => {});
      await fs.rm(path.join(runDir, 'peer-listing-drafts.jsonl'), { force: true }).catch(() => {});
      return blocked(
        `${pendingEvidence.length} 个商品的货源证据尚不足：需要确认相似度、规格、库存及可比单价；不能将搜索卡片价格视为已验证货源`,
        { reason: 'source_evidence_incomplete', pendingEvidence, totalProducts: normalizedProducts.length, verifiedCount: allResults.length, confirmedCount, results: allResults }
      );
    }

    return {
      status: 'completed',
      totalProducts: normalizedProducts.length,
      verifiedCount: allResults.length,
      confirmedCount,
      results: allResults
    };
  } catch (error) {
    if (requestedAction) return interrupted();
    if (error.code === 'PLATFORM_ACCESS_BLOCKED' || error.code === 'PLATFORM_ACCESS_LOCK_TIMEOUT' || error.name === 'PlatformAccessError') {
      await invalidateDownstreamState(store, runDir, { reason: 'platform_blocked', platform: '1688', error: error.message });
      return blocked(error.message, { platformStatus: error.status || 'blocked' });
    }
    throw error;
  } finally {
    clearInterval(timer);
  }
}

module.exports = { runPeerVerifyImageSourcesStep };
