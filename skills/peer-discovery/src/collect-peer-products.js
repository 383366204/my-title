'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createPeerStateStore, fingerprint } = require('./state-store');
const { normalizePeerDiscoveryParams } = require('./params');
const { collectShopSnapshot, collectShopCandidates } = require('./shared-shop-collector');
const { evidenceStatus } = require('./evidence');

/**
 * Persist per-shop collection before filtering so interrupted work can resume.
 * @param {object} options Run directory, resolved shops/channel, parameters and runtime callbacks.
 * @returns {Promise<object>} Current manifest-derived products and incomplete shop identities.
 */
async function collectPeerProducts(options) {
  const { runDir, shops, channel, signal, onProgress } = options;
  const params = normalizePeerDiscoveryParams(options.params);
  if (!['native', 'web'].includes(channel)) throw new Error('请先确认淘宝采集通道');
  if (params.taobaoChannel !== 'auto' && params.taobaoChannel !== channel) throw new Error('已确认通道与用户选择不一致');
  if (!Array.isArray(shops) || shops.some(s => !s?.shopKey || !s.shopUrl) || new Set(shops.map(s => s.shopKey)).size !== shops.length) throw new Error('候选店铺身份缺失或重复');
  signal?.throwIfAborted();
  const store = createPeerStateStore(runDir);
  let state = await store.initialize(params);
  if (state.activeChannel && state.activeChannel !== channel) throw new Error('当前运行已固定采集通道，请先确认切换并使旧证据失效');
  const collectHash = fingerprint({ channel, collectLimit: params.collectLimit, parser: 'peer-shop-v1' });
  const selectionHash = fingerprint(shops.map(s => ({ shopKey: s.shopKey, shopUrl: s.shopUrl })));
  state = await store.transact(state.revision, draft => {
    draft.activeChannel = channel;
    // 每轮只引用本轮候选店铺，旧快照保留审计但不再产生商品。
    draft.shopManifest = Object.fromEntries(shops.map(shop => {
      const previous = draft.shopManifest?.[shop.shopKey];
      return [shop.shopKey, previous?.collectHash === collectHash && previous?.shopUrl === shop.shopUrl ? previous : null];
    }));
    draft.checkpoints.collectPeerProducts = { status: 'running', selectionHash, completed: 0, total: shops.length };
  }, { signal });
  const products = [], incompleteShops = [], pendingShops = [];
  try {
    for (const [index, shop] of shops.entries()) {
      signal?.throwIfAborted();
      let snapshot;
      const entry = state.shopManifest[shop.shopKey];
      if (entry?.snapshotRevision) {
        const cached = await store.readSnapshot(entry.snapshotRevision);
        if (evidenceStatus(cached, { maxAgeMs: params.evidenceMaxAgeMs }) === 'current' && !['load_stalled', 'time_budget_reached'].includes(cached.stopReason)) snapshot = cached;
      }
      if (!snapshot) snapshot = await collectShopSnapshot(shop, {
        ...params, channel, signal, collector: options.collector,
        onProgress: progress => onProgress?.({ ...progress, shopKey: shop.shopKey, current: index, total: shops.length }),
      });
      signal?.throwIfAborted();
      const snapshotRevision = await store.writeSnapshot(snapshot);
      state = await store.transact(state.revision, draft => {
        draft.shopManifest[shop.shopKey] = { shopUrl: shop.shopUrl, collectHash, snapshotRevision };
        draft.checkpoints.collectPeerProducts.completed = index + 1;
      }, { signal });
      const eligible = await collectShopCandidates(shop, { snapshot, minPayment: params.minPayment, signal });
      products.push(...eligible.products.map(product => ({ ...product, shopKey: shop.shopKey, snapshotRevision })));
      if (snapshot.completeness !== 'reached_end') incompleteShops.push(shop.shopKey);
      if (['load_stalled', 'time_budget_reached'].includes(snapshot.stopReason)) pendingShops.push(shop.shopKey);
      onProgress?.({ current: index + 1, total: shops.length, collected: snapshot.totalCollected, eligible: eligible.products.length, shopKey: shop.shopKey });
    }
    const generation = fingerprint({ manifest: state.shopManifest, minPayment: params.minPayment, branch: params.discoveryBranch });
    const status = pendingShops.length ? 'needs_attention' : 'completed';
    state = await store.transact(state.revision, draft => {
      draft.checkpoints.collectPeerProducts = { ...draft.checkpoints.collectPeerProducts, status, generation, eligibleCount: products.length, incompleteShops, pendingShops };
    }, { signal });
    if (runDir) {
      const peerProductsFile = path.join(runDir, 'peer-products.jsonl');
      const lines = products.map(p => JSON.stringify(p)).join('\n') + (products.length ? '\n' : '');
      await fs.writeFile(peerProductsFile, lines, 'utf8').catch(() => {});
    }
    return { status, generation, products, eligibleCount: products.length, incompleteShops, pendingShops, revision: state.revision };
  } catch (error) {
    // 不覆盖并发更新；原错误仍交给节点执行器映射为阻塞、暂停或失败。
    await store.transact(state.revision, draft => {
      draft.checkpoints.collectPeerProducts = { ...draft.checkpoints.collectPeerProducts,
        status: signal?.aborted ? 'interrupted' : 'failed', error: { code: error.code || 'PEER_COLLECTION_FAILED', message: error.message } };
    }).catch(() => {});
    throw error;
  }
}

module.exports = { collectPeerProducts };
