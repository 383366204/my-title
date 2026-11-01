/**
 * @file runtime-server-forwarder.test.js
 * @description 单服务优先转发器测试（探测、转发、离线回退与超时防本地重跑）
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { createClientForwarder, ServerExecutionTimeoutError } = require('../../../core/runtime/server-forwarder');
const { registerRuntimeRoutes } = require('../../../core/server/runtime-routes');
const { createToolRegistry } = require('../../../core/runtime/tool-registry');
const { createToolExecutor } = require('../../../core/runtime/tool-executor');
const { createOperationStore } = require('../../../core/runtime/operation-store');

const TEST_RUNTIME_DIR = path.resolve(__dirname, '../../../data/test-runtime-forwarder');

describe('core/runtime/server-forwarder', () => {
  before(() => {
    fs.mkdirSync(TEST_RUNTIME_DIR, { recursive: true });
  });

  after(() => {
    try {
      fs.rmSync(TEST_RUNTIME_DIR, { recursive: true, force: true });
    } catch {}
  });

  it('本地 Server 离线时，应当平滑回退到本地持租约执行', async () => {
    let localExecuted = false;
    const mockLocalExecutor = {
      execute: async (id, input) => {
        localExecuted = true;
        return { executedLocally: true, id };
      }
    };

    const forwarder = createClientForwarder({
      runtimeDir: TEST_RUNTIME_DIR,
      localExecutor: mockLocalExecutor
    });

    const result = await forwarder.execute('test.tool', { query: 'test' });
    assert.equal(localExecuted, true);
    assert.deepEqual(result, { executedLocally: true, id: 'test.tool' });
  });

  it('本地 Server 在线时，应当优先 HTTP 转发给 Server 处理', async () => {
    const serverApp = express();
    serverApp.use(express.json());

    const registry = createToolRegistry();
    let serverExecuted = false;
    registry.register({
      id: 'echo.tool',
      execute: async (input) => {
        serverExecuted = true;
        return { fromServer: true, echoed: input.val };
      }
    });

    const opStore = createOperationStore({ operationsDir: path.join(TEST_RUNTIME_DIR, 'server-ops') });
    const serverExecutor = createToolExecutor({ registry, operationStore: opStore });
    const instanceId = 'test-instance-123';

    registerRuntimeRoutes(serverApp, {
      toolExecutor: serverExecutor,
      operationStore: opStore,
      instanceId
    });

    // 启动测试 HTTP Server
    const server = http.createServer(serverApp);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    // 写入 server.json 描述文件
    const serverJsonPath = path.join(TEST_RUNTIME_DIR, 'server.json');
    fs.writeFileSync(
      serverJsonPath,
      JSON.stringify({
        pid: process.pid,
        port,
        instanceId,
        protocolVersion: '1.0'
      }),
      'utf8'
    );

    let localExecuted = false;
    const mockLocalExecutor = {
      execute: async () => {
        localExecuted = true;
        return { executedLocally: true };
      }
    };

    const forwarder = createClientForwarder({
      runtimeDir: TEST_RUNTIME_DIR,
      localExecutor: mockLocalExecutor
    });

    try {
      const result = await forwarder.execute('echo.tool', { val: 'hello' });
      assert.equal(serverExecuted, true, '应当在 Server 端执行');
      assert.equal(localExecuted, false, '不应当在本地回退执行');
      assert.deepEqual(result, { fromServer: true, echoed: 'hello' });
    } finally {
      server.close();
      try { fs.unlinkSync(serverJsonPath); } catch {}
    }
  });

  it('服务端响应超时时，应当抛出 ServerExecutionTimeoutError 且严禁在本地重跑', async () => {
    const serverApp = express();
    serverApp.use(express.json());

    // 模拟健康端点正常，但执行端点故意延迟 1000ms（超过客户端的 100ms 超时）
    serverApp.get('/api/runtime/health', (req, res) => {
      res.json({ ok: true, status: 'healthy', instanceId: 'timeout-inst', protocolVersion: '1.0' });
    });
    serverApp.post('/api/runtime/tools/:id/execute', (req, res) => {
      setTimeout(() => {
        res.json({ ok: true, result: 'delayed' });
      }, 1000);
    });

    const server = http.createServer(serverApp);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const serverJsonPath = path.join(TEST_RUNTIME_DIR, 'server.json');
    fs.writeFileSync(
      serverJsonPath,
      JSON.stringify({
        pid: process.pid,
        port,
        instanceId: 'timeout-inst',
        protocolVersion: '1.0'
      }),
      'utf8'
    );

    let localExecutedCount = 0;
    const mockLocalExecutor = {
      execute: async () => {
        localExecutedCount++;
        return { shouldNotHappen: true };
      }
    };

    const forwarder = createClientForwarder({
      runtimeDir: TEST_RUNTIME_DIR,
      localExecutor: mockLocalExecutor,
      requestTimeoutMs: 100 // 100ms 触发超时
    });

    try {
      await assert.rejects(
        async () => forwarder.execute('delayed.tool', {}, { requestId: 'req-timeout-test' }),
        (err) => {
          assert.ok(err instanceof ServerExecutionTimeoutError);
          assert.equal(err.code, 'SERVER_EXECUTION_TIMEOUT');
          assert.equal(err.requestId, 'req-timeout-test');
          return true;
        }
      );

      // 核心安全约束校验：本地执行次数必须为 0！绝不盲目重跑！
      assert.equal(localExecutedCount, 0, '超时后绝不应该在本地重跑产生重复副作用');
    } finally {
      server.close();
      try { fs.unlinkSync(serverJsonPath); } catch {}
    }
  });
});
