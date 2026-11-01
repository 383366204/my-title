/**
 * @file runtime-workbench-lease.test.js
 * @description 跨进程资源独占原子租约单测与并发互斥测试
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createWorkbenchLeaseManager, LeaseBusyError, LeaseTimeoutError } = require('../../../core/runtime/workbench-lease');

const TEST_RUNTIME_DIR = path.resolve(__dirname, '../../../data/test-runtime-leases');

describe('core/runtime/workbench-lease', () => {
  before(() => {
    fs.mkdirSync(TEST_RUNTIME_DIR, { recursive: true });
  });

  after(() => {
    try {
      fs.rmSync(TEST_RUNTIME_DIR, { recursive: true, force: true });
    } catch {}
  });

  it('应当能正常获取并释放租约', async () => {
    const manager = createWorkbenchLeaseManager({ runtimeDir: TEST_RUNTIME_DIR, ttlMs: 5000 });
    const lease = await manager.acquire('cdp:9222', { purpose: 'test-basic' });

    assert.equal(lease.resourceKey, 'cdp:9222');
    assert.equal(lease.pid, process.pid);
    assert.ok(fs.existsSync(lease.leasePath));

    const fileContent = JSON.parse(fs.readFileSync(lease.leasePath, 'utf8'));
    assert.equal(fileContent.ownerToken, lease.ownerToken);
    assert.equal(fileContent.purpose, 'test-basic');

    const released = lease.release();
    assert.equal(released, true);
    assert.equal(fs.existsSync(lease.leasePath), false);
  });

  it('withLease 应当在函数抛错时依然安全释放租约', async () => {
    const manager = createWorkbenchLeaseManager({ runtimeDir: TEST_RUNTIME_DIR });
    const resourceKey = 'cdp:9223';
    const leasePath = manager.getLeasePath(resourceKey);

    await assert.rejects(
      async () => {
        await manager.withLease(resourceKey, async () => {
          assert.ok(fs.existsSync(leasePath));
          throw new Error('business_error');
        });
      },
      /business_error/
    );

    assert.equal(fs.existsSync(leasePath), false);
  });

  it('死锁/僵尸进程锁 (PID 已死) 应当被安全清理并接管', async () => {
    const manager = createWorkbenchLeaseManager({ runtimeDir: TEST_RUNTIME_DIR });
    const resourceKey = 'cdp:9224';
    const leasePath = manager.getLeasePath(resourceKey);

    // 手动构造一个持有者 PID 为已死亡进程 (99999999) 的陈旧租约
    const fakeZombieLease = {
      resourceKey,
      ownerToken: 'zombie-token',
      pid: 99999999, // 不存在的 PID
      purpose: 'zombie',
      acquiredAt: new Date(Date.now() - 60000).toISOString(),
      heartbeatAt: new Date(Date.now() - 60000).toISOString(),
      ttlMs: 5000
    };
    fs.writeFileSync(leasePath, JSON.stringify(fakeZombieLease, null, 2), 'utf8');

    // 尝试获取该资源，应当识别出 PID 死亡并回收接管
    const newLease = await manager.acquire(resourceKey, { timeoutMs: 1000 });
    assert.equal(newLease.pid, process.pid);
    assert.notEqual(newLease.ownerToken, 'zombie-token');

    newLease.release();
    assert.equal(fs.existsSync(leasePath), false);
  });

  it('损坏或空的陈旧租约文件 (mtime 超时) 应当被安全回收接管', async () => {
    const manager = createWorkbenchLeaseManager({ runtimeDir: TEST_RUNTIME_DIR, ttlMs: 100 });
    const resourceKey = 'cdp:9224b';
    const leasePath = manager.getLeasePath(resourceKey);

    // 写入一个损坏的非 JSON 内容，并将 mtime 设置为 500ms 前（超过 ttlMs 100ms）
    fs.writeFileSync(leasePath, '{corrupted-json...', 'utf8');
    const pastTime = (Date.now() - 500) / 1000;
    fs.utimesSync(leasePath, pastTime, pastTime);

    // 尝试获取该资源，应当识别出损坏且超时，并安全回收接管
    const newLease = await manager.acquire(resourceKey, { timeoutMs: 1000 });
    assert.equal(newLease.pid, process.pid);
    assert.ok(fs.existsSync(leasePath));

    newLease.release();
    assert.equal(fs.existsSync(leasePath), false);
  });

  it('活进程锁未释放时，新请求超时应当抛出 LeaseBusyError 且禁止强抢', async () => {
    const manager = createWorkbenchLeaseManager({ runtimeDir: TEST_RUNTIME_DIR });
    const resourceKey = 'cdp:9225';

    // 先由当前进程获取
    const firstLease = await manager.acquire(resourceKey, { purpose: 'held-by-alive-process' });

    // 另一个管理器尝试获取同一锁（超时时间 300ms）
    const secondManager = createWorkbenchLeaseManager({ runtimeDir: TEST_RUNTIME_DIR });
    await assert.rejects(
      async () => {
        await secondManager.acquire(resourceKey, { timeoutMs: 300, retryIntervalMs: 50 });
      },
      (err) => {
        assert.ok(err instanceof LeaseBusyError);
        assert.equal(err.resourceKey, resourceKey);
        assert.equal(err.owner.pid, process.pid);
        return true;
      }
    );

    // 验证原锁依然完整，未被篡改
    const fileContent = JSON.parse(fs.readFileSync(firstLease.leasePath, 'utf8'));
    assert.equal(fileContent.ownerToken, firstLease.ownerToken);

    firstLease.release();
  });

  it('两个独立子进程争抢同一 CDP 资源时，操作区间应当严格互斥不重叠', async () => {
    const resourceKey = 'cdp:9226';
    const scriptPath = path.resolve(__dirname, '../../../core/runtime/workbench-lease.js');
    const logFile = path.join(TEST_RUNTIME_DIR, 'concurrency-timeline.jsonl');

    // 清理旧日志
    try { fs.unlinkSync(logFile); } catch {}

    // 编写子进程任务脚本
    const childWorkerCode = `
      const fs = require('fs');
      const { createWorkbenchLeaseManager } = require(${JSON.stringify(scriptPath)});
      const manager = createWorkbenchLeaseManager({ runtimeDir: ${JSON.stringify(TEST_RUNTIME_DIR)} });

      async function run() {
        const lease = await manager.acquire(${JSON.stringify(resourceKey)}, { timeoutMs: 10000, retryIntervalMs: 50 });
        const start = Date.now();
        // 模拟执行占用 200ms
        await new Promise(r => setTimeout(r, 200));
        const end = Date.now();
        fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({ pid: process.pid, start, end }) + '\\n');
        lease.release();
      }
      run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
    `;

    // 同时启动 2 个子进程争抢同一 CDP 资源
    const p1 = spawn('node', ['-e', childWorkerCode]);
    const p2 = spawn('node', ['-e', childWorkerCode]);

    await Promise.all([
      new Promise((resolve) => p1.on('close', resolve)),
      new Promise((resolve) => p2.on('close', resolve))
    ]);

    assert.ok(fs.existsSync(logFile), '应当产生执行时间线日志');
    const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    assert.equal(lines.length, 2, '两个子进程都应执行成功');

    const [first, second] = lines.sort((a, b) => a.start - b.start);
    // 互斥校验：第二个进程的开始时间必须大于或等于第一个进程的结束时间 (允许 5ms 调度误差)
    assert.ok(
      second.start >= first.end - 5,
      `操作区间发生并发重叠: First(${first.start}~${first.end}) vs Second(${second.start}~${second.end})`
    );
  });
});
