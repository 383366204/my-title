import { useState, useEffect, useRef, useCallback } from 'react';
import {
  streamAgentChat,
  getAgentSession,
  resumeAgentSession,
  getLlmSettings
} from '../../../api/agent-api.js';
import { grantDistributionApproval, rejectDistributionApproval } from '../../../api/distribution-api.js';

const SESSION_STORAGE_KEY = 'ecom_copilot_session_id';

/**
 * @file use-agent-chat.js
 * @description AI 副驾驶对话状态 Hook (处理 SSE 流、深度思考、工具徽章、卡片协议与 F5 状态恢复)
 */
export function useAgentChat({ onSelectStep, onHighlightRow } = {}) {
  const [messages, setMessages] = useState([]);
  const [sessionId, setSessionId] = useState(() => {
    try {
      return localStorage.getItem(SESSION_STORAGE_KEY) || '';
    } catch (_) {
      return '';
    }
  });
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [currentModel, setCurrentModel] = useState('glm-4-flash');

  const abortControllerRef = useRef(null);

  // 初始化加载当前模型配置与历史会话 (F5 恢复)
  useEffect(() => {
    getLlmSettings()
      .then((cfg) => {
        if (cfg?.model) setCurrentModel(cfg.model);
      })
      .catch(() => {});

    if (sessionId) {
      getAgentSession(sessionId)
        .then((res) => {
          if (res?.ok && res.session?.messages?.length > 0) {
            // 将后端持久化的 messages 结构映射为前端富消息结构
            const restored = restoreSessionMessages(res.session);
            setMessages(restored);
          }
        })
        .catch(() => {
          // 会话过期或无效时清空
          setSessionId('');
          try {
            localStorage.removeItem(SESSION_STORAGE_KEY);
          } catch (_) {}
        });
    }
  }, []);

  // 更新 sessionId 并持久化
  const updateSessionId = useCallback((newId) => {
    if (!newId) return;
    setSessionId(newId);
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, newId);
    } catch (_) {}
  }, []);

  // 发送消息
  const sendMessage = useCallback(async (promptText, { contextNodeId, currentRunId } = {}) => {
    if (!promptText || !promptText.trim() || isStreaming) return;

    setError(null);
    const userPrompt = promptText.trim();
    const userMsgId = `usr_${Date.now()}`;
    const assistantMsgId = `ast_${Date.now()}`;

    // 如果附带画布上下文，在底层提示词中附带
    let fullPrompt = userPrompt;
    if (contextNodeId || currentRunId) {
      const meta = [];
      if (contextNodeId) meta.push(`当前选中画布节点: ${contextNodeId}`);
      if (currentRunId) meta.push(`当前工作流运行ID: ${currentRunId}`);
      fullPrompt = `[上下文: ${meta.join('，')}]\n${userPrompt}`;
    }

    const userMessage = {
      id: userMsgId,
      role: 'user',
      content: userPrompt,
      timestamp: new Date().toLocaleTimeString()
    };

    const initialAssistantMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      thinking: '',
      isThinking: false,
      toolCalls: [],
      cards: [],
      timestamp: new Date().toLocaleTimeString()
    };

    setMessages((prev) => [...prev, userMessage, initialAssistantMessage]);
    setIsStreaming(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      await streamAgentChat({
        sessionId: sessionId || undefined,
        userPrompt: fullPrompt,
        signal: abortController.signal,
        onEvent: (event) => {
          if (!event || !event.type) return;

          switch (event.type) {
            case 'session:start':
              if (event.sessionId) {
                updateSessionId(event.sessionId);
              }
              break;

            case 'thinking:chunk':
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? {
                        ...msg,
                        isThinking: true,
                        thinking: (msg.thinking || '') + (event.text || event.chunk || '')
                      }
                    : msg
                )
              );
              break;

            case 'content:chunk':
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? {
                        ...msg,
                        isThinking: false,
                        content: (msg.content || '') + (event.text || event.chunk || '')
                      }
                    : msg
                )
              );
              break;

            case 'tool:call':
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? {
                        ...msg,
                        isThinking: false,
                        toolCalls: [
                          ...(msg.toolCalls || []),
                          {
                            id: event.callId || `call_${Date.now()}`,
                            name: event.name,
                            input: event.input,
                            status: 'running'
                          }
                        ]
                      }
                    : msg
                )
              );
              break;

            case 'tool:result':
              setMessages((prev) =>
                prev.map((msg) => {
                  if (msg.id !== assistantMsgId) return msg;
                  const updatedCalls = (msg.toolCalls || []).map((tc) =>
                    tc.name === event.name && tc.status === 'running'
                      ? {
                          ...tc,
                          result: event.result,
                          durationMs: event.durationMs,
                          status: 'success'
                        }
                      : tc
                  );

                  // 自动检测工具返回中是否包含工作流运行卡片
                  let newCards = [...(msg.cards || [])];
                  if (
                    event.result &&
                    (event.result.runId || event.name.startsWith('workflow_')) &&
                    typeof event.result === 'object'
                  ) {
                    const existingIdx = newCards.findIndex(
                      (c) => c.type === 'WorkflowCard' && c.runId === event.result.runId
                    );
                    const wfCard = {
                      type: 'WorkflowCard',
                      runId: event.result.runId,
                      status: event.result.status,
                      currentStep: event.result.currentStep,
                      message: event.result.message,
                      summary: event.result.summary
                    };
                    if (existingIdx >= 0) {
                      newCards[existingIdx] = wfCard;
                    } else if (wfCard.runId) {
                      newCards.push(wfCard);
                    }
                  }

                  return {
                    ...msg,
                    toolCalls: updatedCalls,
                    cards: newCards
                  };
                })
              );
              break;

            case 'tool:error':
              setMessages((prev) =>
                prev.map((msg) => {
                  if (msg.id !== assistantMsgId) return msg;
                  const updatedCalls = (msg.toolCalls || []).map((tc) =>
                    tc.name === event.name && tc.status === 'running'
                      ? {
                          ...tc,
                          error: event.error,
                          status: 'error'
                        }
                      : tc
                  );
                  return { ...msg, toolCalls: updatedCalls };
                })
              );
              break;

            case 'suspended':
              // 命中 HITL 挂起检查点，添加卡片
              if (event.card) {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMsgId
                      ? {
                          ...msg,
                          isThinking: false,
                          cards: [...(msg.cards || []).filter((c) => c.type !== event.card.type), event.card]
                        }
                      : msg
                  )
                );
              }
              break;

            case 'completed':
            case 'done':
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? {
                        ...msg,
                        isThinking: false,
                        content: msg.content || event.finalMessage || ''
                      }
                    : msg
                )
              );
              break;

            case 'failure':
            case 'error':
              setError(event.error || 'Agent 执行发生异常');
              break;

            default:
              break;
          }
        }
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message || '网络连接或 Agent 服务异常');
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [sessionId, isStreaming, updateSessionId]);

  // 中止当前生成
  const stopStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsStreaming(false);
    }
  }, []);

  // 清空对话 / 开启新会话
  const clearChat = useCallback(() => {
    stopStream();
    setMessages([]);
    setSessionId('');
    setError(null);
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch (_) {}
  }, [stopStream]);

  // 处理业务复核卡片确认
  const handleConfirmReview = useCallback(
    async (card) => {
      if (!sessionId) return;
      try {
        const resumeMessage = `用户已在工作台复核卡片中确认步骤 [${card.stepId || 'review'}] 的初筛建议。请继续推进执行工作流。`;
        await resumeAgentSession(sessionId, resumeMessage);
        // 触发后续流或刷新
        sendMessage('复核已确认，请继续推进后续步骤。');
      } catch (err) {
        setError(`复核推进失败: ${err.message}`);
        throw err;
      }
    },
    [sessionId, sendMessage]
  );

  // 处理高危发布授权
  const handleGrantApproval = useCallback(
    async (card) => {
      try {
        if (card.approvalId && card.grantToken) {
          await grantDistributionApproval({
            runId: card.runId,
            approvalId: card.approvalId,
            grantToken: card.grantToken,
            expectedInputDigest: card.inputDigest
          });
        }
        if (sessionId) {
          await resumeAgentSession(sessionId, '高危外部操作已签署授权，请继续提交发布。');
          sendMessage('高危外部操作已签署授权，请继续提交发布。');
        }
      } catch (err) {
        setError(`授权失败: ${err.message}`);
        throw err;
      }
    },
    [sessionId, sendMessage]
  );

  // 处理高危发布拒绝
  const handleRejectApproval = useCallback(
    async (card) => {
      try {
        if (card.approvalId) {
          await rejectDistributionApproval({
            runId: card.runId,
            approvalId: card.approvalId
          });
        }
        if (sessionId) {
          await resumeAgentSession(sessionId, '用户已拒绝签署外部发布授权，该操作已取消。');
          sendMessage('我已拒绝外部发布授权，请中止或调整该操作。');
        }
      } catch (err) {
        setError(`拒绝操作失败: ${err.message}`);
        throw err;
      }
    },
    [sessionId, sendMessage]
  );

  return {
    messages,
    sessionId,
    isStreaming,
    error,
    currentModel,
    setCurrentModel,
    sendMessage,
    stopStream,
    clearChat,
    handleConfirmReview,
    handleGrantApproval,
    handleRejectApproval
  };
}

