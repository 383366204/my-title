/**
 * @file status-tool.js
 * @description sycm.status 原子工具定义
 * 符合 ADR v1.0 (D3, D4)
 */

'use strict';

const { z } = require('zod');

const statusSchema = z.object({
  keyword: z.string().optional().describe('可选：只查看指定关键词的缓存详情')
});

/**
 * 共享 SYCM 缓存存储
 */
const sharedSycmCache = new Map();
const SYCM_DATA_TTL = 30 * 60 * 1000;

/** @type {import('../../../core/runtime/contracts').ToolDefinition} */
const sycmStatusTool = {
  id: 'sycm.status',
  mcpName: 'sycm_status',
  version: '1.0.0',
  description: '生意参谋数据缓存状态查询。返回已缓存的关键词列表和详细信息，包括数据创建时间、TTL 剩余等。',
  inputSchema: statusSchema,
  policy: {
    risk: 'low',
    approval: 'never',
    sideEffect: 'read',
    resourceKeys: [],
    platforms: ['sycm']
  },
  execute: async (input) => {
    const { keyword } = input || {};
    if (keyword) {
      const entry = sharedSycmCache.get(keyword);
      if (!entry) {
        return {
          ok: true,
          keyword,
          cached: false,
          message: `关键词 "${keyword}" 没有缓存数据`
        };
      }
      const ageMs = Date.now() - entry.createdAt;
      const ttlRemainingMs = SYCM_DATA_TTL - ageMs;
      return {
        ok: true,
        keyword,
        cached: true,
        createdAt: new Date(entry.createdAt).toISOString(),
        ageSeconds: Math.round(ageMs / 1000),
        ttlRemainingSeconds: Math.max(0, Math.round(ttlRemainingMs / 1000)),
        dataSize: typeof entry.data === 'string' ? entry.data.length : 0
      };
    }

    const allKeywords = Array.from(sharedSycmCache.keys());
    const details = allKeywords.map((kw) => {
      const entry = sharedSycmCache.get(kw);
      const ageMs = Date.now() - entry.createdAt;
      return {
        keyword: kw,
        createdAt: new Date(entry.createdAt).toISOString(),
        ageSeconds: Math.round(ageMs / 1000),
        ttlRemainingSeconds: Math.max(0, Math.round((SYCM_DATA_TTL - ageMs) / 1000))
      };
    });

    return {
      ok: true,
      cachedKeywords: allKeywords,
      count: allKeywords.length,
      details,
      ttlMinutes: SYCM_DATA_TTL / 60000
    };
  }
};

module.exports = {
  sycmStatusTool,
  sharedSycmCache
};
