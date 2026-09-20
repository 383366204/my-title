'use strict';
const modes = require('./distribution-modes.json');

/**
 * 读取任务目标快照，兼容已有单店任务。
 * @param {object} options 铺货参数或任务。
 * @returns {object[]} 目标店铺。
 */
function distributionTargets(options = {}) {
  return options.targetShops || (options.shop ? [options.shop] : []);
}

/**
 * 校验平台分配方式，旧 CLI 的 auto 仍对应随机平均。
 * @param {string} value 分配方式。
 * @returns {object} 方式及平台文案。
 */
function distributionMode(value = 'random-average') {
  const mode = modes.find(row => row.value === (value === 'auto' ? 'random-average' : value));
  if (!mode) throw Object.assign(new Error('无效的商品分配方式'), { code: 'INVALID_SHOP' });
  return mode;
}

/**
 * 用物理店铺和分配方式核对任务是否更换目标，不受选择顺序影响。
 * @param {object} options 铺货参数。
 * @returns {string} 可比较的目标标识。
 */
function distributionTargetKey(options) {
  return JSON.stringify({ shops: distributionTargets(options).map(shop => [shop.platformShopName, shop.port]).sort(), mode: distributionMode(options.distributionMode).value });
}

module.exports = { distributionTargets, distributionMode, distributionTargetKey };
