'use strict';

/**
 * Normalize a positive decimal without rounding or exponent notation.
 * @param {string|number} value Decimal input.
 * @returns {string} Canonical decimal with at most six fractional digits.
 */
function normalizePriceRatio(value = '1') {
  if (!['string', 'number'].includes(typeof value)) throw new TypeError('价格比例必须是十进制数');
  const text = String(value).trim();
  if (text.length > 64 || !/^\d+(?:\.\d{1,6})?$/.test(text)) throw new Error('价格比例最多支持6位小数，不支持科学计数法');
  const [whole, fraction = ''] = text.split('.');
  if (BigInt(whole + fraction) <= 0n) throw new Error('价格比例必须大于0');
  const integer = BigInt(whole).toString();
  const decimal = fraction.replace(/0+$/, '');
  return decimal ? `${integer}.${decimal}` : integer;
}

/**
 * Parse a positive price into a common fixed-point scale.
 * @param {string} value Original decimal price, not a binary float.
 * @param {number} scale Shared precision, default four decimal places.
 * @returns {bigint} Scaled price.
 */
function parsePrice(value, scale = 4) {
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > 6) throw new Error('非法价格精度');
  if (typeof value !== 'string' || value.length > 64 || !/^\d+(?:\.\d+)?$/.test(value.trim())) throw new Error('缺少明确的十进制单价');
  const [whole, fraction = ''] = value.trim().split('.');
  if (fraction.length > scale) throw new Error('单价超出支持精度');
  const result = BigInt(whole + fraction.padEnd(scale, '0'));
  if (result <= 0n) throw new Error('单价必须大于0');
  return result;
}

/**
 * Compare already comparable, same-currency single-piece prices strictly.
 * @param {string} sourcePrice 1688 price text.
 * @param {string} targetPrice Taobao price text.
 * @param {string|number} ratio Positive ratio.
 * @returns {boolean} True only when source/target is strictly below ratio.
 */
function belowPriceRatio(sourcePrice, targetPrice, ratio = '1') {
  const [whole, fraction = ''] = normalizePriceRatio(ratio).split('.');
  // 交叉相乘，避免除法和四舍五入改变严格边界。
  return parsePrice(sourcePrice) * (10n ** BigInt(fraction.length))
    < parsePrice(targetPrice) * BigInt(whole + fraction);
}

module.exports = { normalizePriceRatio, parsePrice, belowPriceRatio };
