/**
 * @file suggest-tool.js
 * @description keyword.suggest 原子工具定义
 * 符合 ADR v1.0 (D3, D4)
 */

'use strict';

const { z } = require('zod');
const { suggestAndVerify, VALID_STRATEGIES } = require('./keyword-suggester');
const { extractSycmData } = require('../../sycm-research/src/sycm-cdp-extractor');
const { normalizeSycmMetrics } = require('../../sycm-research/src/metric-parser');

/**
 * 默认生意参谋验证适配器
 * @param {string[]} candidates
 * @param {Object} options
 * @returns {Promise<Object>}
 */
async function defaultVerifyKeywordsAdapter(candidates, options = {}) {
  const { port = 9222, maxCandidates = 5, onProgress = () => {}, leaseManager, extractSycmDataFn } = options;
  const extractor = typeof extractSycmDataFn === 'function' ? extractSycmDataFn : extractSycmData;
  const keywordMap = new Map();
  const errors = [];
  let verified = 0;
  let failed = 0;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    onProgress(`正在验证关键词 (${i + 1}/${candidates.length}): ${candidate}`);
    try {
      const result = await extractor(candidate, {
        mode: 'hot',
        port,
        leaseManager,
        onProgress: (msg) => onProgress(`[SYCM ${candidate}] ${msg}`)
      });

      if (!result || !Array.isArray(result.data) || result.data.length === 0) {
        failed++;
        continue;
      }

      verified++;
      for (const item of result.data) {
        const normalized = normalizeSycmMetrics(item);
        const kw = item.keyword || candidate;
        const searchPopularity = Number(normalized.searchPopularity) || 0;
        if (searchPopularity >= 20 && !keywordMap.has(kw)) {
          keywordMap.set(kw, {
            keyword: kw,
            searchPopularity,
            clickRate: Number(normalized.clickRate) || 0,
            conversionRate: Number(normalized.conversionRate) || 0,
            demandSupplyRatio: Number(normalized.demandSupplyRatio) || 0,
            tmallClickShare: Number(normalized.tmallClickShare) || 0
          });
        }
      }
    } catch (err) {
      failed++;
      errors.push({ keyword: candidate, error: err.message });
    }
  }

  const sorted = Array.from(keywordMap.values())
    .sort((a, b) => b.searchPopularity - a.searchPopularity)
    .slice(0, maxCandidates);

  return {
    ok: true,
    keywords: sorted,
    verified,
    failed,
    errors
  };
}

const inputSchema = z.object({
  strategy: z.enum(['crowd', 'scene', 'season', 'problem', 'industry', 'holiday', 'gift', 'cross', 'guochao', 'trend', 'niche', 'emotion', 'price']).describe('选词策略'),
  input: z.string().optional().describe('策略输入'),
  max_candidates: z.number().int().min(1).max(20).optional().default(5).describe('最大候选词数'),
  port: z.number().int().positive().optional().default(9222).describe('Chrome 端口'),
  sycm_verify: z.boolean().optional().default(false).describe('是否启用生意参谋 SYCM 验证')
});

/** @type {import('../../../core/runtime/contracts').ToolDefinition} */
const suggestTool = {
  id: 'keyword.suggest',
  mcpName: 'suggest_keywords',
  version: '1.0.0',
  description: '根据营销与人群策略通过 LLM 推荐候选关键词，可按需启用生意参谋验证',
  inputSchema,
  policy: {
    risk: 'low',
    approval: 'never',
    sideEffect: 'none',
    resourceKeys: [], // 默认无需物理锁；若启用 sycm_verify，由底层 extractor 自行按需持有
    platforms: []
  },
  execute: async (input, ctx) => {
    ctx = ctx || {};
    const verifyFn = input.sycm_verify
      ? (cands, opts) => (typeof ctx.verifyKeywords === 'function' ? ctx.verifyKeywords : defaultVerifyKeywordsAdapter)(cands, {
          ...opts,
          extractSycmDataFn: ctx.extractSycmData,
          leaseManager: ctx.leaseManager
        })
      : undefined;

    return await suggestAndVerify({
      strategy: input.strategy,
      input: input.input || '',
      maxCandidates: input.max_candidates || 5,
      port: input.port || 9222,
      skipSycm: !input.sycm_verify,
      verifyFn,
      suggestKeywordsFn: ctx.suggestKeywords,
      leaseManager: ctx.leaseManager,
      onProgress: (msg) => {
        if (ctx.logger && typeof ctx.logger.info === 'function') {
          ctx.logger.info(`[keyword.suggest] ${msg}`);
        }
      }
    });
  }
};

module.exports = {
  suggestTool,
  defaultVerifyKeywordsAdapter
};
