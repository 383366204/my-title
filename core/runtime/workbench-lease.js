/**
 * @file workbench-lease.js
 * @description 跨进程资源独占原子租约管理器（基于操作系统 open 'wx' 排他创建）
 * 符合 ADR v1.0 (D5) 及 Codex 联合对线定稿协议
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_TTL_MS = 30000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 10000;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 15000;
const DEFAULT_RETRY_INTERVAL_MS = 200;

class LeaseBusyError extends Error {
  constructor(resourceKey, owner) {
    super(`资源 [${resourceKey}] 当前被进程 [PID:${owner?.pid || 'unknown'}] 占用中，无法获取`);
    this.name = 'LeaseBusyError';
    this.code = 'LEASE_BUSY';
    this.resourceKey = resourceKey;
    this.owner = owner;
  }
}

class LeaseTimeoutError extends Error {
  constructor(resourceKey, timeoutMs) {
    super(`获取资源 [${resourceKey}] 租约超时 (${timeoutMs}ms)`);
    this.name = 'LeaseTimeoutError';
    this.code = 'LEASE_TIMEOUT';
    this.resourceKey = resourceKey;
  }
}

/**
 * 判断指定 PID 是否存活
 * 只有在 process.kill(pid, 0) 抛出 ESRCH 时确认死亡；EPERM 仍视同存活
 * @param {number} pid
 * @returns {boolean}
 */
function isProcessAlive(pid) {
  if (!pid || typeof pid !== 'number' || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === 'ESRCH') {
      return false; // 进程已明确退出
    }
    return true; // EPERM 等其他错误说明进程仍存在
  }
}

/**
 * 编码资源键为安全的文件名
 * @param {string} resourceKey
 * @returns {string}
 */
