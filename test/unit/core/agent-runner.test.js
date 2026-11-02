/**
 * @file agent-runner.test.js
 * @description 受限 AgentRunner 单元测试 (轮次预算、自愈、挂起恢复、互斥锁、防死锁调度)
 */

'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { z } = require('zod');

const { AgentRunner } = require('../../../core/agent/agent-runner');
const { createToolRegistry } = require('../../../core/runtime/tool-registry');
const { createToolExecutor } = require('../../../core/runtime/tool-executor');
const { createSessionStore } = require('../../../core/agent/session-store');

describe('AgentRunner Unit Tests', () => {
  let tmpDir;
  let registry;
  let executor;
  let sessionStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runner-test-'));
    registry = createToolRegistry();
    executor = createToolExecutor({ registry, logger: { log() {}, error() {} } });
    sessionStore = createSessionStore({ dataDir: tmpDir });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('should complete normally when model outputs direct answer without tools', async () => {
    const mockLlm = {
      chatWithTools: async () => ({
        message: {
          role: 'assistant',
          content: '你好！我是选品 AI 助手，有什么可以帮您？'
        },
        usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 }
      })
    };

    const runner = new AgentRunner({
      toolExecutor: executor,
      registry,
      llmClient: mockLlm,
      sessionStore
    });

    let completedPayload = null;
    runner.on('completed', payload => {
      completedPayload = payload;
    });

    const session = await runner.start({
      sessionId: 'test_session_direct',
      userPrompt: '你好'
    });

    assert.equal(session.status, 'completed');
    assert.equal(session.turnCount, 1);
    assert.ok(completedPayload);
    assert.equal(completedPayload.finalMessage, '你好！我是选品 AI 助手，有什么可以帮您？');
  });

  it('should execute tool, compact result, and finish in turn 2', async () => {
    // 注册一个测试工具
    registry.register({
      id: 'trend.query',
      mcpName: 'trend_query',
      version: '1.0.0',
      description: '查询趋势',
      inputSchema: z.object({ keyword: z.string() }),
      policy: { risk: 'low', approval: 'never', sideEffect: 'read', resourceKeys: [], platforms: [] },
      execute: async ({ keyword }) => ({ ok: true, keyword, trendScore: 95 })
    });

    let turn = 0;
    const mockLlm = {
      chatWithTools: async () => {
        turn++;
        if (turn === 1) {
          return {
            message: {
              role: 'assistant',
              content: '正在为您查询趋势...',
              tool_calls: [
                {
                  id: 'call_trend_1',
                  type: 'function',
                  function: {
                    name: 'trend_query',
                    arguments: JSON.stringify({ keyword: '纯银项链' })
                  }
                }
              ]
            }
          };
        }
        return {
          message: {
            role: 'assistant',
            content: '纯银项链当前趋势评分为 95，热度极高。'
          }
        };
      }
    };

    const runner = new AgentRunner({
      toolExecutor: executor,
      registry,
      llmClient: mockLlm,
      sessionStore
    });

    const toolEvents = [];
    runner.on('tool:call', e => toolEvents.push(e));
    runner.on('tool:result', e => toolEvents.push(e));

    const session = await runner.start({
      sessionId: 'test_session_tools',
      userPrompt: '查一下纯银项链趋势'
    });

    assert.equal(session.status, 'completed');
    assert.equal(session.turnCount, 2);
    assert.equal(toolEvents.length, 2); // call + result
    assert.equal(toolEvents[0].name, 'trend_query');
    assert.equal(toolEvents[1].result.trendScore, 95);

    // 检查第 3 条消息为 tool role，且经过了 compact 序列化
    const toolMsg = session.messages.find(m => m.role === 'tool');
    assert.ok(toolMsg);
    assert.equal(toolMsg.tool_call_id, 'call_trend_1');
    assert.ok(toolMsg.content.includes('"trendScore":95'));
  });

  it('should enforce in-flight session mutex (SESSION_BUSY 409)', async () => {
    let resolveFirst;
    const mockLlm = {
      chatWithTools: () => new Promise(res => { resolveFirst = res; })
    };

    const runner = new AgentRunner({
      toolExecutor: executor,
      registry,
      llmClient: mockLlm,
      sessionStore
    });

    const firstRunPromise = runner.start({
      sessionId: 'test_session_mutex',
      userPrompt: '慢任务'
    });

    // 立即发起同 session 的第二次调用
    await assert.rejects(
      async () => {
        await runner.start({
          sessionId: 'test_session_mutex',
          userPrompt: '并发请求'
        });
      },
      (err) => err.code === 'SESSION_BUSY'
    );

    // 解锁第一个
    resolveFirst({ message: { role: 'assistant', content: '完成了' } });
    await firstRunPromise;
  });

  it('should stop and exit when external AbortSignal is triggered', async () => {
    const abortController = new AbortController();
    const mockLlm = {
      chatWithTools: async () => {
        // 模拟长耗时，中途取消
        abortController.abort();
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
    };

    const runner = new AgentRunner({
      toolExecutor: executor,
      registry,
      llmClient: mockLlm,
      sessionStore
    });

    let abortedEmitted = false;
    runner.on('aborted', () => { abortedEmitted = true; });

    const session = await runner.start({
      sessionId: 'test_session_abort',
      userPrompt: '取消测试',
      abortSignal: abortController.signal
    });

    assert.equal(session.status, 'aborted');
    assert.equal(abortedEmitted, true);
  });

  it('should support parameter self-correction when tool validation fails', async () => {
    registry.register({
      id: 'math.divide',
      mcpName: 'math_divide',
      version: '1.0.0',
      description: '除法计算',
      inputSchema: z.object({
        divisor: z.number().positive('除数必须为正数')
      }),
      policy: { risk: 'low', approval: 'never', sideEffect: 'none', resourceKeys: [], platforms: [] },
      execute: async ({ divisor }) => ({ ok: true, result: 100 / divisor })
    });

    let turn = 0;
    const mockLlm = {
      chatWithTools: async () => {
        turn++;
        if (turn === 1) {
          // 第 1 轮：模型传入错误参数 divisor = -5 (引发 Zod 校验失败)
          return {
            message: {
              role: 'assistant',
              content: '正在计算...',
              tool_calls: [{
                id: 'call_math_1',
                type: 'function',
                function: { name: 'math_divide', arguments: '{"divisor":-5}' }
              }]
            }
          };
        }
        if (turn === 2) {
          // 第 2 轮：模型读取到参数错误提示后，自愈并纠正参数 divisor = 5
          return {
            message: {
              role: 'assistant',
              content: '已修正参数为正数，重新计算...',
              tool_calls: [{
                id: 'call_math_2',
                type: 'function',
                function: { name: 'math_divide', arguments: '{"divisor":5}' }
              }]
            }
          };
        }
        return {
          message: {
            role: 'assistant',
            content: '计算结果为 20。'
          }
        };
      }
    };

    const runner = new AgentRunner({
      toolExecutor: executor,
      registry,
      llmClient: mockLlm,
      sessionStore
    });

    const errors = [];
    runner.on('tool:error', e => errors.push(e));

    const session = await runner.start({
      sessionId: 'test_session_self_correction',
      userPrompt: '计算 100 除以 5'
    });

    assert.equal(session.status, 'completed');
    assert.equal(session.turnCount, 3);
    assert.equal(errors.length, 1);
    assert.ok(errors[0].error.error.includes('除数必须为正数'));
  });

  it('should trip circuit breaker on consecutive identical tool errors', async () => {
    registry.register({
      id: 'broken.tool',
      mcpName: 'broken_tool',
      version: '1.0.0',
      description: '测试失败工具',
      inputSchema: z.object({ value: z.string() }),
      policy: { risk: 'low', approval: 'never', sideEffect: 'none', resourceKeys: [], platforms: [] },
      execute: async () => {
        const err = new Error('外部不可达');
        err.code = 'EXTERNAL_UNREACHABLE';
        throw err;
      }
    });

    const mockLlm = {
      chatWithTools: async () => ({
        message: {
          role: 'assistant',
          content: '尝试调用...',
          tool_calls: [{
            id: 'call_fail',
            type: 'function',
            function: { name: 'broken_tool', arguments: '{"value":"test"}' }
          }]
        }
      })
    };

    const runner = new AgentRunner({
      toolExecutor: executor,
      registry,
      llmClient: mockLlm,
      sessionStore
    });

    const session = await runner.start({
      sessionId: 'test_session_circuit_breaker',
      userPrompt: '连续报错测试',
      maxTurns: 10
    });

    // 不会刷满 10 轮，连续 2 次相同错误立即熔断
    assert.equal(session.status, 'failed');
    assert.equal(session.turnCount, 2);
    assert.ok(session.failureReason.includes('连续发生相同参数错误已熔断'));
  });

  it('should suspend and emit ReviewCard when workflow hits needs_review, and resume seamlessly', async () => {
    let workflowStatus = 'needs_review';

    registry.register({
      id: 'workflow.status_mock',
      mcpName: 'workflow_status_mock',
      version: '1.0.0',
      description: '工作流状态',
      inputSchema: z.object({ runId: z.string() }),
      policy: { risk: 'low', approval: 'never', sideEffect: 'read', resourceKeys: [], platforms: [] },
      execute: async ({ runId }) => ({
        ok: true,
        runId,
        status: workflowStatus,
        currentStep: 'keywordReview',
        summary: '关键词挖掘已完成，待人工勾选',
        candidateCount: 15,
        pendingReview: { stepId: 'keywordReview', version: 1 }
      })
    });

    let turn = 0;
    const mockLlm = {
      chatWithTools: async () => {
        turn++;
        if (turn === 1) {
          return {
            message: {
              role: 'assistant',
              content: '正在查询选品工作流状态...',
              tool_calls: [{
                id: 'call_wf_1',
                type: 'function',
                function: { name: 'workflow_status_mock', arguments: '{"runId":"run_101"}' }
              }]
            }
          };
        }
        return {
          message: {
            role: 'assistant',
            content: '人工复核已通过，继续推进后续选品上架。'
          }
        };
      }
    };

    const runner = new AgentRunner({
      toolExecutor: executor,
      registry,
      llmClient: mockLlm,
      sessionStore
    });

    let suspendedEvent = null;
    runner.on('suspended', e => { suspendedEvent = e; });

    // 1. 首次运行：命中 needs_review，会话挂起
    const session = await runner.start({
      sessionId: 'test_session_hitl',
      userPrompt: '推进 run_101'
    });

    assert.equal(session.status, 'suspended');
    assert.ok(suspendedEvent);
    assert.equal(suspendedEvent.card.type, 'ReviewCard');
    assert.equal(suspendedEvent.card.stepId, 'keywordReview');
    assert.equal(suspendedEvent.card.runId, 'run_101');
    assert.equal(suspendedEvent.card.candidateCount, 15);

    // 2. 模拟用户在前端确认复核后，恢复该会话
    workflowStatus = 'completed';
    const resumedSession = await runner.resume({
      sessionId: 'test_session_hitl',
      userMessage: '人工复核已通过，勾选了前 5 个高转化关键词，请继续。'
    });

    assert.equal(resumedSession.status, 'completed');
    assert.equal(resumedSession.turnCount, 2);
    assert.equal(resumedSession.suspension, null);
  });

  it('should suspend and emit ApprovalCard when operation requires high-risk execution approval (ADR D8)', async () => {
    registry.register({
      id: 'distribution.publish',
      mcpName: 'distribution_publish',
      version: '1.0.0',
      description: '批量铺货上架',
      inputSchema: z.object({ runId: z.string() }),
      policy: { risk: 'high', approval: 'always', sideEffect: 'write', resourceKeys: [], platforms: [] },
      execute: async () => ({
        status: 'needs_approval',
        runId: 'run_publish_88',
        approvalId: 'app_pub_88',
        grantToken: 'tok_grant_88',
        actionType: 'distribution.publish',
        inputDigest: 'sha256:digest88',
        productCount: 10,
        title: '外部写操作高危授权确认'
      })
    });

    const mockLlm = {
      chatWithTools: async () => ({
        message: {
          role: 'assistant',
          content: '正在提交外部铺货...',
          tool_calls: [{
            id: 'call_pub_1',
            type: 'function',
            function: { name: 'distribution_publish', arguments: '{"runId":"run_publish_88"}' }
          }]
        }
      })
    };

    const runner = new AgentRunner({
      toolExecutor: executor,
      registry,
      llmClient: mockLlm,
      sessionStore
    });

    let suspendedEvent = null;
    runner.on('suspended', e => { suspendedEvent = e; });

    const session = await runner.start({
      sessionId: 'test_session_approval',
      userPrompt: '发布商品到店铺'
    });

    assert.equal(session.status, 'suspended');
    assert.ok(suspendedEvent);
    assert.equal(suspendedEvent.card.type, 'ApprovalCard');
    assert.equal(suspendedEvent.card.runId, 'run_publish_88');
    assert.equal(suspendedEvent.card.approvalId, 'app_pub_88');
    assert.equal(suspendedEvent.card.grantToken, 'tok_grant_88');
    assert.equal(suspendedEvent.card.inputDigest, 'sha256:digest88');
    assert.equal(suspendedEvent.card.productCount, 10);
  });
});
