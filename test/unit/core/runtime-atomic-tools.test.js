/**
 * @file runtime-atomic-tools.test.js
 * @description 首批 3 个原子工具（sycm.query, keyword.suggest, title.generate）的装配与执行测试
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createDefaultToolRegistry, createDefaultToolExecutor } = require('../../../core/runtime/bootstrap');
const { suggestTool } = require('../../../skills/title-gen/src/suggest-tool');
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
});
