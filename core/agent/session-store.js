/**
 * @file session-store.js
 * @description Agent 会话持久化与状态恢复存储 (SessionStore)
 * 支持原子快照落盘 (writeJsonAtomic)、断点续跑以及进程崩溃僵尸会话自愈 (Zombie Sweep)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { writeJsonAtomic, isPidAlive } = require('../../skills/pipeline-flow/runtime/store');

const DEFAULT_SESSIONS_DIR = path.resolve(__dirname, '../../data/runtime/agent-sessions');

/**
 * 获取会话文件存储路径
 * @param {string} sessionId
 * @param {string} [dataDir]
 * @returns {string}
 */
function getSessionFilePath(sessionId, dataDir) {
  const safeId = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const baseDir = dataDir ? path.resolve(dataDir) : DEFAULT_SESSIONS_DIR;
  return path.join(baseDir, `${safeId}.json`);
}

class SessionStore {
  /**
   * @param {object} [options]
   * @param {string} [options.dataDir]
   */
  constructor(options = {}) {
    this.dataDir = options.dataDir ? path.resolve(options.dataDir) : DEFAULT_SESSIONS_DIR;
    if (!fs.existsSync(this.dataDir)) {
      try {
        fs.mkdirSync(this.dataDir, { recursive: true });
      } catch (_) {}
    }
  }

  /**
   * 保存会话快照（原子写入）
   * @param {object} session
   * @returns {object}
   */
  save(session) {
    if (!session || !session.sessionId) {
      throw new Error('saveSession: 必须提供包含有效 sessionId 的会话对象');
    }

    const filePath = getSessionFilePath(session.sessionId, this.dataDir);
    const now = new Date().toISOString();

    const snapshot = {
      sessionId: session.sessionId,
      status: session.status || 'running',
      pid: session.pid || process.pid,
      turnCount: session.turnCount || 0,
      maxTurns: session.maxTurns || 10,
      suspension: session.suspension || null,
      messages: session.messages || [],
      usage: session.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      createdAt: session.createdAt || now,
      updatedAt: now
    };

    writeJsonAtomic(filePath, snapshot);
    return snapshot;
  }

  /**
   * 读取会话快照（附带崩溃僵尸状态自愈检查）
   * @param {string} sessionId
   * @returns {object|null}
   */
  get(sessionId) {
    if (!sessionId) return null;
    const filePath = getSessionFilePath(sessionId, this.dataDir);
    if (!fs.existsSync(filePath)) return null;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const record = JSON.parse(content);
      if (!record || typeof record !== 'object') return null;

      // 僵尸会话自愈：若处于 running 状态但所在进程已经死亡，自动修正为 interrupted
      if (record.status === 'running') {
        const isCurrentPid = record.pid === process.pid;
        const alive = isCurrentPid || (record.pid && isPidAlive(record.pid));
        if (!alive) {
          record.status = 'interrupted';
          record.interruptedReason = '服务重启导致会话意外中断，可点击恢复继续运行';
          record.updatedAt = new Date().toISOString();
          try {
            writeJsonAtomic(filePath, record);
          } catch (_) {}
        }
      }

      return record;
    } catch (_) {
      return null;
    }
  }

  /**
   * 删除会话
   * @param {string} sessionId
   * @returns {boolean}
   */
  delete(sessionId) {
    if (!sessionId) return false;
    const filePath = getSessionFilePath(sessionId, this.dataDir);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  /**
   * 列出所有持久化会话
   * @returns {Array<object>}
   */
  list() {
    if (!fs.existsSync(this.dataDir)) return [];
    try {
      const files = fs.readdirSync(this.dataDir).filter(f => f.endsWith('.json'));
      const sessions = [];
      for (const file of files) {
        const id = file.replace(/\.json$/, '');
        const sess = this.get(id);
        if (sess) sessions.push(sess);
      }
      sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      return sessions;
    } catch (_) {
      return [];
    }
  }
}

/**
 * 工厂函数
 * @param {object} [options]
 * @returns {SessionStore}
 */
function createSessionStore(options = {}) {
  return new SessionStore(options);
}

module.exports = {
  SessionStore,
  createSessionStore,
  getSessionFilePath
};
