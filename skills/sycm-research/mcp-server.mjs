#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import our skill modules
const sycmSkill = require('./index.js');

const server = new McpServer({
  name: 'sycm-research',
  version: '1.0.0',
});

// Data cache for SYCM data
const sycmDataStore = new Map();
const SYCM_DATA_TTL = 30 * 60 * 1000; // 30 minutes TTL for SYCM data

// Cleanup expired SYCM data every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of sycmDataStore) {
    if (entry.createdAt && now - entry.createdAt > SYCM_DATA_TTL) {
      sycmDataStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

server.tool(
  'sycm_query',
  [
    '生意参谋搜索分析数据查询工具。自动通过 CDP 连接 Chrome，打开生意参谋搜索分析页面，勾选全部指标，提取数据并返回。',
    '',
    '使用前提：用户必须先用 --remote-debugging-port=9222 启动 Chrome 并登录 sycm.taobao.com。',
    '如果 Chrome 未运行，工具会返回启动命令指引。'
  ].join('\n'),
  {
    keyword: z.string().describe('要查询的搜索关键词，如：耳钉、纯银项链'),
    port: z.number().default(9222).describe('Chrome 远程调试端口，默认 9222'),
    maxPages: z.number().default(1).describe('最大提取页数，默认 1'),
    mode: z.enum(['hot', 'blue']).default('blue').describe('查询模式，hot=相关热搜词，blue=相关蓝海词'),
    compareType: z.enum(['cycle', 'yearSync']).optional().default('cycle').describe('数据对比类型，cycle=环比，yearSync=同比，默认cycle'),
    timePeriod: z.enum(['7d', '30d', 'day', 'week', 'month']).optional().default('7d').describe('时间周期，7d=7天，30d=30天，day=日，week=周，month=月，默认7d'),
    filterConditions: z.object({
      demandSupplyRatio: z.number().optional().describe('需求供给比最小值'),
      searchPopularity: z.number().optional().describe('搜索人气最小值'),
      conversionRate: z.number().optional().describe('支付转化率最小值'),
      buyerCount: z.number().optional().describe('支付买家数最小值'),
      referencePrice: z.number().optional().describe('关键词推广参考价'),
    }).optional().describe('过滤条件（仅蓝海词模式生效）'),
    noDefaultFilters: z.boolean().default(false).describe('禁用默认过滤条件'),
  },
  async ({ keyword, port, maxPages, mode, compareType, timePeriod, filterConditions, noDefaultFilters }) => {
    try {
      const { isChromeDevToolsAvailable, autoLaunchChrome } = sycmSkill;
      const { extractSycmData, DEFAULT_FILTER_CONDITIONS } = require('./src/sycm-cdp-extractor.js');

      if (!await isChromeDevToolsAvailable(port)) {
        const launchResult = await autoLaunchChrome(port);
        if (!launchResult.success) {
          return { content: [{ type: 'text', text: JSON.stringify({
            ok: false,
            status: 'chrome_launch_failed',
            message: launchResult.message,
            hint: '请确认 Chrome 已安装，然后重新调用此工具。'
          }, null, 2) }] };
        }
      }

      var progressLog = [];
      var mergedFilters = null;
      if (mode === 'blue') {
        if (noDefaultFilters) {
          mergedFilters = filterConditions || null;
        } else {
          mergedFilters = Object.assign({}, DEFAULT_FILTER_CONDITIONS, filterConditions || {});
        }
      }
      const result = await extractSycmData(keyword, {
        port: port,
        maxPages: maxPages,
        mode: mode,
        filterConditions: mergedFilters,
        pageFilters: {
          compareType: compareType,
          timePeriod: timePeriod
        },
        onProgress: function(msg) { progressLog.push(msg); }
      });

      // Store the result in cache
      sycmDataStore.set(keyword, {
        data: result,
        createdAt: Date.now()
      });

      return { content: [{ type: 'text', text: JSON.stringify({
        ok: true,
        keyword: result.keyword,
        source: result.source,
        extractedAt: result.extractedAt,
        method: result.method,
        mode: result.mode,
        filterApplied: result.filterApplied,
        pageFiltersApplied: result.pageFiltersApplied,
        totalPages: result.totalPages,
        currentPage: result.currentPage,
        totalCount: result.totalCount,
        headers: result.headers,
        data: result.data,
        categoryAnalysis: result.categoryAnalysis ? {
          recommended: result.categoryAnalysis.recommendation && result.categoryAnalysis.recommendation.recommended ? {
            category: result.categoryAnalysis.recommendation.recommended.category,
            clickRatio: result.categoryAnalysis.recommendation.recommended.clickRatio,
            clickRate: result.categoryAnalysis.recommendation.recommended.clickRate,
            score: result.categoryAnalysis.recommendation.recommended.score
          } : null,
          ranking: (result.categoryAnalysis.recommendation && result.categoryAnalysis.recommendation.ranking) ?
            result.categoryAnalysis.recommendation.ranking.map(function(r) {
              return {
                category: r.category,
                clickRatio: r.clickRatio,
                clickRate: r.clickRate,
                score: r.score
              };
            }) : [],
          reason: (result.categoryAnalysis.recommendation && result.categoryAnalysis.recommendation.reason) || ''
        } : null,
        _progress: progressLog
      }, null, 2) }] };
    } catch (err) {
      console.error(`[sycm-research] sycm_query error:`, err.message);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }], isError: true };
    }
  }
);

server.tool(
  'sycm_status',
  '生意参谋数据缓存状态查询。返回 sycmDataStore 中已缓存的关键词列表和详细信息，包括数据创建时间、TTL 剩余等。',
  {
    keyword: z.string().optional().describe('可选：只查看指定关键词的缓存详情'),
  },
  async ({ keyword }) => {
    try {
      if (keyword) {
        // 查询指定关键词的缓存
        const entry = sycmDataStore.get(keyword);
        if (!entry) {
          return { content: [{ type: 'text', text: JSON.stringify({
            ok: true,
            keyword,
            cached: false,
            message: `关键词 "${keyword}" 没有缓存数据`
          }, null, 2) }] };
        }
        const ageMs = Date.now() - entry.createdAt;
        const ttlRemainingMs = SYCM_DATA_TTL - ageMs;
        return { content: [{ type: 'text', text: JSON.stringify({
          ok: true,
          keyword,
          cached: true,
          createdAt: new Date(entry.createdAt).toISOString(),
          ageSeconds: Math.round(ageMs / 1000),
          ttlRemainingSeconds: Math.max(0, Math.round(ttlRemainingMs / 1000)),
          dataSize: entry.data ? JSON.stringify(entry.data).length : 0,
        }, null, 2) }] };
      }

      // 查询所有缓存
      const allKeywords = Array.from(sycmDataStore.keys());
      const details = allKeywords.map(kw => {
        const entry = sycmDataStore.get(kw);
        const ageMs = Date.now() - entry.createdAt;
        return {
          keyword: kw,
          createdAt: new Date(entry.createdAt).toISOString(),
          ageSeconds: Math.round(ageMs / 1000),
          ttlRemainingSeconds: Math.max(0, Math.round((SYCM_DATA_TTL - ageMs) / 1000)),
        };
      });

      return { content: [{ type: 'text', text: JSON.stringify({
        ok: true,
        cachedKeywords: allKeywords,
        count: allKeywords.length,
        details,
        ttlMinutes: SYCM_DATA_TTL / 60000,
      }, null, 2) }] };
    } catch (err) {
      console.error(`[sycm-research] sycm_status error:`, err.message);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }], isError: true };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('sycm-research MCP Server running on stdio');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
