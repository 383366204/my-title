const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { addSeed, listSeeds, mineKeywords, scoreKeyword, expandSeed, rejectCandidate } = require('..');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'keyword-mining-'));
}

describe('keyword-mining', () => {
  test('addSeed stores and sorts seeds', () => {
    const dataDir = tempDataDir();
    addSeed('戒指', { category: '饰品', priority: 10, reason: 'test', dataDir });
    addSeed('宠物玩具', { category: '宠物', priority: 8, dataDir });

    const seeds = listSeeds({ dataDir });
    assert.strictEqual(seeds.length, 2);
    assert.strictEqual(seeds[0].keyword, '戒指');
    assert.strictEqual(seeds[0].priorityScore, 10);
  });

  test('expandSeed creates specific candidates', () => {
    const candidates = expandSeed({ keyword: '戒指', category: '饰品' }, { maxPerSeed: 20 });
    const words = candidates.map(item => item.keyword);

    assert.ok(words.includes('玛瑙戒指'));
    assert.ok(words.includes('戒指女'));
    assert.ok(candidates.every(item => item.seed === '戒指'));
  });

  test('expandSeed uses category rules for pet products', () => {
    const candidates = expandSeed({ keyword: '宠物玩具', category: '宠物' }, { maxPerSeed: 40 });
    const words = candidates.map(item => item.keyword);

    assert.ok(words.includes('狗狗宠物玩具'));
    assert.ok(words.includes('耐咬宠物玩具'));
    assert.ok(words.includes('猫咪耐咬宠物玩具'));
  });

  test('expandSeed avoids material stacking and mismatched hair accessory crowds', () => {
    const ringWords = expandSeed({ keyword: '玛瑙戒指', category: '饰品' }, { maxPerSeed: 80 }).map(item => item.keyword);
    const hairWords = expandSeed({ keyword: '发夹', category: '发饰' }, { maxPerSeed: 80 }).map(item => item.keyword);

    assert.ok(!ringWords.some(word => word.includes('纯银玛瑙戒指')));
    assert.ok(!hairWords.some(word => word.includes('男士')));
    assert.ok(hairWords.includes('珍珠发夹'));
  });

  test('rejectCandidate blocks unreasonable combinations', () => {
    assert.strictEqual(rejectCandidate('宝宝戒指').rejected, true);
    assert.strictEqual(rejectCandidate('玛瑙宠物玩具').rejected, true);
    assert.strictEqual(scoreKeyword('宝宝戒指').nextAction, 'reject');
  });

  test('scoreKeyword favors concrete product long-tail words', () => {
    const scored = scoreKeyword('玛瑙戒指女');

    assert.ok(scored.localScore >= 65);
    assert.strictEqual(scored.nextAction, 'sycm_verify');
    assert.ok(scored.reason.includes('材质+商品词+人群组合'));
  });

  test('mineKeywords returns ranked candidates without persisting when disabled', () => {
    const dataDir = tempDataDir();
    addSeed('戒指', { category: '饰品', priority: 10, dataDir });
    addSeed('宠物玩具', { category: '宠物', priority: 9, dataDir });

    const result = mineKeywords({ dataDir, count: 10, persist: false });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.seedsUsed, 2);
    assert.ok(result.candidates.length > 0);
    assert.ok(result.candidates[0].localScore >= result.candidates[result.candidates.length - 1].localScore);
    assert.strictEqual(fs.existsSync(path.join(dataDir, 'candidates.jsonl')), false);
  });

  test('mineKeywords applies diversity limits and next commands', () => {
    const dataDir = tempDataDir();
    addSeed('戒指', { category: '饰品', priority: 10, dataDir });
    addSeed('宠物玩具', { category: '宠物', priority: 9, dataDir });

    const result = mineKeywords({ dataDir, count: 12, outputMaxPerSeed: 2, persist: false });
    const bySeed = new Map();
    for (const item of result.candidates) {
      bySeed.set(item.seed, (bySeed.get(item.seed) || 0) + 1);
      assert.ok(item.nextCommands.sycm.includes('node bin/cli.js sycm'));
    }

    assert.ok(result.candidates.length > 0);
    assert.ok([...bySeed.values()].every(count => count <= 2));
  });
});
