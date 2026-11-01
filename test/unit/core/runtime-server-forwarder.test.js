/**
 * @file runtime-server-forwarder.test.js
 * @description 单服务优先转发器测试（探测、转发、离线回退与超时防本地重跑）
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { createClientForwarder, ServerExecutionTimeoutError, ServerForwardingError } = require('../../../core/runtime/server-forwarder');

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
    const serverJsonPath = path.join(TEST_RUNTIME_DIR, 'server.json');
    const instanceId = 'test-instance-123';
    fs.writeFileSync(
      serverJsonPath,
      JSON.stringify({
        pid: process.pid,
        port: 49999,
        instanceId,
        protocolVersion: '1.0'
      }),
      'utf8'
    );

    let serverExecuted = false;
    let localExecuted = false;

    const mockHttpClient = {
      get: (url, opts, cb) => {
        const req = new EventEmitter();
        req.destroy = () => {};
        process.nextTick(() => {
          const res = new EventEmitter();
          res.statusCode = 200;
          cb(res);
          res.emit('data', Buffer.from(JSON.stringify({ ok: true, status: 'healthy', instanceId })));
          res.emit('end');
        });
        return req;
      },
      request: (url, opts, cb) => {
        const req = new EventEmitter();
        const chunks = [];
        req.write = (c) => chunks.push(c);
        req.destroy = () => {};
        req.end = () => {
          process.nextTick(() => {
            const bodyStr = Buffer.concat(chunks.map(c => typeof c === 'string' ? Buffer.from(c) : c)).toString('utf8');
            const parsed = JSON.parse(bodyStr);
            serverExecuted = true;
            const res = new EventEmitter();
            res.statusCode = 200;
            cb(res);
            res.emit('data', Buffer.from(JSON.stringify({ ok: true, result: { fromServer: true, echoed: parsed.input.val } })));
            res.emit('end');
          });
        };
        return req;
      }
    };

    const mockLocalExecutor = {
      execute: async () => {
        localExecuted = true;
        return { executedLocally: true };
      }
    };

    const forwarder = createClientForwarder({
      runtimeDir: TEST_RUNTIME_DIR,
      localExecutor: mockLocalExecutor,
      httpClient: mockHttpClient
    });

    try {
      const result = await forwarder.execute('echo.tool', { val: 'hello' });
      assert.equal(serverExecuted, true, '应当在 Server 端执行');
      assert.equal(localExecuted, false, '不应当在本地回退执行');
      assert.deepEqual(result, { fromServer: true, echoed: 'hello' });
    } finally {
      try { fs.unlinkSync(serverJsonPath); } catch {}
    }
  });

  it('服务端响应超时时，应当抛出 ServerExecutionTimeoutError 且严禁在本地重跑', async () => {
    const serverJsonPath = path.join(TEST_RUNTIME_DIR, 'server.json');
    const instanceId = 'timeout-inst';
    fs.writeFileSync(
      serverJsonPath,
      JSON.stringify({
        pid: process.pid,
        port: 49998,
        instanceId,
        protocolVersion: '1.0'
      }),
      'utf8'
    );

    let localExecutedCount = 0;
    const mockHttpClient = {
      get: (url, opts, cb) => {
        const req = new EventEmitter();
        req.destroy = () => {};
        process.nextTick(() => {
          const res = new EventEmitter();
          res.statusCode = 200;
          cb(res);
          res.emit('data', Buffer.from(JSON.stringify({ ok: true, status: 'healthy', instanceId })));
          res.emit('end');
        });
        return req;
      },
      request: (url, opts, cb) => {
        const req = new EventEmitter();
        let timer = null;
        req.write = () => {};
        req.destroy = () => {
          if (timer) clearTimeout(timer);
        };
        req.end = () => {
          // 设置定时器触发超时
          if (opts.timeout) {
            timer = setTimeout(() => {
              req.emit('timeout');
            }, opts.timeout);
          }
        };
        return req;
      }
    };

    const mockLocalExecutor = {
      execute: async () => {
        localExecutedCount++;
        return { shouldNotHappen: true };
      }
    };

    const forwarder = createClientForwarder({
      runtimeDir: TEST_RUNTIME_DIR,
      localExecutor: mockLocalExecutor,
      httpClient: mockHttpClient,
      requestTimeoutMs: 50 // 50ms 快速触发超时
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
          res.statusCode = 200;
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

  it('服务端响应流在传输中途中断时应当安全抛出 ServerForwardingError 并保留对账凭证', async () => {
    const serverJsonPath = path.join(TEST_RUNTIME_DIR, 'server.json');
    fs.writeFileSync(
      serverJsonPath,
      JSON.stringify({
        pid: process.pid,
        port: 59998,
        instanceId: 'stream-err-inst',
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
          res.statusCode = 200;
          cb(res);
          res.emit('data', Buffer.from(JSON.stringify({ ok: true, instanceId: 'stream-err-inst' })));
          res.emit('end');
        });
        return req;
      },
      request: (url, opts, cb) => {
        const req = new EventEmitter();
        req.write = () => {};
        req.end = () => {
          process.nextTick(() => {
            const res = new EventEmitter();
            res.statusCode = 200;
            cb(res);
            // 响应头已发送，流传输中途中断
            res.emit('data', Buffer.from('{"ok":true,"re'));
            res.emit('error', new Error('stream premature close'));
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
        async () => forwarder.execute('test.tool', {}, { requestId: 'req-stream-err-1' }),
        (err) => {
          assert.ok(err instanceof ServerForwardingError);
          assert.equal(err.code, 'SERVER_FORWARDING_ERROR');
          assert.equal(err.requestId, 'req-stream-err-1');
          assert.ok(err.operationQueryUrl.includes('req-stream-err-1'));
          return true;
        }
      );
    } finally {
      try { fs.unlinkSync(serverJsonPath); } catch {}
    }
  });

  it('execute 应当在 abortSignal 中止时抛出 OPERATION_ABORTED，绝不启动已取消的远程请求', async () => {
    const serverJsonPath = path.join(TEST_RUNTIME_DIR, 'server.json');
    fs.writeFileSync(serverJsonPath, JSON.stringify({
      port: 9879,
      instanceId: 'abort-server-inst',
      pid: process.pid
    }));

    let requestCalled = false;
    const mockHttpClient = {
      get: (url, opts, cb) => {
        const req = new EventEmitter();
        process.nextTick(() => {
          const res = new EventEmitter();
          res.statusCode = 200;
          cb(res);
          res.emit('data', Buffer.from(JSON.stringify({ ok: true, instanceId: 'abort-server-inst' })));
          res.emit('end');
        });
        return req;
      },
      request: () => {
        requestCalled = true;
        const req = new EventEmitter();
        req.write = () => {};
        req.end = () => {};
        return req;
      }
    };

    const forwarder = createClientForwarder({
      runtimeDir: TEST_RUNTIME_DIR,
      httpClient: mockHttpClient
    });

    try {
      const controller = new AbortController();
      controller.abort();

      await assert.rejects(
        async () => forwarder.execute('test.tool', {}, { abortSignal: controller.signal }),
        (err) => {
          assert.equal(err.code, 'OPERATION_ABORTED');
          return true;
        }
      );

      assert.equal(requestCalled, false, '已取消请求绝不发起远程 HTTP 调用');
    } finally {
      try { fs.unlinkSync(serverJsonPath); } catch {}
    }
  });

  it('HTTP 执行端点正常接收 POST 请求体后不应触发 abortSignal，仅在客户端提前断开连接时才触发中止', async () => {
    const { registerRuntimeRoutes } = require('../../../core/server/runtime-routes');
    const express = require('express');
    const http = require('http');
    const { Duplex } = require('stream');

    const app = express();
    app.use(express.json());

    let observedSignal = null;
    let executorRan = false;

    registerRuntimeRoutes(app, {
      toolExecutor: {
        execute: async (toolId, input, ctx) => {
          executorRan = true;
          observedSignal = ctx.abortSignal;
          // 模拟稍微耗时的异步任务
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { done: true, wasAborted: ctx.abortSignal.aborted };
        }
      },
      operationStore: {}
    });

    // 构造模拟连接测试正常请求
    const server = http.createServer(app);
    let responseData = '';
    const socket = new Duplex({
      read() {},
      write(chunk, enc, cb) {
        responseData += chunk.toString();
        cb();
      }
    });

    server.emit('connection', socket);
    const postBody = JSON.stringify({ input: { test: true } });
    socket.push(
      `POST /api/runtime/tools/test.tool/execute HTTP/1.1\r\n` +
      `Host: 127.0.0.1\r\n` +
      `Content-Type: application/json\r\n` +
      `Content-Length: ${Buffer.byteLength(postBody)}\r\n` +
      `Connection: close\r\n\r\n` +
      postBody
    );

    // 等待响应生成
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(executorRan, true);
    assert.ok(observedSignal);
    assert.equal(observedSignal.aborted, false, '正常请求结束时不应将异步操作误当作客户端中断而取消');
    assert.ok(responseData.includes('"done":true'));
  });
});