function encodeResourceKey(resourceKey) {
  return String(resourceKey).replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * 创建跨进程租约管理器
 * @param {Object} [options]
 * @param {string} [options.runtimeDir] 运行时租约存储目录
 * @param {number} [options.ttlMs] 租约超时时间（毫秒）
 * @param {number} [options.heartbeatIntervalMs] 心跳上报间隔（毫秒）
 */
function createWorkbenchLeaseManager(options = {}) {
  const projectRoot = options.projectRoot || path.resolve(__dirname, '../../');
  const runtimeDir = options.runtimeDir || path.join(projectRoot, 'data', 'runtime', 'leases');
  const defaultTtlMs = options.ttlMs || DEFAULT_TTL_MS;
  const heartbeatIntervalMs = options.heartbeatIntervalMs || DEFAULT_HEARTBEAT_INTERVAL_MS;

  // 确保目录存在
  fs.mkdirSync(runtimeDir, { recursive: true });

  // 记录本进程当前持有的活跃租约，供进程退出钩子安全清理
  /** @type {Map<string, { leasePath: string, ownerToken: string, heartbeatTimer: any }>} */
  const activeLeases = new Map();

  /**
   * 获取租约文件路径
   * @param {string} resourceKey
   * @returns {string}
   */
  function getLeasePath(resourceKey) {
    return path.join(runtimeDir, `${encodeResourceKey(resourceKey)}.lease`);
  }

  /**
   * 读取已有租约元数据
   * @param {string} leasePath
   * @returns {Object|null}
   */
  function readLeaseFile(leasePath) {
    try {
      if (!fs.existsSync(leasePath)) return null;
      const content = fs.readFileSync(leasePath, 'utf8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * 原子更新租约元数据 (基于 tmp + rename)
   * @param {string} leasePath
   * @param {Object} data
   */
  function writeMetadataAtomic(leasePath, data) {
    const tmpPath = `${leasePath}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, leasePath);
  }

  /**
   * 尝试原子获取短生命周期的回收互斥锁（具备陈旧回收锁自愈能力，防止因回收进程异常退出而遗留死锁 blocker）
   * @param {string} reclaimLockPath
   * @returns {{ release: () => void }|null}
   */
  function tryAcquireReclaimLock(reclaimLockPath) {
    function tryCreate() {
      let fd = null;
      try {
        fd = fs.openSync(reclaimLockPath, 'wx');
        const meta = { pid: process.pid, createdAt: Date.now() };
        fs.writeFileSync(fd, JSON.stringify(meta), 'utf8');
        fs.closeSync(fd);
        fd = null;
        return {
          release: () => {
            try { fs.unlinkSync(reclaimLockPath); } catch {}
          }
        };
      } catch (err) {
        if (fd !== null) {
          try { fs.closeSync(fd); } catch {}
        }
        if (err.code === 'EEXIST') {
          return null;
        }
        throw err;
      }
    }

    const lock = tryCreate();
    if (lock) return lock;

    // 回收锁已存在，检查是否被遗弃（持有者 PID 已死，或存在超过 5 秒的陈旧回收锁）
    try {
      let isAbandoned = false;
      try {
        const raw = fs.readFileSync(reclaimLockPath, 'utf8');
        const data = JSON.parse(raw);
        if (data && data.pid) {
          if (!isProcessAlive(data.pid) || (Date.now() - (data.createdAt || 0) > 5000)) {
            isAbandoned = true;
          }
        }
      } catch {
        // 文件为空或损坏
        const stat = fs.statSync(reclaimLockPath);
        if (Date.now() - stat.mtimeMs > 5000) {
          isAbandoned = true;
        }
      }

      if (isAbandoned) {
        try { fs.unlinkSync(reclaimLockPath); } catch {}
        return tryCreate();
      }
    } catch {}

    return null;
  }

  /**
   * 尝试原子获取单次租约（非阻塞）
   * @param {string} resourceKey
   * @param {Object} [meta={}]
   * @returns {Object|null} 成功返回租约句柄，失败返回 null
   */
  function tryAcquireOnce(resourceKey, meta = {}) {
    const leasePath = getLeasePath(resourceKey);
    const ownerToken = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    const ttlMs = meta.ttlMs || defaultTtlMs;

    const leaseData = {
      resourceKey,
      ownerToken,
      pid: process.pid,
      purpose: meta.purpose || 'unknown',
      acquiredAt: now,
      heartbeatAt: now,
      ttlMs
    };

    let fd = null;
    try {
      // 核心互斥基语：利用操作系统级 open 'wx' 进行排他性原子创建
      fd = fs.openSync(leasePath, 'wx');
      fs.writeFileSync(fd, JSON.stringify(leaseData, null, 2), 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = null;

      // 启动心跳续约
      const heartbeatTimer = setInterval(() => {
        try {
          const current = readLeaseFile(leasePath);
          if (current && current.ownerToken === ownerToken) {
            current.heartbeatAt = new Date().toISOString();
            writeMetadataAtomic(leasePath, current);
          } else {
            // 所有者不匹配说明被篡改或丢失，停止心跳
            clearInterval(heartbeatTimer);
          }
        } catch (err) {
          // 心跳更新异常
          clearInterval(heartbeatTimer);
        }
      }, heartbeatIntervalMs);

      // 避免阻止进程正常退出
      if (heartbeatTimer.unref) {
        heartbeatTimer.unref();
      }

      const leaseHandle = {
        resourceKey,
        leasePath,
        ownerToken,
        pid: process.pid,
        acquiredAt: now,
        release: () => release(resourceKey, ownerToken)
      };

      activeLeases.set(ownerToken, {
        leasePath,
        ownerToken,
        heartbeatTimer
      });

      return leaseHandle;
    } catch (err) {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch {}
      }

      if (err.code === 'EEXIST') {
        // 文件已存在，检查旧锁持有者状态
        const existing = readLeaseFile(leasePath);
        if (existing) {
          const alive = isProcessAlive(existing.pid);
          if (!alive) {
            // 确认原进程已经死亡 (ESRCH)，属于僵尸锁，通过互斥回收锁防止多个等待者竞态删除新锁
            const reclaimLockPath = `${leasePath}.reclaim`;
            const reclaimLock = tryAcquireReclaimLock(reclaimLockPath);
            if (reclaimLock) {
              try {
                // 获取到回收锁后，再次核验 leasePath 的持有者 token 依然等于刚才确认死亡的 token
                const recheck = readLeaseFile(leasePath);
                if (recheck && recheck.ownerToken === existing.ownerToken && !isProcessAlive(recheck.pid)) {
                  fs.unlinkSync(leasePath);
                }
              } finally {
                reclaimLock.release();
              }
            }
          }
          // 注意：如果原进程依然存活 (alive === true)，即使心跳超时也绝不抢占（由上层决定排队等待）
        } else {
          // 文件存在但无法解析为有效 JSON（可能因上个进程在 openSync 后未来得及写入即被杀死，或内容损坏）
          try {
            const stat = fs.statSync(leasePath);
            if (Date.now() - stat.mtimeMs > defaultTtlMs) {
              const reclaimLockPath = `${leasePath}.reclaim`;
              const reclaimLock = tryAcquireReclaimLock(reclaimLockPath);
              if (reclaimLock) {
                try {
                  const recheck = readLeaseFile(leasePath);
                  if (recheck === null && fs.existsSync(leasePath)) {
                    const recheckStat = fs.statSync(leasePath);
                    if (Date.now() - recheckStat.mtimeMs > defaultTtlMs) {
                      fs.unlinkSync(leasePath);
                    }
                  }
                } finally {
                  reclaimLock.release();
                }
              }
            }
          } catch {
            // stat 失败（如文件刚被删除）忽略
          }
        }
        return null;
      }

      throw err;
    }
  }

  /**
   * 释放租约
   * @param {string} resourceKey
   * @param {string} ownerToken
   * @returns {boolean}
   */
  function release(resourceKey, ownerToken) {
    const leaseRecord = activeLeases.get(ownerToken);
    if (leaseRecord) {
      clearInterval(leaseRecord.heartbeatTimer);
      activeLeases.delete(ownerToken);
    }

    const leasePath = getLeasePath(resourceKey);
    try {
      const current = readLeaseFile(leasePath);
      // 只有 token 匹配时才真正 unlink，防止释放了别人的新锁
      if (current && current.ownerToken === ownerToken) {
        fs.unlinkSync(leasePath);
        return true;
      }
    } catch {
      // 忽略文件不存在或已被删除的情况
    }
    return false;
  }

  /**
   * 轮询获取租约（支持超时）
   * @param {string} resourceKey
   * @param {Object} [options={}]
   * @param {number} [options.timeoutMs]
   * @param {number} [options.retryIntervalMs]
   * @param {string} [options.purpose]
   * @returns {Promise<Object>}
   */
  async function acquire(resourceKey, options = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
    const retryIntervalMs = options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
    const startTime = Date.now();

    while (true) {
      if (options.signal?.aborted || (typeof options.shouldStop === 'function' && options.shouldStop())) {
        const abortErr = new Error(`获取租约 [${resourceKey}] 已被中止`);
        abortErr.code = 'OPERATION_ABORTED';
        abortErr.nonPlatform = true;
        throw abortErr;
      }

      const lease = tryAcquireOnce(resourceKey, options);
      if (lease) {
        return lease;
      }

      if (Date.now() - startTime >= timeoutMs) {
        const existing = readLeaseFile(getLeasePath(resourceKey));
        if (existing && isProcessAlive(existing.pid)) {
          throw new LeaseBusyError(resourceKey, existing);
        }
        throw new LeaseTimeoutError(resourceKey, timeoutMs);
      }

      await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
    }
  }

  /**
   * 高阶包装器：持有租约执行异步函数，并在 finally 中确保释放
   * @template T
   * @param {string} resourceKey
   * @param {Object} options
   * @param {(lease: Object) => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async function withLease(resourceKey, options, fn) {
    if (typeof options === 'function') {
      fn = options;
      options = {};
    }
    const lease = await acquire(resourceKey, options);
    try {
      return await fn(lease);
    } finally {
      lease.release();
    }
  }

  /**
   * 释放本进程持有的所有租约（用于安全退出）
   */
  function releaseAll() {
    for (const [token, record] of activeLeases.entries()) {
      try {
        clearInterval(record.heartbeatTimer);
        const current = readLeaseFile(record.leasePath);
        if (current && current.ownerToken === token) {
          fs.unlinkSync(record.leasePath);
        }
      } catch {}
    }
    activeLeases.clear();
  }

  return {
    acquire,
    tryAcquireOnce,
    release,
    withLease,
    releaseAll,
    getLeasePath,
    readLeaseFile,
    isProcessAlive
  };
}

// 注册全局进程退出安全钩子，清理遗留租约
let globalHookInstalled = false;
function installGlobalProcessHooks(manager) {
  if (globalHookInstalled) return;
  globalHookInstalled = true;

  const cleanup = () => {
    try {
      manager.releaseAll();
    } catch {}
  };

  process.once('exit', cleanup);
  process.once('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });
}

// 默认单例
let defaultInstance = null;
function getLeaseManager(options) {
  if (!defaultInstance) {
    defaultInstance = createWorkbenchLeaseManager(options);
    installGlobalProcessHooks(defaultInstance);
  }
  return defaultInstance;
}

module.exports = {
  createWorkbenchLeaseManager,
  getLeaseManager,
  isProcessAlive,
  LeaseBusyError,
  LeaseTimeoutError
};
