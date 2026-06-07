const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  flowDaily,
  flowMine,
  flowVerify,
  flowGenerate,
  flowExport,
  readJsonl,
  scoreSycmRows,
  fetchSycmWithFallback,
  validateGeneratedRow,
  categoryAssessment,
  scoreKeywordOpportunity,
  scoreProductOpportunity,
  summarizeOpportunities
} = require('..');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-flow-'));
}

describe('pipeline-flow', () => {
  test('scoreSycmRows accepts usable blue-ocean data', () => {
    const result = scoreSycmRows([
      {
        keyword: '逗猫棒室内猫咪玩具',
        demandSupplyRatio: 17.75,
        searchPopularity: '50 ~ 150 5%',
        clickRate: 66,
        conversionRate: '0% ~ 1%'
      }
    ]);

    assert.strictEqual(result.passed, true);
    assert.ok(result.score > 0);
  });

  test('scoreSycmRows relaxes demand-supply requirement for hot mode', () => {
    const result = scoreSycmRows([
      { keyword: '儿童玩具热搜词', searchPopularity: 200, clickRate: 35 }
    ], { mode: 'hot' });

    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.mode, 'hot');
    assert.ok(result.reason.includes('热搜降级通过'));
  });

  test('scoreSycmRows supports relaxed blue-ocean mode', () => {
    const result = scoreSycmRows([
      { keyword: '儿童玩具放宽蓝海词', demandSupplyRatio: 0.7, searchPopularity: 80, clickRate: 20 }
    ], { mode: 'blue_relaxed' });

    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.confidence, 'medium');
    assert.strictEqual(result.usage, 'title_optional');
  });

  test('scoreKeywordOpportunity marks verified blue words as searchable opportunities', () => {
    const result = scoreKeywordOpportunity({
      keyword: '玛瑙戒指女',
      localScore: 82,
      sycmScore: {
        passed: true,
        score: 86,
        mode: 'blue',
        confidence: 'high',
        usage: 'title_core'
      }
    });

    assert.ok(result.score >= 80);
    assert.strictEqual(result.decision, 'continue');
    assert.strictEqual(result.nextAction, 'search_1688');
  });

  test('scoreProductOpportunity prefers valid 1688 URLs with relevant title and sales', () => {
    const result = scoreProductOpportunity({
      url: 'https://detail.1688.com/offer/123.html',
      title: '玛瑙戒指女小众高级感开口可调节轻奢饰品',
      price: '3.8',
      sales30days: '200',
      imageUrl: 'https://img.example.com/a.jpg',
      shopName: 'test shop'
    }, { keyword: '玛瑙戒指女', verifyMode: 'blue' });

    assert.ok(result.score >= 78);
    assert.strictEqual(result.decision, 'continue');
    assert.strictEqual(result.level, 'strong_recommend');
  });

  test('fetchSycmWithFallback switches to hot search when blue rows are insufficient', async () => {
    const calls = [];
    const result = await fetchSycmWithFallback('宠物玩具', {
      sycmExtractor: async (keyword, options) => {
        calls.push(options.mode);
        if (options.mode === 'blue') return { keyword, data: [] };
        return {
          keyword,
          data: [{ keyword: '宠物玩具热搜词', demandSupplyRatio: 1.2, searchPopularity: 200, clickRate: 40 }]
        };
      }
    });

    assert.deepStrictEqual(calls, ['blue', 'blue', 'hot']);
    assert.strictEqual(result.fallbackUsed, true);
    assert.strictEqual(result.verifyMode, 'hot');
    assert.strictEqual(result.sycmScore.passed, true);
  });

  test('fetchSycmWithFallback prefers relaxed blue before hot search', async () => {
    const calls = [];
    const result = await fetchSycmWithFallback('儿童玩具', {
      sycmExtractor: async (keyword, options) => {
        calls.push(options.mode);
        if (calls.length === 1) return { keyword, data: [] };
        return {
          keyword,
          data: [{ keyword: '儿童玩具放宽蓝海词', demandSupplyRatio: 0.7, searchPopularity: 80, clickRate: 20 }]
        };
      }
    });

    assert.deepStrictEqual(calls, ['blue', 'blue']);
    assert.strictEqual(result.verifyMode, 'blue_relaxed');
    assert.strictEqual(result.sycmScore.confidence, 'medium');
    assert.strictEqual(result.sycmScore.usage, 'title_optional');
  });

  test('flowDaily writes resumable run files and distribution batch', async () => {
    const dataDir = tempDataDir();
    const sycmExtractor = async keyword => ({
      keyword,
      data: [
        {
          keyword: keyword + '蓝海词',
          demandSupplyRatio: 3,
          searchPopularity: '100 ~ 200',
          clickRate: 50,
          conversionRate: '2% ~ 5%'
        }
      ],
      categoryAnalysis: {
        recommendation: {
          recommended: { category: '宠物用品 > 狗狗玩具', score: 80 }
        }
      }
    });
    const generator = async keyword => ({
      ok: true,
      products: [
        {
          '产品链接': 'https://detail.1688.com/offer/123.html',
          '铺货标题': keyword + '宠物用品狗狗互动耐咬训练解闷磨牙发声弹力球室内户外陪伴好物'
        }
      ]
    });

    const result = await flowDaily({
      dataDir,
      mine: 3,
      verify: 2,
      generate: 1,
      export: 1,
      sycmExtractor,
      generator
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.steps.verified, 2);
    assert.strictEqual(result.steps.generated, 1);
    assert.strictEqual(result.steps.exported, 1);
    assert.ok(result.nextCommand.includes('1688-distribution'));
    assert.ok(fs.existsSync(result.files.candidates));
    assert.ok(fs.existsSync(result.files.verifiedKeywords));
    assert.ok(fs.existsSync(result.files.generatedProducts));
    assert.ok(fs.existsSync(result.files.distributionBatch));
    assert.ok(fs.existsSync(result.files.distributionReview));
    assert.ok(fs.readFileSync(result.files.distributionBatch, 'utf8').includes('$$宠物用品 > 狗狗玩具'));
    assert.ok(fs.readFileSync(result.files.distributionReview, 'utf8').includes('Verify Mode'));
    assert.ok(fs.readFileSync(result.files.distributionReview, 'utf8').includes('Product Opportunity'));
    const pool = summarizeOpportunities({ dataDir: path.join(dataDir, 'opportunities'), limit: 5 });
    assert.ok(pool.counts.keywords >= 1);
    assert.ok(pool.counts.products >= 1);
    assert.ok(fs.readFileSync(result.files.distributionReview, 'utf8').includes('Category: 宠物用品 > 狗狗玩具'));
  });

  test('flowExport review warns for hot trend reference rows', async () => {
    const dataDir = tempDataDir();
    const mined = await flowMine({ dataDir, limit: 1 });
    const runDir = path.join(dataDir, 'runs', mined.runId);
    const generatedFile = path.join(runDir, 'generated-products.jsonl');
    fs.writeFileSync(generatedFile, JSON.stringify({
      status: 'generated',
      keyword: '硅胶儿童玩具',
      url: 'https://detail.1688.com/offer/789.html',
      title: '硅胶儿童玩具宝宝洗澡沙滩戏水益智互动耐摔安全无味室内户外陪伴好物',
      verifyMode: 'hot',
      confidence: 'trend',
      usage: 'trend_reference',
      fallbackUsed: true,
      sycmScore: { reason: '热搜降级通过', usage: 'trend_reference' }
    }) + '\n', 'utf8');

    const exported = await flowExport({ dataDir, runId: mined.runId, limit: 1 });
    const review = fs.readFileSync(exported.reviewFile, 'utf8');

    assert.ok(review.includes('Risk:'));
    assert.ok(review.includes('不是严格蓝海词'));
  });

  test('flowExport blocks short titles and category conflicts before distribution', async () => {
    const dataDir = tempDataDir();
    const mined = await flowMine({ dataDir, limit: 1 });
    const runDir = path.join(dataDir, 'runs', mined.runId);
    const generatedFile = path.join(runDir, 'generated-products.jsonl');
    fs.writeFileSync(generatedFile, [
      JSON.stringify({
        status: 'generated',
        keyword: '宠物玩具',
        url: 'https://detail.1688.com/offer/100.html',
        title: '宠物玩具短标题',
        recommendedCategory: '宠物用品 > 狗狗玩具',
        product: { categoryListName: '宠物用品 > 狗狗玩具' },
        verifyMode: 'blue'
      }),
      JSON.stringify({
        status: 'generated',
        keyword: '宠物玩具',
        url: 'https://detail.1688.com/offer/101.html',
        title: '宠物玩具狗狗互动耐咬训练解闷磨牙发声弹力球室内户外陪伴用品好物',
        recommendedCategory: '宠物用品 > 狗狗玩具',
        product: { categoryListName: '服饰配件 > 戒指' },
        verifyMode: 'blue'
      })
    ].join('\n') + '\n', 'utf8');

    const exported = await flowExport({ dataDir, runId: mined.runId, limit: 2 });
    const batch = fs.readFileSync(exported.file, 'utf8');
    const review = fs.readFileSync(exported.reviewFile, 'utf8');

    assert.equal(exported.count, 0);
    assert.equal(exported.rejected, 2);
    assert.equal(exported.mustReview, true);
    assert.equal(batch, '');
    assert.ok(review.includes('title_too_short'));
    assert.ok(review.includes('category_conflict'));
  });

  test('validateGeneratedRow reports category confidence', () => {
    const ok = validateGeneratedRow({
      keyword: '宠物玩具',
      url: 'https://detail.1688.com/offer/123.html',
      title: '宠物玩具狗狗互动耐咬训练解闷磨牙发声弹力球室内户外陪伴用品好物',
      recommendedCategory: '宠物用品 > 狗狗玩具',
      product: { categoryListName: '宠物用品 > 狗狗玩具' }
    });
    const conflict = categoryAssessment({
      title: '宠物玩具狗狗互动耐咬训练解闷磨牙发声弹力球室内户外陪伴用品好物',
      keyword: '宠物玩具',
      recommendedCategory: '宠物用品 > 狗狗玩具',
      product: { categoryListName: '服饰配件 > 戒指' }
    });

    assert.equal(ok.ok, true);
    assert.equal(ok.categoryConfidence, 'high');
    assert.equal(conflict.confidence, 'low');
  });

  test('flowDaily stops when SYCM verifies no keywords', async () => {
    const dataDir = tempDataDir();
    const result = await flowDaily({
      dataDir,
      mine: 2,
      verify: 1,
      sycmExtractor: async keyword => ({ keyword, data: [] }),
      generator: async () => {
        throw new Error('generator should not run');
      }
    });

    assert.strictEqual(result.status, 'verified_empty');
    assert.strictEqual(result.steps.verified, 0);
    assert.strictEqual(result.steps.generated, 0);
    assert.strictEqual(result.steps.exported, 0);
  });

  test('flowDaily stops when generation produces no products', async () => {
    const dataDir = tempDataDir();
    const result = await flowDaily({
      dataDir,
      mine: 2,
      verify: 1,
      generate: 1,
      sycmExtractor: async keyword => ({
        keyword,
        data: [{ keyword, demandSupplyRatio: 2, searchPopularity: 100, clickRate: 30 }]
      }),
      generator: async () => ({ ok: true, products: [] })
    });

    assert.strictEqual(result.status, 'generate_failed');
    assert.strictEqual(result.steps.verified, 1);
    assert.strictEqual(result.steps.generated, 0);
    assert.strictEqual(result.steps.exported, 0);
  });

  test('flow steps can resume from latest run', async () => {
    const dataDir = tempDataDir();
    const mined = await flowMine({ dataDir, limit: 2 });
    const verified = await flowVerify({
      dataDir,
      limit: 1,
      sycmExtractor: async keyword => ({
        keyword,
        data: [{ keyword, demandSupplyRatio: 2, searchPopularity: 100, clickRate: 30 }]
      })
    });
    const generated = await flowGenerate({
      dataDir,
      limit: 1,
      generator: async keyword => ({
        ok: true,
        products: [{ '产品链接': 'https://detail.1688.com/offer/456.html', '铺货标题': keyword + '恢复测试标题足够长用于铺货狗狗互动耐咬训练解闷磨牙发声弹力球室内陪伴' }]
      })
    });
    const exported = await flowExport({ dataDir, limit: 1 });

    assert.strictEqual(verified.runId, mined.runId);
    assert.strictEqual(generated.runId, mined.runId);
    assert.strictEqual(exported.runId, mined.runId);
    assert.ok(mined.nextCommand.includes('flow verify'));
    assert.ok(verified.nextCommand.includes('flow generate'));
    assert.ok(generated.nextCommand.includes('flow export'));
    assert.strictEqual(readJsonl(path.join(dataDir, 'runs', mined.runId, 'verified-keywords.jsonl')).length, 1);
  });
});
