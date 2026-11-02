/**
 * @file runtime-agent-routes.test.js
 * @description 运行时 Agent 与 LLM 动态设置 HTTP / SSE 路由测试
 */

'use strict';

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');

const { registerRuntimeRoutes } = require('../../../core/server/runtime-routes');
const { createSessionStore } = require('../../../core/agent/session-store');
const { AgentRunner } = require('../../../core/agent/agent-runner');
const { createToolRegistry } = require('../../../core/runtime/tool-registry');
const { createToolExecutor } = require('../../../core/runtime/tool-executor');
const { resetDynamicSettings } = require('../../../core/llm/settings-manager');

describe('Runtime Agent & LLM Routes Integration Tests', () => {
  let app;
  let server;
  let baseUrl;
  let tmpDir;
  let sessionStore;
  let executor;
  let runner;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-routes-test-'));
    sessionStore = createSessionStore({ dataDir: tmpDir });
    const registry = createToolRegistry();
    executor = createToolExecutor({ registry, logger: { log() {}, error() {} } });

    const mockLlm = {
      chatWithTools: async () => ({
        message: {
          role: 'assistant',
          content: '这是来自 Agent 的测试回复。'
        },
        usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 }
      })
    };

    runner = new AgentRunner({
      toolExecutor: executor,
      registry,
      llmClient: mockLlm,
      sessionStore
    });

    app = express();
    app.use(express.json());

    registerRuntimeRoutes(app, {
      toolExecutor: executor,
      operationStore: { get: () => null },
      agentRunner: runner,
      sessionStore
    });

    await new Promise(resolve => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    resetDynamicSettings();
    await new Promise(resolve => server.close(resolve));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  describe('LLM Settings Endpoints', () => {
    it('GET /api/runtime/llm/settings should return masked settings', async () => {
      const res = await axios.get(`${baseUrl}/api/runtime/llm/settings`);
      assert.equal(res.status, 200);
      assert.equal(res.data.ok, true);
      assert.ok(res.data.settings);
      assert.equal(typeof res.data.settings.provider, 'string');
      assert.equal(typeof res.data.settings.apiKeyMasked, 'string');
    });

    it('POST /api/runtime/llm/settings should update dynamic settings', async () => {
      const res = await axios.post(`${baseUrl}/api/runtime/llm/settings`, {
        provider: 'openai-compatible',
        apiKey: 'sk-test-routes-key-1234',
        model: 'gpt-4o-test'
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.ok, true);
      assert.equal(res.data.settings.provider, 'openai-compatible');
      assert.equal(res.data.settings.model, 'gpt-4o-test');
      assert.ok(res.data.settings.apiKeyMasked.includes('******'));
    });
  });

  describe('Agent Chat & Session Endpoints', () => {
    it('POST /api/runtime/agent/chat should execute and return session via standard JSON', async () => {
      const res = await axios.post(`${baseUrl}/api/runtime/agent/chat`, {
        sessionId: 'routes_sess_1',
        userPrompt: '测试对话'
      });

      assert.equal(res.status, 200);
      assert.equal(res.data.ok, true);
      assert.equal(res.data.session.sessionId, 'routes_sess_1');
      assert.equal(res.data.session.status, 'completed');
    });

    it('GET /api/runtime/agent/sessions/:id should return persisted session', async () => {
      const res = await axios.get(`${baseUrl}/api/runtime/agent/sessions/routes_sess_1`);
      assert.equal(res.status, 200);
      assert.equal(res.data.ok, true);
      assert.equal(res.data.session.sessionId, 'routes_sess_1');
    });

    it('GET /api/runtime/agent/sessions should list sessions', async () => {
      const res = await axios.get(`${baseUrl}/api/runtime/agent/sessions`);
      assert.equal(res.status, 200);
      assert.equal(res.data.ok, true);
      assert.ok(Array.isArray(res.data.sessions));
      assert.ok(res.data.sessions.some(s => s.sessionId === 'routes_sess_1'));
    });

    it('POST /api/runtime/agent/chat with stream: true should stream SSE events', async () => {
      const res = await axios.post(
        `${baseUrl}/api/runtime/agent/chat`,
        {
          sessionId: 'routes_sess_stream',
          userPrompt: '流式对话测试',
          stream: true
        },
        {
          responseType: 'text'
        }
      );

      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/event-stream'));
      assert.ok(res.data.includes('session:start'));
      assert.ok(res.data.includes('content:chunk'));
      assert.ok(res.data.includes('done'));
    });
  });
});
