'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createAllocationPlan, splitAllocationBatches } = require('./allocation-plan');
const { createPeerStateStore } = require('./state-store');

const runDirSubmissionLocks = new Map();

/**
 * Serialize concurrent submission requests for the same runDir in the same process.
 * @param {string} runDir
 * @param {Function} fn
 * @returns {Promise<any>}
 */
async function withSubmissionLock(runDir, fn) {
  const previous = runDirSubmissionLocks.get(runDir) || Promise.resolve();
  let resolveCurrent;
  const current = new Promise(resolve => { resolveCurrent = resolve; });
  runDirSubmissionLocks.set(runDir, current);
  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    resolveCurrent();
    if (runDirSubmissionLocks.get(runDir) === current) {
      runDirSubmissionLocks.delete(runDir);
    }
  }
}

/**
 * Read and parse submission ledger safely.
 * Only ENOENT (file not found) is treated as empty ledger.
 * Any parsing error, truncated line, or permission issue throws an explicit error to prevent duplicate submissions.
 * @param {string} ledgerFile Path to peer-submissions.jsonl
 * @returns {Promise<Array<object>>}
 */
async function readSubmissionLedger(ledgerFile) {
  let content;
  try {
    content = await fs.readFile(ledgerFile, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    const error = new Error(`铺货账本读取失败，阻止提交以防止重复铺货: ${err.message}`);
    error.code = 'SUBMISSION_LEDGER_CORRUPTED';
    throw error;
  }

  const lines = content.trim().split('\n').filter(Boolean);
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      rows.push(JSON.parse(lines[i]));
    } catch (parseErr) {
      const error = new Error(`铺货账本解析损坏 (第 ${i + 1} 行)，阻止提交以防止重复铺货: ${parseErr.message}`);
      error.code = 'SUBMISSION_LEDGER_CORRUPTED';
      throw error;
    }
  }
  return rows;
}

/**
 * Strict resolution of offer submission statuses.
 * Missing items from partial results or empty/unrecognized responses enter 'unknown' state.
 * Mixed success and failure are resolved accurately per offer.
 * @param {any} res Result from external submitter.
 * @param {string[]} pendingOfferIds
 * @returns {Map<string, { status: string, error: string | null }>}
 */
function resolveOfferStatuses(res, pendingOfferIds = []) {
  const statusMap = new Map();

  // 1. 优先检查是否包含逐项明细（results、items 或直接为数组）
  const itemArray = Array.isArray(res?.results)
    ? res.results
    : (Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : null));

  if (itemArray) {
    const itemMap = new Map();
    for (let idx = 0; idx < itemArray.length; idx++) {
      const it = itemArray[idx];
      if (it && typeof it === 'object') {
        const id = it.offerId || it.itemId || it.id;
        if (id) {
          itemMap.set(String(id), it);
        } else if (itemArray.length === pendingOfferIds.length) {
          itemMap.set(String(pendingOfferIds[idx]), it);
        }
      }
    }

    for (const offerId of pendingOfferIds) {
      const it = itemMap.get(String(offerId));
      if (!it) {
        // 逐项明细中缺失此商品：无法核实平台状态，进入 unknown 防重核对
        statusMap.set(offerId, {
          status: 'unknown',
          error: `逐项结果缺失商品 ${offerId} 的确认信息，已转入核对`
        });
      } else if (['accepted', 'pending', 'running', 'awaiting_confirmation'].includes(it.status)) {
        statusMap.set(offerId, {
          status: 'unknown',
          error: '商品任务已受理但尚未确认完成，已转入核对'
        });
      } else if (it.ok === false || it.success === false || it.status === 'failed' || it.error) {
        statusMap.set(offerId, {
          status: 'failed',
          error: String(it.error?.message || it.error || it.message || '商品提交失败')
        });
      } else if (it.status === 'success' || it.status === 'completed' || (it.status === undefined && (it.ok === true || it.success === true))) {
        statusMap.set(offerId, { status: 'success', error: null });
      } else {
        statusMap.set(offerId, {
          status: 'unknown',
          error: '商品返回未确认结果，已转入未知状态以防重复铺货'
        });
      }
    }
    return statusMap;
  }

  // 2. 整批响应（无逐项明细）
  let batchStatus;
  let batchError = null;

  if (!res || typeof res !== 'object' || Object.keys(res).length === 0) {
    // 空响应：已发生外部提交，无法排除平台已接收，必须记为 unknown 阻止自动重试
    batchStatus = 'unknown';
    batchError = '提交器返回空响应，已转入未知状态 (unknown) 以防重复铺货';
  } else if (['accepted', 'pending', 'running', 'awaiting_confirmation'].includes(res.status)) {
    batchStatus = 'unknown';
    batchError = '任务已受理但尚未确认完成，已转入核对';
  } else if (res.ok === false || res.success === false || res.status === 'failed' || (res.error && !res.ok)) {
    batchStatus = 'failed';
    batchError = String(res.error?.message || res.error || res.message || '平台显式拒绝');
  } else if (res.status === 'success' || res.status === 'completed' || (res.status === undefined && (res.ok === true || res.success === true))) {
    if (typeof res.completed === 'number' && res.completed < pendingOfferIds.length) {
      batchStatus = 'unknown';
      batchError = `仅完成 ${res.completed}/${pendingOfferIds.length}，缺少逐项明细，已转入未知状态`;
    } else {
      batchStatus = 'success';
    }
  } else if (typeof res.completed === 'number' && res.completed >= pendingOfferIds.length) {
    batchStatus = 'success';
  } else {
    // 无法识别的响应：记为 unknown 防重核对
    batchStatus = 'unknown';
    batchError = '提交器未返回明确的成功或拒绝结果，已转入未知状态以防重复铺货';
  }

  for (const offerId of pendingOfferIds) {
    statusMap.set(offerId, { status: batchStatus, error: batchError });
  }
  return statusMap;
}

