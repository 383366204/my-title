/**
 * @file runtime-routes.js
 * @description Agent 统一运行时 HTTP 端点 (健康检查、工具代理执行、幂等操作查询)
 * 符合 ADR v1.0 (D4, D5)
 */

'use strict';

const {
  getPublicSettings,
  writeDynamicSettings,
  testConnectivity
} = require('../llm/settings-manager');
const { createAgentRunner } = require('../agent/agent-runner');
const { createSessionStore } = require('../agent/session-store');

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
  if (err?.code === 'IDEMPOTENCY_CONFLICT' || err?.code === 'OPERATION_INTERRUPTED' || err?.code === 'SESSION_BUSY') return 409;
  if (err?.code === 'OPERATION_ABORTED') return 499;
  if (err?.code === 'TOOL_NOT_FOUND' || err?.code === 'SESSION_NOT_FOUND') return 404;
  if (err?.code === 'INVALID_ARGUMENT' || err?.code === 'INVALID_SESSION_STATE') return 400;
  if (err?.code === 'LEASE_BUSY' || err?.code === 'PLATFORM_ACCESS_BLOCKED') return 429;
  return 500;
}

/**
 * 注册运行时路由
 * @param {import('express').Express} app
 * @param {Object} deps
 * @param {import('../runtime/tool-executor').createToolExecutor} deps.toolExecutor
 * @param {import('../runtime/operation-store').createOperationStore} deps.operationStore
 * @param {import('../agent/agent-runner').AgentRunner} [deps.agentRunner]
 * @param {import('../agent/session-store').SessionStore} [deps.sessionStore]
 * @param {string} [deps.instanceId]
 */
function registerRuntimeRoutes(app, deps = {}) {
  const { toolExecutor, operationStore, instanceId = 'default-instance' } = deps;
  const sessionStore = deps.sessionStore || createSessionStore();
  const agentRunner = deps.agentRunner || createAgentRunner({
    toolExecutor,
    sessionStore
  });

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
    // 在 HTTP 响应对象上监听连接提前关闭（客户端中断），而不是在 req 上监听（req 会在请求体读取完后触发 close）
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });
    req.on('aborted', () => {
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

  // 4. LLM 动态设置查询与保存端点
  app.get('/api/runtime/llm/settings', (req, res) => {
    try {
      const settings = getPublicSettings();
      res.json({ ok: true, settings });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/runtime/llm/settings', (req, res) => {
    try {
      writeDynamicSettings(req.body || {});
      const updated = getPublicSettings();
      res.json({ ok: true, settings: updated });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/runtime/llm/test', async (req, res) => {
    try {
      const result = await testConnectivity(req.body || {});
      if (result.ok) {
        res.json(result);
      } else {
        res.status(result.status || 400).json(result);
      }
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 5. Agent 会话与交互端点 (支持普通 JSON 与 SSE 流式输出)
  app.post('/api/runtime/agent/chat', async (req, res) => {
    const { sessionId, userPrompt, maxTurns, toolWhitelist, stream } = req.body || {};
    const wantsStream = Boolean(stream) || (req.headers.accept && req.headers.accept.includes('text/event-stream'));

    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    if (wantsStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const sendSse = (type, payload) => {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
        }
      };

      const listeners = {
        'session:start': (d) => sendSse('session:start', d),
        'turn:start': (d) => sendSse('turn:start', d),
        'thinking:chunk': (d) => sendSse('thinking:chunk', d),
        'content:chunk': (d) => sendSse('content:chunk', d),
        'tool:call': (d) => sendSse('tool:call', d),
        'tool:result': (d) => sendSse('tool:result', d),
        'tool:error': (d) => sendSse('tool:error', d),
        'turn:end': (d) => sendSse('turn:end', d),
        'suspended': (d) => sendSse('suspended', d),
        'completed': (d) => sendSse('completed', d),
        'aborted': (d) => sendSse('aborted', d),
        'failure': (d) => sendSse('failure', d)
      };

      for (const [evt, fn] of Object.entries(listeners)) {
        agentRunner.on(evt, fn);
      }

      try {
        const session = await agentRunner.start({
          sessionId,
          userPrompt,
          maxTurns,
          toolWhitelist,
          abortSignal: abortController.signal
        });
        sendSse('done', { sessionId: session.sessionId, status: session.status });
        res.end();
      } catch (err) {
        sendSse('error', { error: err.message, code: err.code || 'RUNNER_ERROR' });
        res.end();
      } finally {
        for (const [evt, fn] of Object.entries(listeners)) {
          agentRunner.off(evt, fn);
        }
      }
      return;
    }

    // 普通 JSON 响应
    try {
      const session = await agentRunner.start({
        sessionId,
        userPrompt,
        maxTurns,
        toolWhitelist,
        abortSignal: abortController.signal
      });
      res.json({ ok: true, session });
    } catch (err) {
      const httpStatus = resolveNumericHttpStatus(err);
      res.status(httpStatus).json({
        ok: false,
        error: err.message,
        code: err.code || 'AGENT_ERROR'
      });
    }
  });

  app.get('/api/runtime/agent/sessions', (req, res) => {
    try {
      const list = sessionStore.list();
      res.json({ ok: true, sessions: list });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/runtime/agent/sessions/:id', (req, res) => {
    const { id } = req.params;
    const session = sessionStore.get(id);
    if (!session) {
      return res.status(404).json({ ok: false, error: `未找到会话 [${id}]`, code: 'SESSION_NOT_FOUND' });
    }
    res.json({ ok: true, session });
  });

  app.post('/api/runtime/agent/sessions/:id/resume', async (req, res) => {
    const { id } = req.params;
    const { userMessage } = req.body || {};
    try {
      const session = await agentRunner.resume({
        sessionId: id,
        userMessage
      });
      res.json({ ok: true, session });
    } catch (err) {
      const httpStatus = resolveNumericHttpStatus(err);
      res.status(httpStatus).json({
        ok: false,
        error: err.message,
        code: err.code || 'AGENT_RESUME_ERROR'
      });
    }
  });
}

module.exports = {
  registerRuntimeRoutes
};
