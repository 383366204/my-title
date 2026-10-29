'use strict';

const { normalizePriceRatio } = require('./price-comparison');
const { normalizeTaobaoChannel } = require('./taobao-channel');

function integer(value, fallback, min, max, name) {
  if (value === undefined) return fallback;
  if (!['string', 'number'].includes(typeof value) || !/^\d+$/.test(String(value))) throw new Error(`${name}必须为整数`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${name}必须在${min}-${max}之间`);
  return number;
}

function decimal(value, fallback, min, max, name) {
  if (value === undefined) return fallback;
  if (!['string', 'number'].includes(typeof value) || !/^\d+(?:\.\d+)?$/.test(String(value))) throw new Error(`${name}必须为十进制数`);
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${name}必须在${min}-${max}之间`);
  return number;
}

/**
 * Validate shared peer discovery inputs before any platform request.
 * @param {object} raw CLI, MCP or UI values.
 * @returns {object} Canonical parameters used for persistence and fingerprints.
 */
function normalizePeerDiscoveryParams(raw = {}) {
  const discoveryBranch = raw.discoveryBranch ?? 'peer-analysis';
  if (!['peer-analysis', 'image-selection'].includes(discoveryBranch)) throw new Error('未知的同行发现分支');
  const requestedMethod = raw.allocationMethod ?? 'sequential-average';
  const allocationMethod = requestedMethod === 'sequential' ? 'sequential-average' : requestedMethod === 'duplicate' ? 'repeat' : requestedMethod;
  if (!['sequential-average', 'random-average', 'random', 'repeat'].includes(allocationMethod)) throw new Error('未知的商品分配方式');
  const params = {
    ...(raw.links !== undefined ? { links: raw.links } : {}),
    ...(raw.rawLinks !== undefined ? { rawLinks: raw.rawLinks } : {}),
    discoveryBranch,
    taobaoChannel: normalizeTaobaoChannel(raw.taobaoChannel),
    allocationMethod,
    imagePriceRatioThreshold: normalizePriceRatio(raw.imagePriceRatioThreshold ?? '1'),
    similarityThreshold: decimal(raw.similarityThreshold, 0.45, 0, 1, '相似度门槛'),
    priceRatioThreshold: decimal(raw.priceRatioThreshold, 0.7, 0, 10, '原分支价格比例'),
    collectLimit: integer(raw.collectLimit, 40, 10, 50, '采集数量'),
    minProducts: integer(raw.minProducts, 10, 1, 50, '商品数量门槛'),
    minSourcing: integer(raw.minSourcing, 5, 1, 50, '货源数量门槛'),
    minPayment: integer(raw.minPayment, 10, 0, 10000, '付款人数门槛'),
    maxCandidateShops: integer(raw.maxCandidateShops ?? raw.maxShops, 30, 1, 100, '候选店铺数量'),
    searchMaxProducts: integer(raw.searchMaxProducts, 10, 1, 50, '单次搜索数量'),
    searchMaxPages: integer(raw.searchMaxPages, 1, 1, 10, '搜索页数'),
    port: integer(raw.port, 9222, 1, 65535, 'Chrome端口'),
    evidenceMaxAgeMs: integer(raw.evidenceMaxAgeMs, 86400000, 1, Number.MAX_SAFE_INTEGER, '证据有效期')
  };
  if (discoveryBranch === 'peer-analysis' && Math.max(params.minProducts, params.minSourcing) > params.collectLimit) throw new Error('数量门槛不能超过采集上限');
  return params;
}

module.exports = { normalizePeerDiscoveryParams };
