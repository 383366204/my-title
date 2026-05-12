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
const { getRateLimiter, RateLimitError } = require('../src/rate-limiter.js');

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
    if (err.name === 'RateLimitError') {
      sendJsonResponse(res, 429, {
        ok: false,
        error: '1688 API 冷却中',
        retry_after_seconds: Math.ceil(err.cooldownRemainingMs / 1000),
      });
      return;
    }
    console.error(`[HTTP] opportunities error:`, err.message);
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
    if (err.name === 'RateLimitError') {
      sendJsonResponse(res, 429, {
        ok: false,
        error: '1688 API 冷却中',
        retry_after_seconds: Math.ceil(err.cooldownRemainingMs / 1000),
      });
      return;
    }
    console.error(`[HTTP] trend error:`, err.message);
    sendErrorResponse(res, 502, `1688 API 错误: ${err.message}`);
  }
}

async function handleApiBatchGenerate(req, res, keywords, length) {
  try {
    const { batchRun } = require('../src/batch.js');
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    tasks.set(id, { status: 'processing', createdAt: Date.now(), progress: { completed: 0, total: keywords.length } });

    console.error(`[HTTP] batch task ${id} started: ${keywords.length} keywords`);

    batchRun(keywords, { maxLength: length || 60, silent: true })
      .then(result => {
        console.error(`[HTTP] batch task ${id} done: ${result.summary.success}/${result.summary.total}`);
        tasks.set(id, { status: 'done', createdAt: Date.now(), result });
      })
      .catch(err => {
        console.error(`[HTTP] batch task ${id} failed: ${err.message}`);
        tasks.set(id, { status: 'error', createdAt: Date.now(), error: err.message });
      });

    sendJsonResponse(res, 202, {
      ok: true,
      status: 'processing',
      task_id: id,
      message: `已开始批量生成，请用 task_id="${id}" 查询结果`,
    });
  } catch (err) {
    if (err.name === 'RateLimitError') {
      sendJsonResponse(res, 429, {
        ok: false,
        error: '1688 API 冷却中',
        retry_after_seconds: Math.ceil(err.cooldownRemainingMs / 1000),
      });
      return;
    }
    console.error(`[HTTP] batch-generate error: ${err.message}`);
    sendErrorResponse(res, 500, `Internal server error: ${err.message}`);
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
        // 限流错误：返回排队状态而非服务器错误
        if (err.name === 'RateLimitError') {
          const status = getRateLimiter().getStatus();
          tasks.set(id, {
            status: 'done',
            createdAt: Date.now(),
            result: {
              ok: true,
              status: 'rate_limited',
              retry_after_seconds: Math.ceil(err.cooldownRemainingMs / 1000),
              cooldown: status.cooldown,
              message: status.cooldown
                ? `1688 API 冷却中，预计 ${Math.ceil(err.cooldownRemainingMs / 1000)} 秒后恢复`
                : `1688 API 请求限流，请稍后重试`,
            },
          });
          
          // Emit task completed event with rate limit status
          broadcastEvent('task_completed', { 
            task_id: id, 
            keyword,
            status: 'rate_limited',
            timestamp: new Date().toISOString(),
          });
          return;
        }
        console.error(`[HTTP] task ${id} failed:`, err.message);
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
  const rateLimiterStatus = getRateLimiter().getStatus();

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
    sseClientsCount: sseClients.size,
    rateLimiter: rateLimiterStatus
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

  if (pathname === '/api/batch-generate' && req.method === 'POST') {
    parseJsonBody(req).then(body => {
      const { keywords, length = 60 } = body;
      if (!Array.isArray(keywords) || keywords.length === 0) {
        return sendErrorResponse(res, 400, 'keywords must be a non-empty array');
      }
      handleApiBatchGenerate(req, res, keywords, length);
    }).catch(err => {
      sendErrorResponse(res, 400, `Invalid JSON body: ${err.message}`);
    });
    return;
  }

  // POST /api/rate-limit/reset - 重置 1688 API 冷却
  if (pathname === '/api/rate-limit/reset' && req.method === 'POST') {
    getRateLimiter().resetCooldown();
    sendJsonResponse(res, 200, { ok: true, message: '冷却已重置' });
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
        // 限流错误：返回排队状态而非服务器错误
        if (err.name === 'RateLimitError') {
          const status = getRateLimiter().getStatus();
          tasks.set(id, {
            status: 'done',
            createdAt: Date.now(),
            result: {
              ok: true,
              status: 'rate_limited',
              retry_after_seconds: Math.ceil(err.cooldownRemainingMs / 1000),
              cooldown: status.cooldown,
              message: status.cooldown
                ? `1688 API 冷却中，预计 ${Math.ceil(err.cooldownRemainingMs / 1000)} 秒后恢复`
                : `1688 API 请求限流，请稍后重试`,
            },
          });
          return;
        }
        console.error(`[my-title] task ${id} failed:`, err.message);
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
        if (err.name === 'RateLimitError') {
          tasks.set(id, {
            status: 'done',
            createdAt: Date.now(),
            result: {
              ok: true,
              status: 'rate_limited',
              retry_after_seconds: Math.ceil(err.cooldownRemainingMs / 1000),
              cooldown: true,
              message: `1688 API 冷却中，预计 ${Math.ceil(err.cooldownRemainingMs / 1000)} 秒后恢复`,
            },
          });
          return;
        }
        console.error(`[my-title] image task ${id} failed:`, err.message);
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
      if (err.name === 'RateLimitError') {
        return { content: [{ type: 'text', text: JSON.stringify({
          ok: true,
          status: 'rate_limited',
          retry_after_seconds: Math.ceil(err.cooldownRemainingMs / 1000),
          cooldown: true,
          message: `1688 API 冷却中，预计 ${Math.ceil(err.cooldownRemainingMs / 1000)} 秒后恢复`,
        }) }] };
      }
      console.error(`[my-title] opportunities error:`, err.message);
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
      if (err.name === 'RateLimitError') {
        return { content: [{ type: 'text', text: JSON.stringify({
          ok: true,
          status: 'rate_limited',
          retry_after_seconds: Math.ceil(err.cooldownRemainingMs / 1000),
          cooldown: true,
          message: `1688 API 冷却中，预计 ${Math.ceil(err.cooldownRemainingMs / 1000)} 秒后恢复`,
        }) }] };
      }
      console.error(`[my-title] trend error:`, err.message);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }], isError: true };
    }
  }
);

