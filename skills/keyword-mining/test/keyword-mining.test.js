const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  addSeed,
  listSeeds,
  mineKeywords,
  scoreKeyword,
  expandSeed,
  rejectCandidate,
  keywordSignature,
  clusterBySignature,
  diversifyCandidates,
  normalizeAIResponse
} = require('..');
const { extractSearchPopularityFromSycmJson } = require('../src/sycm-precheck');

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
    const candidates = expandSeed({ keyword: '戒指', category: '饰品' }, { maxPerSeed: 30 });
    const words = candidates.map(item => item.keyword);

    assert.ok(words.includes('玛瑙戒指'));
    assert.ok(words.includes('戒指女'));
    assert.ok(candidates.every(item => item.seed === '戒指'));
  });

  test('expandSeed uses category rules for pet products', () => {
    const candidates = expandSeed({ keyword: '宠物玩具', category: '宠物' }, { maxPerSeed: 60 });
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
    assert.strictEqual(scored.tier, 'high');
    assert.ok(scored.reason.includes('材质+商品词+人群组合'));
    assert.strictEqual(scored.coreProduct, '戒指');
    assert.ok(scored.signature.includes('戒指'));
    assert.ok(scored.signature.includes('玛瑙'));
  });

  test('keywordSignature groups reordered modifiers into the same direction', () => {
    const a = keywordSignature('夏季防晒冰袖女');
    const b = keywordSignature('防晒冰袖女夏季');

    assert.strictEqual(a.coreProduct, '冰袖');
    assert.strictEqual(a.signature, b.signature);
  });

  test('clusterBySignature keeps the best keyword and records alternatives', () => {
    const items = ['夏季防晒冰袖女', '防晒冰袖女夏季', '珍珠发夹女'].map((word, index) => {
      const scored = scoreKeyword(word);
      return {
        keyword: word,
        localScore: scored.localScore + index,
        signature: scored.signature,
        coreProduct: scored.coreProduct
      };
    });

    const clustered = clusterBySignature(items);
    const iceSleeve = clustered.find(item => item.coreProduct === '冰袖');

    assert.strictEqual(clustered.length, 2);
    assert.ok(iceSleeve.cluster.includes('夏季防晒冰袖女'));
    assert.ok(iceSleeve.cluster.includes('防晒冰袖女夏季'));
    assert.strictEqual(iceSleeve.clusterSize, 2);
  });

  test('diversifyCandidates limits repeated core products', () => {
    const items = ['玛瑙戒指女', '纯银戒指女', '朱砂戒指女', '珍珠发夹女'].map(word => {
      const scored = scoreKeyword(word);
      return {
        keyword: word,
        localScore: scored.localScore,
        signature: scored.signature,
        coreProduct: scored.coreProduct,
        seed: scored.coreProduct,
        category: '',
        pattern: 'test'
      };
    });

    const selected = diversifyCandidates(items, {
      count: 10,
      maxPerSeed: 10,
      maxPerCategory: 10,
      maxPerPattern: 10,
      maxPerProductCore: 2
    });

    assert.strictEqual(selected.filter(item => item.coreProduct === '戒指').length, 2);
    assert.ok(selected.some(item => item.coreProduct === '发夹'));
  });

  test('mineKeywords returns ranked candidates without persisting when disabled', async () => {
    const dataDir = tempDataDir();
    addSeed('戒指', { category: '饰品', priority: 10, dataDir });
    addSeed('宠物玩具', { category: '宠物', priority: 9, dataDir });

    const result = await mineKeywords({ dataDir, count: 10, persist: false });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.seedsUsed, 2);
    assert.ok(result.stats.expanded > 0);
    assert.ok(result.stats.duplicatesRemoved >= 0);
    assert.ok(result.candidates.length > 0);
    assert.ok(result.candidates[0].localScore >= result.candidates[result.candidates.length - 1].localScore);
    assert.strictEqual(fs.existsSync(path.join(dataDir, 'candidates.jsonl')), false);
  });

  test('mineKeywords default seed pool produces candidates', async () => {
    const result = await mineKeywords({ count: 5, persist: false });

    assert.strictEqual(result.ok, true);
    assert.ok(result.stats.expanded > 0);
    assert.ok(result.candidates.length > 0);
  });

  test('sycm precheck reads CLI data payload shape', () => {
    const popularity = extractSearchPopularityFromSycmJson({
      ok: true,
      data: [{ keyword: '弹力带', searchPopularity: 128 }]
    });

    assert.strictEqual(popularity, 128);
  });

  test('mineKeywords applies diversity limits and next commands', async () => {
    const dataDir = tempDataDir();
    addSeed('戒指', { category: '饰品', priority: 10, dataDir });
    addSeed('宠物玩具', { category: '宠物', priority: 9, dataDir });

    const result = await mineKeywords({ dataDir, count: 12, outputMaxPerSeed: 2, persist: false });
    const bySeed = new Map();
    for (const item of result.candidates) {
      bySeed.set(item.seed, (bySeed.get(item.seed) || 0) + 1);
      assert.ok(item.nextCommands.hotCheck.includes('--mode hot'));
      assert.ok(item.nextCommands.blueExplore.includes('--mode blue'));
      assert.ok(['high', 'mid', 'low'].includes(item.tier));
    }

    assert.ok(result.candidates.length > 0);
    assert.ok([...bySeed.values()].every(count => count <= 2));
  });

  test('mineKeywords separates direct seeds by default', async () => {
    const dataDir = tempDataDir();
    addSeed('水枪玩具', { category: '玩具', priority: 10, type: 'direct', dataDir });

    const result = await mineKeywords({ dataDir, count: 5, persist: false });

    assert.ok(result.directKeywords.some(item => item.keyword === '水枪玩具' && item.pattern === 'direct-seed'));
    assert.ok(!result.candidates.some(item => item.keyword === '水枪玩具' && item.pattern === 'direct-seed'));
  });

  test('mineKeywords can optionally include direct seeds as candidates', async () => {
    const dataDir = tempDataDir();
    addSeed('水枪玩具', { category: '玩具', priority: 10, type: 'direct', dataDir });

    const result = await mineKeywords({ dataDir, count: 5, persist: false, includeDirect: true });

    assert.ok(result.candidates.some(item => item.keyword === '水枪玩具' && item.pattern === 'direct-seed'));
  });

  test('normalizeAIResponse filters invalid AI candidates', () => {
    const candidates = normalizeAIResponse({
      candidates: [
        { keyword: '便携弹力带', seed: '弹力带', category: '运动健身', confidence: 85, reason: '具体商品' },
        { keyword: '便携弹力带', seed: '弹力带', confidence: 80 },
        { keyword: '', confidence: 90 }
      ]
    }, 10);

    assert.strictEqual(candidates.length, 1);
    assert.strictEqual(candidates[0].keyword, '便携弹力带');
    assert.strictEqual(candidates[0].source, 'ai');
    assert.strictEqual(candidates[0].aiConfidence, 85);
  });

  test('mineKeywords supports AI-only source with injected client', async () => {
    const dataDir = tempDataDir();
    addSeed('弹力带', { category: '运动健身', priority: 10, dataDir });

    const result = await mineKeywords({
      dataDir,
      source: 'ai',
      aiCandidates: 5,
      count: 5,
      persist: false,
      llmClient: {
        provider: 'mock-ai',
        model: 'mock-model',
        async generateKeywordCandidates() {
          return {
            candidates: [
              { keyword: '便携弹力带', seed: '弹力带', category: '运动健身', confidence: 86, reason: '适合居家训练' },
              { keyword: '收纳弹力带', seed: '弹力带', category: '运动健身', confidence: 74, reason: '功能明确' }
            ]
          };
        }
      }
    });

    assert.strictEqual(result.stats.source, 'ai');
    assert.strictEqual(result.stats.ai.provider, 'mock-ai');
    assert.strictEqual(result.stats.ai.generated, 2);
    assert.ok(result.candidates.every(item => item.source === 'ai'));
    assert.ok(result.candidates.some(item => item.keyword === '便携弹力带'));
  });

  test('mineKeywords supports hybrid source', async () => {
    const dataDir = tempDataDir();
    addSeed('弹力带', { category: '运动健身', priority: 10, dataDir });

    const result = await mineKeywords({
      dataDir,
      source: 'hybrid',
      aiCandidates: 3,
      count: 10,
      persist: false,
      llmClient: {
        provider: 'mock-ai',
        model: 'mock-model',
        async generateKeywordCandidates() {
          return {
            candidates: [
              { keyword: '便携弹力带', seed: '弹力带', category: '运动健身', confidence: 88, reason: '场景明确' }
            ]
          };
        }
      }
    });

    assert.strictEqual(result.stats.source, 'hybrid');
    assert.ok(result.stats.expanded > result.stats.ai.generated);
    assert.ok(result.candidates.some(item => item.source === 'ai'));
    assert.ok(result.candidates.some(item => item.source === 'local'));
  });

  test('mineKeywords falls back to local candidates when hybrid AI fails', async () => {
    const dataDir = tempDataDir();
    addSeed('弹力带', { category: '运动健身', priority: 10, dataDir });

    const result = await mineKeywords({
      dataDir,
      source: 'hybrid',
      count: 5,
      persist: false,
      llmClient: {
        provider: 'mock-ai',
        model: 'mock-model',
        async generateKeywordCandidates() {
          throw new Error('temporary AI failure');
        }
      }
    });

    assert.strictEqual(result.stats.source, 'hybrid');
    assert.strictEqual(result.stats.ai.generated, 0);
    assert.match(result.stats.ai.error, /temporary AI failure/);
    assert.ok(result.candidates.length > 0);
    assert.ok(result.candidates.every(item => item.source === 'local'));
  });
});
