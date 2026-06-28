const { describe, it } = require('node:test');
const assert = require('node:assert');
const { extractNouns } = require('../core/word-segmenter');

describe('Word Segmenter', () => {
  it('should extract nouns and VN words from product titles', () => {
    const titles = [
      '夏季防晒衣女轻薄透气防晒服户外防风衣',
      '纯银项链女小众设计感高级轻奢锁骨链',
      '韩版百搭运动鞋男透气跑步休闲鞋'
    ];

    const result = extractNouns(titles);
    assert.ok(Array.isArray(result), 'Result should be an array');
    assert.ok(result.length > 0, 'Result should not be empty');

    // Check if expected product nouns are extracted
    const words = result.map(item => item.word);

    // Nouns like '银项链', '锁骨', '防晒' should exist
    assert.ok(words.includes('银项链') || words.includes('锁骨') || words.includes('项链'), 'Should extract neckwear terms');
    assert.ok(words.includes('防晒') || words.includes('防风'), 'Should extract outerwear terms');

    // Verify ignored words are filtered out
    assert.ok(!words.includes('的'), 'Should filter out common particles');
    assert.ok(!words.includes('设计感'), 'Should filter out ignored modifiers');
  });

  it('should count frequencies correctly', () => {
    const titles = [
      '纯银项链锁骨链',
      '项链珍珠项链',
      '项链女配饰'
    ];
    const result = extractNouns(titles);
    const xianglian = result.find(item => item.word === '项链');
    assert.ok(xianglian, 'Should find item for 项链');
    assert.ok(xianglian.count >= 2, 'xianglian count should be registered');
  });
});