/**
 * Strict verification of submitter response contract.
 * @param {any} res
 * @param {string[]} pendingOfferIds
 * @returns {boolean}
 */
function isSubmissionSuccessful(res, pendingOfferIds = []) {
  if (!pendingOfferIds.length) return false;
  const statusMap = resolveOfferStatuses(res, pendingOfferIds);
  return pendingOfferIds.every(id => statusMap.get(id)?.status === 'success');
}

/**
 * Save manual draft edits with strict optimistic revision locking.
 * @param {object} ctx Context with runDir and store.
 * @param {object} request Edit payload with expectedDraftRevision and edits map.
 * @returns {Promise<object>}
 */
async function savePeerDraftEdits(ctx, request = {}) {
  const { runDir } = ctx;
  const store = ctx.store || createPeerStateStore(runDir);
  return store.withLock(async () => {
    const state = await store.read();

    const { expectedDraftRevision, edits = {} } = request;
    if (!state.bundle || state.bundle.draftRevision !== expectedDraftRevision) {
      const error = new Error('草稿版本冲突，请刷新后重试');
      error.code = 'PEER_REVISION_CONFLICT';
      throw error;
    }

    const updatedDrafts = (state.bundle.activeDrafts || []).map(draft => {
      const edit = edits[draft.draftKey];
      if (!edit) return draft;
      const title = edit.title !== undefined ? String(edit.title).trim() : draft.title;
      const category = edit.category !== undefined ? edit.category : draft.category;
      return {
        ...draft,
        title,
        category,
        titleSource: 'manual',
        needsInput: !title || !category
      };
    });

    const hasNeedsInput = updatedDrafts.some(d => d.needsInput);
    const nextRevision = `drafts_${Date.now()}_${randomUUID().slice(0, 8)}`;

    const updatedState = await store.transact(state.revision, draft => {
      draft.bundle = {
        ...draft.bundle,
        draftRevision: nextRevision,
        activeDrafts: updatedDrafts,
        reviewState: hasNeedsInput ? 'needs_input' : 'ready_to_submit',
        updatedAt: Date.now()
      };
      delete draft.allocationPlan;
    });

    // 写入视图文件，并清除旧版本的分配计划视图
    const draftsFile = path.join(runDir, 'peer-listing-drafts.jsonl');
    const lines = updatedDrafts.map(d => JSON.stringify(d)).join('\n') + '\n';
    await fs.rm(path.join(runDir, 'peer-allocation-plan.json'), { force: true });
    await fs.writeFile(draftsFile, lines, 'utf8');

    return {
      ok: true,
      draftRevision: nextRevision,
      bundle: updatedState.bundle
    };
  });
}

