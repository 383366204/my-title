'use strict';

const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { distributionMode } = require('../../../core/distribution-targets');

/**
 * Create an allocation preview. Persist this result; never regenerate on retry.
 * @param {object} options Confirmed unique offerIds, shopIds, draftRevision, mode and optional seed.
 * @returns {object} Plan with stable item/shop pairs and per-shop counts.
 */
function createAllocationPlan({ offerIds, shopIds, draftRevision, mode = 'sequential-average', seed = randomBytes(16).toString('hex') }) {
  distributionMode(mode);
  for (const [name, values] of [['商品', offerIds], ['店铺', shopIds]]) {
    if (!Array.isArray(values) || values.some(id => typeof id !== 'string' || !id.trim()) || new Set(values).size !== values.length) throw new Error(`${name}ID必须非空且不重复`);
  }
  if (!shopIds.length || typeof draftRevision !== 'string' || !draftRevision) throw new Error('缺少店铺或草稿版本');
  if (typeof seed !== 'string' || !seed || seed.length > 256) throw new Error('非法随机种子');
  let counter = 0;
  const nextIndex = max => {
    // 拒绝采样避免取模偏差；种子和计数器使同一计划可复现。
    const limit = Math.floor(0x100000000 / max) * max;
    let value;
    do { value = createHash('sha256').update(JSON.stringify([seed, counter++])).digest().readUInt32BE(); } while (value >= limit);
    return value % max;
  };
  const ordered = [...offerIds];
  if (mode === 'random-average') {
    for (let i = ordered.length - 1; i > 0; i--) {
      const j = nextIndex(i + 1);
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }
  }
  const items = [];
  if (mode === 'repeat' || mode === 'random') {
    for (const offerId of ordered) {
      const targets = mode === 'repeat' ? shopIds : [shopIds[nextIndex(shopIds.length)]];
      for (const targetShopId of targets) items.push({ offerId, targetShopId });
    }
  } else {
    let offset = 0;
    shopIds.forEach((targetShopId, index) => {
      const count = Math.floor(ordered.length / shopIds.length) + (index < ordered.length % shopIds.length ? 1 : 0);
      for (const offerId of ordered.slice(offset, offset + count)) items.push({ offerId, targetShopId });
      offset += count;
    });
  }
  return {
    planId: randomUUID(), draftRevision, mode, seed, items,
    counts: shopIds.map(targetShopId => ({ targetShopId, count: items.filter(item => item.targetShopId === targetShopId).length }))
  };
}

/**
 * Split a persisted plan into single-shop transport batches, without allocation.
 * @param {object} plan Persisted allocation plan.
 * @param {number} batchSize Maximum offers per batch.
 * @returns {object[]} Single-shop batches in plan order.
 */
function splitAllocationBatches(plan, batchSize = 20) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error('非法批次大小');
  const groups = new Map();
  const seen = new Set();
  for (const item of plan.items) {
    if (typeof item.offerId !== 'string' || !item.offerId || typeof item.targetShopId !== 'string' || !item.targetShopId) throw new Error('非法分配项');
    const key = JSON.stringify([item.targetShopId, item.offerId]);
    if (seen.has(key)) throw new Error('重复的商品店铺分配');
    seen.add(key);
    if (!groups.has(item.targetShopId)) groups.set(item.targetShopId, []);
    groups.get(item.targetShopId).push(item.offerId);
  }
  const batches = [];
  for (const [targetShopId, offerIds] of groups) {
    for (let offset = 0; offset < offerIds.length; offset += batchSize) {
      const items = offerIds.slice(offset, offset + batchSize);
      const batchId = createHash('sha256').update(JSON.stringify([plan.planId, targetShopId, offset, items])).digest('hex');
      batches.push({ batchId, targetShopId, offerIds: items, distributionMode: 'sequential-average' });
    }
  }
  return batches;
}

module.exports = { createAllocationPlan, splitAllocationBatches };