/**
 * 辅助函数：将持久化的 Session 数据转换为前端消息流结构
 */
function restoreSessionMessages(session) {
  if (!session || !Array.isArray(session.messages)) return [];

  const result = [];
  let currentAssistant = null;

  for (const raw of session.messages) {
    if (raw.role === 'user') {
      if (currentAssistant) {
        result.push(currentAssistant);
        currentAssistant = null;
      }
      result.push({
        id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        role: 'user',
        content: raw.content || '',
        timestamp: ''
      });
    } else if (raw.role === 'assistant') {
      if (currentAssistant) {
        result.push(currentAssistant);
      }
      currentAssistant = {
        id: `ast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        role: 'assistant',
        content: raw.content || '',
        thinking: '',
        toolCalls: [],
        cards: [],
        timestamp: ''
      };
      if (Array.isArray(raw.tool_calls)) {
        for (const tc of raw.tool_calls) {
          currentAssistant.toolCalls.push({
            id: tc.id,
            name: tc.function?.name,
            input: tc.function?.arguments,
            status: 'success'
          });
        }
      }
    } else if (raw.role === 'tool' && currentAssistant) {
      // 匹配工具结果
      const call = currentAssistant.toolCalls.find((c) => c.id === raw.tool_call_id);
      if (call) {
        call.result = raw.content;
      }
    }
  }

  if (currentAssistant) {
    // 检查是否有未完成的挂起卡片
    if (session.status === 'suspended' && session.suspension?.card) {
      currentAssistant.cards.push(session.suspension.card);
    }
    result.push(currentAssistant);
  }

  return result;
}
