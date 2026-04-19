#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { run } = require('../src/index.js');

const server = new McpServer({
  name: 'my-title',
  version: '1.0.0',
});

server.tool(
  'generate_title',
  '电商选品标题生成工具。输入关键词，通过 AI 提取核心词、搜索 1688 商品、生成 SEO 优化的淘宝标题。返回包含铺货标题、选品理由、定价建议、风险提示的商品列表。',
  {
    keyword: z.string().describe('商品关键词，如：戒指男潮牌高级感痞帅'),
    length: z.number().default(60).describe('标题最大字符数（1汉字=2字符），默认60'),
    limit: z.number().default(5).describe('最多处理商品数量，默认5（减少等待时间）'),
  },
  async ({ keyword, length, limit }) => {
    console.error(`[my-title] generate_title called: keyword="${keyword}", length=${length}, limit=${limit}`);
    try {
      const result = await run(keyword, {
        maxLength: length || 60,
        silent: true,
        limit: limit || 5,
      });

      console.error(`[my-title] success: ${result.products.length} products, ${result.titles.length} titles`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: true,
              coreWord: result.coreWord,
              blueOceanWord: result.blueOceanWord,
              modifiers: result.modifiers,
              filteredCount: result.filteredCount,
              titles: result.titles,
              products: result.products,
            }),
          },
        ],
      };
    } catch (err) {
      console.error(`[my-title] error: ${err.message}`, err.stack);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: false, error: err.message }),
          },
        ],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('my-title MCP Server running on stdio');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
