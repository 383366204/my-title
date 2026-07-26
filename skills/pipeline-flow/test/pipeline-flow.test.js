const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  flowDaily,
  flowMine,
  flowReviewCandidates,
  flowVerify,
  flowGenerate,
  flowExport,
  flowKeyword,
  appendRunCandidates,
  getRun,
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

function mockProduct(keyword = '测试货源', id = '123') {
  return {
    id,
    subject: '宠物玩具狗狗互动耐咬训练球室内陪伴用品',
    title: '宠物玩具狗狗互动耐咬训练球室内陪伴用品',
    detailUrl: `https://detail.1688.com/offer/${id}.html`,
    price: '15.8',
    sales30days: 1200,
    imageUrl: `https://img.example.com/${id}.jpg`,
    shopName: '义乌宠物用品工厂店',
    categoryListName: '宠物用品 > 狗狗玩具'
  };
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
    assert.ok(result.breakdown.positive.some(item => item.key === 'local_score'));
    assert.ok(result.breakdown.positive.some(item => item.key === 'sycm_score'));
    assert.strictEqual(result.breakdown.gapToContinue, 0);
  });

  test('scoreKeywordOpportunity lets strong hot fallback words continue with risk flags', () => {
    const result = scoreKeywordOpportunity({
      keyword: '纯银吊坠',
      localScore: 80,
      verifyMode: 'hot',
      fallbackUsed: true,
      sycmScore: {
        passed: true,
        score: 61,
        mode: 'hot',
        confidence: 'trend',
        usage: 'trend_reference'
      }
    });

    assert.strictEqual(result.decision, 'continue');
    assert.strictEqual(result.nextAction, 'search_1688');
    assert.ok(result.riskFlags.includes('fallback_hot'));
    assert.strictEqual(result.breakdown.gapToContinue, 0);
  });

  test('scoreKeywordOpportunity still rejects weak hot fallback words', () => {
    const result = scoreKeywordOpportunity({
      keyword: '本命年吊坠',
      localScore: 80,
      verifyMode: 'hot',
      fallbackUsed: true,
      sycmScore: {
        passed: true,
        score: 20,
        mode: 'hot',
        confidence: 'trend',
        usage: 'trend_reference'
      }
    });

    assert.strictEqual(result.decision, 'reject');
    assert.strictEqual(result.nextAction, 'stop');
    assert.ok(result.breakdown.gapToContinue > 0);
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

  test('appendRunCandidates writes discovered candidates into an existing run', async () => {
    const dataDir = tempDataDir();
    const mined = await flowMine({
      dataDir,
      limit: 1,
      fallbackCandidates: true
    });

    const result = await appendRunCandidates({
      dataDir,
      runId: mined.runId,
      candidates: [
        { keyword: '纯银项链女', localScore: 82, source: 'peer', nextAction: 'sycm_verify' },
        { keyword: '纯银项链女', localScore: 82, source: 'peer', nextAction: 'sycm_verify' }
      ]
    });

    assert.equal(result.ok, true);
    assert.equal(result.added, 1);
    const { run } = getRun({ dataDir, runId: mined.runId });
    const rows = readJsonl(run.files.candidates);
    assert.ok(rows.some(row => row.keyword === '纯银项链女'));
    assert.equal(run.counts.candidates, rows.length);
  });

  test('flowReviewCandidates waits for manual keyword approval before SYCM verification', async () => {
    const dataDir = tempDataDir();
    const mined = await flowMine({
      dataDir,
      limit: 2,
      fallbackCandidates: true
    });

    const waiting = flowReviewCandidates({
      dataDir,
      runId: mined.runId
    });

    assert.strictEqual(waiting.status, 'awaiting_keyword_review');
    assert.ok(waiting.blockers.includes('keyword_review_required'));
    assert.ok(waiting.nextCommand.includes('flow review'));

    const approved = flowReviewCandidates({
      dataDir,
      runId: mined.runId,
      approvedKeywords: [mined.candidates[0].keyword],
      rejectedKeywords: [mined.candidates[1].keyword]
    });

    assert.strictEqual(approved.status, 'keywords_reviewed');
    assert.strictEqual(approved.approved.length, 1);
    assert.strictEqual(approved.rejected.length, 1);
    assert.ok(approved.nextCommand.includes('flow verify'));
    const { run } = getRun({ dataDir, runId: mined.runId });
    const reviewedRows = readJsonl(run.files.reviewedCandidates);
    assert.deepStrictEqual(reviewedRows.map(row => row.reviewStatus), ['approved', 'rejected']);
  });

  test('flowMine avoids candidates that appeared in recent pipeline runs', async () => {
    const dataDir = tempDataDir();
    const first = await flowMine({
      dataDir,
      runId: 'first_seen_run',
      limit: 3,
      excludeSeen: true,
      recordSeen: false
    });
    const second = await flowMine({
      dataDir,
      runId: 'second_seen_run',
      limit: 3,
      excludeSeen: true,
      recordSeen: false
    });

    const firstWords = new Set(first.candidates.map(row => row.keyword));
    assert.ok(firstWords.size > 0);
    assert.ok(second.candidates.length > 0);
    assert.ok(second.candidates.every(row => !firstWords.has(row.keyword)));
  });

  test('flowVerify stops on SYCM slider manual action', async () => {
    const dataDir = tempDataDir();
    const mined = await flowMine({ dataDir, limit: 2 });
    let calls = 0;
    const err = new Error('生意参谋查询触发淘宝滑块/安全验证，请在当前 Chrome 页面手动完成滑块后重试');
    err.status = 'slider_required';
    err.details = { ok: false, status: 'slider_required', action: 'manual slider required' };

    const result = await flowVerify({
      dataDir,
      runId: mined.runId,
      limit: 2,
      sycmExtractor: async () => {
        calls += 1;
        throw err;
      }
    });

    assert.strictEqual(calls, 1);
    assert.strictEqual(result.verified.length, 0);
    assert.strictEqual(result.rejected[0].status, 'slider_required');
    assert.ok(result.blockers.includes('sycm_manual_action_required'));
  });

  test('flowVerify does not continue after partial SYCM manual action', async () => {
    const dataDir = tempDataDir();
    const mined = await flowMine({ dataDir, limit: 2 });
    fs.writeFileSync(path.join(mined.runDir, 'candidates.jsonl'), [
      JSON.stringify({ keyword: 'alpha ring', nextAction: 'sycm_verify' }),
      JSON.stringify({ keyword: 'beta ring', nextAction: 'sycm_verify' })
    ].join('\n') + '\n', 'utf8');
    let calls = 0;

    const result = await flowVerify({
      dataDir,
      runId: mined.runId,
      limit: 2,
      sycmExtractor: async keyword => {
        calls += 1;
        if (calls === 1) {
          return {
            keyword,
            data: [{ keyword, demandSupplyRatio: 3, searchPopularity: 200, clickRate: 45 }]
          };
        }
        const err = new Error('manual slider required');
        err.status = 'slider_required';
        err.details = { ok: false, status: 'slider_required', action: 'manual slider required' };
        throw err;
      }
    });

    assert.strictEqual(calls, 2);
    assert.strictEqual(result.verified.length, 1);
    assert.ok(result.blockers.includes('sycm_manual_action_required'));
    assert.ok(!result.nextCommand.includes('flow generate'));
    assert.strictEqual(result.status, 'verified_partial_manual_required');
  });

  test('flowVerify skips observe-only candidates', async () => {
    const dataDir = tempDataDir();
    const mined = await flowMine({ dataDir, limit: 2 });
    fs.writeFileSync(path.join(mined.runDir, 'candidates.jsonl'), [
      JSON.stringify({ keyword: 'observe candidate', nextAction: 'observe' }),
      JSON.stringify({ keyword: 'verify candidate', nextAction: 'sycm_verify' })
    ].join('\n') + '\n', 'utf8');
    const queried = [];

    const result = await flowVerify({
      dataDir,
      runId: mined.runId,
      limit: 2,
      sycmExtractor: async keyword => {
        queried.push(keyword);
        return {
          keyword,
          data: [{ keyword, demandSupplyRatio: 2.5, searchPopularity: 100, clickRate: 30 }]
        };
      }
    });

    assert.deepStrictEqual(queried, ['verify candidate']);
    assert.strictEqual(result.verified.length, 1);
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
      recordSeen: false,
      reviewMode: 'auto',
      mine: 3,
      verify: 2,
      generate: 1,
      export: 1,
      sycmExtractor,
      generator,
      searchProducts: async (_coreWord, blueOceanWord) => [mockProduct(blueOceanWord, '123')]
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.steps.reviewed, 3);
    assert.strictEqual(result.steps.verified, 2);
    assert.strictEqual(result.steps.selected, 1);
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

  test('flowKeyword preserves the user exact keyword through SYCM and generation', async () => {
    const dataDir = tempDataDir();
    const exactKeyword = '宝宝醒狮虎头鞋';
    const sycmCalls = [];
    const generatorCalls = [];

    const result = await flowKeyword({
      dataDir,
      keyword: exactKeyword,
      export: 1,
      sycmExtractor: async keyword => {
        sycmCalls.push(keyword);
        return {
          keyword,
          data: [
            {
              keyword,
              demandSupplyRatio: 2,
              searchPopularity: 300,
              clickRate: 45,
              conversionRate: '5% ~ 7.5%'
            }
          ],
          categoryAnalysis: {
            recommendation: {
              recommended: { category: '母婴用品 > 婴儿鞋', score: 80 }
            }
          }
        };
      },
      generator: async keyword => {
        generatorCalls.push(keyword);
        return {
          ok: true,
          products: [
            {
              '产品链接': 'https://detail.1688.com/offer/1049095335543.html',
              '铺货标题': exactKeyword + '周岁百天满月抓周刺绣软底防滑婴儿步前鞋中国风新年拍照道具',
              '商品原价': '15.8',
              '30天销量': 5500,
              '主图链接': 'https://img.example.com/tiger-shoes.jpg',
              shopName: '1688小店进货官方供应链',
              categoryListName: '母婴用品 > 婴儿鞋'
            }
          ]
        };
      },
      searchProducts: async () => [mockProduct(exactKeyword, '1049095335543')]
    });

    assert.strictEqual(result.exactKeyword, exactKeyword);
    assert.deepStrictEqual(sycmCalls, [exactKeyword]);
    assert.deepStrictEqual(generatorCalls, [exactKeyword]);
    assert.strictEqual(result.steps.mined, 1);
    assert.strictEqual(result.steps.verified, 1);
    assert.strictEqual(result.steps.selected, 1);
    assert.strictEqual(result.steps.exported, 1);
    assert.ok(fs.readFileSync(result.files.distributionBatch, 'utf8').includes('1049095335543'));
    const candidates = readJsonl(path.join(result.runDir, 'candidates.jsonl'));
    assert.strictEqual(candidates[0].keyword, exactKeyword);
    assert.ok(candidates[0].flags.includes('user_exact_keyword'));
  });

  test('flowGenerate keeps a larger default candidate pool per keyword', async () => {
    const dataDir = tempDataDir();
    const mined = await flowMine({ dataDir, limit: 1 });
    fs.writeFileSync(path.join(mined.runDir, 'verified-keywords.jsonl'), JSON.stringify({
      keyword: '陶瓷摆件',
      status: 'verified',
      sycmScore: { passed: true, mode: 'blue', confidence: 'high', usage: 'title_core' },
      verifyMode: 'blue',
      confidence: 'high',
      usage: 'title_core'
    }) + '\n', 'utf8');

    const products = Array.from({ length: 15 }, (_, index) => ({
      '产品链接': `https://detail.1688.com/offer/${1000 + index}.html`,
      '铺货标题': `陶瓷摆件家居装饰客厅桌面花器摆设现代简约创意商品${index}`,
      '商品原价': '18.8',
      '30天销量': 20,
      '主图链接': 'https://img.example.com/a.jpg'
    }));

    const generated = await flowGenerate({
      dataDir,
      runId: mined.runId,
      limit: 1,
      generator: async () => ({ ok: true, products })
    });

    assert.strictEqual(generated.generated.filter(row => row.status === 'generated').length, 12);
  });

  test('flowGenerate uses the MiniMax timeout and persists diagnostic metadata', async () => {
    const dataDir = tempDataDir();
    const mined = await flowMine({ dataDir, limit: 1 });
    fs.writeFileSync(path.join(mined.runDir, 'verified-keywords.jsonl'), JSON.stringify({
      keyword: '陶瓷摆件',
      status: 'verified',
      sycmScore: { passed: true }
    }) + '\n', 'utf8');
    let receivedTimeout = 0;

    const generated = await flowGenerate({
      dataDir,
      runId: mined.runId,
      limit: 1,
      llmProvider: 'minimax',
      generator: async (_keyword, options) => {
        receivedTimeout = options.runTimeoutMs;
        const error = new Error('标题生成超时(180s)，请简化关键词或减少数量');
        error.code = 'title_generation_timeout';
        error.source = 'title-gen';
        error.retryWith = { count: 3, runTimeoutMs: 180000 };
        throw error;
      }
    });

    assert.strictEqual(receivedTimeout, 180000);
    assert.strictEqual(generated.status, 'generate_failed');
    assert.strictEqual(generated.generated[0].llmProvider, 'minimax');
    assert.strictEqual(generated.generated[0].llmModel, 'MiniMax-M2.7');
    assert.strictEqual(generated.generated[0].code, 'title_generation_timeout');
    assert.deepStrictEqual(generated.generated[0].retryWith, { count: 3, runTimeoutMs: 180000 });
  });

  test('flowGenerate skips verified keywords that fail keyword opportunity scoring by default', async () => {
    const dataDir = tempDataDir();
    const mined = await flowMine({ dataDir, limit: 1 });
    fs.writeFileSync(path.join(mined.runDir, 'verified-keywords.jsonl'), [
      JSON.stringify({
        keyword: '热搜观察词',
        status: 'verified',
        keywordOpportunity: { score: 38, decision: 'reject', nextAction: 'stop' }
      }),
      JSON.stringify({
        keyword: '蓝海可生成词',
        status: 'verified',
        keywordOpportunity: { score: 82, decision: 'continue', nextAction: 'search_1688' }
      })
    ].join('\n') + '\n', 'utf8');

    const calls = [];
    const generated = await flowGenerate({
      dataDir,
      runId: mined.runId,
      limit: 2,
      generator: async (keyword) => {
        calls.push(keyword);
        return {
          ok: true,
          products: [{
            '产品链接': 'https://detail.1688.com/offer/123456.html',
            '铺货标题': `${keyword}标题足够长用于验证默认过滤机会分未通过关键词`,
            '商品原价': '18.8',
            '30天销量': 20
          }]
        };
      }
    });

    assert.deepStrictEqual(calls, ['蓝海可生成词']);
    assert.strictEqual(generated.generated.filter(row => row.status === 'generated').length, 1);
    assert.strictEqual(generated.generated.find(row => row.status === 'generated').selectedKeyword, '蓝海可生成词');
  });

  test('flowExport separates recommended submit rows from manual review candidates', async () => {
    const dataDir = tempDataDir();
    const mined = await flowMine({ dataDir, limit: 1 });
    const runDir = path.join(dataDir, 'runs', mined.runId);
    const generatedFile = path.join(runDir, 'generated-products.jsonl');
    fs.writeFileSync(generatedFile, [
      JSON.stringify({
        status: 'generated',
        keyword: '陶瓷摆件',
        url: 'https://detail.1688.com/offer/100.html',
        title: '陶瓷摆件家居装饰客厅桌面花器摆设现代简约创意商品书房玄关酒柜装饰',
        recommendedCategory: '家居饰品 > 摆件类 > 装饰摆件',
        product: { categoryListName: '家居饰品 > 摆件类 > 装饰摆件' },
        productOpportunity: { decision: 'continue', level: 'candidate', score: 72 }
      }),
      JSON.stringify({
        status: 'generated',
        keyword: '陶瓷摆件',
        url: 'https://detail.1688.com/offer/101.html',
        title: '陶瓷摆件桌面艺术花器小众异形家居客厅玄关装饰摆件书房酒柜装饰',
        recommendedCategory: '家居饰品 > 摆件类 > 装饰摆件',
        product: { categoryListName: '家居饰品 > 摆件类 > 装饰摆件' },
        productOpportunity: { decision: 'review', level: 'manual_review', score: 58 }
      })
    ].join('\n') + '\n', 'utf8');

    const exported = await flowExport({ dataDir, runId: mined.runId, limit: 2 });
    const batch = fs.readFileSync(exported.file, 'utf8');
    const review = fs.readFileSync(exported.reviewFile, 'utf8');

    assert.strictEqual(exported.count, 1);
    assert.strictEqual(exported.reviewCandidates, 1);
    assert.strictEqual(exported.mustReview, true);
    assert.ok(batch.includes('offer/100.html'));
    assert.ok(!batch.includes('offer/101.html'));
    assert.ok(review.includes('Recommended Submit'));
    assert.ok(review.includes('Manual Review Candidates'));
    assert.ok(review.includes('Review Candidates: 1'));
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

  test('flowExport blocks rows that have no SYCM or product category', async () => {
    const dataDir = tempDataDir();
    const mined = await flowMine({ dataDir, limit: 1 });
    const runDir = path.join(dataDir, 'runs', mined.runId);
    const generatedFile = path.join(runDir, 'generated-products.jsonl');
    fs.writeFileSync(generatedFile, JSON.stringify({
      status: 'generated',
      keyword: '宝宝醒狮虎头鞋',
      url: 'https://detail.1688.com/offer/1049095335543.html',
      title: '宝宝醒狮虎头鞋周岁百天满月抓周刺绣软底防滑婴儿步前鞋中国风新年拍照道具',
      verifyMode: 'blue',
      product: {}
    }) + '\n', 'utf8');

    const exported = await flowExport({ dataDir, runId: mined.runId, limit: 1 });
    const batch = fs.readFileSync(exported.file, 'utf8');
    const review = fs.readFileSync(exported.reviewFile, 'utf8');

    assert.equal(exported.count, 0);
    assert.equal(exported.mustReview, true);
    assert.equal(batch, '');
    assert.ok(review.includes('missing_category'));
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
      recordSeen: false,
      reviewMode: 'auto',
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

  test('flowVerify stops when verified keywords fail opportunity scoring', async () => {
    const dataDir = tempDataDir();
    const mined = await flowMine({ dataDir, limit: 1 });
    fs.writeFileSync(path.join(mined.runDir, 'candidates.jsonl'), JSON.stringify({
      keyword: '低机会验真词',
      localScore: 0,
      nextAction: 'sycm_verify'
    }) + '\n', 'utf8');

    const result = await flowVerify({
      dataDir,
      runId: mined.runId,
      limit: 1,
      sycmExtractor: async keyword => ({
        keyword,
        data: [{ keyword, demandSupplyRatio: 1, searchPopularity: 20, clickRate: 1 }]
      })
    });

    assert.strictEqual(result.status, 'verified_no_generation_eligible');
    assert.strictEqual(result.verified.length, 1);
    assert.ok(result.blockers.includes('no_generation_eligible_keywords'));
    assert.ok(result.nextCommand.includes('run.json'));
    assert.ok(!result.nextCommand.includes('flow generate'));
  });

  test('flowVerify supplements the reserve candidate pool when the primary batch has no strict opportunity', async () => {
    const dataDir = tempDataDir();
    const mined = await flowMine({ dataDir, limit: 2 });
    fs.writeFileSync(path.join(mined.runDir, 'candidates.jsonl'), [
      JSON.stringify({ keyword: '备用测试词一', localScore: 0, nextAction: 'sycm_verify' }),
      JSON.stringify({ keyword: '备用测试词二', localScore: 80, nextAction: 'sycm_verify' })
    ].join('\n') + '\n', 'utf8');

    const result = await flowVerify({
      dataDir,
      runId: mined.runId,
      limit: 1,
      autoExpandVerify: true,
      verifyReserve: 1,
      sycmExtractor: async keyword => ({
        keyword,
        data: [{ keyword, demandSupplyRatio: 8, searchPopularity: 500, clickRate: 80, conversionRate: 5 }]
      })
    });

    assert.strictEqual(result.status, 'verified');
    assert.strictEqual(result.verified.length, 2);
    assert.strictEqual(getRun({ dataDir, runId: mined.runId }).run.counts.sycmReserveChecked, 1);
    assert.strictEqual(getRun({ dataDir, runId: mined.runId }).run.counts.sycmGenerationEligible, 1);
  });

  test('flowVerify can continue a small observable fallback set for the daily review path', async () => {
    const dataDir = tempDataDir();
    const mined = await flowMine({ dataDir, limit: 1 });
    fs.writeFileSync(path.join(mined.runDir, 'candidates.jsonl'), JSON.stringify({
      keyword: '可复核备用词',
      localScore: 0,
      nextAction: 'sycm_verify'
    }) + '\n', 'utf8');

    const result = await flowVerify({
      dataDir,
      runId: mined.runId,
      limit: 1,
      autoAllowReviewKeywords: true,
      reviewKeywordLimit: 2,
      sycmExtractor: async keyword => ({
        keyword,
        data: [{ keyword, demandSupplyRatio: 8, searchPopularity: 500, clickRate: 80, conversionRate: 5 }]
      })
    });

    assert.strictEqual(result.status, 'verified');
    assert.strictEqual(result.verified[0].autoFallbackEligible, true);
    assert.strictEqual(getRun({ dataDir, runId: mined.runId }).run.counts.sycmAutoFallbackEligible, 1);
  });

  test('flowDaily stops when generation produces no products', async () => {
    const dataDir = tempDataDir();
    const result = await flowDaily({
      dataDir,
      recordSeen: false,
      reviewMode: 'auto',
      mine: 2,
      verify: 1,
      generate: 1,
      sycmExtractor: async keyword => ({
        keyword,
        data: [{ keyword, demandSupplyRatio: 17.75, searchPopularity: 500, clickRate: 80, conversionRate: 5 }]
      }),
      searchProducts: async keyword => [mockProduct(keyword, '789')],
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
    const reviewed = flowReviewCandidates({ dataDir, approveAll: true });
    const verified = await flowVerify({
      dataDir,
      limit: 1,
      sycmExtractor: async keyword => ({
        keyword,
        data: [{ keyword, demandSupplyRatio: 17.75, searchPopularity: 500, clickRate: 80, conversionRate: 5 }]
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

    assert.strictEqual(reviewed.runId, mined.runId);
    assert.strictEqual(verified.runId, mined.runId);
    assert.strictEqual(generated.runId, mined.runId);
    assert.strictEqual(exported.runId, mined.runId);
    assert.ok(mined.nextCommand.includes('flow review'));
    assert.ok(reviewed.nextCommand.includes('flow verify'));
    assert.ok(verified.nextCommand.includes('flow select'));
    assert.ok(generated.nextCommand.includes('flow export'));
    assert.strictEqual(readJsonl(path.join(dataDir, 'runs', mined.runId, 'verified-keywords.jsonl')).length, 1);
  });
});
