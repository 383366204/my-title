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

const { run, runFromImage } = require('../src/index.js');

const TASK_TTL = 30 * 60 * 1000; // 30 minutes

const server = new McpServer({
  name: 'my-title',
  version: '1.0.0',
});

const tasks = new Map();

// Cleanup expired tasks every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, task] of tasks) {
    if (task.createdAt && now - task.createdAt > TASK_TTL) {
      tasks.delete(id);
    }
  }
}, 5 * 60 * 1000);

server.tool(
  'generate_title',
  [
    '电商选品标题生成工具。支持三种调用方式：',
    '',
    '1. 标题生成（默认）: 传 keyword → 返回 task_id → 用 task_id 查询结果',
    '2. 推荐关键词: 传 keyword + research=true → 同步返回推荐词列表（不生成标题）',
    '3. SYCM增强生成: 传 keyword + keyword_data → 返回 task_id → 用 task_id 查询结果',
    '',
    '推荐工作流: 先用 research=true 获取推荐词 → 用户去生意参谋查数据 → 把数据粘贴到 keyword_data 重新调用 → 获得更精准的标题。',
    'keyword_data 格式: 从生意参谋「搜索分析」复制粘贴的Tab分隔文本，包含列：相关搜索词、搜索人气、点击率、支付转化率、支付买家数、需求供给比、天猫商品点击占比。'
  ].join('\n'),
  {
    keyword: z.string().optional().describe('商品关键词（首次调用必传），如：戒指男潮牌高级感痞帅'),
    length: z.number().default(60).describe('标题最大字符数（1汉字=2字符），默认60'),
    keyword_data: z.string().optional().describe('生意参谋搜索分析数据（可选，从生意参谋搜索分析页面复制粘贴的Tab分隔文本）'),
    task_id: z.string().optional().describe('查询任务结果时传入（不需要传 keyword）'),
    research: z.boolean().default(false).describe('推荐研究关键词模式（同步返回推荐词列表，不生成标题）'),
  },
  async ({ keyword, length, keyword_data, task_id, research }) => {
    // Research mode: sync call, returns keyword recommendations
    if (research) {
      const result = await run(keyword, { research: true });
      if (result.ok && result.researchKeywords) {
        return { content: [{ type: 'text', text: JSON.stringify({
          ok: true,
          researchKeywords: result.researchKeywords,
          coreWord: result.coreWord,
          modifiers: result.modifiers,
          _trace: result._trace || {},
          _hint: '请让用户去生意参谋搜索分析查询这些关键词的数据，然后把复制的数据通过 keyword_data 参数传回来重新调用，可获得按需求供给比排序的更精准标题。'
        }, null, 2) }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: '推荐关键词失败' }) }] };
    }

    if (task_id) {
      const task = tasks.get(task_id);
      if (!task) {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'task_id 不存在' }) }], isError: true };
      }
      // Check if task has expired
      if (task.createdAt && Date.now() - task.createdAt > TASK_TTL) {
        tasks.delete(task_id);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'task_id 不存在' }) }], isError: true };
      }
      if (task.status === 'processing') {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, status: 'processing', task_id, message: '仍在处理中，请几秒后再次查询' }) }] };
      }
      if (task.status === 'done') {
        const result = task.result;
        tasks.delete(task_id);
        // 无 keyword_data 时提示可使用 SYCM 增强
        const hint = !task.keyword_data
          ? { _hint: '💡 当前结果为普通模式。使用 research=true 先获取推荐词，再配合 keyword_data 传入生意参谋数据，可获得按市场需求排序的更精准标题。' }
          : {};
        return { content: [{ type: 'text', text: JSON.stringify({ ...result, ...hint }) }] };
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
    tasks.set(id, { status: 'processing', createdAt: Date.now(), keyword_data: !!keyword_data });

    console.error(`[my-title] task ${id} started: keyword="${keyword}", length=${length}`);

    run(keyword, { maxLength: length || 60, silent: true, sycmData: keyword_data })
      .then(result => {
        console.error(`[my-title] task ${id} done: ${result.products.length} products, ${result.titles.length} titles`);
        tasks.set(id, {
          status: 'done',
          createdAt: Date.now(),
          result: {
            ok: true,
            coreWord: result.coreWord,
            blueOceanWord: result.blueOceanWord,
            modifiers: result.modifiers,
            filteredCount: result.filteredCount,
            titles: result.titles,
            products: result.products,
            stats: result.stats,
            _trace: result.stats?.trace || {},
          },
        });
      })
      .catch(err => {
        console.error(`[my-title] task ${id} failed: ${err.message}`);
        tasks.set(id, { status: 'error', createdAt: Date.now(), error: err.message });
      });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ ok: true, status: 'processing', task_id: id, message: `已开始生成标题，请用 task_id="${id}" 查询结果，约 30-60 秒后完成` }),
      }],
    };
  }
);

server.tool(
  'generate_title_from_image',
  '通过 1688 商品链接，自动获取主图并以图搜图生成铺货标题',
  {
    url: z.string().optional().describe('1688商品详情页链接，如：https://detail.1688.com/offer/123456.html'),
    length: z.number().default(60).describe('标题最大字符数，默认60'),
    task_id: z.string().optional().describe('查询任务结果时传入（不需要传 url）'),
  },
  async ({ url, length, task_id }) => {
    // 轮询模式
    if (task_id) {
      const task = tasks.get(task_id);
      if (!task) {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'task_id 不存在' }) }], isError: true };
      }
      // Check if task has expired
      if (task.createdAt && Date.now() - task.createdAt > TASK_TTL) {
        tasks.delete(task_id);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'task_id 不存在' }) }], isError: true };
      }
      if (task.status === 'processing') {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, status: 'processing', task_id, message: '仍在处理中' }) }] };
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

    if (!url) {
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: '首次调用必须传 url' }) }], isError: true };
    }

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    tasks.set(id, { status: 'processing', createdAt: Date.now() });

    console.error(`[my-title] image task ${id} started: url="${url}"`);

    runFromImage(url, { maxLength: length || 60, silent: true })
      .then(result => {
        console.error(`[my-title] image task ${id} done: ${result.titles?.length || 0} titles`);
        tasks.set(id, {
          status: 'done',
          createdAt: Date.now(),
          result: {
            ok: true,
            sourceUrl: result.sourceUrl,
            imageUrl: result.imageUrl,
            originalTitle: result.originalTitle,
            coreWord: result.coreWord,
            blueOceanWord: result.blueOceanWord,
            titles: result.titles,
            peerTitles: result.peerTitles,
            peerSource: result.peerSource,
            stats: result.stats,
          },
        });
      })
      .catch(err => {
        console.error(`[my-title] image task ${id} failed: ${err.message}`);
        tasks.set(id, { status: 'error', createdAt: Date.now(), error: err.message });
      });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ ok: true, status: 'processing', task_id: id, message: `已开始处理，请用 task_id="${id}" 查询结果` }),
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
