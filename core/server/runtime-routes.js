/**
 * @file runtime-routes.js
 * @description Agent 统一运行时 HTTP 端点 (健康检查、工具代理执行、幂等操作查询)
 * 符合 ADR v1.0 (D4, D5)
 */

'use strict';

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

    try {
      const result = await toolExecutor.execute(toolId, input, {
        requestId,
        caller
      });
      res.json({
        ok: true,
        toolId,
        requestId,
        result
      });
    } catch (err) {
      const status = err.status || (err.code === 'IDEMPOTENCY_CONFLICT' ? 409 : err.code === 'TOOL_NOT_FOUND' ? 404 : err.code === 'INVALID_ARGUMENT' ? 400 : 500);
      res.status(status).json({
        ok: false,
        error: err.message,
        code: err.code || 'TOOL_EXECUTION_FAILED',
        status
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
