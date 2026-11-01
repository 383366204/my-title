/**
 * @file query-tool.js
 * @description sycm.query 原子工具定义
 * 符合 ADR v1.0 (D3, D4)
 */

'use strict';

const { z } = require('zod');
const { extractSycmData } = require('./sycm-cdp-extractor');

const inputSchema = z.object({
  keyword: z.string().min(1, 'keyword 不能为空'),
  mode: z.enum(['blue', 'hot']).optional().default('blue'),
  port: z.number().int().positive().optional().default(9222),
  maxPages: z.number().int().min(1).max(10).optional().default(1),
  pageFilters: z.object({
    compareType: z.enum(['cycle', 'yearSync']).optional(),
    timePeriod: z.enum(['7d', '30d', 'day', 'week', 'month']).optional()
  }).optional(),
  filterConditions: z.record(z.string(), z.any()).optional()
});

/** @type {import('../../../core/runtime/contracts').ToolDefinition} */
const queryTool = {
  id: 'sycm.query',
  mcpName: 'sycm_query',
  version: '1.0.0',
  description: '通过 Chrome CDP 查询生意参谋搜索分析数据（搜索人气、点击率、竞争度等）',
  inputSchema,
  policy: {
    risk: 'medium',
    approval: 'never',
    sideEffect: 'read',
    resourceKeys: [], // 由底层 extractor 根据实际选定的 port 动态持有 cdp:<port> 租约，避免双重获取导致死锁
    platforms: ['sycm']
  },
  execute: async (input, ctx) => {
    ctx = ctx || {};
    if (ctx.abortSignal?.aborted) {
      const abortErr = new Error('操作已在启动前取消');
      abortErr.code = 'OPERATION_ABORTED';
      throw abortErr;
    }
    const port = input.port || 9222;
    // 动态绑定实际端口资源键
    const options = {
      ...input,
      leaseManager: ctx.leaseManager,
      shouldStop: () => ctx.abortSignal?.aborted,
      onProgress: (msg) => {
        if (ctx.logger && typeof ctx.logger.info === 'function') {
          ctx.logger.info(`[sycm.query] ${msg}`);
        }
      }
    };
    return await extractSycmData(input.keyword, options);
  }
};

module.exports = {
  queryTool
};
