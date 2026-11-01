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
   * 原子受理操作请求 (利用原子硬链接或排他创建，杜绝多进程并发提交相同 requestId 时的穿透竞争)
   * @param {string} requestId
   * @param {Object} initialRecord
   * @returns {{ claimed: boolean, record: Object }}
   */
  function claimOrGet(requestId, initialRecord) {
    if (!requestId) {
      return { claimed: true, record: initialRecord };
    }
    const filePath = getFilePath(requestId);
    const tmpPath = `${filePath}.claim.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(tmpPath, JSON.stringify(initialRecord, null, 2), 'utf8');

    let claimed = false;
    try {
      // 优先尝试原子硬链接创建：天然保证一旦目标文件出现，其内容必然已完整写入，消除并发时读到半写入文件的窗口
      fs.linkSync(tmpPath, filePath);
      claimed = true;
    } catch (err) {
      if (err.code !== 'EEXIST') {
        // 如果底层不支持 linkSync (如跨文件系统)，降级为 openSync 'wx' 互斥创建
        let fd = null;
        try {
          fd = fs.openSync(filePath, 'wx');
          fs.writeFileSync(fd, JSON.stringify(initialRecord, null, 2), 'utf8');
          fs.fsyncSync(fd);
          fs.closeSync(fd);
          fd = null;
          claimed = true;
        } catch (openErr) {
          if (fd !== null) try { fs.closeSync(fd); } catch {}
          if (openErr.code !== 'EEXIST') throw openErr;
        }
      }
    } finally {
      try { fs.unlinkSync(tmpPath); } catch {}
    }

    if (claimed) {
      return { claimed: true, record: initialRecord };
    }

    // 此时文件已存在，读取已有记录（若正好遇上并发写落盘微小窗口，重试轮询等待最多 500ms）
    let existing = null;
    const deadline = Date.now() + 500;
    while (!existing && Date.now() < deadline) {
      existing = get(requestId);
      if (existing) break;
      const waitTill = Date.now() + 20;
      while (Date.now() < waitTill) {}
    }

    if (existing) {
      return { claimed: false, record: existing };
    }

    // 500ms 后依然无法读取有效 JSON，说明原创建进程在写入中途确实崩溃
    const interruptedRecord = {
      requestId,
      toolId: initialRecord?.toolId || 'unknown',
      inputDigest: initialRecord?.inputDigest || '',
      status: 'unknown_interrupted',
      error: '操作创建时原进程中断，状态不可考',
      createdAt: initialRecord?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    try {
      save(interruptedRecord);
    } catch {}
    return { claimed: false, record: interruptedRecord };
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
