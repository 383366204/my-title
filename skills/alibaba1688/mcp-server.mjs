#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

require('../../core/env').loadEnv({ projectRoot: path.resolve(__dirname, '..', '..') });

const { searchAll } = require('./src/search-1688');
const { searchWeb1688, checkWeb1688Status } = require('./src/search-web-1688');
const { fetchOpportunities, fetchTrend } = require('./src/insights');

const server = new McpServer({
  name: 'alibaba1688',
  version: '1.0.0',
  description: '1688 product search, opportunities, and trend tools',
});

server.tool(
  'search_products',
  'Search 1688 products. mode=api uses the original API; mode=web uses an existing Chrome CDP session; mode=hybrid merges both.',
  {
    coreWord: z.string().describe('Core search word'),
    blueOceanWord: z.string().optional().describe('Blue-ocean keyword; defaults to coreWord'),
    modifiers: z.array(z.object({
      word: z.string(),
      rigidity: z.enum(['rigid', 'optional']),
    })).optional().default([]).describe('Product modifiers used for relevance filtering'),
    semanticGroups: z.record(z.array(z.string())).optional().default({}).describe('Synonym groups'),
    mode: z.enum(['api', 'web', 'hybrid']).optional().default('api').describe('Search mode'),
    port: z.number().optional().default(9222).describe('Chrome CDP port for web/hybrid mode'),
    maxProducts: z.number().optional().default(20).describe('Maximum web products to return'),
    maxPages: z.number().optional().describe('Maximum 1688 search pages to collect in web mode'),
    maxResolveLinks: z.number().optional().default(8).describe('Maximum redirect links to resolve'),
    scrollLoad: z.boolean().optional().default(true).describe('Scroll the 1688 page to load lazy product cards before extraction'),
    scrollSteps: z.number().optional().default(8).describe('Maximum scroll steps for lazy-loaded product cards'),
    minPrice: z.number().optional().describe('Minimum price filter'),
    maxPrice: z.number().optional().describe('Maximum price filter'),
    minSales30d: z.number().optional().describe('Minimum 30-day sales filter'),
    pageSort: z.enum(['sales', 'price']).optional().describe('Page sort to click on 1688 search page'),
    minOrderQuantity: z.number().optional().describe('Minimum order quantity page filter'),
    maxOrderQuantity: z.number().optional().describe('Maximum order quantity page filter'),
    minShopProducts: z.number().optional().describe('Minimum shop product count page filter'),
    pageFeatureKeywords: z.array(z.string()).optional().default([]).describe('Visible 1688 page feature labels to click'),
  },
  async ({ coreWord, blueOceanWord = coreWord, modifiers = [], semanticGroups = {}, mode = 'api', port = 9222, maxProducts = 20, maxPages, maxResolveLinks = 8, scrollLoad = true, scrollSteps = 8, minPrice, maxPrice, minSales30d, pageSort, minOrderQuantity, maxOrderQuantity, minShopProducts, pageFeatureKeywords = [] }) => {
    if (mode === 'api' && !process.env.ALI_1688_AK) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'ALI_1688_AK is not configured' }) }],
        isError: true,
      };
    }
    try {
      if (mode === 'web') {
        const result = await searchWeb1688({
          keyword: blueOceanWord || coreWord,
          port,
          maxProducts,
          maxPages,
          maxResolveLinks,
          scrollLoad,
          scrollSteps,
          minPrice,
          maxPrice,
          minSales30d,
          pageSort,
          minOrderQuantity,
          maxOrderQuantity,
          minShopProducts,
          pageFeatureKeywords
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      }

      const products = await searchAll(coreWord, blueOceanWord, modifiers, semanticGroups, {
        mode,
        port,
        maxProducts,
        maxPages,
        maxResolveLinks,
        scrollLoad,
        scrollSteps,
        webFilters: {
          minPrice,
          maxPrice,
          minSales30d,
          pageSort,
          minOrderQuantity,
          maxOrderQuantity,
          minShopProducts,
          pageFeatureKeywords
        }
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, data: products }) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }],
        isError: true,
      };
    }
  }
);

server.tool(
  'web_status',
  'Check Chrome CDP and the current 1688 page. Use before mode=web search.',
  {
    port: z.number().optional().default(9222).describe('Chrome CDP port'),
  },
  async ({ port = 9222 }) => {
    const result = await checkWeb1688Status({ port });
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      isError: !result.ok,
    };
  }
);

server.tool(
  'opportunities',
  'Fetch 1688 opportunity data.',
  {},
  async () => {
    if (!process.env.ALI_1688_AK) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'ALI_1688_AK is not configured' }) }],
        isError: true,
      };
    }
    try {
      const data = await fetchOpportunities();
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, data }) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }],
        isError: true,
      };
    }
  }
);

server.tool(
  'trend',
  'Fetch 1688 trend data for a keyword.',
  {
    query: z.string().describe('Search keyword'),
  },
  async ({ query }) => {
    if (!process.env.ALI_1688_AK) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'ALI_1688_AK is not configured' }) }],
        isError: true,
      };
    }
    try {
      const data = await fetchTrend(query);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, data }) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[alibaba1688] MCP server started');
}

main().catch((err) => {
  console.error('[alibaba1688] Fatal error:', err);
  process.exit(1);
});
