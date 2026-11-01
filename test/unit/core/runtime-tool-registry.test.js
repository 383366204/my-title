/**
 * @file runtime-tool-registry.test.js
 * @description ToolRegistry 与 Contracts 契约单测
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createToolRegistry } = require('../../../core/runtime/tool-registry');
const { createToolPolicy } = require('../../../core/runtime/contracts');

describe('core/runtime/tool-registry', () => {
  it('应当能正常注册工具并通过 id 或 mcpName 检索', () => {
    const registry = createToolRegistry();
    const tool = registry.register({
      id: 'sycm.query',
      mcpName: 'sycm_query',
      version: '1.0.0',
      description: '查询生意参谋搜索指标',
      policy: {
        risk: 'medium',
        resourceKeys: ['cdp:9222'],
        platforms: ['sycm']
      },
      execute: async (input) => ({ keyword: input.keyword, rank: 1 })
    });

    assert.equal(tool.id, 'sycm.query');
    assert.equal(tool.mcpName, 'sycm_query');
    assert.equal(tool.policy.risk, 'medium');
    assert.deepEqual(tool.policy.resourceKeys, ['cdp:9222']);
    assert.deepEqual(tool.policy.platforms, ['sycm']);

    // 通过 id 获取
    const byId = registry.get('sycm.query');
    assert.equal(byId.id, 'sycm.query');

    // 通过 mcpName 获取
    const byMcp = registry.get('sycm_query');
    assert.equal(byMcp.id, 'sycm.query');

    assert.equal(registry.has('sycm.query'), true);
    assert.equal(registry.has('sycm_query'), true);
    assert.equal(registry.has('non.existent'), false);

    const list = registry.list();
    assert.equal(list.length, 1);
  });

  it('注册重复 ID 时应当报错', () => {
    const registry = createToolRegistry();
    registry.register({
      id: 'test.tool',
      execute: async () => 'ok'
    });

    assert.throws(
      () => {
        registry.register({
          id: 'test.tool',
          execute: async () => 'another'
        });
      },
      /工具 ID 冲突: \[test.tool\] 已注册/
    );
  });

  it('注册重复 mcpName 时应当报错', () => {
    const registry = createToolRegistry();
    registry.register({
      id: 'tool.one',
      mcpName: 'test_mcp',
      execute: async () => 'ok'
    });

    assert.throws(
      () => {
        registry.register({
          id: 'tool.two',
          mcpName: 'test_mcp',
          execute: async () => 'another'
        });
      },
      /MCP 工具名冲突: \[test_mcp\] 已被工具 \[tool.one\] 占用/
    );
  });

  it('缺少必要字段或 execute 非函数时应当抛出异常', () => {
    const registry = createToolRegistry();

    assert.throws(() => registry.register(null), /ToolDefinition 必须是非空对象/);
    assert.throws(() => registry.register({ id: '' }), /ToolDefinition 缺少有效 id 标识/);
    assert.throws(() => registry.register({ id: 'bad.tool' }), /缺少 execute 执行函数/);
  });

  it('createToolPolicy 应当提供安全默认值并去重数组', () => {
    const policy = createToolPolicy({
      resourceKeys: ['cdp:9222', 'cdp:9222', ''],
      platforms: ['sycm', 'sycm']
    });

    assert.equal(policy.risk, 'low');
    assert.equal(policy.approval, 'never');
    assert.equal(policy.sideEffect, 'none');
    assert.deepEqual(policy.resourceKeys, ['cdp:9222']);
    assert.deepEqual(policy.platforms, ['sycm']);
  });
});
