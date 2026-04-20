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

const tasks = new Map();

server.tool(
  'generate_title',
  '电商选品标题生成工具（异步）。首次调用传入 keyword 启动生成，返回 task_id。再次调用传入 task_id 查询结果。结果包含铺货标题、选品理由、定价建议、风险提示的商品列表。',
  {
    keyword: z.string().optional().describe('商品关键词（首次调用必传），如：戒指男潮牌高级感痞帅'),
    length: z.number().default(60).describe('标题最大字符数（1汉字=2字符），默认60'),
    task_id: z.string().optional().describe('查询任务结果时传入（不需要传 keyword）'),
  },
  async ({ keyword, length, task_id }) => {
    if (task_id) {
      const task = tasks.get(task_id);
      if (!task) {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'task_id 不存在' }) }], isError: true };
      }
      if (task.status === 'processing') {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, status: 'processing', task_id, message: '仍在处理中，请几秒后再次查询' }) }] };
      }
      if (task.status === 'done') {
        const result = task.result;
        tasks.delete(task_id);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      if (task.status === 'error') {
        const err = task.error;
        tasks.delete(task_id);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err }) }], isError: true };
      }
    }

    if (!keyword) {
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: '首次调用必须传 keyword' }) }], isError: true };
    }

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    tasks.set(id, { status: 'processing' });

    console.error(`[my-title] task ${id} started: keyword="${keyword}", length=${length}`);

    run(keyword, { maxLength: length || 60, silent: true })
      .then(result => {
        console.error(`[my-title] task ${id} done: ${result.products.length} products, ${result.titles.length} titles`);
        tasks.set(id, {
          status: 'done',
          result: {
            ok: true,
            coreWord: result.coreWord,
            blueOceanWord: result.blueOceanWord,
            modifiers: result.modifiers,
            filteredCount: result.filteredCount,
            titles: result.titles,
            products: result.products,
            stats: result.stats,
          },
        });
      })
      .catch(err => {
        console.error(`[my-title] task ${id} failed: ${err.message}`);
        tasks.set(id, { status: 'error', error: err.message });
      });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ ok: true, status: 'processing', task_id: id, message: `已开始生成标题，请用 task_id="${id}" 查询结果，约 30-60 秒后完成` }),
      }],
    };
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