/**
 * Create and persist a deterministic multi-shop allocation plan without platform calls.
 * @param {object} ctx Context with runDir.
 * @param {object} request expectedDraftRevision, offerIds, targetShops, mode, seed.
 * @returns {Promise<object>} Persisted allocation plan.
 */
async function createPeerAllocationPlan(ctx, request = {}) {
  const { runDir } = ctx;
  const store = ctx.store || createPeerStateStore(runDir);
  const state = await store.read();

  const { expectedDraftRevision, offerIds, targetShops = [], mode = 'sequential-average', seed } = request;
  if (!state.bundle || state.bundle.draftRevision !== expectedDraftRevision) {
    const error = new Error('草稿版本冲突，请基于当前版本生成分配计划');
    error.code = 'PEER_REVISION_CONFLICT';
    throw error;
  }

  if (!Array.isArray(targetShops) || !targetShops.length) {
    throw new Error('目标店铺快照列表不能为空');
  }

  const shopIds = targetShops.map(s => {
    const id = s.id || s.shopId;
    if (!id) throw new Error('店铺快照缺少店铺ID');
    return String(id);
  });

  const plan = createAllocationPlan({
    offerIds,
    shopIds,
    draftRevision: expectedDraftRevision,
    mode,
    seed
  });

  plan.targetShopSnapshots = targetShops.map(s => ({
    id: s.id || s.shopId,
    platformShopName: s.platformShopName || s.shopName || '',
    port: s.port || 9222,
    revision: s.revision || null
  }));

  await store.transact(state.revision, draft => {
    draft.allocationPlan = plan;
  });

  // 独立文件仅为派生视图，权威状态发布失败时不能生成可提交的计划。
  const planFile = path.join(runDir, 'peer-allocation-plan.json');
  await fs.writeFile(planFile, JSON.stringify(plan, null, 2), 'utf8');

  return {
    ok: true,
    plan
  };
}

/**
 * Submit persisted allocation batches to platform distribution service with idempotency.
 * @param {object} ctx Context with runDir.
 * @param {object} request expectedDraftRevision, expectedPlanId, confirm, batchSize, submitter.
 * @returns {Promise<object>} Submission results and updated ledger.
 */
