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
  const max = Number(options.max || MAX_EXACT_KEYWORDS);
  const values = (Array.isArray(input) ? input : [input])
    .flatMap(value => String(value || '').split(/[\r\n,，;；、]+/))
    .map(value => value.trim())
    .filter(Boolean);
  const keywords = [...new Set(values)];
  if (keywords.length > max) {
    throw new Error(`精确关键词最多输入 ${max} 个`);
  }
  return keywords;
}

module.exports = {
  MAX_EXACT_KEYWORDS,
  normalizeExactKeywords
};
