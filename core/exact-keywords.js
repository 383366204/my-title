'use strict';

const MAX_EXACT_KEYWORDS = 20;

/**
 * Normalize exact-keyword input from arrays or delimiter-separated text.
 * @param {string|string[]} input Keyword input.
 * @param {object} [options] Normalization options.
 * @param {number} [options.max] Maximum accepted keyword count.
 * @returns {string[]} Ordered, deduplicated keywords.
 */
function normalizeExactKeywords(input, options = {}) {
  const max = Number(options.max || 0);
  const inputs = Array.isArray(input) ? input : [input];
  if (inputs.some(value => value != null && typeof value !== 'string')) {
    throw new Error('关键词格式不正确，请输入文本');
  }
  const values = inputs
    .flatMap(value => String(value || '').split(/[\r\n,，;；、]+/))
    .map(value => value.trim())
    .filter(Boolean);
  const keywords = [...new Set(values)];
  if (keywords.some(value => /[\u0000-\u001f\u007f<>]/.test(value) || /https?:\/\//i.test(value))) {
    throw new Error('关键词格式不正确，请勿输入链接、HTML 或控制字符');
  }
  if (max > 0 && keywords.length > max) {
    throw new Error(`精确关键词最多输入 ${max} 个`);
  }
  return keywords;
}

module.exports = {
  MAX_EXACT_KEYWORDS,
  normalizeExactKeywords
};
