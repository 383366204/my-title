#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 加载环境变量
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

// 导入 skill 模块
const { searchAll } = require('./src/search-1688');
const { fetchOpportunities, fetchTrend } = require('./src/insights');
const { RateLimitError } = require('./src/client');

const server = new McpServer({
  name: 'alibaba1688',
  version: '1.0.0',
  description: '1688 数据服务：商品搜索、热榜、趋势',
});

/**
 * 工具：search_products
 * 搜索 1688 商品，支持刚性修饰词过滤和语义族匹配
 */
server.tool(
  'search_products',
  '搜索 1688 商品，支持核心词、蓝海词、修饰词过滤，返回符合刚性修饰词的商品列表。',
  {
    coreWord: z.string().describe('核心搜索词（必填）'),
    blueOceanWord: z.string().optional().describe('蓝海词（可选，默认同核心词）'),
    modifiers: z.array(z.object({
      word: z.string(),
      rigidity: z.enum(['rigid', 'optional']),
    })).optional().default([]).describe('修饰词列表，用于过滤'),
    semanticGroups: z.record(z.array(z.string())).optional().default({}).describe('语义族映射，用于同义词匹配'),
  },
  async ({ coreWord, blueOceanWord = coreWord, modifiers = [], semanticGroups = {} }) => {
    if (!process.env.ALI_1688_AK) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'ALI_1688_AK 未配置' }) }],
        isError: true,
      };
    }
    try {
      const products = await searchAll(coreWord, blueOceanWord, modifiers, semanticGroups);
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, data: products }) }],
      };
    } catch (err) {
      if (err.name === 'RateLimitError') {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            ok: true,
            status: 'rate_limited',
            retry_after_seconds: Math.ceil(err.cooldownRemainingMs / 1000),
            cooldown: true,
            message: `1688 API 冷却中，预计 ${Math.ceil(err.cooldownRemainingMs / 1000)} 秒后恢复`,
          }) }],
        };
      }
      console.error(`[alibaba1688] search_products error:`, err.message);
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }],
        isError: true,
      };
    }
  }
);

/**
 * 工具：opportunities
 * 获取 1688 商机热榜（各平台爆款商品）
 */
server.tool(
  'opportunities',
  '获取 1688 商机热榜数据，包含 1688、淘宝、小红书等平台的爆款商品排行榜，适合选品参考。',
  {},
  async () => {
    if (!process.env.ALI_1688_AK) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'ALI_1688_AK 未配置' }) }],
        isError: true,
      };
    }
    try {
      const data = await fetchOpportunities();
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, data }) }],
      };
    } catch (err) {
      if (err.name === 'RateLimitError') {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            ok: true,
            status: 'rate_limited',
            retry_after_seconds: Math.ceil(err.cooldownRemainingMs / 1000),
            cooldown: true,
            message: `1688 API 冷却中，预计 ${Math.ceil(err.cooldownRemainingMs / 1000)} 秒后恢复`,
          }) }],
        };
      }
      console.error(`[alibaba1688] opportunities error:`, err.message);
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }],
        isError: true,
      };
    }
  }
);

/**
 * 工具：trend
 * 获取关键词的热门趋势分析
 */
server.tool(
  'trend',
  '获取关键词在 1688 平台的热门趋势分析，返回趋势数据（Markdown 格式或对象）。',
  {
    query: z.string().describe('搜索关键词'),
  },
  async ({ query }) => {
    if (!process.env.ALI_1688_AK) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'ALI_1688_AK 未配置' }) }],
        isError: true,
      };
    }
    try {
      const data = await fetchTrend(query);
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, data }) }],
      };
    } catch (err) {
      if (err.name === 'RateLimitError') {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            ok: true,
            status: 'rate_limited',
            retry_after_seconds: Math.ceil(err.cooldownRemainingMs / 1000),
            cooldown: true,
            message: `1688 API 冷却中，预计 ${Math.ceil(err.cooldownRemainingMs / 1000)} 秒后恢复`,
          }) }],
        };
      }
      console.error(`[alibaba1688] trend error:`, err.message);
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }],
        isError: true,
      };
    }
  }
);

// 启动 MCP 服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[alibaba1688] MCP server started');
}

main().catch((err) => {
  console.error('[alibaba1688] Fatal error:', err);
  process.exit(1);
});