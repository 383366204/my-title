#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import http from 'http';
import { EventEmitter } from 'events';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { run, runFromImage } = require('../src/index.js');

const TASK_TTL = 30 * 60 * 1000; // 30 minutes

// HTTP Server Configuration
const SYCM_DATA_TTL = 30 * 60 * 1000; // 30 minutes TTL for SYCM data
const MAX_HISTORY_SIZE = 50;

// Global stores for HTTP mode
const sycmDataStore = new Map(); // key: sycm_keyword, value: { data, createdAt }
const history = []; // recent generation history
const sseClients = new Set(); // SSE client connections
const eventEmitter = new EventEmitter();

// Cleanup expired SYCM data every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of sycmDataStore) {
    if (entry.createdAt && now - entry.createdAt > SYCM_DATA_TTL) {
      sycmDataStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

// Helper function to add CORS headers
function addCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
}

// Helper function to send JSON response
function sendJsonResponse(res, statusCode, data) {
  addCorsHeaders(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.writeHead(statusCode);
  res.end(JSON.stringify(data, null, 2));
}

// Helper function to send error response
function sendErrorResponse(res, statusCode, message) {
  sendJsonResponse(res, statusCode, { ok: false, error: message });
}

// Helper function to send SSE event to all clients
function broadcastEvent(event, data) {
  const eventData = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(eventData);
    } catch (err) {
      // Client disconnected, remove from set
      sseClients.delete(client);
    }
  }
}

// HTTP Request Handlers

async function handleApiOpportunities(req, res) {
  if (!process.env.ALI_1688_AK) {
    return sendErrorResponse(res, 500, 'ALI_1688_AK 未配置');
  }
  try {
    const Alibaba1688Client = require('../src/alibaba1688-client.js');
    const client = new Alibaba1688Client(process.env.ALI_1688_AK);
    const result = await client.fetchOpportunities();
    sendJsonResponse(res, 200, { ok: true, data: result });
  } catch (err) {
    console.error(`[HTTP] opportunities error: ${err.message}`);
    sendErrorResponse(res, 502, `1688 API 错误: ${err.message}`);
  }
}

async function handleApiTrend(req, res, body) {
  if (!process.env.ALI_1688_AK) {
    return sendErrorResponse(res, 500, 'ALI_1688_AK 未配置');
  }
  try {
    const { query } = body;
    if (!query || typeof query !== 'string') {
      return sendErrorResponse(res, 400, 'Missing or invalid query parameter');
    }
    const Alibaba1688Client = require('../src/alibaba1688-client.js');
    const client = new Alibaba1688Client(process.env.ALI_1688_AK);
    const result = await client.fetchTrend(query);
    sendJsonResponse(res, 200, { ok: true, data: result });
  } catch (err) {
    console.error(`[HTTP] trend error: ${err.message}`);
    sendErrorResponse(res, 502, `1688 API 错误: ${err.message}`);
  }
}

async function handleApiResearch(req, res, body) {
  try {
    const { keyword } = body;
    if (!keyword || typeof keyword !== 'string') {
      return sendErrorResponse(res, 400, 'Missing or invalid keyword parameter');
    }
    
    const result = await run(keyword, { research: true, silent: true });
    
    if (result.ok && result.researchKeywords) {
      sendJsonResponse(res, 200, {
        ok: true,
        researchKeywords: result.researchKeywords,
        coreWord: result.coreWord,
        modifiers: result.modifiers,
        _trace: result._trace || {},
        _hint: '请让用户去生意参谋搜索分析查询这些关键词的数据，然后把复制的数据通过 /api/extract 端点传回来'
      });
    } else {
      sendErrorResponse(res, 500, '推荐关键词失败');
    }
  } catch (err) {
    console.error(`[HTTP] API research error:`, err);
    sendErrorResponse(res, 500, `Internal server error: ${err.message}`);
  }
}

