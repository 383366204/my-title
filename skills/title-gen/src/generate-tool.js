/**
 * @file generate-tool.js
 * @description title.generate 原子工具定义
 * 符合 ADR v1.0 (D3, D4)
 */

'use strict';

const { z } = require('zod');
const { generateTitlePipeline } = require('./pipeline');
const { searchAll } = require('../../alibaba1688/src/search-1688');
const { extractSycmData, DEFAULT_FILTER_CONDITIONS } = require('../../sycm-research/src/sycm-cdp-extractor');

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

const defaultSearchProductsAdapter = ({ coreWord, blueOceanWord, modifiers, semanticGroups, searchMode, webFilters, port, maxProducts, maxPages, maxResolveLinks, scrollLoad, scrollSteps }) =>
  searchAll(coreWord, blueOceanWord, modifiers, semanticGroups, {
    mode: searchMode || 'api',
    port,
    maxProducts,
    maxPages,
    maxResolveLinks,
    scrollLoad,
    scrollSteps,
    ...(webFilters || {})
  });

async function defaultFetchSycmKeywordDataAdapter({ keyword, port, leaseManager }) {
  const result = await extractSycmData(keyword, {
    port: parseInt(port || process.env.SYCM_DEBUG_PORT || '9222', 10),
    maxPages: parseInt(process.env.SYCM_MAX_PAGES || '1', 10),
    mode: process.env.SYCM_TITLE_MODE || 'blue',
    loginMode: process.env.SYCM_LOGIN_MODE || 'manual',
    filterConditions: DEFAULT_FILTER_CONDITIONS,
    leaseManager
  });
  return result && Array.isArray(result.data) ? result.data : [];
}

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
      maxLength: input.length || 60,
      sycmData: input.keyword_data,
      sycmAuto: Boolean(input.sycm_auto),
      research: Boolean(input.research),
      useImageSearch: Boolean(input.use_image_search),
      minPrice: input.min_price || 0,
      maxPrice: input.max_price || 0,
      limit: input.count || 3,
      count: input.count || 3,
      leaseManager: ctx.leaseManager,
      searchProducts: defaultSearchProductsAdapter,
      fetchKeywordData: input.sycm_auto ? (args) => defaultFetchSycmKeywordDataAdapter({ ...args, leaseManager: ctx.leaseManager }) : undefined,
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
  generateTool,
  defaultSearchProductsAdapter,
  defaultFetchSycmKeywordDataAdapter
};
