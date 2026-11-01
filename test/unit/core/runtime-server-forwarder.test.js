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
const { EventEmitter } = require('events');
const express = require('express');
const { createClientForwarder, ServerExecutionTimeoutError, ServerForwardingError } = require('../../../core/runtime/server-forwarder');
const { registerRuntimeRoutes } = require('../../../core/server/runtime-routes');
const { createToolRegistry } = require('../../../core/runtime/tool-registry');
const { createToolExecutor } = require('../../../core/runtime/tool-executor');
const { createOperationStore } = require('../../../core/runtime/operation-store');

const TEST_RUNTIME_DIR = path.resolve(__dirname, '../../../data/test-runtime-forwarder');

function createExpressMockHttpClient(app) {
  return {
    get: (urlStr, options, callback) => {
      const parsed = new URL(urlStr);
      const req = new EventEmitter();
      req.destroy = (err) => { req.emit('error', err); };
      process.nextTick(() => {
        const mockReq = new EventEmitter();
        mockReq.method = 'GET';
        mockReq.url = parsed.pathname + parsed.search;
        mockReq.headers = options.headers || {};
        const mockRes = new EventEmitter();
        mockRes.statusCode = 200;
        mockRes.status = (code) => { mockRes.statusCode = code; return mockRes; };
        mockRes.setHeader = () => {};
        mockRes.json = (obj) => {
          mockRes.emit('data', Buffer.from(JSON.stringify(obj)));
          mockRes.emit('end');
        };
        mockRes.send = (str) => {
          mockRes.emit('data', Buffer.from(str));
          mockRes.emit('end');
        };
        callback(mockRes);
        app(mockReq, mockRes);
      });
      return req;
    },
    request: (urlStr, options, callback) => {
      const parsed = new URL(urlStr);
      const req = new EventEmitter();
      const chunks = [];
      let timer = null;
      req.write = (c) => chunks.push(c);
      req.destroy = (err) => {
        if (timer) clearTimeout(timer);
        req.emit('error', err || new Error('destroyed'));
      };
      req.end = () => {
        if (options.timeout) {
          timer = setTimeout(() => {
            req.emit('timeout');
          }, options.timeout);
        }
        process.nextTick(() => {
          const bodyBuffer = Buffer.concat(chunks.map(c => typeof c === 'string' ? Buffer.from(c) : c));
          const mockReq = new EventEmitter();
          mockReq.method = options.method || 'POST';
          mockReq.url = parsed.pathname + parsed.search;
          mockReq.headers = options.headers || {};
          const mockRes = new EventEmitter();
          mockRes.statusCode = 200;
          mockRes.status = (code) => { mockRes.statusCode = code; return mockRes; };
          mockRes.setHeader = () => {};
          mockRes.json = (obj) => {
            if (timer) clearTimeout(timer);
            callback(mockRes);
            mockRes.emit('data', Buffer.from(JSON.stringify(obj)));
            mockRes.emit('end');
          };
          mockRes.send = (str) => {
            if (timer) clearTimeout(timer);
            callback(mockRes);
            mockRes.emit('data', Buffer.from(str));
            mockRes.emit('end');
          };
          app(mockReq, mockRes);
          mockReq.emit('data', bodyBuffer);
          mockReq.emit('end');
        });
      };
      return req;
    }
  };
}

async function startServerOrMock(app) {
  const server = http.createServer(app);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    return {
      server,
      port: server.address().port,
      httpClient: undefined,
      close: () => server.close()
    };
  } catch (err) {
    if (err.code === 'EPERM') {
      return {
        server: null,
        port: 9999,
        httpClient: createExpressMockHttpClient(app),
        close: () => {}
      };
    }
    throw err;
  }
}

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

    // 启动测试 HTTP Server (若在沙箱环境中受限则平滑切到 mockHttpClient)
    const running = await startServerOrMock(serverApp);
    const port = running.port;

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
      localExecutor: mockLocalExecutor,
      httpClient: running.httpClient
    });

    try {
      const result = await forwarder.execute('echo.tool', { val: 'hello' });
      assert.equal(serverExecuted, true, '应当在 Server 端执行');
      assert.equal(localExecuted, false, '不应当在本地回退执行');
      assert.deepEqual(result, { fromServer: true, echoed: 'hello' });
    } finally {
      running.close();
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

    const running = await startServerOrMock(serverApp);
    const port = running.port;

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
      httpClient: running.httpClient,
      requestTimeoutMs: 100 // 100ms 触发超时
    });

    try {
      await assert.rejects(
        async () => forwarder.execute('delayed.tool', {}, { requestId: 'req-timeout-test' }),
        (err) => {
          assert.ok(err instanceof ServerExecutionTimeoutError);
          assert.equal(err.code, 'SERVER_EXECUTION_TIMEOUT');
          assert.equal(err.requestId, 'req-timeout-test');
          assert.ok(err.operationQueryUrl.includes('req-timeout-test'));
          return true;
        }
      );

      // 核心安全约束校验：本地执行次数必须为 0！绝不盲目重跑！
      assert.equal(localExecutedCount, 0, '超时后绝不应该在本地重跑产生重复副作用');
    } finally {
      running.close();
      try { fs.unlinkSync(serverJsonPath); } catch {}
    }
  });

  it('转发连接异常时应当抛出 ServerForwardingError 并保留 requestId 与查询链接', async () => {
    const serverJsonPath = path.join(TEST_RUNTIME_DIR, 'server.json');
    fs.writeFileSync(
      serverJsonPath,
      JSON.stringify({
        pid: process.pid,
        port: 59999,
        instanceId: 'offline-inst',
        protocolVersion: '1.0'
      }),
      'utf8'
    );

    const mockHttpClient = {
      get: (url, opts, cb) => {
        const req = new EventEmitter();
        req.destroy = () => {};
        process.nextTick(() => {
          const res = new EventEmitter();
          cb(res);
          res.emit('data', Buffer.from(JSON.stringify({ ok: true, instanceId: 'offline-inst' })));
          res.emit('end');
        });
        return req;
      },
      request: (url, opts, cb) => {
        const req = new EventEmitter();
        req.write = () => {};
        req.end = () => {
          process.nextTick(() => {
            req.emit('error', new Error('ECONNRESET connection reset'));
          });
        };
        return req;
      }
    };

    const forwarder = createClientForwarder({
      runtimeDir: TEST_RUNTIME_DIR,
      httpClient: mockHttpClient
    });

    try {
      await assert.rejects(
        async () => forwarder.execute('test.tool', {}, { requestId: 'req-forward-err-1' }),
        (err) => {
          assert.ok(err instanceof ServerForwardingError);
          assert.equal(err.code, 'SERVER_FORWARDING_ERROR');
          assert.equal(err.requestId, 'req-forward-err-1');
          assert.ok(err.operationQueryUrl.includes('req-forward-err-1'));
          return true;
        }
      );
    } finally {
      try { fs.unlinkSync(serverJsonPath); } catch {}
    }
  });
});
