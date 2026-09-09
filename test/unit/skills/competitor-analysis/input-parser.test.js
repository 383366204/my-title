'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCompetitorInputs } = require('../../../../skills/competitor-analysis/src/input-parser');

test('parses and deduplicates a full Taobao share message', () => {
  const input = '【淘宝】09₴HkTFT2s9oS9《 [https://m.tb.cn/h.8jmiOTsTYDdLRYz](https://m.tb.cn/h.8jmiOTsTYDdLRYz) HU108 点击链接直接打开';
  const result = parseCompetitorInputs(input);
  assert.equal(result.links.length, 1);
  assert.equal(result.links[0].inputUrl, 'https://m.tb.cn/h.8jmiOTsTYDdLRYz');
  assert.equal(result.links[0].kind, 'short');
  assert.equal(result.duplicateCount, 1);
});

test('rejects non-Taobao links and respects the configured limit', () => {
  const result = parseCompetitorInputs('https://example.com/a\nhttps://shop123.taobao.com/\nhttps://shop456.taobao.com/', { limit: 1 });
  assert.equal(result.links.length, 1);
  assert.equal(result.invalid.length, 1);
  assert.equal(result.truncatedCount, 1);
});

test('rejects trusted-looking URLs with credentials or nonstandard ports', () => {
  const parsed = parseCompetitorInputs([
    'https://user:pass@shop123.taobao.com/',
    'https://shop123.taobao.com:444/search.htm'
  ]);
  assert.equal(parsed.links.length, 0);
  assert.equal(parsed.invalid.length, 2);
});
