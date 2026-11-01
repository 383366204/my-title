const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, beforeEach } = require('node:test');

const {
  PlatformAccessError,
  clearPlatformAccessBlocker,
  getPlatformAccessStatus,
  reportPlatformBlocker,
  resetPlatformAccessState,
  runWithPlatformGuard
} = require('../../../core/platform-access-guard');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'platform-access-guard-'));
}

test('local upload state timeouts do not trip the breaker but real rate limits still do', async () => {
  const dataDir = tempDataDir();
  const options = { dataDir, cache: false, minCooldownMs: 0, maxCooldownMs: 0, failureThreshold: 1 };
  try {
    for (let i = 0; i < 3; i++) {
      await assert.rejects(runWithPlatformGuard('1688', options, async () => {
        throw Object.assign(new Error('上传状态未确认'), { code: 'IMAGE_UPLOAD_STATE_TIMEOUT' });
      }), { code: 'IMAGE_UPLOAD_STATE_TIMEOUT' });
    }
    let called = false;
    await runWithPlatformGuard('1688', options, async () => { called = true; });
    assert.equal(called, true);
    await assert.rejects(runWithPlatformGuard('1688', options, async () => {
      throw new PlatformAccessError('访问过于频繁', { status: 'rate_limited' });
    }));
    await assert.rejects(runWithPlatformGuard('1688', options, async () => {}), { code: 'PLATFORM_ACCESS_BLOCKED' });
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('expired session lock belonging to a live local process is not stolen', async () => {
  const dataDir = tempDataDir();
  const lockDir = path.join(dataDir, '1688', 'lock');
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, host: os.hostname(), acquiredAt: '2020-01-01T00:00:00Z' }));
  let called = false;
  try {
    await assert.rejects(runWithPlatformGuard('1688', { dataDir, cache: false, staleLockMs: 1, lockTimeoutMs: 1 }, async () => { called = true; }), { code: 'PLATFORM_ACCESS_LOCK_TIMEOUT' });
    assert.equal(called, false);
    assert.equal(fs.existsSync(lockDir), true);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('dead local owner can be recovered but release cannot remove a different token', async () => {
  const dataDir = tempDataDir();
  const lockDir = path.join(dataDir, '1688', 'lock');
  const exited = require('child_process').spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: exited.pid, host: os.hostname(), acquiredAt: '2020-01-01T00:00:00Z' }));
  try {
    await runWithPlatformGuard('1688', { dataDir, cache: false, staleLockMs: 1, minCooldownMs: 0, maxCooldownMs: 0 }, async () => {
      const owner = JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8'));
      assert.equal(owner.pid, process.pid);
      assert.ok(owner.token);
      fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ ...owner, token: 'different-owner' }));
    });
    assert.equal(fs.existsSync(lockDir), true);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

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

test('platform guard reports cooldown without shortening the wait', async () => {
  const dataDir = tempDataDir();
  const updates = [];

  await runWithPlatformGuard('sycm', {
    dataDir,
    cache: false,
    minCooldownMs: 0,
    maxCooldownMs: 0
  }, async () => ({ ok: true }));

  const started = Date.now();
  await runWithPlatformGuard('sycm', {
    dataDir,
    cache: false,
    minCooldownMs: 35,
    maxCooldownMs: 35,
    onCooldown: state => updates.push(state)
  }, async () => ({ ok: true }));

  assert.ok(Date.now() - started >= 30);
  assert.ok(updates.length > 0);
  assert.equal(updates[0].platform, 'sycm');
  assert.ok(updates[0].remainingMs > 0);
});

test('platform guard applies a longer cooldown at a configured batch boundary', async () => {
  const dataDir = tempDataDir();
  for (let index = 0; index < 2; index += 1) {
    await runWithPlatformGuard('sycm', {
      dataDir,
      cache: false,
      minCooldownMs: 0,
      maxCooldownMs: 0
    }, async () => ({ ok: true }));
  }

  const started = Date.now();
  await runWithPlatformGuard('sycm', {
    dataDir,
    cache: false,
    minCooldownMs: 0,
    maxCooldownMs: 0,
    batchSize: 2,
    minBatchCooldownMs: 35,
    maxBatchCooldownMs: 35
  }, async () => ({ ok: true }));

  assert.ok(Date.now() - started >= 25);
});

test('platform guard can pause before a cooled-down request reaches the platform', async () => {
  const dataDir = tempDataDir();
  await runWithPlatformGuard('sycm', {
    dataDir,
    cache: false,
    minCooldownMs: 0,
    maxCooldownMs: 0
  }, async () => ({ ok: true }));

  let calls = 0;
  await assert.rejects(
    () => runWithPlatformGuard('sycm', {
      dataDir,
      cache: false,
      minCooldownMs: 10_000,
      maxCooldownMs: 10_000,
      shouldStop: () => 'pause'
    }, async () => {
      calls += 1;
      return { ok: true };
    }),
    (err) => err instanceof PlatformAccessError
      && err.code === 'PLATFORM_ACCESS_INTERRUPTED'
      && err.status === 'pause'
  );
  assert.equal(calls, 0);
  assert.equal(getPlatformAccessStatus('sycm', { dataDir }).available, true);
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

test('platform blocker can be cleared after the user restores browser access', () => {
  const dataDir = tempDataDir();
  reportPlatformBlocker('sycm', {
    dataDir,
    status: 'transient_failure',
    message: 'No Chrome tab found on port 9222',
    cooldownMs: 60_000
  });

  const cleared = clearPlatformAccessBlocker('sycm', { dataDir });

  assert.equal(cleared.available, true);
  assert.equal(cleared.breaker.open, false);
  assert.equal(cleared.manualAction, null);
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
