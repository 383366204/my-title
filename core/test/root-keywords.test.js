'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeRootKeywords } = require('../root-keywords');

test('root keyword input has no business count cap and reports duplicates', () => {
  const input = [...Array.from({ length: 250 }, (_, index) => `词根${index}`), '词根1', ' 词根2 '].join('\n');
  const result = normalizeRootKeywords(input);

  assert.equal(result.roots.length, 250);
  assert.deepEqual(result.duplicates, ['词根1', '词根2']);
});
