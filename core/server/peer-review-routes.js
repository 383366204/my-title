'use strict';

const path = require('node:path');
const { assertRuntimeRunId, readRuntimeState } = require('../../skills/pipeline-flow/runtime/store');
const { createPeerStateStore } = require('../../skills/peer-discovery/src/state-store');
const { savePeerDraftEdits, createPeerAllocationPlan, reconcilePeerSubmissions } = require('../../skills/peer-discovery/src/peer-listing-adapter');
const { createDistributionShopStore } = require('../distribution-shops');

/**
 * 同行选货复核接口，只管理草稿和分配预览，不触发平台提交。
 * @param {object} app Express 应用。
 * @param {object} deps 数据目录及可注入依赖。
 * @returns {void}
 */
function registerPeerReviewRoutes(app, deps = {}) {
  const dataDir = deps.dataDir || path.join(process.cwd(), 'data', 'pipeline');
  const shops = deps.shops || createDistributionShopStore();
  const readRuntime = deps.readRuntimeState || readRuntimeState;
  const base = '/api/workflows/runs/:runId/peer-review';
  const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
  const handle = operation => async (req, res) => {
    try {
      const { runId } = req.params;
      assertRuntimeRunId(runId);
      const runtime = readRuntime({ dataDir, runId });
      if (!runtime) fail('未找到对应运行', 404);
      if (runtime.mode !== 'peer-discovery' || runtime.params?.discoveryBranch !== 'image-selection') {
        fail('当前运行不是同行图搜选货流水线', 409);
      }
      const runDir = path.join(dataDir, 'runs', runId);
      const store = createPeerStateStore(runDir);
      const state = await store.read();
      if (!state.bundle) fail('铺货草稿尚未准备完成', 409);
      const data = await operation({ runDir, store }, state, req.body || {});
      res.json({ ok: true, data });
    } catch (error) {
      res.status(error.status || (error.code === 'PEER_REVISION_CONFLICT' ? 409 : 400))
        .json({ ok: false, error: error.message, code: error.code });
    }
  };
  app.get(base, handle(async (ctx, state) => ({
    bundle: state.bundle,
    allocationPlan: state.allocationPlan?.draftRevision === state.bundle.draftRevision ? state.allocationPlan : null,
    submissions: await reconcilePeerSubmissions(ctx),
  })));
  app.post(`${base}/drafts`, handle(async (ctx, state, body) => {
    if (!body.edits || typeof body.edits !== 'object' || Array.isArray(body.edits)) fail('请提供商品编辑内容');
    const keys = new Set(state.bundle.activeDrafts.map(draft => draft.draftKey));
    for (const [key, edit] of Object.entries(body.edits)) {
      if (!keys.has(key) || !edit || typeof edit !== 'object' || Array.isArray(edit)) fail('商品草稿不存在或格式错误');
      if (Object.keys(edit).some(field => !['title', 'category'].includes(field))) fail('仅允许修改标题和类目');
      for (const value of Object.values(edit)) if (typeof value !== 'string') fail('标题和类目必须为文字');
    }
    return savePeerDraftEdits(ctx, { expectedDraftRevision: body.expectedDraftRevision, edits: body.edits });
  }));
  app.post(`${base}/allocation`, handle(async (ctx, state, body) => {
    const ids = body.shopIds;
    if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) fail('请选择不重复的目标店铺');
    const targetShops = ids.map(id => {
      const shop = shops.get(id);
      if (body.shopRevisions?.[id] !== shop.revision) fail('店铺配置已变化，请刷新后重试', 409);
      return shop;
    });
    const available = new Set(state.bundle.activeDrafts.map(draft => draft.offerId));
    if (!Array.isArray(body.offerIds) || !body.offerIds.length || body.offerIds.some(id => !available.has(id))) fail('请选择当前草稿中的商品');
    return createPeerAllocationPlan(ctx, {
      expectedDraftRevision: body.expectedDraftRevision, offerIds: body.offerIds,
      targetShops, mode: body.mode,
    });
  }));
}

module.exports = { registerPeerReviewRoutes };