async function handleApiExtract(req, res, body) {
  try {
    const { sycm_keyword, sycm_data } = body;
    if (!sycm_keyword || typeof sycm_keyword !== 'string') {
      return sendErrorResponse(res, 400, 'Missing or invalid sycm_keyword parameter');
    }
    if (!sycm_data || typeof sycm_data !== 'string') {
      return sendErrorResponse(res, 400, 'Missing or invalid sycm_data parameter');
    }
    
    sycmDataStore.set(sycm_keyword, {
      data: sycm_data,
      createdAt: Date.now()
    });
    
    sendJsonResponse(res, 200, {
      ok: true,
      message: `SYCM data stored for keyword: ${sycm_keyword}`,
      storedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error(`[HTTP] API extract error:`, err);
    sendErrorResponse(res, 500, `Internal server error: ${err.message}`);
  }
}

async function handleApiGenerate(req, res, body) {
  try {
    const { keyword, length = 60, sycm_keyword } = body;
    if (!keyword || typeof keyword !== 'string') {
      return sendErrorResponse(res, 400, 'Missing or invalid keyword parameter');
    }
    
    const sycmData = sycm_keyword ? sycmDataStore.get(sycm_keyword)?.data : undefined;
    
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    tasks.set(id, { status: 'processing', createdAt: Date.now(), keyword_data: !!sycmData });
    
    // Emit task started event
    broadcastEvent('task_started', { task_id: id, keyword, timestamp: new Date().toISOString() });
    
    console.error(`[HTTP] task ${id} started: keyword="${keyword}", length=${length}, sycm_keyword=${sycm_keyword || 'none'}`);
    
    // Start generation in background
    run(keyword, { maxLength: length || 60, silent: true, sycmData })
      .then(result => {
        console.error(`[HTTP] task ${id} done: ${result.products.length} products, ${result.titles.length} titles`);
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
        
        // Add to history
        const historyEntry = {
          task_id: id,
          keyword,
          sycm_keyword,
          length,
          timestamp: new Date().toISOString(),
          result: {
            coreWord: result.coreWord,
            blueOceanWord: result.blueOceanWord,
            productsCount: result.products.length,
            titlesCount: result.titles.length
          }
        };
        history.unshift(historyEntry);
        if (history.length > MAX_HISTORY_SIZE) {
          history.pop();
        }
        
        // Emit task completed event
        broadcastEvent('task_completed', { 
          task_id: id, 
          keyword,
          status: 'done',
          timestamp: new Date().toISOString(),
          result: historyEntry.result
        });
      })
      .catch(err => {
        console.error(`[HTTP] task ${id} failed: ${err.message}`);
        tasks.set(id, { status: 'error', createdAt: Date.now(), error: err.message });
        
        // Emit task error event
        broadcastEvent('task_error', { 
          task_id: id, 
          keyword,
          status: 'error',
          timestamp: new Date().toISOString(),
          error: err.message
        });
      });
    
    sendJsonResponse(res, 202, { 
      ok: true, 
      status: 'processing', 
      task_id: id, 
      message: `已开始生成标题，请用 task_id="${id}" 查询结果，约 30-60 秒后完成`
    });
  } catch (err) {
    console.error(`[HTTP] API generate error:`, err);
    sendErrorResponse(res, 500, `Internal server error: ${err.message}`);
  }
}

function handleApiStatus(req, res) {
  const storedKeywords = Array.from(sycmDataStore.keys());
  const activeTasks = Array.from(tasks.entries())
    .filter(([_, task]) => task.status === 'processing')
    .map(([id, task]) => ({ id, createdAt: task.createdAt }));
  
  sendJsonResponse(res, 200, {
    ok: true,
    serverStatus: 'running',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    storedKeywords,
    storedKeywordsCount: storedKeywords.length,
    activeTasksCount: activeTasks.length,
    activeTasks,
    historyCount: history.length,
    sseClientsCount: sseClients.size
  });
}

function handleApiEvents(req, res) {
  addCorsHeaders(res);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.writeHead(200);
  
  // Send initial connection event
  res.write('event: connected\ndata: {"message": "Connected to SSE stream"}\n\n');
  
  // Add client to set
  sseClients.add(res);
  
  // Remove client on disconnect
  req.on('close', () => {
    sseClients.delete(res);
  });
  
  req.on('error', () => {
    sseClients.delete(res);
  });
}

function handleTaskQuery(req, res, taskId) {
  const task = tasks.get(taskId);
  if (!task) {
    return sendErrorResponse(res, 404, `task_id ${taskId} 不存在`);
  }
  
  // Check if task has expired
  if (task.createdAt && Date.now() - task.createdAt > TASK_TTL) {
    tasks.delete(taskId);
    return sendErrorResponse(res, 404, `task_id ${taskId} 不存在`);
  }
  
  if (task.status === 'processing') {
    return sendJsonResponse(res, 200, { 
      ok: true, 
      status: 'processing', 
      task_id: taskId, 
      message: '仍在处理中，请几秒后再次查询' 
    });
  }
  
  if (task.status === 'done') {
    const result = task.result;
    tasks.delete(taskId);
    // 无 keyword_data 时提示可使用 SYCM 增强
    const hint = !task.keyword_data
      ? { _hint: '💡 当前结果为普通模式。使用 /api/research 先获取推荐词，再配合 /api/extract 传入生意参谋数据，可获得按市场需求排序的更精准标题。' }
      : {};
    sendJsonResponse(res, 200, { ...result, ...hint });
    return;
  }
  
  if (task.status === 'error') {
    const err = task.error;
    tasks.delete(taskId);
    sendErrorResponse(res, 500, err);
    return;
  }
}

// Main HTTP request handler
function handleHttpRequest(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    addCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }
  
  // Parse URL
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  
  // Route based on pathname
  if (pathname === '/api/research' && req.method === 'POST') {
    parseJsonBody(req).then(body => handleApiResearch(req, res, body)).catch(err => {
      sendErrorResponse(res, 400, `Invalid JSON body: ${err.message}`);
    });
    return;
  }
  
  if (pathname === '/api/extract' && req.method === 'POST') {
    parseJsonBody(req).then(body => handleApiExtract(req, res, body)).catch(err => {
      sendErrorResponse(res, 400, `Invalid JSON body: ${err.message}`);
    });
    return;
  }
  
  if (pathname === '/api/generate' && req.method === 'POST') {
    parseJsonBody(req).then(body => handleApiGenerate(req, res, body)).catch(err => {
      sendErrorResponse(res, 400, `Invalid JSON body: ${err.message}`);
    });
    return;
  }
  
  if (pathname === '/api/status' && req.method === 'GET') {
    handleApiStatus(req, res);
    return;
  }
  
  if (pathname === '/api/events' && req.method === 'GET') {
    handleApiEvents(req, res);
    return;
  }
  
// Handle task query: /api/task/:task_id
  const taskMatch = pathname.match(/^\/api\/task\/([^\/]+)$/);
  if (taskMatch && req.method === 'GET') {
    const taskId = taskMatch[1];
    handleTaskQuery(req, res, taskId);
    return;
  }

  // GET /api/opportunities - 1688 商机热榜
  if (pathname === '/api/opportunities' && req.method === 'GET') {
    handleApiOpportunities(req, res);
    return;
  }

  // POST /api/trend - 1688 趋势洞察
  if (pathname === '/api/trend' && req.method === 'POST') {
    parseJsonBody(req).then(body => handleApiTrend(req, res, body)).catch(err => {
      sendErrorResponse(res, 400, `Invalid JSON body: ${err.message}`);
    });
    return;
  }

  // 404 for unknown routes
  sendErrorResponse(res, 404, 'Not Found');
}

// Helper function to parse JSON request body
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        if (!body.trim()) {
          resolve({});
          return;
        }
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

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
    '支持图搜模式: use_image_search=true 启用淘宝以图搜词获取同行热门标题，进一步提升SEO效果。',
    'keyword_data 格式: 从生意参谋「搜索分析」复制粘贴的Tab分隔文本，包含列：相关搜索词、搜索人气、点击率、支付转化率、支付买家数、需求供给比、天猫商品点击占比。'
  ].join('\n'),
  {
    keyword: z.string().optional().describe('商品关键词（首次调用必传），如：戒指男潮牌高级感痞帅'),
    length: z.number().default(60).describe('标题最大字符数（1汉字=2字符），默认60'),
    keyword_data: z.string().optional().describe('生意参谋搜索分析数据（可选，从生意参谋搜索分析页面复制粘贴的Tab分隔文本）'),
    task_id: z.string().optional().describe('查询任务结果时传入（不需要传 keyword）'),
    research: z.boolean().default(false).describe('推荐研究关键词模式（同步返回推荐词列表，不生成标题）'),
    use_image_search: z.boolean().default(false).describe('启用淘宝以图搜词获取同行热门标题（默认false）'),
    cancel: z.boolean().default(false).describe('取消正在处理的任务（需要传入task_id）'),
    skip_image_search: z.boolean().default(false).describe('跳过已触发的图片搜索（需要传入task_id）'),
    max_image_search: z.number().default(0).describe('图搜最大商品数（0=不限制，建议10-15）'),
    min_price: z.number().default(0).describe('最低价格过滤（元，0=不过滤）'),
    max_price: z.number().default(0).describe('最高价格过滤（元，0=不过滤）'),
  },
  async ({ keyword, length, keyword_data, task_id, research, use_image_search, cancel, skip_image_search, max_image_search, min_price, max_price }) => {
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

      // Handle cancel request
      if (cancel && task.abortController) {
        task.abortController.abort();
        task.status = 'cancelled';
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, status: 'cancelled', task_id, message: '任务已取消' }) }] };
      }

      // Handle skip image search request
      if (skip_image_search) {
        if (task && task.skipFlag) {
          task.skipFlag.skipImageSearch = true;
        }
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, status: task.status, task_id, message: '已标记跳过图片搜索' }) }] };
      }

       if (task.status === 'processing') {
         const progress = task.progress || { completed: 0, total: 0, estimated_seconds_remaining: task.estimatedSeconds || 60 };
         const msg = progress.total > 0 
           ? `已完成 ${progress.completed}/${progress.total}，预计剩余约 ${Math.ceil(progress.estimated_seconds_remaining / 60)} 分钟`
           : '仍在处理中，请几秒后再次查询';
         return { content: [{ type: 'text', text: JSON.stringify({ 
           ok: true, status: 'processing', task_id, progress, message: msg 
         }) }] };
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
      if (task.status === 'captcha_required') {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, status: 'captcha_required', task_id, message: '需要验证码才能继续图片搜索，请处理后重试' }) }] };
      }
      if (task.status === 'cancelled') {
        tasks.delete(task_id);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, status: 'cancelled', message: '任务已被取消' }) }] };
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
    const abortController = new AbortController();
    const estimatedSeconds = use_image_search ? ((max_image_search || 40) * 50 + 5) : 60; // 默认预估 40 商品
    const skipFlag = { skipImageSearch: false };
    tasks.set(id, { 
      status: 'processing', 
      createdAt: Date.now(), 
      keyword_data: !!keyword_data,
      useImageSearch: use_image_search,
      maxImageSearch: max_image_search,
      minPrice: min_price,
      maxPrice: max_price,
      abortController: abortController,
      progress: { completed: 0, total: 0, estimated_seconds_remaining: estimatedSeconds },
      estimatedSeconds,
      skipFlag
    });

    console.error(`[my-title] task ${id} started: keyword="${keyword}", length=${length}, use_image_search=${use_image_search}, max_image_search=${max_image_search}, min_price=${min_price}, max_price=${max_price}`);

    run(keyword, { 
      maxLength: length || 60, 
      silent: true, 
      sycmData: keyword_data,
      useImageSearch: use_image_search,
      maxImageSearch: max_image_search,
      minPrice: min_price,
      maxPrice: max_price,
      signal: abortController.signal,
      skipFlag: tasks.get(id).skipFlag,
      onProductsFound: (count) => {
        const task = tasks.get(id);
        if (task) {
          const remaining = use_image_search ? (count * 50 + 5) : 60;
          task.progress = { completed: 0, total: count, estimated_seconds_remaining: remaining };
          task.estimatedSeconds = remaining;
        }
      },
      onProgress: (progress) => {
        const task = tasks.get(id);
        if (task) {
          const remaining = (progress.total - progress.completed) * 50;
          task.progress = { 
            completed: progress.completed, 
            total: progress.total, 
            estimated_seconds_remaining: remaining 
          };
        }
      }
    })
      .then(result => {
        console.error(`[my-title] task ${id} done: ${result.products.length} products, ${result.titles.length} titles`);
        // Check if captcha was detected during image search
        if (result.stats?.trace?.captchaDetected) {
          tasks.set(id, {
            status: 'captcha_required',
            createdAt: Date.now(),
          });
        } else {
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
        }
      })
      .catch(err => {
        console.error(`[my-title] task ${id} failed: ${err.message}`);
        // Handle abort error
        if (err.name === 'AbortError' && tasks.get(id).status === 'processing') {
          tasks.set(id, { status: 'cancelled', createdAt: Date.now() });
        } else {
          tasks.set(id, { status: 'error', createdAt: Date.now(), error: err.message });
        }
      });

     return {
       content: [{
         type: 'text',
         text: JSON.stringify({ 
           ok: true, 
           status: 'processing', 
           task_id: id, 
           estimated_seconds: estimatedSeconds,
           message: `已开始生成标题${use_image_search ? '（含图搜）' : ''}，预计约 ${Math.ceil(estimatedSeconds / 60)} 分钟。请用 task_id="${id}" 查询结果。` 
         }),
       }],
     };
  }
);