server.tool(
  'batch_generate_titles',
  '批量蓝海词选品工具。一次调用处理多个关键词，自动去重核心词共享 1688 搜索结果，比多次调用 generate_title 更省 API 配额。',
  {
    keywords: z.array(z.string()).min(1).max(20).describe('蓝海词数组（1-20个）'),
    length: z.number().default(60).describe('标题最大字符数'),
    task_id: z.string().optional().describe('查询任务结果时传入'),
  },
  async ({ keywords, length, task_id }) => {
    // 轮询模式
    if (task_id) {
      const task = tasks.get(task_id);
      if (!task) {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'task_id 不存在' }) }], isError: true };
      }
      if (task.createdAt && Date.now() - task.createdAt > TASK_TTL) {
        tasks.delete(task_id);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'task_id 不存在' }) }], isError: true };
      }
      if (task.status === 'processing') {
        return { content: [{ type: 'text', text: JSON.stringify({
          ok: true, status: 'processing', task_id,
          progress: task.progress || { completed: 0, total: keywords ? keywords.length : 0 },
          message: '仍在处理中，请几秒后再次查询',
        }) }] };
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

    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: '必须传 keywords 数组' }) }], isError: true };
    }

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const abortController = new AbortController();
    const estimatedSeconds = keywords.length * 120;
    tasks.set(id, {
      status: 'processing',
      createdAt: Date.now(),
      progress: { completed: 0, total: keywords.length, currentKeyword: '' },
      abortController,
    });

    console.error(`[my-title] batch task ${id} started: ${keywords.length} keywords`);

    const { batchRun } = require('../src/batch.js');
    batchRun(keywords, {
      maxLength: length || 60,
      silent: true,
      signal: abortController.signal,
      onProgress: ({ completed, total, currentKeyword }) => {
        const task = tasks.get(id);
        if (task) {
          task.progress = { completed, total, currentKeyword };
        }
      },
    })
      .then(result => {
        console.error(`[my-title] batch task ${id} done: ${result.summary.success}/${result.summary.total}`);
        tasks.set(id, {
          status: 'done',
          createdAt: Date.now(),
          result,
        });
      })
      .catch(err => {
        if (err.name === 'RateLimitError') {
          tasks.set(id, {
            status: 'done',
            createdAt: Date.now(),
            result: {
              ok: true,
              status: 'rate_limited',
              retry_after_seconds: Math.ceil(err.cooldownRemainingMs / 1000),
              cooldown: true,
              message: `1688 API 冷却中，预计 ${Math.ceil(err.cooldownRemainingMs / 1000)} 秒后恢复`,
            },
          });
          return;
        }
        console.error(`[my-title] batch task ${id} failed: ${err.message}`);
        tasks.set(id, { status: 'error', createdAt: Date.now(), error: err.message });
      });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: true,
          status: 'processing',
          task_id: id,
          estimated_seconds: estimatedSeconds,
          message: `已开始批量生成 ${keywords.length} 个关键词的标题，预计约 ${Math.ceil(estimatedSeconds / 60)} 分钟。请用 task_id="${id}" 查询结果。`,
        }),
      }],
    };
  }
);

