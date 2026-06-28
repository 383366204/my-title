const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  byteLen,
  constructFallbackTitle,
  appendWordsToTarget,
  completeTitle,
  scoreTitle
} = require('../src/title-utils');

describe('title-utils length expansion', () => {
  test('constructFallbackTitle fills toward 60 bytes when source words are available', () => {
    const title = constructFallbackTitle(
      '宠物玩具',
      '宠物玩具狗狗磨牙耐咬毛绒发声玩具小狗解闷陪伴训练宠物用品',
      [
        '宠物玩具狗狗耐咬互动训练磨牙洁齿发声球',
        '狗狗玩具自嗨解闷陪伴宠物用品毛绒耐咬'
      ],
      60,
      60
    );

    assert.ok(title.startsWith('宠物玩具'));
    assert.ok(byteLen(title) >= 58, `expected title near 60 bytes, got ${byteLen(title)}: ${title}`);
    assert.ok(byteLen(title) <= 60, `expected title <= 60 bytes, got ${byteLen(title)}: ${title}`);
  });

  test('appendWordsToTarget uses safe filler only when source words are not enough', () => {
    const title = appendWordsToTarget('项链女锁骨链', ['项链女'], 60, 60);

    assert.ok(byteLen(title) > byteLen('项链女锁骨链'));
    assert.ok(byteLen(title) <= 60);
  });

  test('scoreTitle exposes quality diagnostics', () => {
    const result = scoreTitle({
      title: '宠物玩具狗狗磨牙耐咬毛绒发声玩具小狗解闷陪伴训练宠物用品',
      blueOceanWord: '宠物玩具',
      coreWord: '玩具',
      modifiers: [{ word: '狗狗', rigidity: 'rigid' }],
      sycmKeywords: [{ keyword: '磨牙耐咬' }, { keyword: '解闷陪伴' }],
      minLength: 60,
      maxLength: 60
    });

    assert.ok(result.score >= 80, `expected high quality score, got ${result.score}`);
    assert.strictEqual(result.prefixOk, true);
    assert.deepStrictEqual(result.sycmWordsUsed, ['磨牙耐咬', '解闷陪伴']);
  });

  test('scoreTitle treats cleaned blue ocean word as prefix', () => {
    const result = scoreTitle({
      title: '本命年吊坠女朱砂貔貅项链转运招财紫金砂红绳款',
      blueOceanWord: '本命年吊坠 女',
      coreWord: '吊坠',
      modifiers: [{ word: '本命年', rigidity: 'rigid' }, { word: '女', rigidity: 'rigid' }],
      minLength: 40,
      maxLength: 60
    });

    assert.strictEqual(result.prefixOk, true);
    assert.ok(!result.issues.includes('蓝海词未前置'));
  });

  test('completeTitle collapses repeated cleaned blue ocean prefixes', () => {
    const title = completeTitle(
      '本命年吊坠女本命年吊坠女朱砂貔貅项链转运招财',
      '本命年吊坠 女',
      ['朱砂貔貅项链转运招财紫金砂红绳款'],
      40,
      60
    );

    assert.ok(title.startsWith('本命年吊坠女'));
    assert.ok(!title.startsWith('本命年吊坠女本命年吊坠女'));
  });

  test('completeTitle removes stale year claims', () => {
    const staleYear = new Date().getFullYear() - 1;
    const title = completeTitle(
      `本命年吊坠女${staleYear}年新款朱砂貔貅项链转运招财`,
      '本命年吊坠 女',
      ['朱砂貔貅项链转运招财紫金砂红绳款'],
      40,
      60
    );

    assert.ok(!title.includes(`${staleYear}年`));
  });
});
