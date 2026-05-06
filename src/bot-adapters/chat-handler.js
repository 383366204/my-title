"use strict";

// GLM chat handler for WeChat bot
// Exports:
// - chat(userMessage, glmClient): Promise<string>
// - isProductIntent(userMessage): boolean

/**
 * Determine whether the user message expresses product-related intent.
 * @param {string} userMessage
 * @returns {boolean}
 */
function isProductIntent(userMessage) {
  if (typeof userMessage !== 'string') return false;
  const msg = userMessage;
  // keywords indicating product selection / sourcing intent
  const keywords = [
    '选品', '找货', '搜商品', '进货', '铺货', '上架',
    '标题', '生成标题', '商品', '产品', '货源'
  ];
  const lower = msg.toLowerCase();
  // 仅基于关键字存在性判断，忽略大小写
  return keywords.some(k => lower.includes(k.toLowerCase()));
}

/**
 * GLM chat interface for WeChat, using the provided glmClient instance.
 * - Truncates input to 1000 chars
 * - Sends a system prompt to guide GLM behavior
 * - Returns plain text response from GLM
 * - On error, returns a user-friendly fallback message
 *
 * @param {string} userMessage
 * @param {Object} glmClient - GLM client instance (provided by the caller)
 * @returns {Promise<string>}
 */
async function chat(userMessage, glmClient) {
  // 1) normalize and truncate input
  let msg = typeof userMessage === 'string' ? userMessage : String(userMessage);
  if (msg.length > 1000) msg = msg.slice(0, 1000);

  // 2) system prompt (must be included in the GLM call)
  const systemPrompt =
    '你是my-title选品助手，专注于为电商选品场景提供对话支持。' +
    ' 了解 /选品 /搜索 /分析 /help 命令。请将回复控制在200字以内。' +
    ' 当用户提到选品/找货/搜商品等意图时，引导用户使用 /选品 命令，禁止自动执行任何命令。';

  const payload = {
    model: glmClient?.model || 'glm-4.7-flash',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: msg }
    ],
    temperature: 0.7,
    max_tokens: 300
  };

  try {
    const axios = require('axios');
    const httpRes = await axios.post(
      `${glmClient.apiBase.replace(/\/$/, '')}/chat/completions`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${glmClient.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );
    const d = httpRes?.data ?? {};
    return d?.choices?.[0]?.message?.content ?? '';
  } catch (err) {
    return '暂时无法回复，请稍后再试';
  }
}

module.exports = {
  /**
   * @param {string} userMessage
   * @param {Object} glmClient
   * @returns {Promise<string>}
   */
  chat,
  /**
   * @param {string} userMessage
   * @returns {boolean}
   */
  isProductIntent
};
