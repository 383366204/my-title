/**
 * @file generate-tool.js
 * @description title.generate 原子工具定义
 * 符合 ADR v1.0 (D3, D4)
 */

'use strict';

const { z } = require('zod');
const { generateTitlePipeline } = require('./pipeline');

const inputSchema = z.object({
  keyword: z.string().min(1, 'keyword 不能为空').describe('商品关键词'),
  length: z.number().int().positive().optional().default(60).describe('标题最大字符数'),
  keyword_data: z.string().optional().describe('生意参谋搜索分析数据'),
  sycm_auto: z.boolean().optional().default(false).describe('是否自动查询生意参谋'),
  research: z.boolean().optional().default(false).describe('推荐研究关键词模式'),
  use_image_search: z.boolean().optional().default(false).describe('是否启用淘宝图搜'),
  min_price: z.number().optional().default(0).describe('最低价格过滤'),
  max_price: z.number().optional().default(0).describe('最高价格过滤'),
  count: z.number().int().optional().default(3).describe('生成标题候选数量')
});

/** @type {import('../../../core/runtime/contracts').ToolDefinition} */
const generateTool = {
  id: 'title.generate',
  mcpName: 'generate_title',
  version: '1.0.0',
  description: '电商选品标题生成工具：核心词提取、1688搜索、商品打分过滤与三段式SEO标题生成',
  inputSchema,
  policy: {
    risk: 'low',
    approval: 'never',
    sideEffect: 'none',
    resourceKeys: [],
    platforms: ['1688']
  },
  execute: async (input, ctx) => {
    const pipelineOptions = {
      length: input.length || 60,
      keywordData: input.keyword_data,
      sycmAuto: input.sycm_auto,
      research: input.research || false,
      useImageSearch: input.use_image_search || false,
      minPrice: input.min_price || 0,
      maxPrice: input.max_price || 0,
      count: input.count || 3,
      leaseManager: ctx.leaseManager,
      onProgress: (msg) => {
        if (ctx.logger && typeof ctx.logger.info === 'function') {
          ctx.logger.info(`[title.generate] ${msg}`);
        }
      }
    };

    return await generateTitlePipeline(input.keyword, pipelineOptions);
  }
};

module.exports = {
  generateTool
};
