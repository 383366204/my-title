const axios = require('axios');
const { parseJsonFromLLM, retry } = require('../../../core/llm-utils');
const { createLLMClient } = require('../../../core/llm');
const { normalizeKeyword } = require('./seed-store');
const { rejectCandidate } = require('./reject-combinations');
const { checkBannedWords } = require('../../../core/banned-words');

function compactSeeds(seeds, maxSeeds) {
  return (seeds || []).slice(0, maxSeeds).map(seed => ({
    keyword: seed.keyword,
    category: seed.category || '',
    priority: Number(seed.priority || 0),
    type: seed.type || 'expand',
    successCount: Number(seed.successCount || 0),
    failCount: Number(seed.failCount || 0),
    reason: seed.reason || ''
  }));
}

function buildPrompt({ seeds, count, date }) {
  return [
    '你是淘宝蓝海选品方向研究员。请基于给定种子词池，生成适合淘宝/1688铺货验证的候选关键词。',
    '',
    '目标:',
    '- 生成具体商品关键词，不要只给人群词、场景词或泛需求词。',
    '- 优先选择有明确商品形态、明确人群、明确场景、明确功能的长尾词。',
    '- 避免品牌词、IP词、医疗功效词、绝对化宣传词、侵权风险词、过宽泛词。',
    '- 不要输出标题，只输出可用于后续生意参谋验证和1688搜货的关键词。',
    '',
    `日期: ${date}`,
    `需要候选数: ${count}`,
    '种子词池:',
    JSON.stringify(compactSeeds(seeds, 40), null, 2),
    '',
    '请返回严格 JSON，不要解释:',
    JSON.stringify({
      candidates: [
        {
          keyword: '具体商品长尾词',
          category: '类目',
          seed: '来源种子词',
          intent: '搜索意图',
          targetCrowd: '目标人群',
          reason: '推荐理由',
          risk: '主要风险',
          confidence: 80
        }
      ]
    }, null, 2)
  ].join('\n');
}

function normalizeAIItem(item, index) {
  const keyword = normalizeKeyword(item && item.keyword);
  if (!keyword) return null;

  const banned = checkBannedWords(keyword);
  if (!banned.valid) return null;

  const rejected = rejectCandidate(keyword);
  if (rejected.rejected) return null;

  const confidence = Number(item.confidence);
  return {
    keyword,
    seed: normalizeKeyword(item.seed || '') || 'ai',
    category: item.category || '',
    pattern: 'ai-suggest',
    source: 'ai',
    aiRank: index + 1,
    aiConfidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : 60,
    aiReason: item.reason || '',
    aiRisk: item.risk || '',
    intent: item.intent || '',
    targetCrowd: item.targetCrowd || item.target_crowd || ''
  };
}

function normalizeAIResponse(value, maxCandidates) {
  const rows = Array.isArray(value)
    ? value
    : Array.isArray(value && value.candidates)
      ? value.candidates
      : [];

  const seen = new Set();
  const output = [];
  for (const [index, row] of rows.entries()) {
    const item = normalizeAIItem(row, index);
    if (!item || seen.has(item.keyword)) continue;
    seen.add(item.keyword);
    output.push(item);
    if (output.length >= maxCandidates) break;
  }
  return output;
}

async function callChatCompletions(client, messages) {
  const apiBase = String(client.apiBase || '').replace(/\/+$/, '');
  if (!apiBase) throw new Error('LLM apiBase is not configured');
  if (!client.apiKey) throw new Error('LLM apiKey is not configured');

  const body = typeof client._buildChatPayload === 'function'
    ? client._buildChatPayload({ messages, temperature: 0.2 })
    : { model: client.model, messages, temperature: 0.2 };

  const response = await retry(() => axios.post(
    `${apiBase}/chat/completions`,
    body,
    {
      headers: {
        Authorization: `Bearer ${client.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: client._longTimeout || client._timeout || 30000
    }
  ), 1, 1500);

  const content = response.data
    && response.data.choices
    && response.data.choices[0]
    && response.data.choices[0].message
    && response.data.choices[0].message.content;
  if (!content) throw new Error('Invalid LLM response: missing message content');
  return parseJsonFromLLM(String(content));
}

/**
 * Generate keyword candidates with the configured LLM provider.
 * @param {object} options Options.
 * @param {Array<object>} options.seeds Seed pool.
 * @param {number} [options.maxCandidates=80] Max generated candidates.
 * @param {object} [options.llmClient] Optional injected LLM client.
 * @param {string} [options.date] ISO date.
 * @returns {Promise<{candidates:Array<object>, meta:object}>}
 */
async function generateAIKeywordCandidates({ seeds, maxCandidates = 80, llmClient = null, date = new Date().toISOString().slice(0, 10) } = {}) {
  const client = llmClient || createLLMClient();
  const messages = [
    { role: 'system', content: '你是电商选品关键词研究员，只输出严格 JSON。' },
    { role: 'user', content: buildPrompt({ seeds, count: maxCandidates, date }) }
  ];

  if (client && typeof client.generateKeywordCandidates === 'function') {
    const value = await client.generateKeywordCandidates({ seeds, maxCandidates, date, messages });
    return {
      candidates: normalizeAIResponse(value, maxCandidates),
      meta: {
        provider: client.provider || 'mock',
        model: client.model || '',
        requested: maxCandidates
      }
    };
  }

  const parsed = await callChatCompletions(client, messages);
  return {
    candidates: normalizeAIResponse(parsed, maxCandidates),
    meta: {
      provider: client.provider || 'llm',
      model: client.model || '',
      requested: maxCandidates
    }
  };
}

module.exports = {
  buildPrompt,
  generateAIKeywordCandidates,
  normalizeAIResponse
};
