/**
 * @file operation-store.js
 * @description 运行态操作受理与幂等持久化记录管理器
 * 符合 ADR v1.0 (D5)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isProcessAlive } = require('./workbench-lease');

/**
 * 递归对对象的 key 排序，实现稳定的 JSON 规范化序列化
 * @param {any} obj
 * @returns {any}
 */
function canonicalize(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(canonicalize);
  }
  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = canonicalize(obj[key]);
  }
  return sorted;
}

/**
 * 计算规范化入参摘要
 * @param {string} toolId
 * @param {any} input
 * @returns {string}
 */
function computeInputDigest(toolId, input) {
  const canonical = canonicalize({ toolId, input: input || {} });
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * 创建操作持久化管理器
 * @param {Object} [options]
 * @param {string} [options.operationsDir]
 */
function createOperationStore(options = {}) {
  const projectRoot = options.projectRoot || path.resolve(__dirname, '../../');
  const operationsDir = options.operationsDir || path.join(projectRoot, 'data', 'runtime', 'operations');

  fs.mkdirSync(operationsDir, { recursive: true });

  function getFilePath(requestId) {
    const raw = String(requestId);
    const safeKey = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
    const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
    return path.join(operationsDir, `${safeKey}_${hash}.json`);
  }

  /**
   * 读取已有操作记录
   * @param {string} requestId
   * @returns {Object|null}
   */
  function get(requestId) {
    if (!requestId) return null;
    const filePath = getFilePath(requestId);
    try {
      if (!fs.existsSync(filePath)) return null;
      const content = fs.readFileSync(filePath, 'utf8');
      const record = JSON.parse(content);

      // 若发现遗留的 running 且创建进程已死亡，标记为 unknown_interrupted
      if (record.status === 'running' && record.pid && !isProcessAlive(record.pid)) {
        record.status = 'unknown_interrupted';
        record.error = { message: '服务进程意外中断，操作状态未知，禁止自动重跑' };
        record.updatedAt = new Date().toISOString();
        save(record);
      }

      return record;
    } catch {
      return null;
    }
  }

  /**
   * 保存操作记录 (原子 tmp + rename)
   * @param {Object} record
   */
  function save(record) {
    if (!record || !record.requestId) return;
    const filePath = getFilePath(record.requestId);
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
  }

  /**
   * 原子受理操作请求 (利用 open 'wx' 排他创建，杜绝多进程并发提交相同 requestId 时的穿透竞争)
   * @param {string} requestId
   * @param {Object} initialRecord
   * @returns {{ claimed: boolean, record: Object }}
   */
  function claimOrGet(requestId, initialRecord) {
    if (!requestId) {
      return { claimed: true, record: initialRecord };
    }
    const filePath = getFilePath(requestId);
    let fd = null;
    try {
      fd = fs.openSync(filePath, 'wx');
      fs.writeFileSync(fd, JSON.stringify(initialRecord, null, 2), 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = null;
      return { claimed: true, record: initialRecord };
    } catch (err) {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch {}
      }
      if (err.code === 'EEXIST') {
        const existing = get(requestId);
        return { claimed: false, record: existing || initialRecord };
      }
      throw err;
    }
  }

  return {
    get,
    save,
    claimOrGet,
    getFilePath,
    computeInputDigest
  };
}

module.exports = {
  createOperationStore,
  computeInputDigest
};