server.tool(
  'generate_title_from_image',
  '通过 1688 商品链接，自动获取主图并以图搜图生成铺货标题',
  {
    url: z.string().optional().describe('1688商品详情页链接，如：https://detail.1688.com/offer/123456.html'),
    keyword: z.string().optional().describe('手动指定蓝海词/关键词（标题前缀），不传则自动从同行标题提取'),
    length: z.number().default(60).describe('标题最大字符数，默认60'),
    task_id: z.string().optional().describe('查询任务结果时传入（不需要传 url）'),
  },
  async ({ url, keyword, length, task_id }) => {
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

    runFromImage(url, { maxLength: length || 60, silent: true, keyword: keyword || '' })
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

server.tool(
  'opportunities',
  '1688 商机热榜工具。返回各平台（1688/淘宝/小红书）的热门商机排行榜数据，帮助发现当前市场热销品类和趋势。适合选品参考。',
  {
    // 空参数
  },
  async () => {
    if (!process.env.ALI_1688_AK) {
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'ALI_1688_AK 未配置' }) }], isError: true };
    }
    try {
      const Alibaba1688Client = require('../src/alibaba1688-client.js');
      const client = new Alibaba1688Client(process.env.ALI_1688_AK);
      const result = await client.fetchOpportunities();
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, data: result }) }] };
    } catch (err) {
      console.error(`[my-title] opportunities error: ${err.message}`);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }], isError: true };
    }
  }
);

