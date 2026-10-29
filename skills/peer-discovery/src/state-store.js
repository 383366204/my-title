'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { AsyncLocalStorage } = require('node:async_hooks');

const lockContext = new AsyncLocalStorage();

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  throw new Error('同行发现状态包含不可持久化的值');
}

/**
 * Fingerprint version dependencies independently of object property order.
 * @param {unknown} value JSON-compatible evidence or configuration.
 * @returns {string} SHA256 content identity.
 */
function fingerprint(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function atomicJson(file, value) {
  const content = canonical(value);
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temp, 'wx', 0o600);
    try { await handle.writeFile(content); await handle.sync(); }
    finally { await handle.close(); }
    await fs.rename(temp, file);
    const directory = await fs.open(path.dirname(file), 'r');
    try { await directory.sync(); }
    catch (error) { if (!['EINVAL', 'ENOTSUP', 'EPERM'].includes(error.code)) throw error; }
    finally { await directory.close(); }
  }
  finally { await fs.rm(temp, { force: true }); }
}

function conflict(message) { return Object.assign(new Error(message), { code: 'PEER_REVISION_CONFLICT' }); }

/**
 * Store current state atomically, referencing immutable evidence objects.
 * @param {string} runDir Existing pipeline run directory.
 * @returns {object} Initialization, revision transactions and snapshot methods.
 */
function createPeerStateStore(runDir) {
  if (typeof runDir !== 'string' || !path.isAbsolute(runDir)) throw new Error('运行目录须为绝对路径');
  const dir = path.join(runDir, 'peer-discovery');
  const file = path.join(dir, 'current.json');
  const lock = path.join(dir, 'write.lock');

  async function withLock(operation, { signal, timeoutMs = 10000 } = {}) {
    const activeLocks = lockContext.getStore();
    if (activeLocks && activeLocks.has(dir)) {
      return await operation();
    }

    await fs.mkdir(dir, { recursive: true });
    const token = randomUUID();
    const deadline = Date.now() + timeoutMs;
    while (true) {
      signal?.throwIfAborted();
      try {
        await fs.mkdir(lock);
        await atomicJson(path.join(lock, 'owner.json'), { token, pid: process.pid, host: os.hostname(), createdAt: Date.now() });
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        // 不按时长抢锁；仅清理已确认死亡的同机执行器。
        const owner = await readJson(path.join(lock, 'owner.json'));
        if (owner?.host === os.hostname() && Number.isInteger(owner.pid) && owner.pid > 0) {
          let dead = false;
          try { process.kill(owner.pid, 0); } catch (cause) { dead = cause.code === 'ESRCH'; }
          if (dead) {
            const reclaim = `${lock}.reclaim`;
            let owned = false;
            try {
              await fs.mkdir(reclaim);
              owned = true;
              const current = await readJson(path.join(lock, 'owner.json'));
              if (current?.token === owner.token && current?.pid === owner.pid) {
                await fs.rm(lock, { recursive: true, force: true });
              }
            } catch (cause) { if (!['ENOENT', 'EEXIST'].includes(cause.code)) throw cause; }
            finally { if (owned) await fs.rm(reclaim, { recursive: true, force: true }); }
          }
        }
        if (Date.now() >= deadline) throw Object.assign(new Error('当前运行正在更新，请稍后重试'), { code: 'PEER_STATE_BUSY' });
        await delay(25);
      }
    }
    const nextLocks = new Set(activeLocks);
    nextLocks.add(dir);
    try {
      return await lockContext.run(nextLocks, () => operation());
    } finally {
      const owner = await readJson(path.join(lock, 'owner.json'));
      if (owner?.token === token) await fs.rm(lock, { recursive: true, force: true });
    }
  }

  return {
    withLock,
    async initialize(params) {
      return withLock(async () => {
        const previous = await readJson(file);
        if (previous) {
          if (previous.params.discoveryBranch !== params.discoveryBranch) throw conflict('运行开始后不能切换分支');
          return previous;
        }
        const state = { schemaVersion: 1, revision: 0, params, manifest: {}, checkpoints: {}, bundle: null, ledger: {}, createdAt: Date.now() };
        await atomicJson(file, state);
        return state;
      });
    },
    async read() {
      const state = await readJson(file);
      if (!state || state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision)) throw new Error('同行发现运行状态缺失或版本不支持');
      return state;
    },
    async transact(expectedRevision, mutate, options) {
      return withLock(async () => {
        const state = await this.read();
        if (state.revision !== expectedRevision) throw conflict('页面数据已更新，请刷新后再操作');
        const draft = structuredClone(state);
        const returned = mutate(draft);
        if (returned?.then) throw new Error('状态事务内禁止异步平台调用');
        if (draft.params.discoveryBranch !== state.params.discoveryBranch) throw conflict('运行开始后不能切换分支');
        if (fingerprint(state) === fingerprint(draft)) return state;
        draft.revision = state.revision + 1;
        await atomicJson(file, draft);
        return draft;
      }, options);
    },
    async writeSnapshot(value) {
      const revision = fingerprint(value);
      const snapshots = path.join(dir, 'snapshots');
      await fs.mkdir(snapshots, { recursive: true });
      const target = path.join(snapshots, `${revision}.json`);
      // 内容寻址对象不就地修改；先发布完整文件，再由事务切换manifest。
      await atomicJson(target, value);
      return revision;
    },
    async readSnapshot(revision) {
      if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error('快照版本无效');
      const value = await readJson(path.join(dir, 'snapshots', `${revision}.json`));
      if (value === null || fingerprint(value) !== revision) throw new Error('快照缺失或内容校验失败');
      return value;
    }
  };
}

module.exports = { createPeerStateStore, fingerprint };
