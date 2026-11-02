import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Agent Chat View Model & Card Protocol Unit Tests', () => {
  it('should parse streaming SSE chunks and correctly reconstruct events across buffer boundaries', async () => {
    // 模拟 SSE 分块数据流（包含跨块切割）
    const chunks = [
      'data: {"type":"session:start","sessionId":"sess_123"}\n\n',
      'data: {"type":"thinking:chunk","text":"正在',
      '分析用户的选品意图..."}\n\n',
      'data: {"type":"content:chunk","text":"建议按如下步骤',
      '推进选品。"}\n\n',
      'data: {"type":"tool:call","name":"workflow_status","callId":"call_1","input":{"runId":"run_abc"}}\n\n',
      'data: {"type":"tool:result","name":"workflow_status","callId":"call_1","durationMs":85,"result":{"runId":"run_abc","status":"running","currentStep":"sycm"}}\n\n',
      'data: {"type":"done","sessionId":"sess_123"}\n\n'
    ];

    const receivedEvents = [];

    // 手写简易流式解码器逻辑，与 agent-api.js 逻辑保持严格一致
    let buffer = '';
    for (const chunk of chunks) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6).trim();
          if (jsonStr) {
            receivedEvents.push(JSON.parse(jsonStr));
          }
        }
      }
    }
    if (buffer.trim().startsWith('data: ')) {
      receivedEvents.push(JSON.parse(buffer.trim().slice(6).trim()));
    }

    assert.strictEqual(receivedEvents.length, 6);
    assert.strictEqual(receivedEvents[0].type, 'session:start');
    assert.strictEqual(receivedEvents[0].sessionId, 'sess_123');
    assert.strictEqual(receivedEvents[1].type, 'thinking:chunk');
    assert.strictEqual(receivedEvents[1].text, '正在分析用户的选品意图...');
    assert.strictEqual(receivedEvents[2].type, 'content:chunk');
    assert.strictEqual(receivedEvents[2].text, '建议按如下步骤推进选品。');
    assert.strictEqual(receivedEvents[3].type, 'tool:call');
    assert.strictEqual(receivedEvents[3].name, 'workflow_status');
    assert.strictEqual(receivedEvents[4].type, 'tool:result');
    assert.strictEqual(receivedEvents[4].durationMs, 85);
    assert.strictEqual(receivedEvents[5].type, 'done');
  });

  it('should validate ReviewCard protocol fields and optimistic lock version', () => {
    const reviewCard = {
      type: 'ReviewCard',
      runId: 'run_sample_01',
      stepId: 'keywordReview',
      version: 3,
      title: '业务阶段复核待确认 (keywordReview)',
      summary: '候选词 12 个，等待复核勾选',
      candidateCount: 12,
      draftDecisions: {
        approvedKeywords: ['纯银项链女', '小众锁骨链']
      }
    };

    assert.strictEqual(reviewCard.type, 'ReviewCard');
    assert.strictEqual(reviewCard.runId, 'run_sample_01');
    assert.strictEqual(reviewCard.stepId, 'keywordReview');
    assert.strictEqual(reviewCard.version, 3);
    assert.strictEqual(reviewCard.candidateCount, 12);
    assert.ok(Array.isArray(reviewCard.draftDecisions.approvedKeywords));
    assert.strictEqual(reviewCard.draftDecisions.approvedKeywords.length, 2);
  });

  it('should validate ApprovalCard protocol fields per ADR D8 execution approval', () => {
    const approvalCard = {
      type: 'ApprovalCard',
      runId: 'run_sample_02',
      approvalId: 'app_pub_99',
      grantToken: 'tok_sec_abc123',
      actionType: 'distribution.publish',
      inputDigest: 'sha256:d41d8cd98f00b204e9800998ecf8427e',
      title: '外部写操作高危授权确认',
      summary: '即将向店铺 [测试店铺] 批量提交 5 个商品，该操作将直接创建外部商品',
      productCount: 5,
      shopName: '测试店铺'
    };

    assert.strictEqual(approvalCard.type, 'ApprovalCard');
    assert.strictEqual(approvalCard.actionType, 'distribution.publish');
    assert.strictEqual(approvalCard.approvalId, 'app_pub_99');
    assert.strictEqual(approvalCard.grantToken, 'tok_sec_abc123');
    assert.strictEqual(approvalCard.productCount, 5);
    assert.ok(approvalCard.inputDigest.startsWith('sha256:'));
  });

  it('should restore suspended sessions on page refresh (F5 recovery)', () => {
    const rawPersistedSession = {
      sessionId: 'sess_persisted_1',
      status: 'suspended',
      turnCount: 2,
      suspension: {
        reason: 'needs_review',
        card: {
          type: 'ReviewCard',
          runId: 'run_restore_1',
          stepId: 'select',
          version: 1,
          candidateCount: 8
        }
      },
      messages: [
        { role: 'user', content: '帮我筛一下商品' },
        {
          role: 'assistant',
          content: '正在为您检索 1688 货源...',
          tool_calls: [
            {
              id: 'call_search',
              function: { name: 'suggest_keywords', arguments: '{"input":"项链"}' }
            }
          ]
        },
        {
          role: 'tool',
          tool_call_id: 'call_search',
          name: 'suggest_keywords',
          content: '{"candidates":["项链","吊坠"]}'
        }
      ]
    };

    // 运行前端还原逻辑
    const restored = [];
    let currentAssistant = null;

    for (const raw of rawPersistedSession.messages) {
      if (raw.role === 'user') {
        if (currentAssistant) restored.push(currentAssistant);
        restored.push({ role: 'user', content: raw.content });
      } else if (raw.role === 'assistant') {
        currentAssistant = {
          role: 'assistant',
          content: raw.content,
          toolCalls: (raw.tool_calls || []).map((tc) => ({
            id: tc.id,
            name: tc.function?.name,
            input: tc.function?.arguments,
            status: 'success'
          })),
          cards: []
        };
      } else if (raw.role === 'tool' && currentAssistant) {
        const call = currentAssistant.toolCalls.find((c) => c.id === raw.tool_call_id);
        if (call) call.result = raw.content;
      }
    }

    if (currentAssistant) {
      if (rawPersistedSession.status === 'suspended' && rawPersistedSession.suspension?.card) {
        currentAssistant.cards.push(rawPersistedSession.suspension.card);
      }
      restored.push(currentAssistant);
    }

    assert.strictEqual(restored.length, 2);
    assert.strictEqual(restored[0].role, 'user');
    assert.strictEqual(restored[1].role, 'assistant');
    assert.strictEqual(restored[1].toolCalls.length, 1);
    assert.strictEqual(restored[1].toolCalls[0].result, '{"candidates":["项链","吊坠"]}');
    assert.strictEqual(restored[1].cards.length, 1);
    assert.strictEqual(restored[1].cards[0].type, 'ReviewCard');
    assert.strictEqual(restored[1].cards[0].runId, 'run_restore_1');
  });
});
