'use strict';

/**
 * Normalize user-provided root keywords without applying a business count cap.
 * @param {string|string[]} input Root keyword input.
 * @returns {{roots:string[], duplicates:string[]}} Ordered unique roots and duplicates.
 */
function normalizeRootKeywords(input) {
  const values = (Array.isArray(input) ? input : [input])
    .flatMap(value => String(value || '').split(/[\r\n,，;；、]+/))
    .map(value => value.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  const seen = new Set();
  const duplicateSet = new Set();
  const roots = [];
  for (const value of values) {
    const key = value.replace(/\s+/g, '').toLowerCase();
    if (seen.has(key)) {
      duplicateSet.add(value);
      continue;
    }
    seen.add(key);
    roots.push(value);
  }
  return { roots, duplicates: [...duplicateSet] };
}

module.exports = {
  normalizeRootKeywords
};