async function submitPeerAllocationPlan(ctx, request = {}) {
  const { runDir } = ctx;
  const { expectedDraftRevision, expectedPlanId, confirm, batchSize = 20 } = request;

  if (confirm !== true) {
    throw new Error('必须明确确认铺货提交 (confirm=true)');
  }

  const store = ctx.store || createPeerStateStore(runDir);

  return withSubmissionLock(runDir, async () => {
    return store.withLock(async () => {
      // 1. 获取锁后，重新读取最新状态并严格核验草稿版本与分配计划（防止排队等待锁期间草稿已变更）
      const state = await store.read();

      if (!state.bundle || state.bundle.draftRevision !== expectedDraftRevision) {
        const error = new Error('草稿版本冲突，禁止提交旧版本');
        error.code = 'PEER_REVISION_CONFLICT';
        throw error;
      }

      const plan = state.allocationPlan;
      if (!plan) {
        const error = new Error('未找到已发布的分配计划，请重新生成分配计划');
        error.code = 'PEER_PLAN_MISSING';
        throw error;
      }

      if (plan.planId !== expectedPlanId || plan.draftRevision !== expectedDraftRevision) {
        const error = new Error('分配计划与当前草稿版本不匹配');
        error.code = 'PEER_PLAN_MISMATCH';
        throw error;
      }

      // 检查草稿完整性：选中的 offerId 必须有标题和目标类目
      const draftsMap = new Map((state.bundle.activeDrafts || []).map(d => [d.offerId, d]));
      for (const item of plan.items) {
        const draft = draftsMap.get(item.offerId);
        if (!draft || !draft.title) {
          const error = new Error(`商品 ${item.offerId} 缺少标题，禁止提交`);
          error.code = 'DRAFT_INCOMPLETE';
          throw error;
        }
        if (!draft.category) {
          const error = new Error(`商品 ${item.offerId} 缺少目标类目，禁止提交`);
          error.code = 'CATEGORY_REQUIRED';
          throw error;
        }
        if (draft.needsInput === true) {
          const error = new Error(`商品 ${item.offerId} 尚未完成人工确认，禁止提交`);
          error.code = 'DRAFT_REVIEW_REQUIRED';
          throw error;
        }
      }

      const submitter = ctx.submitter || request.submitter;
      if (typeof submitter !== 'function') {
        throw new Error('未配置铺货分发提交器 (submitter)');
      }

      // 读取既有账本 (peer-submissions.jsonl)
      const ledgerFile = path.join(runDir, 'peer-submissions.jsonl');
      const rawLedger = await readSubmissionLedger(ledgerFile);

      // 建立每个 targetShopId#offerId 的最新状态
      const latestByKey = new Map();
      for (const entry of rawLedger) {
        latestByKey.set(`${entry.targetShopId}#${entry.offerId}`, entry.status);
      }

      // 严格防止重复铺货：已成功 (success)、正在提交中 (submitting) 或未知超时待核对 (unknown) 的记录严禁重复提交
      const nonRetryableKeys = new Set();
      for (const [key, status] of latestByKey.entries()) {
        if (status === 'success' || status === 'submitting' || status === 'unknown') {
          nonRetryableKeys.add(key);
        }
      }

      // 拆分为单店子批次
      const batches = splitAllocationBatches(plan, batchSize);
      const newLedgerEntries = [];
      const jobId = `dist_${Date.now()}_${randomUUID().slice(0, 8)}`;
      let distinctOffersSubmitted = 0;

      for (const batch of batches) {
        // 过滤已成功、在途提交或未知超时待核对的 offerId
        const pendingOfferIds = batch.offerIds.filter(id => !nonRetryableKeys.has(`${batch.targetShopId}#${id}`));
        if (!pendingOfferIds.length) continue;

        const targetShop = (plan.targetShopSnapshots || []).find(s => s.id === batch.targetShopId) || {
          id: batch.targetShopId,
          platformShopName: batch.targetShopId,
          port: 9222
        };

        // 1. 原子预写入提交意图 (status: 'submitting')，防止并发重复提交与无审计调用
        const intentStamp = Date.now();
        for (const offerId of pendingOfferIds) {
          const intentEntry = {
            jobId,
            batchId: batch.batchId,
            targetShopId: batch.targetShopId,
            offerId,
            status: 'submitting',
            submittedAt: intentStamp,
            error: null
          };
          newLedgerEntries.push(intentEntry);
          nonRetryableKeys.add(`${batch.targetShopId}#${offerId}`);
          await fs.appendFile(ledgerFile, JSON.stringify(intentEntry) + '\n', 'utf8');
        }
        distinctOffersSubmitted += pendingOfferIds.length;

        // 2. 调用实际提交器，严格校验返回结果（逐项核验商品覆盖范围与空响应防护）
        let offerStatusMap;
        try {
          const res = await submitter({
            batchId: batch.batchId,
            targetShop,
            targetShops: [targetShop],
            offerIds: pendingOfferIds,
            distributionMode: 'sequential-average'
          });
          offerStatusMap = resolveOfferStatuses(res, pendingOfferIds);
        } catch (err) {
          const isTimeoutOrNetwork = /timeout|network|abort|econnreset/i.test(err?.message || '');
          const errorStatus = isTimeoutOrNetwork ? 'unknown' : (err?.code === 'REJECTED' ? 'failed' : 'unknown');
          const errorMsg = err?.message || String(err);
          offerStatusMap = new Map();
          for (const offerId of pendingOfferIds) {
            offerStatusMap.set(offerId, { status: errorStatus, error: errorMsg });
          }
        }

        // 3. 落盘最终结果（按每个商品的真实状态逐项更新）
        const finalStamp = Date.now();
        for (const offerId of pendingOfferIds) {
          const itemRes = offerStatusMap.get(offerId) || { status: 'unknown', error: '状态未决' };
          const resultEntry = {
            jobId,
            batchId: batch.batchId,
            targetShopId: batch.targetShopId,
            offerId,
            status: itemRes.status,
            submittedAt: finalStamp,
            error: itemRes.error
          };
          newLedgerEntries.push(resultEntry);
          latestByKey.set(`${batch.targetShopId}#${offerId}`, itemRes.status);
          await fs.appendFile(ledgerFile, JSON.stringify(resultEntry) + '\n', 'utf8');
        }
      }

      const allOfferTargets = plan.items.map(item => `${item.targetShopId}#${item.offerId}`);
      const finalSuccessCount = allOfferTargets.filter(key => latestByKey.get(key) === 'success').length;
      const hasUnknownOrInFlight = allOfferTargets.some(key => {
        const s = latestByKey.get(key);
        return s === 'unknown' || s === 'submitting';
      });
      const isAllComplete = allOfferTargets.length > 0 && finalSuccessCount === allOfferTargets.length && !hasUnknownOrInFlight;

      const curState = await store.read();
      if (curState.bundle && curState.bundle.draftRevision === expectedDraftRevision) {
        await store.transact(curState.revision, draft => {
          if (draft.bundle && draft.bundle.draftRevision === expectedDraftRevision) {
            draft.bundle.reviewState = isAllComplete ? 'completed' : 'needs_attention';
          }
        });
      }

      return {
        ok: true,
        jobId,
        batchesProcessed: batches.length,
        newSubmissions: distinctOffersSubmitted,
        completed: isAllComplete
      };
    }, { timeoutMs: 60000 });
  });
}

