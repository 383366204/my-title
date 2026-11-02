/**
 * @file agent-api.js
 * @description Agent 对话与 LLM 动态配置 API 客户端
 * 对接 PR-08 后端运行时端点 (/api/runtime/*)
 */

import { requestJson, requestPayload } from './http.js';

export const getLlmSettings = () => requestJson('/api/runtime/llm/settings');

export const saveLlmSettings = (settings) => requestJson('/api/runtime/llm/settings', {
  method: 'POST',
  body: settings
});

export const testLlmConnectivity = (candidateConfig) => requestPayload('/api/runtime/llm/test', {
  method: 'POST',
  body: candidateConfig,
  allowApiError: true
});

export const listAgentSessions = () => requestJson('/api/runtime/agent/sessions');

export const getAgentSession = (id) => requestJson(`/api/runtime/agent/sessions/${encodeURIComponent(id)}`);

export const resumeAgentSession = (id, userMessage) => requestJson(`/api/runtime/agent/sessions/${encodeURIComponent(id)}/resume`, {
  method: 'POST',
  body: { userMessage }
});

/**
 * 流式发送 Agent 消息 (基于 fetch ReadableStream 解析 SSE 数据流)
 * @param {object} options
 * @param {string} options.sessionId 会话 ID
 * @param {string} options.userPrompt 用户自然语言指令
 * @param {AbortSignal} [options.signal] 中止控制
 * @param {(event: { type: string, [key: string]: any }) => void} options.onEvent 接收单条事件
 * @returns {Promise<void>}
 */
export async function streamAgentChat({ sessionId, userPrompt, signal, onEvent }) {
  const response = await fetch('/api/runtime/agent/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream'
    },
    body: JSON.stringify({
      sessionId,
      userPrompt,
      stream: true
    }),
    signal
  });

  if (!response.ok) {
    let errorMsg = `Agent 请求失败 (${response.status})`;
    try {
      const errJson = await response.json();
      errorMsg = errJson.error || errorMsg;
    } catch (_) {}
    throw new Error(errorMsg);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // 保留未完成的行片段

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6).trim();
          if (!jsonStr) continue;
          try {
            const event = JSON.parse(jsonStr);
            onEvent?.(event);
          } catch (_) {
            // 忽略非标准行
          }
        }
      }
    }

    if (buffer.trim().startsWith('data: ')) {
      try {
        const event = JSON.parse(buffer.trim().slice(6).trim());
        onEvent?.(event);
      } catch (_) {}
    }
  } finally {
    reader.releaseLock();
  }
}
