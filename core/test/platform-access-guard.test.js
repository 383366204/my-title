const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, beforeEach } = require('node:test');

const {
  PlatformAccessError,
  getPlatformAccessStatus,
  reportPlatformBlocker,
  resetPlatformAccessState,
  runWithPlatformGuard
} = require('../platform-access-guard');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'platform-access-guard-'));
}

beforeEach(() => {
  resetPlatformAccessState();
});

test('platform guard returns cached result without calling operation', async () => {
  const dataDir = tempDataDir();
  let calls = 0;

  const first = await runWithPlatformGuard('sycm', {
    dataDir,
    cacheKey: { keyword: '陶瓷摆件', mode: 'blue' },
    cacheTtlMs: 60_000,
    minCooldownMs: 0,
    maxCooldownMs: 0
  }, async () => {
    calls++;
    return { keyword: '陶瓷摆件', data: [{ keyword: '陶瓷摆件' }] };
  });

  const second = await runWithPlatformGuard('sycm', {
    dataDir,
    cacheKey: { keyword: '陶瓷摆件', mode: 'blue' },
    cacheTtlMs: 60_000,
    minCooldownMs: 0,
    maxCooldownMs: 0
  }, async () => {
    calls++;
    return { keyword: '陶瓷摆件', data: [] };
  });

  assert.equal(calls, 1);
  assert.equal(second.keyword, first.keyword);
  assert.deepEqual(second.data, first.data);
  assert.equal(second._guard.cacheHit, true);
});

test('platform guard opens breaker after hard blocker and blocks following calls locally', async () => {
  const dataDir = tempDataDir();
  const slider = new Error('需要滑块验证');
  slider.status = 'slider_required';

  await assert.rejects(
    () => runWithPlatformGuard('sycm', {
      dataDir,
      cache: false,
      minCooldownMs: 0,
      maxCooldownMs: 0,
      breakerCooldownMs: 60_000
    }, async () => {
      throw slider;
    }),
    /需要滑块验证/
  );

  const status = getPlatformAccessStatus('sycm', { dataDir });
  assert.equal(status.breaker.open, true);
  assert.equal(status.manualAction.status, 'slider_required');

  let calls = 0;
  await assert.rejects(
    () => runWithPlatformGuard('sycm', {
      dataDir,
      cache: false,
      minCooldownMs: 0,
      maxCooldownMs: 0,
      breakerCooldownMs: 60_000
    }, async () => {
      calls++;
      return { ok: true };
    }),
    (err) => err instanceof PlatformAccessError && err.code === 'PLATFORM_ACCESS_BLOCKED'
  );
  assert.equal(calls, 0);
});

test('platform guard applies cooldown between successful calls', async () => {
  const dataDir = tempDataDir();
  const started = Date.now();

  await runWithPlatformGuard('sycm', {
    dataDir,
    cache: false,
    minCooldownMs: 0,
    maxCooldownMs: 0
  }, async () => ({ ok: true }));

  await runWithPlatformGuard('sycm', {
    dataDir,
    cache: false,
    minCooldownMs: 35,
    maxCooldownMs: 35
  }, async () => ({ ok: true }));

  assert.ok(Date.now() - started >= 30);
});

test('platform blocker report protects 1688 without using browser-specific code', () => {
  const dataDir = tempDataDir();
  reportPlatformBlocker('1688', {
    dataDir,
    status: 'rate_limited',
    message: '1688 API 429',
    cooldownMs: 60_000
  });

  const status = getPlatformAccessStatus('1688', { dataDir });
  assert.equal(status.breaker.open, true);
  assert.equal(status.manualAction.status, 'rate_limited');
});

test('platform guard exposes normalized ready status for taobao', () => {
  const dataDir = tempDataDir();
  const status = getPlatformAccessStatus('taobao', { dataDir });

  assert.equal(status.platform, 'taobao');
  assert.equal(status.available, true);
  assert.equal(status.status, 'ready');
  assert.equal(status.cooldownRemainingMs, 0);
  assert.equal(status.manualAction, null);
  assert.equal(status.breaker.open, false);
});

test('platform guard classifies slider text as hard blocker status', async () => {
  const dataDir = tempDataDir();
  const err = new Error('淘宝出现滑块验证，请稍后重试');

  await assert.rejects(
    () => runWithPlatformGuard('taobao', {
      dataDir,
      cache: false,
      minCooldownMs: 0,
      maxCooldownMs: 0,
      breakerCooldownMs: 60_000
    }, async () => {
      throw err;
    }),
    /滑块验证/
  );

  const status = getPlatformAccessStatus('taobao', { dataDir });
  assert.equal(status.status, 'slider_required');
  assert.equal(status.available, false);
  assert.equal(status.manualAction.status, 'slider_required');
});
