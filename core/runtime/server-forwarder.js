/**
 * @file server-forwarder.js
 * @description 客户端调用转发器（单服务优先：发现本地常驻服务则 HTTP 转发，无服务时本地持租约执行）
 * 符合 ADR v1.0 (D5) 严格约束：禁止转发超时后静默在本地重跑
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { isProcessAlive } = require('./workbench-lease');
const { createDefaultToolExecutor } = require('./bootstrap');

class ServerExecutionTimeoutError extends Error {
  constructor(message, requestId, operationQueryUrl) {
    super(message);
    this.name = 'ServerExecutionTimeoutError';
    this.code = 'SERVER_EXECUTION_TIMEOUT';
    this.requestId = requestId;
    this.operationQueryUrl = operationQueryUrl;
  }
}

class ServerForwardingError extends Error {
  constructor(message, requestId, operationQueryUrl, cause) {
    super(message);
    this.name = 'ServerForwardingError';
    this.code = 'SERVER_FORWARDING_ERROR';
    this.requestId = requestId;
    this.operationQueryUrl = operationQueryUrl;
    if (cause) this.cause = cause;
  }
}

/**
 * 创建客户端转发器
 * @param {Object} [deps]
 * @param {string} [deps.runtimeDir]
 * @param {import('./tool-executor').createToolExecutor} [deps.localExecutor]
 * @param {any} [deps.httpClient] HTTP 客户端（默认 Node.js 内置 http 模块）
 * @param {number} [deps.healthTimeoutMs]
 * @param {number} [deps.requestTimeoutMs]
 */
function createClientForwarder(deps = {}) {
  const projectRoot = deps.projectRoot || path.resolve(__dirname, '../../');
  const runtimeDir = deps.runtimeDir || path.join(projectRoot, 'data', 'runtime');
  const serverJsonPath = path.join(runtimeDir, 'server.json');
  const localExecutor = deps.localExecutor || createDefaultToolExecutor();
  const httpClient = deps.httpClient || http;
  const healthTimeoutMs = deps.healthTimeoutMs || 1000;
  const requestTimeoutMs = deps.requestTimeoutMs || 60000;

  /**
   * 探测本地 Server 是否存活且健康
   * @returns {Promise<{ online: boolean, serverInfo?: Object }>}
   */
  async function checkServerOnline() {
    try {
      if (!fs.existsSync(serverJsonPath)) {
        return { online: false };
      }
      const raw = fs.readFileSync(serverJsonPath, 'utf8');
      const serverInfo = JSON.parse(raw);

      if (!serverInfo.pid || !serverInfo.port) {
        return { online: false };
      }

      // 1. 检查 PID 是否存活
      if (!isProcessAlive(serverInfo.pid)) {
        return { online: false };
      }

      // 2. 发起 HTTP 健康探测
      const healthData = await new Promise((resolve, reject) => {
        let healthEnded = false;
        const req = httpClient.get(
          `http://127.0.0.1:${serverInfo.port}/api/runtime/health`,
          { timeout: healthTimeoutMs },
          (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
              healthEnded = true;
              try {
                resolve(JSON.parse(body));
              } catch (e) {
                reject(e);
              }
            });
            res.on('error', (err) => {
              healthEnded = true;
              reject(err);
            });
            res.on('close', () => {
              if (!healthEnded) {
                reject(new Error('健康检查响应流过早关闭'));
              }
            });
          }
        );
        req.on('timeout', () => { req.destroy(new Error('Health probe timeout')); });
        req.on('error', reject);
      });

      if (healthData && healthData.ok && (!serverInfo.instanceId || healthData.instanceId === serverInfo.instanceId)) {
        return { online: true, serverInfo };
      }

      return { online: false };
    } catch {
      return { online: false };
    }
  }

  /**
   * 统一执行工具：优先远程转发，离线回退本地
   * @param {string} idOrName
   * @param {any} [input={}]
   * @param {Object} [options={}]
   * @returns {Promise<any>}
   */
  async function execute(idOrName, input = {}, options = {}) {
    const requestId = options.requestId || (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
    const { online, serverInfo } = await checkServerOnline();

    if (online && serverInfo) {
      // 远程转发给已运行的 Runtime Server
      const postData = JSON.stringify({
        input,
        requestId,
        caller: options.caller || 'client-forwarder'
      });

      return await new Promise((resolve, reject) => {
        const req = httpClient.request(
          `http://127.0.0.1:${serverInfo.port}/api/runtime/tools/${encodeURIComponent(idOrName)}/execute`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData)
            },
            timeout: options.timeoutMs || requestTimeoutMs
          },
          (res) => {
            let body = '';
            let ended = false;
            const queryUrl = `http://127.0.0.1:${serverInfo.port}/api/runtime/operations/${requestId}`;

            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
              ended = true;
              try {
                const responseJson = JSON.parse(body);
                if (res.statusCode >= 200 && res.statusCode < 300 && responseJson.ok) {
                  resolve(responseJson.result);
                } else {
                  const err = new Error(responseJson.error || `HTTP 错误: ${res.statusCode}`);
                  err.status = res.statusCode;
                  err.code = responseJson.code || 'REMOTE_EXECUTION_ERROR';
                  reject(err);
                }
              } catch (parseErr) {
                reject(
                  new ServerForwardingError(
                    `解析服务端响应失败: ${parseErr.message}, body: ${body}。请核查 operation 状态: ${queryUrl}`,
                    requestId,
                    queryUrl,
                    parseErr
                  )
                );
              }
            });

            res.on('error', (resErr) => {
              reject(
                new ServerForwardingError(
                  `读取服务端响应流异常 (${resErr.message})。若请求已被服务端接收，请查询 operation 状态: ${queryUrl}`,
                  requestId,
                  queryUrl,
                  resErr
                )
              );
            });

            res.on('close', () => {
              if (!ended) {
                reject(
                  new ServerForwardingError(
                    `服务端响应流过早关闭 (premature close)。若请求已被服务端接收，请查询 operation 状态: ${queryUrl}`,
                    requestId,
                    queryUrl
                  )
                );
              }
            });
          }
        );

        req.on('timeout', () => {
          req.destroy();
          // ADR D5 严格决议：禁止超时后静默在本地重跑！
          const queryUrl = `http://127.0.0.1:${serverInfo.port}/api/runtime/operations/${requestId}`;
          reject(
            new ServerExecutionTimeoutError(
              `转发至本地 Server 执行超时。禁止静默在本地重跑以防止产生重复副作用。请查询 operation 状态: ${queryUrl}`,
              requestId,
              queryUrl
            )
          );
        });

        req.on('error', (err) => {
          const queryUrl = `http://127.0.0.1:${serverInfo.port}/api/runtime/operations/${requestId}`;
          reject(
            new ServerForwardingError(
              `连接本地 Runtime Server 失败 (${err.message})。若请求已被服务端接收，请查询 operation 状态: ${queryUrl}`,
              requestId,
              queryUrl,
              err
            )
          );
        });

        req.write(postData);
        req.end();
      });
    }

    // 本地离线执行（自动受本地租约与平台锁保护）
    return await localExecutor.execute(idOrName, input, {
      ...options,
      requestId
    });
  }

  return {
    execute,
    checkServerOnline,
    serverJsonPath
  };
}

module.exports = {
  createClientForwarder,
  ServerExecutionTimeoutError,
  ServerForwardingError
};
