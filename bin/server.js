'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const { AsyncLocalStorage } = require('async_hooks');
require('dotenv').config();

const {
  listSeeds,
  addSeed,
  loadSeeds,
  saveSeeds,
  mineKeywords,
  DEFAULT_DATA_DIR
} = require('../skills/keyword-mining');

const { generateTitlePipeline } = require('../skills/title-gen');
const { searchAll } = require('../skills/alibaba1688');

const {
  validateWorkflow,
  listProductionWorkflowTemplates,
  sanitizeWorkflowParams,
  buildPipelineCliArgs,
  listWorkflowRuns,
  getWorkflowRun,
  readWorkflowNodeArtifact
} = require('../core/workflow');

const {
  listPipelineRuns,
  summarizePipelineRun
} = require('../core/pipeline-run-summary');

const app = express();
app.use(express.json());

const legacyWebPath = path.join(__dirname, '../web');
const reactWebPath = path.join(__dirname, '../apps/web/dist');

// Keep the old native UI as a rollback-only fallback while React owns the main entry.
app.use('/legacy', express.static(legacyWebPath));

// AsyncLocalStorage for concurrent SSE log routing
const logStorage = new AsyncLocalStorage();

// Hook console globally once
const originalLog = console.log;
const originalError = console.error;
const WORKBENCH_OUTPUT_LIMIT_BYTES = 200 * 1024;
let activeWorkbenchProcess = null;

const sendSseLog = (type, args) => {
  const res = logStorage.getStore();
  if (!res) return;
  const message = args.map(arg => {
    if (arg instanceof Error) return arg.stack || arg.message;
    if (typeof arg === 'object') return JSON.stringify(arg);
    return String(arg);
  }).join(' ');
  try {
    res.write(`data: ${JSON.stringify({ type, message })}\n\n`);
  } catch (_) {}
};

console.log = (...args) => {
  sendSseLog('log', args);
  originalLog(...args);
};

console.error = (...args) => {
  sendSseLog('error', args);
  originalError(...args);
};

// Find a free port starting from a default
function findFreePort(startPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(findFreePort(startPort + 1));
      } else {
        reject(err);
      }
    });
    server.listen(startPort, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => {
        resolve(port);
      });
    });
  });
}

// 1. GET /api/status - Get system and data file stats
app.get('/api/status', (req, res) => {
  const stats = {
    env: {
      hasGlmKey: !!process.env.GLM_API_KEY,
      hasAliKey: !!process.env.ALI_1688_AK
    },
    files: {
      seedsCount: 0,
      seenCount: 0,
      rejectedCount: 0,
      cacheCount: 0
    }
  };

  try {
    const seeds = loadSeeds(DEFAULT_DATA_DIR);
    stats.files.seedsCount = seeds.length;
  } catch (_) {}

  const getLineCount = (filename) => {
    try {
      const file = path.join(DEFAULT_DATA_DIR, filename);
      if (fs.existsSync(file)) {
        return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).length;
      }
    } catch (_) {}
    return 0;
  };

  stats.files.seenCount = getLineCount('seen-candidates.jsonl');
  stats.files.rejectedCount = getLineCount('rejected-candidates.jsonl');
  stats.files.cacheCount = getLineCount('verify-cache.jsonl');

  res.json({ ok: true, data: stats });
});

