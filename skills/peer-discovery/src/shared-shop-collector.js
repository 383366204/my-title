'use strict';

const { collectSortedShopProducts } = require('../../competitor-analysis/src/collector');
const { collectTaobaoWebShop } = require('./taobao-web-shop-collector');

/**
 * Parse payment evidence, retaining unknown versus explicitly zero.
 * @param {string} text Original payment label.
 * @returns {object} hasSignal and conservative integer lower bound.
 */
function parsePaymentSignal(text) {
  const unknown = { hasSignal: false, value: 0 };
  if (typeof text !== 'string') return unknown;
  const compact = text.replace(/\s+/g, '');
  const match = compact.match(/^(不足|少于|未满)?(\d+(?:\.\d+)?)(万|千|百)?(?:[-~～至](\d+(?:\.\d+)?)(万|千|百)?)?\+?人付款$/);
  if (!match) return unknown;
  const multiplier = unit => ({ 万: 10000, 千: 1000, 百: 100 }[unit] || 1);
  const value = Math.round(Number(match[2]) * multiplier(match[3] || match[5]));
  const upper = match[4] === undefined ? value : Math.round(Number(match[4]) * multiplier(match[5] || match[3]));
  if (!Number.isSafeInteger(value) || !Number.isSafeInteger(upper) || upper < value) return unknown;
  return { hasSignal: true, value: match[1] ? 0 : value };
}

/**
 * Collect raw shop evidence without applying payment or shop verdict gates.
 * @param {object} shop Resolved shop profile.
 * @param {object} options Collector/client, collectLimit and optional signal.
 * @returns {Promise<object>} Snapshot, conservatively incomplete unless explicitly proven complete.
 */
async function collectShopSnapshot(shop, options = {}) {
  if (!shop?.shopKey) throw new Error('缺少稳定店铺标识');
  options.signal?.throwIfAborted();
  const limit = options.collectLimit ?? 40;
  if (!Number.isSafeInteger(limit) || limit < 10 || limit > 50) throw new Error('采集数量必须为10-50');
  const maxAgeMs = options.evidenceMaxAgeMs ?? 86400000;
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) throw new Error('证据有效期必须为正整数');
  const channel = options.channel ?? 'native';
  if (!['native', 'web'].includes(channel)) throw new Error('请先确认淘宝采集通道，不能在采集时自动切换');
  const collector = options.collector || (channel === 'web' ? collectTaobaoWebShop : collectSortedShopProducts);
  // 平台异常原样传递，由编排器区分登录/验证码/连接等阻塞，绝不伪造空结果。
  const startedAt = Date.now();
  const result = await collector(shop, 'hot', {
    client: options.client, limit, signal: options.signal, port: options.port,
    evidenceMaxAgeMs: maxAgeMs, onProgress: options.onProgress,
    guardOptions: options.guardOptions,
  });
  options.signal?.throwIfAborted();
  if (!Array.isArray(result?.products)) throw new Error('商品采集返回格式无效');
  if (result.shopKey && result.shopKey !== shop.shopKey) throw new Error('商品采集返回了其他店铺');
  if (result.channel && result.channel !== channel) throw new Error('商品采集通道与已确认通道不一致');
  const observedAt = result.observedAt ?? startedAt;
  const expiresAt = Math.min(result.expiresAt ?? observedAt + maxAgeMs, observedAt + maxAgeMs);
  if (!Number.isSafeInteger(observedAt) || observedAt < 0 || observedAt > Date.now() ||
      !Number.isSafeInteger(expiresAt) || expiresAt <= observedAt) throw new Error('商品采集证据时间无效');
  return {
    shopKey: shop.shopKey,
    channel,
    observedAt,
    expiresAt,
    stopReason: result.stopReason ?? null,
    products: result.products.map(product => ({ ...product })),
    // 现有collector没有页尾证据；滚动停止或取得limit不能视为全店采完。
    completeness: result.collectionCompleteness === 'reached_end' ? 'reached_end' : 'uncertain',
    totalCollected: result.products.length
  };
}

/**
 * Filter a raw snapshot without another platform request when supplied.
 * @param {object} shop Resolved shop profile.
 * @param {object} options Snapshot or collector options plus minPayment.
 * @returns {Promise<object>} Snapshot metadata, filtered products and raw count.
 */
async function collectShopCandidates(shop, options = {}) {
  const minPayment = options.minPayment ?? 10;
  if (!Number.isSafeInteger(minPayment) || minPayment < 0) throw new Error('付款人数门槛必须为非负整数');
  options.signal?.throwIfAborted();
  const snapshot = options.snapshot || await collectShopSnapshot(shop, options);
  if (!shop?.shopKey || snapshot.shopKey !== shop.shopKey || !Array.isArray(snapshot.products)) throw new Error('快照与店铺不匹配');
  return {
    ...snapshot,
    products: snapshot.products.filter(product => {
      const signal = parsePaymentSignal(product.paymentText);
      return signal.hasSignal && signal.value >= minPayment;
    })
  };
}

module.exports = { parsePaymentSignal, collectShopSnapshot, collectShopCandidates };
