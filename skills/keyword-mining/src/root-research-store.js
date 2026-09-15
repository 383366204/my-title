'use strict';

const fs = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');

const ROOT_RESEARCH_COOLDOWN_MS = 30 * 86400000;

/**
 * 只统一查询文本格式，不合并语义相近但搜索结果不同的词。
 * @param {string} value 实际查询词。
 * @returns {string} 历史查询键。
 */
function normalizeResearchRoot(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}]+/gu, '');
}

function recordPath(dataDir, scope, root) {
  const key = createHash('sha256').update(JSON.stringify([scope, normalizeResearchRoot(root)])).digest('hex');
  return path.join(dataDir, 'root-research', `${key}.json`);
}

function readCycles(file) {
  try {
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(rows)) throw new Error('词根研究记录格式无效');
    return rows;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), { flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function legacyCompletion(dataDir, root) {
  const file = path.join(dataDir, 'root-history.jsonl');
  if (!fs.existsSync(file)) return null;
  const normalized = normalizeResearchRoot(root);
  let latest = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line);
    if (normalizeResearchRoot(row.root) !== normalized || !['success', 'empty'].includes(row.result)) continue;
    const completed = Date.parse(row.checkedAt || '');
    if (Number.isFinite(completed) && (!latest || completed > Date.parse(latest.completedAt))) latest = { completedAt: row.checkedAt, legacy: true };
  }
  return latest;
}

/**
 * 检查同一研究范围内该词是否满 30 天；技术失败不进入完成记录。
 * @param {string} root 查询词。
 * @param {object} options 数据目录、范围及当前时间。
 * @returns {object} 冷却状态与上次完成记录。
 */
function rootResearchStatus(root, { dataDir, researchScopeId = 'default', now = Date.now() }) {
  const cycles = readCycles(recordPath(dataDir, researchScopeId, root));
  const last = cycles.at(-1) || (researchScopeId === 'default' ? legacyCompletion(dataDir, root) : null);
  const next = last ? Date.parse(last.completedAt) + ROOT_RESEARCH_COOLDOWN_MS : null;
  return {
    state: !last ? 'new' : Number(now) < next ? 'cooling' : 'due',
    lastCompletedAt: last?.completedAt || null,
    nextEligibleAt: next === null ? null : new Date(next).toISOString(),
    lastCycle: last || null
  };
}

/**
 * 串行认领词根并即时保存有效结果；重试本轮复用已完成查询，不延长冷却。
 * @param {string} root 查询词。
 * @param {object} options 存储位置、研究范围、运行轮次及查询上下文。
 * @param {Function} extract 实际查询函数。
 * @returns {Promise<object>} 查询结果或明确的冷却状态。
 */
async function researchRoot(root, options, extract) {
  const { dataDir, researchScopeId = 'default', cycleId = randomUUID(), queryContext = {}, now = Date.now } = options;
  const file = recordPath(dataDir, researchScopeId, root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  // 不用超时抢占活跃浏览器任务：异常退出留下的锁也交由人工确认后处理。
  let handle;
  try {
    handle = fs.openSync(lock, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') return { skipped: true, state: 'running' };
    throw error;
  }
  try {
    fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, cycleId, createdAt: new Date(now()).toISOString() }));
    const cycles = readCycles(file);
    const prior = cycles.find(row => row.cycleId === cycleId && JSON.stringify(row.queryContext) === JSON.stringify(queryContext));
    if (prior) return { response: prior.response, cycle: prior, reused: true };
    const status = rootResearchStatus(root, { dataDir, researchScopeId, now: now() });
    if (status.state === 'cooling') return { skipped: true, ...status };
    const response = await extract();
    if (response?.ok === false || !Array.isArray(response?.data) || response?.stepIncomplete) {
      const error = new Error(response?.error || response?.message || '生意参谋查询未完整完成');
      error.status = response?.status;
      error.details = response?.manualAction;
      throw error;
    }
    const previousWords = new Set((cycles.at(-1)?.response?.data || []).map(row => row.keyword).filter(Boolean));
    const words = [...new Set(response.data.map(row => row.keyword).filter(Boolean))];
    const cycle = {
      cycleId, root, researchScopeId, queryContext,
      completedAt: new Date(now()).toISOString(), response,
      comparison: {
        newKeywords: words.filter(word => !previousWords.has(word)),
        retainedKeywords: words.filter(word => previousWords.has(word))
      }
    };
    atomicWrite(file, [...cycles, cycle]);
    return { response, cycle, reused: false };
  } finally {
    fs.closeSync(handle);
    fs.unlinkSync(lock);
  }
}

/**
 * 固定同一次尝试的灵感和词根，暂停、失败重试不重新调用模型。
 * @param {string} file 快照路径。
 * @param {Function} discover 首次发现函数。
 * @returns {Promise<object>} 已保存的发现结果。
 */
async function discoverySnapshot(file, discover) {
  if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const result = await discover();
  if (file) atomicWrite(file, result);
  return result;
}

module.exports = { ROOT_RESEARCH_COOLDOWN_MS, normalizeResearchRoot, rootResearchStatus, researchRoot, discoverySnapshot };