/**
 * Reconcile submission ledger against allocation plan.
 * @param {object} ctx Context with runDir.
 * @returns {Promise<object>}
 */
async function reconcilePeerSubmissions(ctx) {
  const { runDir } = ctx;
  const ledgerFile = path.join(runDir, 'peer-submissions.jsonl');
  const rawEntries = await readSubmissionLedger(ledgerFile);

  const latestByKey = new Map();
  for (const entry of rawEntries) {
    latestByKey.set(`${entry.targetShopId}#${entry.offerId}`, entry);
  }

  const entries = [...latestByKey.values()];
  const success = entries.filter(e => e.status === 'success').length;
  const failed = entries.filter(e => e.status === 'failed').length;
  const unknown = entries.filter(e => e.status === 'unknown' || e.status === 'submitting').length;

  return {
    total: entries.length,
    success,
    failed,
    unknown,
    entries
  };
}

/**
 * Pipeline step adapter for reviewPeerListings.
 * @param {object} options Pipeline step options.
 * @returns {Promise<object>}
 */
async function runPeerReviewListingsStep(options = {}) {
  const { runDir } = options;
  if (!runDir) throw new Error('运行目录缺失');

  const store = options.store || createPeerStateStore(runDir);
  const state = await store.read().catch(() => null);

  if (!state || !state.bundle) {
    return {
      status: 'manual_action_required',
      stepIncomplete: true,
      manualAction: { userMessage: '草稿尚未准备完成，请先执行准备草稿节点' }
    };
  }

  if (state.bundle.reviewState === 'completed') {
    return {
      status: 'completed',
      reviewState: 'completed',
      draftRevision: state.bundle.draftRevision
    };
  }

  if (state.bundle.reviewState === 'needs_evidence') {
    return {
      status: 'manual_action_required', stepIncomplete: true,
      reviewState: 'needs_evidence', reason: 'source_evidence_incomplete',
      pendingEvidence: state.bundle.pendingEvidence || [],
      manualAction: { userMessage: '货源证据尚未补全，请返回1688货源验证节点处理，不能直接确认铺货。' },
    };
  }

  return {
    status: 'manual_action_required',
    stepIncomplete: true,
    reviewState: state.bundle.reviewState,
    draftRevision: state.bundle.draftRevision,
    manualAction: {
      userMessage: state.bundle.reviewState === 'needs_input'
        ? '部分商品标题或淘宝类目缺失，请在复核界面补全并确认'
        : '铺货草稿已就绪，请在复核界面确认分配计划并提交'
    }
  };
}

module.exports = {
  savePeerDraftEdits,
  createPeerAllocationPlan,
  submitPeerAllocationPlan,
  reconcilePeerSubmissions,
  runPeerReviewListingsStep
};
