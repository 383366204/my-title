/**
 * @file insights-tools.js
 * @description alibaba.opportunities 与 alibaba.trend 原子工具定义
 * 符合 ADR v1.0 (D3, D4)
 */

'use strict';

const { z } = require('zod');
const { fetchOpportunities, fetchTrend } = require('./insights');

const opportunitiesSchema = z.object({}).passthrough();

/** @type {import('../../../core/runtime/contracts').ToolDefinition} */
const opportunitiesTool = {
  id: 'alibaba.opportunities',
  mcpName: 'opportunities',
  version: '1.0.0',
  description: '1688 商机热榜工具。返回各平台（1688/淘宝/小红书）的热门商机排行榜数据，帮助发现当前市场热销品类和趋势。',
  inputSchema: opportunitiesSchema,
  policy: {
    risk: 'low',
    approval: 'never',
    sideEffect: 'read',
    resourceKeys: [],
    platforms: ['1688']
  },
  execute: async () => {
    if (!process.env.ALI_1688_AK) {
      const err = new Error('ALI_1688_AK 未配置');
      err.code = 'CONFIG_MISSING';
      throw err;
    }
    const result = await fetchOpportunities();
    return { ok: true, data: result };
  }
};

const trendSchema = z.object({
  query: z.string().min(1, 'query 不能为空').describe('趋势洞察关键词（类目/品类，尽量宽泛）')
});

/** @type {import('../../../core/runtime/contracts').ToolDefinition} */
const trendTool = {
  id: 'alibaba.trend',
  mcpName: 'trend',
  version: '1.0.0',
  description: '1688 趋势洞察工具。输入品类/类目关键词，返回该品类的市场趋势洞察、热门属性和竞争热度分析。',
  inputSchema: trendSchema,
  policy: {
    risk: 'low',
    approval: 'never',
    sideEffect: 'read',
    resourceKeys: [],
    platforms: ['1688']
  },
  execute: async (input) => {
    if (!process.env.ALI_1688_AK) {
      const err = new Error('ALI_1688_AK 未配置');
      err.code = 'CONFIG_MISSING';
      throw err;
    }
    const result = await fetchTrend(input.query);
    return { ok: true, data: result };
  }
};

module.exports = {
  opportunitiesTool,
  trendTool
};
