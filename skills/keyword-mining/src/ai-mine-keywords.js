const axios = require('axios');
const { jsonrepair } = require('jsonrepair');
const { parseJsonFromLLM, retry } = require('../../../core/llm-utils');
const { createLLMClient } = require('../../../core/llm');
const { normalizeKeyword } = require('./seed-store');
const { rejectCandidate } = require('./reject-combinations');
const { checkBannedWords } = require('../../../core/banned-words');

const DEFAULT_BATCH_SIZE = 20;

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
    'You are an ecommerce keyword research assistant for Taobao/1688 product mining.',
    'Return strict JSON only. Do not return markdown.',
    '',
    'Rules:',
    '- Generate concrete product long-tail keywords, not broad crowd/scene words.',
    '- Avoid brand, IP, medical, exaggerated, illegal, or risky claims.',
    '- Keywords will be verified by SYCM and searched on 1688 later.',
    '- Keep each keyword concise and searchable.',
    '',
    `Date: ${date}`,
    `Candidate count: ${count}`,
    'Seed pool:',
    JSON.stringify(compactSeeds(seeds, 40), null, 2),
    '',
    'Return this JSON shape:',
    JSON.stringify({
      candidates: [
        {
          keyword: 'specific product keyword',
          category: 'category',
          seed: 'source seed',
          intent: 'search intent',
          targetCrowd: 'target crowd',
          reason: 'why it may be useful',
          risk: 'main risk',
          confidence: 70
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
    : value && value.keyword
      ? [value]
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

function salvageCandidateObjects(text) {
  const output = [];
  const source = String(text || '');
  const objectPattern = /\{[^{}]*"keyword"\s*:\s*"[^"]+"[^{}]*\}/g;
  for (const match of source.matchAll(objectPattern)) {
    try {
      output.push(JSON.parse(match[0]));
    } catch (_) {
      try {
        output.push(JSON.parse(jsonrepair(match[0])));
      } catch (_) {
        // Keep rescuing later objects.
      }
    }
  }
  return { candidates: output };
}

function parseAIJson(text) {
  try {
    const parsed = parseJsonFromLLM(String(text || ''));
    if (parsed && parsed.keyword) {
      const salvaged = salvageCandidateObjects(text);
      return { candidates: [parsed, ...salvaged.candidates.slice(1)] };
    }
    return parsed;
  } catch (primaryError) {
    try {
      return JSON.parse(jsonrepair(String(text || '')));
    } catch (_) {
      const salvaged = salvageCandidateObjects(text);
      if (salvaged.candidates.length > 0) return salvaged;
      throw primaryError;
    }
  }
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
  return parseAIJson(String(content));
}

function buildBatches(total, batchSize) {
  const size = Math.max(1, Number(batchSize || DEFAULT_BATCH_SIZE));
  const batches = [];
  let remaining = Math.max(1, Number(total || 0));
  while (remaining > 0) {
    const count = Math.min(size, remaining);
    batches.push(count);
    remaining -= count;
  }
  return batches;
}

async function generateOneBatch({ client, seeds, count, date, batchIndex }) {
  const messages = [
    { role: 'system', content: 'You are an ecommerce product keyword researcher. Output strict JSON only.' },
    { role: 'user', content: buildPrompt({ seeds, count, date }) }
  ];

  if (client && typeof client.generateKeywordCandidates === 'function') {
    return client.generateKeywordCandidates({ seeds, maxCandidates: count, date, messages, batchIndex });
  }
  return callChatCompletions(client, messages);
}

/**
 * Generate keyword candidates with the configured LLM provider.
 * @param {object} options Options.
 * @param {Array<object>} options.seeds Seed pool.
 * @param {number} [options.maxCandidates=80] Max generated candidates.
 * @param {object} [options.llmClient] Optional injected LLM client.
 * @param {string} [options.date] ISO date.
 * @param {number} [options.batchSize=20] Max candidates requested per LLM call.
 * @returns {Promise<{candidates:Array<object>, meta:object}>}
 */
async function generateAIKeywordCandidates({
  seeds,
  maxCandidates = 80,
  llmClient = null,
  date = new Date().toISOString().slice(0, 10),
  batchSize = DEFAULT_BATCH_SIZE
} = {}) {
  const client = llmClient || createLLMClient();
  const batches = buildBatches(maxCandidates, batchSize);
  const values = [];
  const failedBatches = [];

  for (let index = 0; index < batches.length; index += 1) {
    try {
      values.push(await generateOneBatch({
        client,
        seeds,
        count: batches[index],
        date,
        batchIndex: index + 1
      }));
    } catch (error) {
      failedBatches.push({ batch: index + 1, error: error.message });
    }
  }

  if (values.length === 0 && failedBatches.length > 0) {
    throw new Error(`AI keyword generation failed for all batches: ${failedBatches.map(item => item.error).join('; ')}`);
  }

  const merged = {
    candidates: values.flatMap(value => {
      if (Array.isArray(value)) return value;
      if (value && Array.isArray(value.candidates)) return value.candidates;
      return [];
    })
  };

  return {
    candidates: normalizeAIResponse(merged, maxCandidates),
    meta: {
      provider: client.provider || 'llm',
      model: client.model || '',
      requested: maxCandidates,
      batchSize,
      batches: batches.length,
      failedBatches
    }
  };
}

module.exports = {
  buildPrompt,
  generateAIKeywordCandidates,
  normalizeAIResponse,
  parseAIJson
};
