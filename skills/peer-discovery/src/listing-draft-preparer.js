'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { constructFallbackTitle, postProcessTitle } = require('../../title-gen/src/title-utils');
const { createLLMClient } = require('../../../core/llm');
const { createPeerStateStore, fingerprint } = require('./state-store');
const { selectCurrentImageResults, isCandidateCurrent, evidenceStatus } = require('./evidence');
const { normalizePeerDiscoveryParams } = require('./params');
const { collectShopCandidates } = require('./shared-shop-collector');
const { invalidateDownstreamState } = require('./downstream-invalidation');

/**
 * Compute SHA-256 revision hash for a draft input specification.
 * @param {object} payload
 * @returns {string}
 */
function hashDraftInput(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * Prepare a single product listing draft with SEO title, target category and attribution.
 * @param {object} candidate Confirmed candidate evidence and product information.
 * @param {object} [options] Title configuration, client, signal, manual edits.
 * @returns {Promise<object>} Draft details with status, revision and error diagnostics.
 */
async function prepareListingDraft(candidate = {}, options = {}) {
  const offerId = String(candidate.offerId || candidate.id || '').trim();
  const skuKey = candidate.skuKey ? String(candidate.skuKey).trim() : 'default';
  const draftKey = `${offerId}#${skuKey}`;

  const manualEdit = options.manualEdits?.[draftKey] || null;
  const inputRevision = hashDraftInput({
    draftKey,
    offerId,
    skuKey,
    candidateTitle: candidate.title || '',
    taobaoTitle: candidate.taobaoTitle || candidate.sourceTitle || '',
    manualEdit
  });

  // 1. 人工编辑优先
  if (manualEdit) {
    const title = String(manualEdit.title || '').trim();
    const category = manualEdit.category || null;
    return {
      draftKey,
      inputRevision,
      offerId,
      skuKey,
      title,
      category,
      titleSource: 'manual',
      titleError: null,
      needsInput: !title || !category
    };
  }

  // 2. 检查类目（有推荐类目则预填，无则留空并标记待输入）
  const category = candidate.category || candidate.suggestedCategory || candidate.targetCategory || null;

  // 3. 准备标题生成上下文
  const blueOceanWord = String(candidate.blueOceanWord || candidate.coreWord || candidate.taobaoTitle || candidate.title || '').slice(0, 20);
  const coreWord = String(candidate.coreWord || blueOceanWord);
  const modifiers = Array.isArray(candidate.modifiers) ? candidate.modifiers : [];
  const peerTitles = Array.isArray(candidate.peerTitles) ? candidate.peerTitles : (candidate.taobaoTitle ? [candidate.taobaoTitle] : []);
  const products = Array.isArray(candidate.products) ? candidate.products : (candidate.title ? [{ title: candidate.title }] : []);
  const maxLength = options.maxLength || 60;
  const minLength = options.minLength || 60;

  let title = '';
  let titleSource = 'llm';
  let titleError = null;

  // 4. 调用 LLM 生成标题（带超时预算和至多 1 次重试）
  const timeoutMs = options.timeoutMs ?? 120000;
  const attemptCall = async () => {
    options.signal?.throwIfAborted();
    if (typeof options.llmCaller === 'function') {
      return await options.llmCaller(candidate, options);
    }
    const client = options.llmClient || createLLMClient();
    const abortTimeout = AbortSignal.timeout(timeoutMs);
    const combinedSignal = options.signal ? AbortSignal.any([options.signal, abortTimeout]) : abortTimeout;

    const titles = await client.generateTitles({
      blueOceanWord,
      coreWord,
      modifiers,
      peerTitles,
      products,
      maxLength
    }, { signal: combinedSignal });

    if (!Array.isArray(titles) || !titles.length) {
      throw new Error('LLM 未返回有效标题');
    }
    const processed = postProcessTitle(titles[0], blueOceanWord, minLength, maxLength);
    return processed || titles[0];
  };

  try {
    try {
      title = await attemptCall();
    } catch (firstErr) {
      options.signal?.throwIfAborted();
      // 鉴权或配置错误不可重试
      if (firstErr.status === 401 || firstErr.status === 403 || firstErr.code === 'INVALID_API_KEY') {
        throw firstErr;
      }
      // 瞬态错误（超时、网络、429等）重试 1 次
      title = await attemptCall();
    }
    titleSource = 'llm';
  } catch (err) {
    options.signal?.throwIfAborted();
    titleError = err.message || '标题生成失败';
    // 降级兜底生成
    const fallback = constructFallbackTitle(blueOceanWord, candidate.title || '', peerTitles, maxLength, minLength);
    if (fallback) {
      title = fallback;
      titleSource = 'fallback';
    } else {
      title = '';
      titleSource = 'failed';
    }
  }

  // 降级标题或缺失类目需人工确认
  const needsInput = !title || !category || titleSource === 'fallback';

  return {
    draftKey,
    inputRevision,
    offerId,
    skuKey,
    title,
    category,
    titleSource,
    titleError,
    needsInput,
    sourceProduct: candidate.sourceProduct || null
  };
}

/**
 * Prepare listing drafts for multiple candidates concurrently.
 * @param {object[]} candidates Array of confirmed sourcing candidates.
 * @param {object} [options] Concurrency, client, signal, onProgress.
 * @returns {Promise<object>} Drafts list and statistics.
 */
async function prepareListingDrafts(candidates = [], options = {}) {
  const signal = options.signal;
  signal?.throwIfAborted();

  const concurrency = Math.max(1, Math.min(5, Number(options.concurrency) || 3));
  const drafts = new Array(candidates.length);
  let readyCount = 0;
  let needsInputCount = 0;
  let failedCount = 0;

  let currentIndex = 0;
  async function worker() {
    while (currentIndex < candidates.length) {
      signal?.throwIfAborted();
      const index = currentIndex++;
      const candidate = candidates[index];

      options.onProgress?.({
        current: index + 1,
        total: candidates.length,
        message: `正在生成铺货标题草稿 (${index + 1}/${candidates.length})`
      });

      let draft;
      try {
        draft = await prepareListingDraft(candidate, options);
      } catch (err) {
        signal?.throwIfAborted();
        draft = {
          draftKey: `${candidate.offerId || index}#default`,
          inputRevision: hashDraftInput({ offerId: candidate.offerId, index }),
          offerId: candidate.offerId || '',
          skuKey: 'default',
          title: '',
          category: null,
          titleSource: 'failed',
          titleError: err.message,
          needsInput: true
        };
      }

      drafts[index] = draft;
      if (draft.title && draft.category && !draft.needsInput) {
        readyCount++;
      } else if (draft.needsInput) {
        needsInputCount++;
      } else {
        failedCount++;
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, candidates.length) }, () => worker());
  await Promise.all(workers);

  return {
    drafts,
    total: drafts.length,
    readyCount,
    needsInputCount,
    failedCount
  };
}

/**
 * Runner step adapter for prepareListingDrafts.
 * @param {object} options Pipeline step options.
 * @returns {Promise<object>}
 */
async function runPeerPrepareListingDraftsStep(options = {}) {
  const { runDir, reportProgress, shouldStop } = options;
  if (!runDir) throw new Error('运行目录缺失');

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
    status: 'manual_action_required', stepIncomplete: true,
    ...details, manualAction: { userMessage: message },
    actionHint: message, nextRecommendedAction: 'retry',
  });

  let store = null;
  try {
    if (requestedAction) return interrupted();

    store = options.store || createPeerStateStore(runDir);
    const params = normalizePeerDiscoveryParams(options.params);
    let state = await store.read().catch(() => store.initialize(params));
    state = await invalidateDownstreamState(store, runDir, { status: 'running', reason: 'preparation_started' }, 'prepareListingDrafts');

    // 1. 始终以 state.shopManifest 为真理源构建当前有效商品列表
    const peerProductsFile = path.join(runDir, 'peer-products.jsonl');
    let products = [];

    if (state?.shopManifest && typeof state.shopManifest === 'object') {
      const manifestEntries = Object.entries(state.shopManifest);
      for (const [shopKey, entry] of manifestEntries) {
        if (!entry?.snapshotRevision) {
          await invalidateDownstreamState(store, runDir, { reason: 'snapshot_missing', shopKey }, 'prepareListingDrafts');
          return blocked(`店铺 [${shopKey}] 缺少商品快照版本，请重新采集该店铺商品`, {
            reason: 'snapshot_missing',
            shopKey
          });
        }
        let snapshot;
        try {
          snapshot = await store.readSnapshot(entry.snapshotRevision);
        } catch (err) {
          await invalidateDownstreamState(store, runDir, { reason: 'snapshot_corrupted', shopKey, snapshotRevision: entry.snapshotRevision }, 'prepareListingDrafts');
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
        await invalidateDownstreamState(store, runDir, { reason: 'products_missing' }, 'prepareListingDrafts');
        return blocked('商品采集结果缺失，请先重新采集同行商品', { reason: 'products_missing' });
      }
    }

    // 2. 读取图搜结果并进行当前有效性与指纹过滤
    const resultsFile = path.join(runDir, 'image-sourcing-results.jsonl');
    let results = [];
    try {
      const content = await fs.readFile(resultsFile, 'utf8');
      results = content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    const searchConfigHash = fingerprint({ provider: '1688-image-search-v1', port: params.port });
    const judgeConfigHash = fingerprint({
      imagePriceRatioThreshold: params.imagePriceRatioThreshold,
      similarityThreshold: params.similarityThreshold
    });

    const normalizedProducts = products.map((p, idx) => ({
      productKey: p.itemId || p.productId || `prod_${idx}`,
      snapshotRevision: p.snapshotRevision || fingerprint(p),
      ...p
    }));

    let validRows = [];
    let pendingEvidence = [];
    if (normalizedProducts.length > 0) {
      const selection = selectCurrentImageResults(normalizedProducts, results, {
        searchConfigHash,
        judgeConfigHash,
        now: Date.now(),
        maxAgeMs: params.evidenceMaxAgeMs
      });
      validRows = selection.results;
      pendingEvidence = selection.pending;
    }

    const timeOptions = { maxAgeMs: params.evidenceMaxAgeMs };

    // 未采集完整或证据不确定不能等同于“没有合格货源”。
    for (const row of validRows) {
      const candidates = Array.isArray(row.candidates) ? row.candidates : [];
      const level = candidate => candidate.verdict?.level || candidate.level;
      if (candidates.some(candidate => level(candidate) === 'confirmed' && isCandidateCurrent(candidate, timeOptions))) continue;
      if (row.complete === true && Array.isArray(row.candidates)
          && candidates.every(candidate => level(candidate) === 'rejected' && isCandidateCurrent(candidate, timeOptions))) continue;
      pendingEvidence.push({
        productKey: row.productKey,
        reason: candidates.find(candidate => level(candidate) !== 'rejected' || !isCandidateCurrent(candidate, timeOptions))?.verdict?.reason
          || (row.complete !== true ? 'search_incomplete' : 'evidence_inconclusive'),
      });
    }

    if (pendingEvidence.length) {
      const draftRevision = `drafts_${randomUUID()}`;
      await store.transact(state.revision, draft => {
        draft.bundle = { draftRevision, activeDrafts: [], reviewState: 'needs_evidence', pendingEvidence, updatedAt: Date.now() };
        delete draft.allocationPlan;
        draft.checkpoints.prepareListingDrafts = { status: 'blocked', pendingCount: pendingEvidence.length };
      }, { signal: controller.signal });
      await fs.rm(path.join(runDir, 'peer-allocation-plan.json'), { force: true }).catch(() => {});
      return blocked(`${pendingEvidence.length} 个商品的货源证据缺失、不完整或待确认，请补全规格、相似度与可比单价后重新验证货源；本次未生成铺货草稿`, {
        reason: 'source_evidence_incomplete', pendingEvidence, totalDrafts: 0,
      });
    }

    const confirmedCandidates = [];
    const selectedEvidence = [];
    for (const row of validRows) {
      if (Array.isArray(row.candidates)) {
        for (const cand of row.candidates) {
          if ((cand.verdict?.level === 'confirmed' || cand.level === 'confirmed')
              && isCandidateCurrent(cand, timeOptions)) {
            selectedEvidence.push({ row, candidate: cand });
            confirmedCandidates.push({
              offerId: cand.offerId || cand.id,
              skuKey: cand.skuKey || 'default',
              title: cand.title || '',
              taobaoTitle: row.source?.title || '',
              price: cand.priceText || cand.price,
              sourceProduct: row.source || null,
              category: row.source?.category || cand.category || null
            });
          }
        }
      }
    }

    if (!confirmedCandidates.length) {
      const emptyRevision = `bundle_${Date.now()}_empty`;
      state = await store.transact(state.revision, draft => {
        draft.bundle = {
          draftRevision: emptyRevision,
          activeDrafts: [],
          reviewState: 'completed',
          updatedAt: Date.now()
        };
        draft.checkpoints.prepareListingDrafts = {
          status: 'completed',
          draftRevision: emptyRevision,
          total: 0,
          readyCount: 0
        };
        delete draft.allocationPlan;
      }, { signal: controller.signal });
      await fs.rm(path.join(runDir, 'peer-allocation-plan.json'), { force: true }).catch(() => {});

      return {
        status: 'completed',
        draftRevision: emptyRevision,
        totalDrafts: 0,
        readyCount: 0,
        needsInputCount: 0,
        failedCount: 0,
        drafts: []
      };
    }

    // 2. 批量生成草稿
    const batchResult = await prepareListingDrafts(confirmedCandidates, {
      ...options.params,
      concurrency: options.params?.concurrency || 3,
      signal: controller.signal,
      onProgress: reportProgress,
      llmCaller: options.llmCaller,
      llmClient: options.llmClient
    });

    return await store.withLock(async () => {
      if (selectedEvidence.some(({ row, candidate }) => evidenceStatus(row, timeOptions) !== 'current'
          || !isCandidateCurrent(candidate, timeOptions))) {
        await invalidateDownstreamState(store, runDir, { reason: 'evidence_expired_during_preparation' }, 'prepareListingDrafts');
        return blocked('标题生成期间货源证据已过期，请重新验证货源后再生成草稿', { reason: 'evidence_expired_during_preparation' });
      }

      const draftRevision = `drafts_${Date.now()}_${randomUUID().slice(0, 8)}`;

      // 3. 更新权威状态 state.bundle
      state = await store.transact(state.revision, draft => {
        draft.bundle = {
          draftRevision,
          activeDrafts: batchResult.drafts,
          reviewState: batchResult.needsInputCount > 0 ? 'needs_input' : 'ready_to_submit',
          updatedAt: Date.now()
        };
        draft.checkpoints.prepareListingDrafts = {
          status: 'completed',
          draftRevision,
          total: batchResult.total,
          readyCount: batchResult.readyCount,
          needsInputCount: batchResult.needsInputCount,
          failedCount: batchResult.failedCount
        };
      }, { signal: controller.signal });

      // 4. 提交成功后落盘派生草稿文件
      const draftsFile = path.join(runDir, 'peer-listing-drafts.jsonl');
      const lines = batchResult.drafts.map(d => JSON.stringify(d)).join('\n') + '\n';
      await fs.writeFile(draftsFile, lines, 'utf8');

      return {
        status: 'completed',
        draftRevision,
        totalDrafts: batchResult.total,
        readyCount: batchResult.readyCount,
        needsInputCount: batchResult.needsInputCount,
        failedCount: batchResult.failedCount,
        drafts: batchResult.drafts
      };
    }, { signal: controller.signal });
  } catch (error) {
    if (requestedAction) return interrupted();
    throw error;
  } finally {
    clearInterval(timer);
  }
}

module.exports = {
  prepareListingDraft,
  prepareListingDrafts,
  runPeerPrepareListingDraftsStep
};
