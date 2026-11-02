/**
 * @file batch-tool.js
 * @description title.batch_generate 原子工具定义
 * 符合 ADR v1.0 (D3, D4)
 */

'use strict';

const { z } = require('zod');
const { batchRun } = require('./batch');
const { searchAll } = require('../../alibaba1688/src/search-1688');

const defaultSearchProductsAdapter = ({ coreWord, blueOceanWord, modifiers, semanticGroups, searchMode, webFilters, port, maxProducts, maxPages, maxResolveLinks, scrollLoad, scrollSteps }) =>
  searchAll(coreWord, blueOceanWord, modifiers, semanticGroups, {
    mode: searchMode || 'api',
    port,
    maxProducts,
    maxPages,
    maxResolveLinks,
    scrollLoad,
    scrollSteps,
    webFilters
  });

const batchSchema = z.object({
  keywords: z.array(z.string().min(1)).min(1, 'keywords 数组不能为空').max(20, '最多支持 20 个关键词').describe('蓝海词数组（1-20个）'),
  length: z.number().int().positive().optional().default(60).describe('标题最大字符数'),
  silent: z.boolean().optional().default(true)
});

/** @type {import('../../../core/runtime/contracts').ToolDefinition} */
const batchGenerateTool = {
  id: 'title.batch_generate',
  mcpName: 'batch_generate_titles',
  version: '1.0.0',
  description: '批量蓝海词选品工具。一次调用处理多个关键词，自动去重核心词共享 1688 搜索结果，比多次调用 generate_title 更省 API 配额。',
  inputSchema: batchSchema,
  policy: {
    risk: 'medium',
    approval: 'never',
    sideEffect: 'read',
    resourceKeys: [],
    platforms: ['1688']
  },
  execute: async (input, ctx) => {
    ctx = ctx || {};
    const { keywords, length = 60, silent = true } = input;
    const signal = ctx.abortSignal;
    return batchRun(keywords, {
      maxLength: length,
      silent,
      signal,
      searchProducts: defaultSearchProductsAdapter,
      onProgress: (prog) => {
        if (ctx.logger?.info) {
          ctx.logger.info(`[batch] 进度: ${prog.completed}/${prog.total} 当前: ${prog.currentKeyword || ''}`);
        }
      }
    });
  }
};

module.exports = {
  batchGenerateTool
};
