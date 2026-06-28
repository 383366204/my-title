'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.ECOM_WORKFLOW_DATA_DIR
  ? path.resolve(process.env.ECOM_WORKFLOW_DATA_DIR)
  : path.join(process.cwd(), 'data', 'workflow', 'runs');

function assertValidRunId(runId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(String(runId || ''))) {
    throw new Error('Invalid workflow run id');
  }
}

function runFilePath(runId, ext) {
  assertValidRunId(runId);
  return path.join(DATA_DIR, `${runId}.${ext}`);
}

// 确保目录存在
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * 创建一个新的工作流运行记录
 * @param {object} workflow 工作流定义 { nodes, edges }
 * @returns {object} 创建的运行记录对象
 */
function createRun(workflow) {
  ensureDir();
  const runId = `run_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  const initialNodeStates = {};
  if (workflow && Array.isArray(workflow.nodes)) {
    workflow.nodes.forEach(node => {
      initialNodeStates[node.id] = {
        id: node.id,
        type: node.type,
        status: 'idle', // 'idle' | 'running' | 'completed' | 'failed'
        input: null,
        output: null,
        error: null,
        startedAt: null,
        completedAt: null
      };
    });
  }

  const runObj = {
    runId,
    status: 'pending', // 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
    workflow,
    nodeStates: initialNodeStates,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: null,
    logs: [] // 内存中保存最近的部分日志
  };

  saveRun(runObj);
  // 初始化一个空的日志文件
  const logFile = runFilePath(runId, 'log');
  fs.writeFileSync(logFile, '', 'utf8');

  return runObj;
}

/**
 * 保存运行记录到文件
 * @param {object} runObj 运行记录对象
 */
function saveRun(runObj) {
  ensureDir();
  const file = runFilePath(runObj.runId, 'json');
  // 在保存前，剔除冗余的 logs 数组以减小 json 大小，或者只保留最近 100 条
  const toSave = { ...runObj };
  if (toSave.logs && toSave.logs.length > 200) {
    toSave.logs = toSave.logs.slice(-200);
  }
  fs.writeFileSync(file, JSON.stringify(toSave, null, 2), 'utf8');
}

/**
 * 获取指定的运行记录
 * @param {string} runId 运行 ID
 * @returns {object|null} 运行记录，如果不存在则返回 null
 */
function getRun(runId) {
  ensureDir();
  const file = runFilePath(runId, 'json');
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    const data = fs.readFileSync(file, 'utf8');
    const runObj = JSON.parse(data);
    // 加载日志文件的内容
    const logFile = runFilePath(runId, 'log');
    if (fs.existsSync(logFile)) {
      runObj.logs = fs.readFileSync(logFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(line => {
          try {
            return JSON.parse(line);
          } catch (_) {
            return { timestamp: new Date().toISOString(), level: 'info', message: line };
          }
        });
    }
    return runObj;
  } catch (err) {
    console.error(`读取运行记录 ${runId} 失败:`, err.message);
    return null;
  }
}

/**
 * 更新运行记录
 * @param {string} runId 运行 ID
 * @param {object} updates 更新的字段
 * @returns {object|null} 更新后的运行记录
 */
function updateRun(runId, updates) {
  const runObj = getRun(runId);
  if (!runObj) return null;

  Object.assign(runObj, updates, {
    updatedAt: new Date().toISOString()
  });

  saveRun(runObj);
  return runObj;
}

/**
 * 往指定的运行记录中添加日志
 * @param {string} runId 运行 ID
 * @param {string} level 日志级别 'info' | 'warn' | 'error'
 * @param {string} message 日志消息
 */
function addRunLog(runId, level, message) {
  ensureDir();
  const logFile = runFilePath(runId, 'log');
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message
  };
  try {
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n', 'utf8');
  } catch (err) {
    console.error(`追加日志失败 ${runId}:`, err.message);
  }
}

/**
 * 列出最近的所有运行记录
 * @returns {array} 运行记录列表
 */
function listRuns() {
  ensureDir();
  try {
    const files = fs.readdirSync(DATA_DIR);
    const runs = files
      .filter(file => file.endsWith('.json'))
      .map(file => {
        try {
          const runId = file.replace('.json', '');
          const filePath = path.join(DATA_DIR, file);
          const raw = fs.readFileSync(filePath, 'utf8');
          const parsed = JSON.parse(raw);
          return {
            runId: parsed.runId,
            status: parsed.status,
            startedAt: parsed.startedAt,
            updatedAt: parsed.updatedAt,
            keyword: parsed.workflow?.nodes?.find(n => n.type === 'keyword-input' || n.type === 'input')?.data?.keyword || ''
          };
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    return runs;
  } catch (err) {
    console.error('列出运行记录失败:', err.message);
    return [];
  }
}

module.exports = {
  createRun,
  getRun,
  updateRun,
  addRunLog,
  listRuns
};