// 1.5 GET /api/workflow/batches - Read-only daily pipeline batch summaries
app.get('/api/workflow/batches', (req, res) => {
  try {
    const limit = parsePositiveNumber(req.query.limit, 20);
    const data = listPipelineRuns({ limit });
    const runs = data.runs.map(withLegacyBatchFields);
    res.json({ ok: true, data: { ...data, runs, latest: runs[0] || null } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 1.6 GET /api/workbench/runs - Daily workbench run summaries
app.get('/api/workbench/runs', (req, res) => {
  try {
    const limit = parsePositiveNumber(req.query.limit, 20);
    res.json({ ok: true, data: listPipelineRuns({ limit }) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 1.7 GET /api/workbench/runs/:runId - Daily workbench run details
app.get('/api/workbench/runs/:runId', (req, res) => {
  try {
    const summary = summarizePipelineRun({ runId: req.params.runId });
    if (!summary) {
      return res.status(404).json({ ok: false, error: '未找到该工作流运行记录' });
    }
    res.json({ ok: true, data: summary });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 1.8 POST /api/workbench/run - Start guarded CLI workflow in background
app.post('/api/workbench/run', (req, res) => {
  if (activeWorkbenchProcess) {
    return res.status(409).json({
      ok: false,
      status: 'workflow_busy',
      error: '已有工作流正在运行，请等待完成后再启动。'
    });
  }

  const body = req.body || {};
  const mode = body.mode === 'keyword' ? 'keyword' : 'daily';
  const keyword = String(body.keyword || '').trim();
  if (mode === 'keyword' && !keyword) {
    return res.status(400).json({ ok: false, error: '关键词不能为空' });
  }

  const args = buildWorkbenchCliArgs(mode, keyword, body);
  let child;
  try {
    child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env
    });
  } catch (err) {
    activeWorkbenchProcess = null;
    return res.status(500).json({ ok: false, error: err.message });
  }

  const runState = {
    child,
    pid: child.pid,
    mode,
    stdout: '',
    stderr: ''
  };
  activeWorkbenchProcess = runState;

  child.stdout.on('data', chunk => {
    runState.stdout = appendCappedOutput(runState.stdout, chunk);
  });
  child.stderr.on('data', chunk => {
    runState.stderr = appendCappedOutput(runState.stderr, chunk);
  });
  child.on('error', err => {
    if (activeWorkbenchProcess === runState) activeWorkbenchProcess = null;
    originalError('[Workbench Run] 子进程启动失败:', err.message);
  });
  child.on('exit', (code, signal) => {
    if (activeWorkbenchProcess === runState) activeWorkbenchProcess = null;
    if (code === 0) {
      originalLog(`[Workbench Run] ${mode} 工作流完成，pid=${runState.pid}`);
    } else {
      originalError(`[Workbench Run] ${mode} 工作流失败，pid=${runState.pid}, code=${code}, signal=${signal || ''}`);
      if (runState.stderr) originalError(runState.stderr.slice(-4000));
    }
  });

  res.json({ ok: true, data: { status: 'started', pid: child.pid, mode } });
});

function parsePositiveNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function withLegacyBatchFields(summary) {
  return {
    ...summary,
    requiresReview: Boolean(
      summary.mustReview ||
      summary.status === 'needs_review' ||
      Number((summary.counts || {}).reviewCandidates || 0) > 0
    ),
    reviewPreview: (summary.previews && summary.previews.distributionReview) || ''
  };
}

function addNumericCliOption(args, flag, value) {
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) {
    args.push(flag, String(num));
  }
}

function buildWorkbenchCliArgs(mode, keyword, options) {
  const args = ['bin/cli.js', 'flow', mode];
  if (mode === 'keyword') args.push(keyword);
  args.push('--json');

  if (mode === 'daily') {
    addNumericCliOption(args, '--mine', options.mine);
    addNumericCliOption(args, '--verify', options.verify);
    addNumericCliOption(args, '--generate', options.generate);
  }
  addNumericCliOption(args, '--export', options.export);
  addNumericCliOption(args, '--products-per-keyword', options.productsPerKeyword);
  addNumericCliOption(args, '--length', options.length);
  addNumericCliOption(args, '--port', options.port);
  addNumericCliOption(args, '--pages', options.pages);

  return args;
}

function appendCappedOutput(current, chunk) {
  const buffer = Buffer.concat([Buffer.from(current), Buffer.from(String(chunk))]);
  if (buffer.length <= WORKBENCH_OUTPUT_LIMIT_BYTES) return buffer.toString('utf8');
  return buffer.subarray(buffer.length - WORKBENCH_OUTPUT_LIMIT_BYTES).toString('utf8');
}

// 2. GET /api/seeds - Get sorted seed list (including paused)
app.get('/api/seeds', (req, res) => {
  try {
    const seeds = listSeeds({ dataDir: DEFAULT_DATA_DIR, includePaused: true });
    res.json({ ok: true, data: seeds });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 3. POST /api/seeds - Add or update a seed
app.post('/api/seeds', (req, res) => {
  const { keyword, category, priority, type } = req.body;
  try {
    const seed = addSeed(keyword, {
      category,
      priority: Number(priority),
      type,
      source: 'manual',
      dataDir: DEFAULT_DATA_DIR
    });
    res.json({ ok: true, data: seed });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// 4. POST /api/seeds/:keyword/toggle - Pause/resume a seed
app.post('/api/seeds/:keyword/toggle', (req, res) => {
  const keywordToToggle = req.params.keyword;
  try {
    const seeds = loadSeeds(DEFAULT_DATA_DIR);
    const seed = seeds.find(s => s.keyword === keywordToToggle);
    if (!seed) {
      return res.status(404).json({ ok: false, error: '种子词不存在' });
    }
    seed.status = seed.status === 'paused' ? 'active' : 'paused';
    saveSeeds(seeds, DEFAULT_DATA_DIR);
    res.json({ ok: true, data: seed });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 5. DELETE /api/seeds/:keyword - Delete a seed
app.delete('/api/seeds/:keyword', (req, res) => {
  const keywordToDelete = req.params.keyword;
  try {
    const seeds = loadSeeds(DEFAULT_DATA_DIR);
    const index = seeds.findIndex(s => s.keyword === keywordToDelete);
    if (index === -1) {
      return res.status(404).json({ ok: false, error: '种子词不存在' });
    }
    seeds.splice(index, 1);
    saveSeeds(seeds, DEFAULT_DATA_DIR);
    res.json({ ok: true, message: '种子已删除' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 6. GET /api/mine/run - Run keyword mining with live logs via SSE
app.get('/api/mine/run', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const options = {
    count: parseInt(req.query.count, 10) || 50,
    source: req.query.source || 'local',
    sycmPrecheck: req.query.sycmPrecheck === 'true',
    autoSeedHighTier: req.query.autoSeedHighTier === 'true',
    minSearchPopularity: parseInt(req.query.minSearchPopularity, 10) || 50,
    dataDir: DEFAULT_DATA_DIR,
    persist: true
  };

  let isClosed = false;
  req.on('close', () => {
    isClosed = true;
    originalLog(`🔌 客户端连接已关闭，挖掘任务的响应通道已终止。`);
  });

  logStorage.run(res, async () => {
    try {
      console.log(`🚀 开始挖掘关键词任务，参数:`, JSON.stringify(options));
      const result = await mineKeywords(options);
      if (!isClosed) {
        res.write(`data: ${JSON.stringify({ type: 'result', data: result })}\n\n`);
      }
    } catch (err) {
      if (!isClosed) {
        console.error(`❌ 挖掘任务发生异常:`, err.message);
        res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      }
    } finally {
      res.end();
    }
  });
});

// 7. POST /api/title/generate - Generate product titles & advice
app.post('/api/title/generate', async (req, res) => {
  const { keyword, maxLength, useImageSearch, peerTitles } = req.body;
  if (!keyword) {
    return res.status(400).json({ ok: false, error: '关键词不能为空' });
  }

  try {
    // 调用 generateTitlePipeline，注入 1688 商品搜索适配器，解决货源空结果的 Bug (P1)
    const result = await generateTitlePipeline(keyword, {
      maxLength: parseInt(maxLength, 10) || 60,
      useImageSearch: !!useImageSearch,
      peerTitles: Array.isArray(peerTitles) ? peerTitles : null,
      searchProducts: ({ coreWord, blueOceanWord, modifiers, semanticGroups }) =>
        searchAll(coreWord, blueOceanWord, modifiers, semanticGroups)
    });
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 8. POST /api/config/clean - Clear verify cache, seen or rejected historical lists
app.post('/api/config/clean', (req, res) => {
  const { type } = req.body; // 'cache' | 'seen' | 'rejected'
  const files = {
    cache: 'verify-cache.jsonl',
    seen: 'seen-candidates.jsonl',
    rejected: 'rejected-candidates.jsonl'
  };

  const filename = files[type];
  if (!filename) {
    return res.status(400).json({ ok: false, error: '不支持清除该类型文件' });
  }

  try {
    const file = path.join(DEFAULT_DATA_DIR, filename);
    if (fs.existsSync(file)) {
      fs.writeFileSync(file, '', 'utf8');
    }
    res.json({ ok: true, message: `${type} 缓存已清除` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==================== Core Root Miner APIs ====================
const { searchTaobaoTitles } = require('../skills/title-gen/src/search-taobao');
const { extractNouns } = require('../core/word-segmenter');
const { precheckCandidates } = require('../skills/keyword-mining/src/sycm-precheck');
const { fetchOpportunities } = require('../skills/alibaba1688');
const { extractSycmData } = require('../skills/sycm-research');

// 9. POST /api/miner/peer - Extract competitor word roots & verify with SYCM
app.post('/api/miner/peer', async (req, res) => {
  const { keyword } = req.body;
  if (!keyword) {
    return res.status(400).json({ ok: false, error: '关键词/链接不能为空' });
  }

  try {
    console.log(`🔍 正在获取淘宝同行 "${keyword}" 的标题...`);
    let titles = await searchTaobaoTitles(keyword, { maxResults: 15 });

    if (!titles.length) {
      return res.json({
        ok: true,
        data: [],
        warning: '未获取到淘宝同行标题，未使用模拟数据。请确认淘宝工具可用，或换一个关键词重试。'
      });
    }

    // Segment titles and extract nouns
    const nounCandidates = extractNouns(titles).slice(0, 15);
    if (!nounCandidates.length) {
      return res.json({ ok: true, data: [] });
    }

    console.log(`✓ 提取出候选词根:`, nounCandidates.map(c => c.word).join(', '));
    console.log(`🔌 正在对提取的候选词根进行生意参谋热度校验...`);

    // Verify with SYCM (popularity > 10)
    let pcResult;
    try {
      pcResult = await precheckCandidates(nounCandidates.map(c => ({ keyword: c.word })), { minSearchPopularity: 10 });
    } catch (sycmErr) {
      return res.status(502).json({
        ok: false,
        error: `生意参谋验证失败，未输出未验真词根: ${sycmErr.message}`
      });
    }

    const verified = pcResult.passed.map(p => {
      const match = nounCandidates.find(c => c.word === p.keyword);
      return {
        word: p.keyword,
        count: match ? match.count : 1,
        searchPopularity: p.searchPopularity
      };
    }).sort((a, b) => b.searchPopularity - a.searchPopularity);

    res.json({ ok: true, data: verified });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 10. POST /api/miner/opportunities - Extract 1688 opportunities & verify with SYCM
app.post('/api/miner/opportunities', async (req, res) => {
  try {
    console.log(`🔍 正在抓取 1688 爆款商机商品...`);
    const bizData = await fetchOpportunities();
    const products = bizData?.opportunityOffers || [];
    const titles = products.map(p => p.title || p.subject || '').filter(Boolean);

    if (!titles.length) {
      return res.json({ ok: true, data: [] });
    }

    // Segment and extract nouns
    const nounCandidates = extractNouns(titles).slice(0, 15);
    if (!nounCandidates.length) {
      return res.json({ ok: true, data: [] });
    }

    console.log(`🔌 正在对 1688 商机词根进行生意参谋热度校验...`);
    let pcResult;
    try {
      pcResult = await precheckCandidates(nounCandidates.map(c => ({ keyword: c.word })), { minSearchPopularity: 10 });
    } catch (sycmErr) {
      return res.status(502).json({
        ok: false,
        error: `生意参谋验证失败，未输出未验真商机词根: ${sycmErr.message}`
      });
    }

    const verified = pcResult.passed.map(p => {
      const match = nounCandidates.find(c => c.word === p.keyword);
      return {
        word: p.keyword,
        count: match ? match.count : 1,
        searchPopularity: p.searchPopularity
      };
    }).sort((a, b) => b.searchPopularity - a.searchPopularity);

    res.json({ ok: true, data: verified });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 11. POST /api/miner/sycm-market - Directly grab related words from SYCM
app.post('/api/miner/sycm-market', async (req, res) => {
  const { keyword } = req.body;
  if (!keyword) {
    return res.status(400).json({ ok: false, error: '核心词根不能为空' });
  }

  try {
    console.log(`🔍 正在直接从生意参谋抓取 "${keyword}" 的关联词榜单...`);
    const sycmRes = await extractSycmData(keyword, { mode: 'hot', maxPages: 1, port: 9222 });
    const items = sycmRes.data || [];

    const data = items.map(item => ({
      word: item.keyword,
      searchPopularity: parseSearchPop(item.searchPopularity),
      demandSupplyRatio: parsePercentOrNumber(item.demandSupplyRatio)
    })).sort((a, b) => b.searchPopularity - a.searchPopularity);

    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

function parseSearchPop(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const m = String(val).replace(/,/g, '').match(/(\d[\d]*)/);
  return m ? parseInt(m[1], 10) : 0;
}

function parsePercentOrNumber(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const str = String(val).trim();
  if (str.endsWith('%')) {
    const num = parseFloat(str.slice(0, -1));
    return Number.isFinite(num) ? num / 100 : 0;
  }
  const num = parseFloat(str);
  return Number.isFinite(num) ? num : 0;
}

// ==================== Workflow APIs ====================

// 1. GET /api/workflows/templates - 获取工作流模板列表
app.get('/api/workflows/templates', (req, res) => {
  res.json({ ok: true, data: listProductionWorkflowTemplates() });
});

// 2. GET /api/workflows/runs - 获取历史工作流运行记录列表
app.get('/api/workflows/runs', (req, res) => {
  try {
    const limit = parsePositiveNumber(req.query.limit, 20);
    res.json({ ok: true, data: listWorkflowRuns({ limit }) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 2.5 POST /api/workflows/validate - 运行前校验工作流图
app.post('/api/workflows/validate', (req, res) => {
  try {
    const result = validateWorkflow(req.body && req.body.workflow);
    res.status(result.ok ? 200 : 400).json({ ok: result.ok, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 3. POST /api/workflows/run - 启动一个新工作流
app.post('/api/workflows/run', (req, res) => {
  if (activeWorkbenchProcess) {
    return res.status(409).json({
      ok: false,
      status: 'workflow_busy',
      error: '已有工作流正在运行，请等待完成后再启动。'
    });
  }

  try {
    const launch = resolveWorkflowLaunch(req.body || {});
    const params = sanitizeWorkflowParams(launch.mode, launch.params);
    const args = buildPipelineCliArgs(launch.mode, params);
    const child = spawn(process.execPath, args, {
      cwd: path.resolve(__dirname, '..'),
      env: process.env
    });

    const runState = {
      child,
      pid: child.pid,
      mode: launch.mode,
      stdout: '',
      stderr: ''
    };
    activeWorkbenchProcess = runState;

    child.stdout.on('data', chunk => {
      runState.stdout = appendCappedOutput(runState.stdout, chunk);
    });
    child.stderr.on('data', chunk => {
      runState.stderr = appendCappedOutput(runState.stderr, chunk);
    });
    child.on('error', err => {
      if (activeWorkbenchProcess === runState) activeWorkbenchProcess = null;
      originalError('[Workflow Run] 子进程启动失败:', err.message);
    });
    child.on('exit', (code, signal) => {
      if (activeWorkbenchProcess === runState) activeWorkbenchProcess = null;
      if (code === 0) {
        originalLog(`[Workflow Run] ${launch.mode} pipeline 完成，pid=${runState.pid}`);
      } else {
        originalError(`[Workflow Run] ${launch.mode} pipeline 失败，pid=${runState.pid}, code=${code}, signal=${signal || ''}`);
        if (runState.stderr) originalError(runState.stderr.slice(-4000));
      }
    });

    res.json({ ok: true, data: { status: 'started', pid: child.pid, mode: launch.mode } });
  } catch (err) {
    if (activeWorkbenchProcess && !activeWorkbenchProcess.pid) activeWorkbenchProcess = null;
    const status = /未知 workflow mode|未知 workflow template|关键词不能为空/.test(err.message) ? 400 : 500;
    res.status(status).json({ ok: false, error: err.message });
  }
});

// 4. GET /api/workflows/runs/:runId/artifacts/:nodeId - 读取节点产物
app.get('/api/workflows/runs/:runId/artifacts/:nodeId', (req, res) => {
  try {
    const artifact = readWorkflowNodeArtifact({
      runId: req.params.runId,
      nodeId: req.params.nodeId,
      limit: parsePositiveNumber(req.query.limit, 50),
      maxChars: parsePositiveNumber(req.query.maxChars, 10000)
    });
    if (!artifact) {
      return res.status(404).json({ ok: false, error: '未找到该节点产物' });
    }
    res.json({ ok: true, data: artifact });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 5. GET /api/workflows/runs/:runId - 获取工作流运行的最新状态与日志
app.get('/api/workflows/runs/:runId', (req, res) => {
  try {
    const runObj = getWorkflowRun({ runId: req.params.runId });
    if (!runObj) {
      return res.status(404).json({ ok: false, error: '未找到该运行记录' });
    }
    res.json({ ok: true, data: runObj });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 6. POST /api/workflows/runs/:runId/cancel - pipeline cancel 暂未实现
app.post('/api/workflows/runs/:runId/cancel', sendWorkflowNotImplemented('cancel'));

// 7. POST /api/workflows/runs/:runId/retry-node - pipeline retry 暂未实现
app.post('/api/workflows/runs/:runId/retry-node', sendWorkflowNotImplemented('retry-node'));

// 8. POST /api/workflows/runs/:runId/resume - pipeline resume 暂未实现
app.post('/api/workflows/runs/:runId/resume', sendWorkflowNotImplemented('resume'));

// 9. GET /api/workflows/runs/:runId/events - 轮询真实 pipeline 状态并以 SSE 推送
app.get('/api/workflows/runs/:runId/events', (req, res) => {
  const runId = req.params.runId;
  const runObj = getWorkflowRun({ runId });
  if (!runObj) {
    return res.status(404).json({ ok: false, error: '未找到运行记录' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); // 确保 headers 刷出

  // 初始化推送
  res.write(`data: ${JSON.stringify({ event: 'init', payload: { status: runObj.status, nodeStates: runObj.nodeStates } })}\n\n`);

  let lastSnapshot = JSON.stringify({ status: runObj.status, nodeStates: runObj.nodeStates });
  const timer = setInterval(() => {
    try {
      const latest = getWorkflowRun({ runId });
      if (!latest) return;
      const nextSnapshot = JSON.stringify({ status: latest.status, nodeStates: latest.nodeStates });
      if (nextSnapshot === lastSnapshot) return;
      lastSnapshot = nextSnapshot;
      res.write(`data: ${JSON.stringify({ event: 'status_change', payload: { status: latest.status } })}\n\n`);
      res.write(`data: ${JSON.stringify({ event: 'init', payload: { status: latest.status, nodeStates: latest.nodeStates } })}\n\n`);
    } catch (err) {
      res.write(`data: ${JSON.stringify({ event: 'log', payload: { level: 'error', message: err.message } })}\n\n`);
    }
  }, 3000);

  req.on('close', () => {
    clearInterval(timer);
  });
});

function resolveWorkflowLaunch(body) {
  const templates = listProductionWorkflowTemplates();
  let template = null;
  const templateId = body.templateId || body.template_id || body.workflow?.id;
  if (templateId) {
    template = templates.find(item => item.id === templateId);
    if (!template) throw new Error(`未知 workflow template: ${templateId}`);
  }

  const mode = body.mode || body.workflow?.mode || template?.mode || 'daily';
  const params = {
    ...(body.params || {}),
    ...(body.options || {})
  };
  for (const key of ['keyword', 'mine', 'verify', 'generate', 'export', 'productsPerKeyword', 'length', 'port', 'pages', 'minBlueRows', 'fallbackHot']) {
    if (Object.prototype.hasOwnProperty.call(body, key)) params[key] = body[key];
  }
  if (!params.keyword) params.keyword = extractWorkflowKeyword(body.workflow);
  return { mode, params };
}

function extractWorkflowKeyword(workflow) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  const keywordNode = nodes.find(node => node && node.data && typeof node.data.keyword === 'string');
  return keywordNode ? keywordNode.data.keyword : '';
}

function sendWorkflowNotImplemented(action) {
  return (req, res) => {
    res.status(501).json({
      ok: false,
      error: `Workflow ${action} is not implemented for production pipeline runs yet.`
    });
  };
}

// React SPA entry. API routes must stay above this fallback.
app.use(express.static(reactWebPath));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, error: 'API not found' });
  }
  const indexPath = path.join(reactWebPath, 'index.html');
  if (!fs.existsSync(indexPath)) return next();
  res.sendFile(indexPath);
});

// Boot Server (Explicitly bind to localhost 127.0.0.1 for local boundaries security P2)
const defaultPort = parseInt(process.env.UI_PORT, 10) || 3000;
findFreePort(defaultPort).then(port => {
  app.listen(port, '127.0.0.1', () => {
    console.log(`\n======================================================`);
    console.log(`🌟 电商选品可视化工具 (Local Web UI) 服务已启动`);
    console.log(`🔗 本地安全链接: http://127.0.0.1:${port}`);
    console.log(`======================================================\n`);
  });
}).catch(err => {
  console.error('无法启动服务器端口扫描:', err.message);
});
