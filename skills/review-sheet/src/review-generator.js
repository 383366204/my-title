'use strict';

const axios = require('axios');
const { createLLMClient, getLLMProviderInfo } = require('../../../core/llm');
const { parseJsonFromLLM } = require('../../../core/llm-utils');

/**
 * 清理用户提供的真实体验要点。
 * @param {unknown} value 原始体验文本。
 * @returns {string} 可用于生成的事实文本。
 */
function normalizeExperienceNotes(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

/**
 * AI 不可用时只整理用户原文，不补充任何事实。
 * @param {unknown} notes 真实体验要点。
 * @param {number} [maxLength] 最大长度。
 * @returns {string} 可编辑评价草稿。
 */
function factualFallbackReview(notes, maxLength = 100) {
  const text = normalizeExperienceNotes(notes);
  if (!text) return '';
  const limit = Math.max(15, Math.min(500, Number(maxLength) || 100));
  const trimmed = text.slice(0, limit).replace(/[，、；;：:\s]+$/u, '');
  return trimmed && !/[。！？!?]$/u.test(trimmed) ? `${trimmed}。` : trimmed;
}

/**
 * 判断评价是否复述商品标题。
 * @param {string} text 评价内容。
 * @param {string} title 商品标题。
 * @returns {boolean} 是否引用标题或标题前缀。
 */
function mentionsTitle(text, title) {
  const review = String(text || '').replace(/\s+/g, '');
  const subject = String(title || '').replace(/\s+/g, '');
  if (!review || subject.length < 10) return false;
  if (review.includes(subject)) return true;
  return review.includes(subject.slice(0, 12));
}

/**
 * 根据真实体验要点整理一批评价。
 * @param {Array<object>} products 带 title 和 experienceNotes 的商品。
 * @param {object} [options] LLM 与文案选项。
 * @returns {Promise<string[]|null>} 配置可用时返回评价数组，否则返回 null。
 */
async function llmReviews(products, options = {}) {
  const llmInfo = getLLMProviderInfo({ provider: options.llmProvider });
  if (!llmInfo.configured || options.useAI === false) return null;
  const client = createLLMClient({ provider: options.llmProvider });
  const input = products.map((product, index) => ({
    index: index + 1,
    title: String(product.title || ''),
    experienceNotes: normalizeExperienceNotes(product.experienceNotes)
  }));
  const avoid = (Array.isArray(options.avoidReviews) ? options.avoidReviews : [])
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .slice(-30);
  const request = typeof options.request === 'function' ? options.request : axios.post;
  const response = await request(
    `${client.apiBase}/chat/completions`,
    client._buildChatPayload({
      messages: [
        {
          role: 'system',
          content: '你负责整理用户真实填写的商品体验。只能改写 experienceNotes 中明确存在的事实，不得补充物流速度、材质、功效、尺寸、服务或其他未经用户提供的信息。商品标题只用于理解品类，严禁复述标题或拼接标题关键词。表达自然、克制，各条句式不同。体验要点为空时必须返回空字符串。只返回与输入等长的 JSON 字符串数组。'
        },
        {
          role: 'user',
          content: `语气：${options.reviewTone || '自然真实'}\n目标长度：约 ${Number(options.reviewLength || 35)} 字\n需要避免与这些已用表达近似：${JSON.stringify(avoid)}\n输入：${JSON.stringify(input)}`
        }
      ],
      temperature: 0.55
    }),
    {
      headers: { Authorization: `Bearer ${client.apiKey}`, 'Content-Type': 'application/json' },
      timeout: client._longTimeout || 60000
    }
  );
  const parsed = parseJsonFromLLM(response.data?.choices?.[0]?.message?.content || '');
  if (!Array.isArray(parsed) || parsed.length !== products.length) throw new Error('评价生成数量与商品数量不一致');
  return parsed.map(value => String(value || '').trim());
}

module.exports = {
  factualFallbackReview,
  llmReviews,
  mentionsTitle,
  normalizeExperienceNotes
};
