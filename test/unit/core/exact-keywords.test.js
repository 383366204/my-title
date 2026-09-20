'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeExactKeywords } = require('../../../core/exact-keywords');

test('normalizeExactKeywords accepts common delimiters and removes duplicates', () => {
  assert.deepEqual(normalizeExactKeywords('纯银项链\n桌面收纳盒，纯银项链;宠物磨牙玩具'), [
    '纯银项链',
    '桌面收纳盒',
    '宠物磨牙玩具'
  ]);
});

test('normalizeExactKeywords keeps phrases intact and allows arbitrary batch size without max', () => {
  assert.deepEqual(normalizeExactKeywords(['纯银 项链', '桌面 收纳盒']), ['纯银 项链', '桌面 收纳盒']);
  const moreThanTwenty = Array.from({ length: 25 }, (_, index) => `关键词${index + 1}`);
  assert.equal(normalizeExactKeywords(moreThanTwenty).length, 25);
  assert.throws(
    () => normalizeExactKeywords(moreThanTwenty, { max: 20 }),
    /最多输入 20 个/
  );
});