server.tool(
  'sycm_query',
  [
    '生意参谋搜索分析数据查询工具。自动通过 CDP 连接 Chrome，打开生意参谋搜索分析页面，勾选全部指标，提取前5页数据并返回。',
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
      const { isChromeDevToolsAvailable, generateChromeLaunchCommand, ERRORS } = require('../src/sycm-browser-helper.js');
      const { extractSycmData, DEFAULT_FILTER_CONDITIONS } = require('../src/sycm-cdp-extractor.js');

      const chromeAvailable = await isChromeDevToolsAvailable(port);
      
      if (!chromeAvailable) {
        const launchCmd = generateChromeLaunchCommand({ port });
        return { content: [{ type: 'text', text: JSON.stringify({
          ok: false,
          status: 'chrome_not_running',
          chromeLaunchCmd: launchCmd.command,
          message: ERRORS.CHROME_NOT_RUNNING.trim(),
          hint: '请让用户先用上述命令启动 Chrome（注意保留 --user-data-dir 以复用登录态），然后重新调用此工具。'
        }, null, 2) }] };
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
        _progress: progressLog
      }, null, 2) }] };
    } catch (err) {
      console.error(`[my-title] sycm_query error:`, err.message);
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
          dataSize: typeof entry.data === 'string' ? entry.data.length : 0,
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
      console.error(`[my-title] sycm_status error:`, err.message);
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
      console.error(`[HTTP]   POST /api/research      - 同步返回推荐词`);
      console.error(`[HTTP]   POST /api/extract       - 暂存 SYCM 数据`);
      console.error(`[HTTP]   POST /api/generate      - 异步生成标题`);
      console.error(`[HTTP]   POST /api/batch-generate - 批量生成标题`);
      console.error(`[HTTP]   GET  /api/status        - 服务器状态`);
      console.error(`[HTTP]   GET  /api/events        - SSE 事件流`);
      console.error(`[HTTP]   GET  /api/task/:id      - 查询任务结果`);
      console.error(`[HTTP]   GET  /api/opportunities - 1688 商机热榜`);
      console.error(`[HTTP]   POST /api/trend          - 1688 趋势洞察`);
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
