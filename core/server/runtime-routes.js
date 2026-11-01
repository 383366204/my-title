/**
 * @file runtime-routes.js
 * @description Agent 统一运行时 HTTP 端点 (健康检查、工具代理执行、幂等操作查询)
 * 符合 ADR v1.0 (D4, D5)
 */

'use strict';

/**
 * 将领域错误状态安全转换为标准数值型 HTTP 状态码
 * @param {any} err
 * @returns {number}
 */
function resolveNumericHttpStatus(err) {
  if (typeof err?.status === 'number' && err.status >= 100 && err.status < 600) {
    return err.status;
  }
  if (typeof err?.statusCode === 'number' && err.statusCode >= 100 && err.statusCode < 600) {
    return err.statusCode;
  }
  if (err?.code === 'IDEMPOTENCY_CONFLICT' || err?.code === 'OPERATION_INTERRUPTED') return 409;
  if (err?.code === 'OPERATION_ABORTED') return 499;
  if (err?.code === 'TOOL_NOT_FOUND') return 404;
  if (err?.code === 'INVALID_ARGUMENT') return 400;
  if (err?.code === 'LEASE_BUSY' || err?.code === 'PLATFORM_ACCESS_BLOCKED') return 429;
  return 500;
}

/**
 * 注册运行时路由
 * @param {import('express').Express} app
 * @param {Object} deps
 * @param {import('../runtime/tool-executor').createToolExecutor} deps.toolExecutor
 * @param {import('../runtime/operation-store').createOperationStore} deps.operationStore
 * @param {string} [deps.instanceId]
 */
function registerRuntimeRoutes(app, deps = {}) {
  const { toolExecutor, operationStore, instanceId = 'default-instance' } = deps;

  // 1. 运行时健康检查与身份发现端点
  app.get('/api/runtime/health', (req, res) => {
    res.json({
      ok: true,
      status: 'healthy',
      instanceId,
      protocolVersion: '1.0',
      pid: process.pid,
      time: new Date().toISOString()
    });
  });

  // 2. 工具统一执行入口
  app.post('/api/runtime/tools/:id/execute', async (req, res) => {
    const toolId = req.params.id;
    const { input = {}, requestId, caller = 'remote-forward' } = req.body || {};

    const abortController = new AbortController();
    req.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    try {
      const result = await toolExecutor.execute(toolId, input, {
        requestId,
        caller,
        abortSignal: abortController.signal
      });
      if (res.writableEnded) return;
      res.json({
        ok: true,
        toolId,
        requestId,
        result
      });
    } catch (err) {
      if (res.writableEnded) return;
      const httpStatus = resolveNumericHttpStatus(err);
      res.status(httpStatus).json({
        ok: false,
        error: err.message,
        code: err.code || 'TOOL_EXECUTION_FAILED',
        domainStatus: typeof err.status === 'string' ? err.status : undefined,
        status: httpStatus
      });
    }
  });

  // 3. 幂等操作状态查询端点
  app.get('/api/runtime/operations/:requestId', (req, res) => {
    const { requestId } = req.params;
    const record = operationStore.get(requestId);
    if (!record) {
      return res.status(404).json({
        ok: false,
        error: `未找到操作记录: [${requestId}]`,
        code: 'OPERATION_NOT_FOUND'
      });
    }
    res.json({
      ok: true,
      operation: record
    });
  });
}

module.exports = {
  registerRuntimeRoutes
};
