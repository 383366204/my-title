/**
 * @file suggest-tool.js
 * @description keyword.suggest 原子工具定义
 * 符合 ADR v1.0 (D3, D4)
 */

'use strict';

const { z } = require('zod');
const { suggestAndVerify, VALID_STRATEGIES } = require('./keyword-suggester');

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
    return await suggestAndVerify({
      strategy: input.strategy,
      input: input.input || '',
      maxCandidates: input.max_candidates || 5,
      port: input.port || 9222,
      skipSycm: !input.sycm_verify,
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
  suggestTool
};