server.tool(
  'trend',
  '1688 趋势洞察工具。输入品类/类目关键词，返回该品类的市场趋势洞察、热门属性和竞争热度分析。适合了解市场规模和增长趋势。',
  {
    query: z.string().describe('趋势洞察关键词（类目/品类，尽量宽泛）'),
  },
  async ({ query }) => {
    if (!process.env.ALI_1688_AK) {
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'ALI_1688_AK 未配置' }) }], isError: true };
    }
    try {
      const Alibaba1688Client = require('../src/alibaba1688-client.js');
      const client = new Alibaba1688Client(process.env.ALI_1688_AK);
      const result = await client.fetchTrend(query);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, data: result }) }] };
    } catch (err) {
      console.error(`[my-title] trend error: ${err.message}`);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }], isError: true };
    }
  }
);

async function main() {
  // Parse command line arguments for HTTP mode
  const args = process.argv.slice(2);
  let httpPort = null;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--http-port' && i + 1 < args.length) {
      httpPort = parseInt(args[i + 1], 10);
      if (isNaN(httpPort) || httpPort < 1 || httpPort > 65535) {
        console.error('Error: --http-port must be a valid port number (1-65535)');
        process.exit(1);
      }
      break;
    }
  }
  
  if (httpPort) {
    // HTTP mode: start HTTP server only (MCP stdio would block stdin)
    const httpServer = http.createServer(handleHttpRequest);
    
    httpServer.on('error', (err) => {
      console.error(`[HTTP] Server error: ${err.message}`);
      if (err.code === 'EADDRINUSE') {
        console.error(`[HTTP] Port ${httpPort} is already in use`);
        process.exit(1);
      }
    });
    
    httpServer.listen(httpPort, () => {
      console.error(`[HTTP] Server started on port ${httpPort}`);
      console.error(`[HTTP] Available endpoints:`);
      console.error(`[HTTP]   POST /api/research    - 同步返回推荐词`);
      console.error(`[HTTP]   POST /api/extract     - 暂存 SYCM 数据`);
      console.error(`[HTTP]   POST /api/generate    - 异步生成标题`);
      console.error(`[HTTP]   GET  /api/status      - 服务器状态`);
      console.error(`[HTTP]   GET  /api/events      - SSE 事件流`);
      console.error(`[HTTP]   GET  /api/task/:id    - 查询任务结果`);
      console.error(`[HTTP]   GET  /api/opportunities - 1688 商机热榜`);
      console.error(`[HTTP]   POST /api/trend        - 1688 趋势洞察`);
    });
    
    // Keep process alive (HTTP server handles its own event loop)
    // MCP stdio is NOT started in HTTP mode to avoid stdin blocking
  } else {
    // Stdio-only mode (original behavior)
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('my-title MCP Server running on stdio');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
