/**
 * @file runtime-tool-executor.test.js
 * @description ToolExecutor 统一执行器、Schema 校验与幂等性测试
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { createToolRegistry } = require('../../../core/runtime/tool-registry');
const { createToolExecutor } = require('../../../core/runtime/tool-executor');
const { createWorkbenchLeaseManager } = require('../../../core/runtime/workbench-lease');
const { createOperationStore } = require('../../../core/runtime/operation-store');

const TEST_RUNTIME_DIR = path.resolve(__dirname, '../../../data/test-runtime-executor');

describe('core/runtime/tool-executor', () => {
  let operationsDir;
  let leasesDir;

  before(() => {
    operationsDir = path.join(TEST_RUNTIME_DIR, 'operations');
    leasesDir = path.join(TEST_RUNTIME_DIR, 'leases');
    fs.mkdirSync(operationsDir, { recursive: true });
    fs.mkdirSync(leasesDir, { recursive: true });
  });

  after(() => {
    try {
      fs.rmSync(TEST_RUNTIME_DIR, { recursive: true, force: true });
    } catch {}
  });

  it('未找到工具时应当抛出 404', async () => {
    const registry = createToolRegistry();
    const executor = createToolExecutor({ registry });

    await assert.rejects(
      async () => executor.execute('non.existent', {}),
      (err) => {
        assert.equal(err.code, 'TOOL_NOT_FOUND');
        assert.equal(err.status, 404);
        return true;
      }
    );
  });

  it('入参不符合 Schema 时应当抛出 400 校验异常', async () => {
    const registry = createToolRegistry();
    registry.register({
      id: 'test.validate',
      inputSchema: z.object({
        keyword: z.string().min(1, 'keyword 不能为空'),
        count: z.number().int().positive()
      }),
      execute: async (input) => input
    });

    const executor = createToolExecutor({ registry });

    await assert.rejects(
      async () => executor.execute('test.validate', { keyword: '', count: -5 }),
      (err) => {
        assert.equal(err.code, 'INVALID_ARGUMENT');
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  it('正常执行应当保存 operation 记录并返回结果', async () => {
    const registry = createToolRegistry();
    registry.register({
      id: 'math.add',
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => ({ sum: a + b })
    });

    const opStore = createOperationStore({ operationsDir });
    const executor = createToolExecutor({ registry, operationStore: opStore });

    const result = await executor.execute('math.add', { a: 10, b: 20 }, { requestId: 'req-math-1' });
    assert.deepEqual(result, { sum: 30 });

    const op = opStore.get('req-math-1');
    assert.equal(op.status, 'completed');
    assert.deepEqual(op.result, { sum: 30 });
  });

  it('相同 requestId 且相同参数应当命中幂等缓存，不重复执行', async () => {
    const registry = createToolRegistry();
    let callCount = 0;
    registry.register({
      id: 'counter.increment',
      execute: async () => {
        callCount++;
        return { count: callCount };
      }
    });

    const opStore = createOperationStore({ operationsDir });
    const executor = createToolExecutor({ registry, operationStore: opStore });

    const res1 = await executor.execute('counter.increment', {}, { requestId: 'idempotent-key-1' });
    assert.deepEqual(res1, { count: 1 });
    assert.equal(callCount, 1);

    // 再次调用相同 requestId 和参数
    const res2 = await executor.execute('counter.increment', {}, { requestId: 'idempotent-key-1' });
    assert.deepEqual(res2, { count: 1 });
    assert.equal(callCount, 1); // 确认业务函数未重复执行！
  });

  it('相同 requestId 但不同参数应当抛出 409 冲突异常', async () => {
    const registry = createToolRegistry();
    registry.register({
      id: 'echo.test',
      execute: async (input) => input
    });

    const opStore = createOperationStore({ operationsDir });
    const executor = createToolExecutor({ registry, operationStore: opStore });

    await executor.execute('echo.test', { msg: 'first' }, { requestId: 'conflict-req-id' });

    await assert.rejects(
      async () => {
        await executor.execute('echo.test', { msg: 'second_modified' }, { requestId: 'conflict-req-id' });
      },
      (err) => {
        assert.equal(err.code, 'IDEMPOTENCY_CONFLICT');
        assert.equal(err.status, 409);
        return true;
      }
    );
  });

  it('声明 resourceKeys 的工具在执行期间应当持有租约，执行后释放', async () => {
    const registry = createToolRegistry();
    const leaseManager = createWorkbenchLeaseManager({ runtimeDir: leasesDir });
    const resourceKey = 'cdp:9227';
    let leaseWasActiveDuringExecution = false;

    registry.register({
      id: 'browser.action',
      policy: {
        resourceKeys: [resourceKey]
      },
      execute: async () => {
        // 校验执行中文件锁确实存在
        const leasePath = leaseManager.getLeasePath(resourceKey);
        leaseWasActiveDuringExecution = fs.existsSync(leasePath);
        return { done: true };
      }
    });

    const executor = createToolExecutor({ registry, leaseManager });
    const result = await executor.execute('browser.action', {});
    assert.deepEqual(result, { done: true });
    assert.equal(leaseWasActiveDuringExecution, true);

    // 验证执行完毕后租约已被安全释放
    const leasePath = leaseManager.getLeasePath(resourceKey);
    assert.equal(fs.existsSync(leasePath), false);
  });
});
