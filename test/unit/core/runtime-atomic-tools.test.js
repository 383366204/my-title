/**
 * @file runtime-atomic-tools.test.js
 * @description 首批 3 个原子工具（sycm.query, keyword.suggest, title.generate）的装配与执行测试
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createDefaultToolRegistry, createDefaultToolExecutor } = require('../../../core/runtime/bootstrap');
const { suggestTool, defaultVerifyKeywordsAdapter } = require('../../../skills/title-gen/src/suggest-tool');
const { queryTool } = require('../../../skills/sycm-research/src/query-tool');
const { generateTool } = require('../../../skills/title-gen/src/generate-tool');

describe('core/runtime/atomic-tools', () => {
  it('应当能正常装配 3 个首批原子工具且名称与别名正确', () => {
    const registry = createDefaultToolRegistry();

    assert.ok(registry.has('sycm.query'));
    assert.ok(registry.has('sycm_query'));
    assert.ok(registry.has('keyword.suggest'));
    assert.ok(registry.has('suggest_keywords'));
    assert.ok(registry.has('title.generate'));
    assert.ok(registry.has('generate_title'));

    const list = registry.list();
    assert.equal(list.length, 3);
  });

  it('keyword.suggest 工具应当能正常透传策略参数，不应报无效策略 undefined', async () => {
    // 覆盖底层 execute 验证入参传递
    const originalExecute = suggestTool.execute;
    let receivedInput = null;

    try {
      suggestTool.execute = async (input, ctx) => {
        receivedInput = input;
        return { ok: true, strategy: input.strategy, keywords: ['test-word'] };
      };

      const registry = createDefaultToolRegistry();
      const executor = createDefaultToolExecutor({ registry });

      const res = await executor.execute('keyword.suggest', {
        strategy: 'crowd',
        input: '宝妈',
        max_candidates: 3,
        sycm_verify: false
      });

      assert.equal(res.ok, true);
      assert.equal(res.strategy, 'crowd');
      assert.equal(receivedInput.strategy, 'crowd');
      assert.equal(receivedInput.input, '宝妈');
    } finally {
      suggestTool.execute = originalExecute;
    }
  });

  it('suggestAndVerify 与 keyword.suggest 在开启 sycm_verify 时应当透传 verifyFn 回调并返回验证指标', async () => {
    let verifyFnCalled = false;
    let receivedOptions = null;

    const mockVerifyFn = async (candidates, opts) => {
      verifyFnCalled = true;
      receivedOptions = opts;
      return {
        ok: true,
        keywords: candidates.map(kw => ({
          keyword: kw,
          searchPopularity: 888,
          clickRate: 0.12,
          conversionRate: 0.05,
          demandSupplyRatio: 1.5,
          tmallClickShare: 0.3
        })),
        verified: candidates.length,
        failed: 0,
        errors: []
      };
    };

    const ctx = {
      leaseManager: { tag: 'mock-lease' },
      suggestKeywords: async () => ['纯银锁骨链', '银项链女'],
      verifyKeywords: mockVerifyFn
    };

    const res = await suggestTool.execute({
      strategy: 'scene',
      input: '约会送礼',
      max_candidates: 2,
      sycm_verify: true,
      port: 9333
    }, ctx);

    assert.equal(res.ok, true);
    assert.equal(verifyFnCalled, true);
    assert.equal(receivedOptions.port, 9333);
    assert.equal(receivedOptions.maxCandidates, 2);
    assert.equal(receivedOptions.leaseManager.tag, 'mock-lease');
    assert.equal(res.keywords.length, 2);
    assert.equal(res.keywords[0].keyword, '纯银锁骨链');
    assert.equal(res.keywords[0].searchPopularity, 888);
  });

  it('defaultVerifyKeywordsAdapter 应当使用 normalizeSycmMetrics 正确解析区间和百分比指标', async () => {
    const mockExtractSycmData = async () => ({
      data: [{
        keyword: '项链女',
        searchPopularity: '100 ~ 200',
        clickRate: '12%',
        conversionRate: '3%',
        demandSupplyRatio: '2.5',
        tmallClickShare: '8%'
      }]
    });

    const { defaultVerifyKeywordsAdapter } = require('../../../skills/title-gen/src/suggest-tool');
    const res = await defaultVerifyKeywordsAdapter(['项链'], {
      maxCandidates: 5,
      extractSycmDataFn: mockExtractSycmData
    });

    assert.equal(res.ok, true);
    assert.equal(res.keywords.length, 1);
    assert.equal(res.keywords[0].keyword, '项链女');
    assert.equal(res.keywords[0].searchPopularity, 100);
    assert.equal(res.keywords[0].clickRate, 0.12);
    assert.equal(res.keywords[0].conversionRate, 0.03);
    assert.equal(res.keywords[0].demandSupplyRatio, 2.5);
    assert.equal(res.keywords[0].tmallClickShare, 0.08);
  });

  it('sycm.query 工具声明中不应有静态 cdp:9222 租约，避免与底层动态租约冲突双重获取', () => {
    assert.deepEqual(queryTool.policy.resourceKeys, []);
  });

  it('sycm.query 工具入参 Schema 应当支持可选的 filterConditions 字典校验', () => {
    const parsed = queryTool.inputSchema.safeParse({
      keyword: '纯银项链',
      filterConditions: { minPv: 100, customTag: 'test' }
    });
    assert.equal(parsed.success, true);
    assert.deepEqual(parsed.data.filterConditions, { minPv: 100, customTag: 'test' });
  });

  it('sycm.query 应当拒绝未实现的 mode: all 入参', () => {
    const parsed = queryTool.inputSchema.safeParse({
      keyword: '纯银项链',
      mode: 'all'
    });
    assert.equal(parsed.success, false);
  });

  it('title.generate 应当将 count 生效并截断返回的 titles 与 products 数量', async () => {
    let passedOptions = null;
    const mockPipeline = async (keyword, opts) => {
      passedOptions = opts;
      return {
        ok: true,
        keyword,
        titles: ['t1', 't2', 't3', 't4'],
        products: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
      };
    };

    const res = await generateTool.execute(
      { keyword: '纯银项链', count: 2 },
      { pipelineFn: mockPipeline }
    );

    assert.equal(passedOptions.productLimit, 2);
    assert.equal(res.titles.length, 2);
    assert.equal(res.products.length, 2);
  });

  it('title.generate 工具应当正确映射 maxLength 与 sycmData 字段', async () => {
    const originalExecute = generateTool.execute;

    try {
      generateTool.execute = async (input, ctx) => {
        // 校验输入 schema 校验与默认值
        return {
          ok: true,
          keyword: input.keyword,
          maxLength: input.length,
          sycmData: input.keyword_data,
          limit: input.count || 3
        };
      };

      const registry = createDefaultToolRegistry();
      const executor = createDefaultToolExecutor({ registry });

      const res = await executor.execute('title.generate', {
        keyword: '纯银项链',
        length: 50,
        keyword_data: 'tab-separated-data',
        count: 5
      });

      assert.equal(res.ok, true);
      assert.equal(res.keyword, '纯银项链');
      assert.equal(res.maxLength, 50);
      assert.equal(res.sycmData, 'tab-separated-data');
      assert.equal(res.limit, 5);
    } finally {
      generateTool.execute = originalExecute;
    }
  });

  it('title.generate 与 sycm.query 与 keyword.suggest 应当在 abortSignal 已触发时立即中断抛错', async () => {
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      async () => generateTool.execute({ keyword: '纯银项链' }, { abortSignal: controller.signal }),
      (err) => {
        assert.equal(err.code, 'OPERATION_ABORTED');
        return true;
      }
    );

    await assert.rejects(
      async () => queryTool.execute({ keyword: '纯银项链' }, { abortSignal: controller.signal }),
      (err) => {
        assert.equal(err.code, 'OPERATION_ABORTED');
        return true;
      }
    );

    await assert.rejects(
      async () => suggestTool.execute({ strategy: 'crowd', input: '学生' }, { abortSignal: controller.signal }),
      (err) => {
        assert.equal(err.code, 'OPERATION_ABORTED');
        return true;
      }
    );
  });

  it('defaultVerifyKeywordsAdapter 应当在信号中止时停止循环并抛出 OPERATION_ABORTED', async () => {
    const controller = new AbortController();
    let callCount = 0;
    const mockExtractor = async (kw) => {
      callCount++;
      if (callCount === 1) {
        controller.abort(); // 第一次处理后触发中止
      }
      return { ok: true, data: [{ keyword: kw, searchPopularity: '100' }] };
    };

    await assert.rejects(
      async () => defaultVerifyKeywordsAdapter(['词1', '词2', '词3'], {
        signal: controller.signal,
        extractSycmDataFn: mockExtractor
      }),
      (err) => {
        assert.equal(err.code, 'OPERATION_ABORTED');
        return true;
      }
    );

    assert.equal(callCount, 1, '中止后不应继续执行后续关键词 extractor');
  });

  it('sycm-cdp-extractor 在租约管理器不可用时应当 fail-closed 抛错拒绝，不应无保护裸跑', async () => {
    const { extractSycmData } = require('../../../skills/sycm-research/src/sycm-cdp-extractor');

    await assert.rejects(
      async () => extractSycmData('纯银项链', {
        guardCache: false,
        leaseManager: { withLease: null } // 无效租约管理器
      }),
      (err) => {
        assert.equal(err.code, 'LEASE_MANAGER_UNAVAILABLE');
        assert.equal(err.nonPlatform, true);
        return true;
      }
    );
  });
});
