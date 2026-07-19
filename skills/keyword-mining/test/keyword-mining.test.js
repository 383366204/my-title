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
  normalizeAIResponse,
  generateAIKeywordCandidates,
  parseAIJson,
  normalizeSynonyms,
  classifySeed,
  gateCandidate
} = require('..');
const { extractShortRoot, selectShortRoots } = require('../src/root-keywords');
const { extractSearchPopularityFromSycmJson, extractSycmMetricsFromJson } = require('../src/sycm-precheck');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'keyword-mining-'));
}

describe('keyword-mining', () => {
  test('short root extraction keeps concrete product roots and rejects broad roots', () => {
    assert.equal(extractShortRoot({ keyword: '纯银项链女高级感' }).root, '项链');
    assert.equal(extractShortRoot({ keyword: '女装爆款' }), null);
  });

  test('short root rotation skips roots checked within cooldown', () => {
    const dataDir = tempDataDir();
    fs.writeFileSync(path.join(dataDir, 'root-history.jsonl'), JSON.stringify({ root: '项链', checkedAt: new Date().toISOString() }) + '\n');
    const roots = selectShortRoots([
      { keyword: '纯银项链女' },
      { keyword: '和田玉吊坠女' }
    ], { dataDir, limit: 2, cooldownDays: 7 });
    assert.deepEqual(roots.map(item => item.root), ['吊坠']);
  });

  test('addSeed stores and sorts seeds', () => {
    const dataDir = tempDataDir();
    addSeed('戒指', { category: '饰品', priority: 10, reason: 'test', dataDir });
    addSeed('宠物玩具', { category: '宠物', priority: 8, dataDir });

    const seeds = listSeeds({ dataDir });
    assert.strictEqual(seeds.length, 2);
    assert.strictEqual(seeds[0].keyword, '戒指');
    assert.strictEqual(seeds[0].priorityScore, 10);
  });

  test('listSeeds only returns active lifecycle seeds to daily mining by default', () => {
    const dataDir = tempDataDir();
    fs.writeFileSync(path.join(dataDir, 'seeds.json'), JSON.stringify([
      { keyword: '活跃词', status: 'active', priority: 5 },
      { keyword: '观察词', status: 'observing', priority: 9 },
      { keyword: '探索词', status: 'explore', priority: 9 },
      { keyword: '冷却词', status: 'cooling', priority: 9 }
    ]));

    assert.deepStrictEqual(listSeeds({ dataDir }).map(seed => seed.keyword), ['活跃词']);
    assert.strictEqual(listSeeds({ dataDir, includePaused: true }).length, 4);
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

  test('classifySeed separates concrete products from broad scene seeds', () => {
    assert.strictEqual(classifySeed({ keyword: '手机壳', category: '数码配件' }).role, 'product');
    assert.strictEqual(classifySeed({ keyword: '情侣手机壳', category: '数码配件' }).role, 'qualified_product');
    assert.strictEqual(classifySeed({ keyword: '宿舍好物', category: '开学宿舍' }).role, 'abstract');
    assert.strictEqual(classifySeed({ keyword: '中秋', category: '节日礼品' }).role, 'event');
  });

  test('expandSeed blocks mechanical function and scene prefixes for incompatible seeds', () => {
    const dormWords = expandSeed({ keyword: '宿舍好物', category: '开学宿舍' }, { maxPerSeed: 80 }).map(item => item.keyword);
    const festivalWords = expandSeed({ keyword: '中秋灯笼', category: '节日礼品' }, { maxPerSeed: 80 }).map(item => item.keyword);
    const phoneCaseWords = expandSeed({ keyword: '情侣手机壳', category: '数码配件' }, { maxPerSeed: 80 }).map(item => item.keyword);
    const outfitWords = expandSeed({ keyword: '情侣装夏', category: '服饰' }, { maxPerSeed: 80 }).map(item => item.keyword);
    const moonCakeWords = expandSeed({ keyword: '月饼包装礼盒', category: '节日礼品' }, { maxPerSeed: 80 }).map(item => item.keyword);

    assert.ok(!dormWords.includes('收纳宿舍好物'));
    assert.ok(!dormWords.includes('便携宿舍好物'));
    assert.ok(!festivalWords.includes('送礼中秋灯笼'));
    assert.ok(!festivalWords.includes('便携中秋灯笼'));
    assert.ok(!festivalWords.includes('收纳中秋灯笼'));
    assert.ok(!phoneCaseWords.includes('便携情侣手机壳'));
    assert.ok(!phoneCaseWords.includes('送礼情侣手机壳'));
    assert.ok(!phoneCaseWords.includes('生日情侣手机壳'));
    assert.ok(!phoneCaseWords.includes('情侣手机壳儿童'));
    assert.ok(!outfitWords.includes('便携情侣装夏'));
    assert.ok(!outfitWords.includes('收纳情侣装夏'));
    assert.ok(!outfitWords.includes('情侣装夏儿童'));
    assert.ok(!moonCakeWords.includes('便携月饼包装礼盒'));
    assert.ok(!moonCakeWords.includes('收纳月饼包装礼盒'));
    assert.ok(!moonCakeWords.includes('月饼包装礼盒儿童'));
    assert.ok(!festivalWords.includes('中秋灯笼儿童'));
    assert.ok(!phoneCaseWords.includes('学生党情侣手机壳'));
    assert.ok(!festivalWords.includes('上班族中秋灯笼'));
    assert.ok(!festivalWords.includes('高级感中秋灯笼'));
  });

  test('rejectCandidate blocks unreasonable combinations', () => {
    assert.strictEqual(rejectCandidate('宝宝戒指').rejected, true);
    assert.strictEqual(rejectCandidate('玛瑙宠物玩具').rejected, true);
    assert.strictEqual(scoreKeyword('宝宝戒指').nextAction, 'reject');
  });

  test('facet reject rules normalize synonyms before blocking risky combinations', () => {
    assert.strictEqual(rejectCandidate('小孩戒指').rejected, true);
    assert.strictEqual(rejectCandidate('婴儿指环').rejected, true);
    assert.strictEqual(normalizeSynonyms('礼物戒指').includes('送礼'), true);
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
    assert.ok(result.candidates.every(item => item.gateStatus));
    assert.ok(result.candidates.every(item => item.canDistribute === false));
    assert.strictEqual(fs.existsSync(path.join(dataDir, 'candidates.jsonl')), false);
  });

  test('mineKeywords skips recently seen candidates when daily dedupe is enabled', async () => {
    const dataDir = tempDataDir();
    addSeed('戒指', { category: '饰品', priority: 10, dataDir });
    addSeed('宠物玩具', { category: '宠物', priority: 9, dataDir });

    const first = await mineKeywords({
      dataDir,
      count: 3,
      persist: false,
      excludeSeen: true,
      recordSeen: true
    });
    const second = await mineKeywords({
      dataDir,
      count: 3,
      persist: false,
      excludeSeen: true,
      recordSeen: false
    });

    const firstWords = new Set(first.candidates.map(item => item.keyword));
    const secondWords = second.candidates.map(item => item.keyword);
    assert.ok(firstWords.size > 0);
    assert.ok(secondWords.length > 0);
    assert.ok(secondWords.every(word => !firstWords.has(word)));
    assert.ok(second.stats.seenFiltered >= first.candidates.length);
  });

  test('mineKeywords reports progress for visible mining stages', async () => {
    const dataDir = tempDataDir();
    addSeed('戒指', { category: '饰品', priority: 10, dataDir });
    addSeed('宠物玩具', { category: '宠物', priority: 9, dataDir });
    const progress = [];

    const result = await mineKeywords({
      dataDir,
      count: 10,
      persist: false,
      onProgress: (event) => progress.push(event)
    });

    assert.strictEqual(result.ok, true);
    assert.ok(progress.some(event => event.stage === 'load-seeds' && event.message === '读取种子池'));
    assert.ok(progress.some(event => event.stage === 'expand' && event.message.includes('扩展候选词')));
    assert.ok(progress.some(event => event.stage === 'rank' && event.message.includes('排序筛选')));
    assert.ok(progress.some(event => event.stage === 'complete' && event.message === `挖词完成 ${result.candidates.length} 个`));
  });

  test('mineKeywords default seed pool produces candidates', async () => {
    const result = await mineKeywords({ count: 5, persist: false });

    assert.strictEqual(result.ok, true);
    assert.ok(result.stats.expanded > 0);
    assert.ok(result.candidates.length > 0);
  });

  test('scoreKeyword treats new seeds as product words', () => {
    const scored = scoreKeyword({ keyword: '便携瑜伽垫', seed: '瑜伽垫', pattern: 'style+seed' });

    assert.strictEqual(scored.coreProduct, '瑜伽垫');
    assert.ok(scored.localScore >= 50);
    assert.notStrictEqual(scored.nextAction, 'reject');
  });

  test('scoreKeyword does not promote broad seeds as concrete products', () => {
    const scored = scoreKeyword({ keyword: '收纳宿舍好物', seed: '宿舍好物', pattern: 'function+seed' });

    assert.notStrictEqual(scored.coreProduct, '宿舍好物');
    assert.ok(scored.localScore < 62);
    assert.notStrictEqual(scored.nextAction, 'sycm_verify');
  });

  test('gateCandidate marks unverified and rejected candidates distinctly', () => {
    const unverified = gateCandidate({
      keyword: '玛瑙戒指女',
      localScore: 88,
      nextAction: 'sycm_verify',
      coreProduct: '戒指'
    });
    const verified = gateCandidate({
      keyword: '玛瑙戒指女',
      localScore: 88,
      nextAction: 'sycm_verify',
      coreProduct: '戒指',
      sycmData: { searchPopularity: 128, demandSupplyRatio: 1.4, clickRate: 18, conversionRate: 2.5 }
    }, { minSearchPopularity: 50 });
    const popularityOnly = gateCandidate({
      keyword: '玛瑙戒指女',
      localScore: 88,
      nextAction: 'sycm_verify',
      coreProduct: '戒指',
      sycmData: { searchPopularity: 128 }
    }, { minSearchPopularity: 50 });
    const rejected = gateCandidate({
      keyword: '收纳宿舍好物',
      localScore: 52,
      nextAction: 'observe',
      coreProduct: '',
      compatibility: { allowed: false, reason: '抽象场景词不适合直接拼接功能词' }
    });

    assert.strictEqual(unverified.gateStatus, 'candidate');
    assert.strictEqual(unverified.canDistribute, false);
    assert.strictEqual(verified.gateStatus, 'verified');
    assert.strictEqual(verified.canDistribute, true);
    assert.strictEqual(popularityOnly.gateStatus, 'review');
    assert.strictEqual(popularityOnly.canDistribute, false);
    assert.strictEqual(rejected.gateStatus, 'rejected');
  });

  test('sycm precheck reads CLI data payload shape', () => {
    const popularity = extractSearchPopularityFromSycmJson({
      ok: true,
      data: [{ keyword: '弹力带', searchPopularity: 128 }]
    });

    assert.strictEqual(popularity, 128);
  });

  test('sycm precheck extracts market metrics beyond search popularity', () => {
    const metrics = extractSycmMetricsFromJson({
      ok: true,
      data: [{
        keyword: '弹力带',
        searchPopularity: '128',
        demandSupplyRatio: '1.8',
        clickRate: '12.5%',
        conversionRate: '2.1%',
        buyerCount: '36'
      }]
    });

    assert.deepStrictEqual(metrics, {
      searchPopularity: 128,
      demandSupplyRatio: 1.8,
      clickRate: 12.5,
      conversionRate: 2.1,
      buyerCount: 36
    });
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

  test('parseAIJson salvages candidate objects from truncated output', () => {
    const parsed = parseAIJson('prefix {"candidates":[{"keyword":"便携瑜伽垫","confidence":80},{"keyword":"收纳瑜伽垫","confidence":70}');
    const candidates = normalizeAIResponse(parsed, 10);

    assert.ok(candidates.some(item => item.keyword === '便携瑜伽垫'));
  });

  test('generateAIKeywordCandidates splits large AI requests into batches and keeps partial success', async () => {
    const calls = [];
    const result = await generateAIKeywordCandidates({
      seeds: [{ keyword: '瑜伽垫', category: '运动健身' }],
      maxCandidates: 45,
      batchSize: 20,
      llmClient: {
        provider: 'mock-ai',
        model: 'mock-model',
        async generateKeywordCandidates({ maxCandidates, batchIndex }) {
          calls.push({ maxCandidates, batchIndex });
          if (batchIndex === 2) throw new Error('batch failed');
          return {
            candidates: [
              { keyword: `便携瑜伽垫${batchIndex}`, seed: '瑜伽垫', category: '运动健身', confidence: 80 }
            ]
          };
        }
      }
    });

    assert.deepStrictEqual(calls.map(call => call.maxCandidates), [20, 20, 5]);
    assert.strictEqual(result.meta.batches, 3);
    assert.strictEqual(result.meta.failedBatches.length, 1);
    assert.strictEqual(result.candidates.length, 2);
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
