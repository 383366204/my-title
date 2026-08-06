'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeExactKeywords } = require('../exact-keywords');

test('normalizeExactKeywords accepts common delimiters and removes duplicates', () => {
  assert.deepEqual(normalizeExactKeywords('纯银项链\n桌面收纳盒，纯银项链;宠物磨牙玩具'), [
    '纯银项链',
    '桌面收纳盒',
    '宠物磨牙玩具'
  ]);
});

test('normalizeExactKeywords keeps phrases intact and limits batch size', () => {
  assert.deepEqual(normalizeExactKeywords(['纯银 项链', '桌面 收纳盒']), ['纯银 项链', '桌面 收纳盒']);
  assert.throws(
    () => normalizeExactKeywords(Array.from({ length: 21 }, (_, index) => `关键词${index + 1}`)),
    /最多输入 20 个/
  );
});
