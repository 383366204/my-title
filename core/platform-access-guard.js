'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data', 'platform-access');
const HARD_BLOCKER_STATUSES = new Set([
  'login_required',
  'slider_required',
  'captcha_required',
  'sycm_feature_required',
  'rate_limited',
  '429'
]);

class PlatformAccessError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'PlatformAccessError';
    this.code = details.code || 'PLATFORM_ACCESS_BLOCKED';
    this.status = details.status || 'blocked';
    this.platform = details.platform || '';
    this.cooldownRemainingMs = details.cooldownRemainingMs || 0;
    this.details = details;
  }
}

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function platformDefaults(platform) {
  const normalized = normalizePlatform(platform);
  if (normalized === 'sycm' || normalized === 'taobao') {
    return {
      cacheTtlMs: envNumber('SYCM_CACHE_TTL_MS', 24 * 60 * 60 * 1000),
      minCooldownMs: envNumber('SYCM_MIN_COOLDOWN_MS', 20_000),
      maxCooldownMs: envNumber('SYCM_MAX_COOLDOWN_MS', 60_000),
      breakerCooldownMs: envNumber('SYCM_BREAKER_COOLDOWN_MS', 15 * 60 * 1000),
      failureThreshold: envNumber('SYCM_BREAKER_FAIL_THRESHOLD', 3),
      lockTimeoutMs: envNumber('SYCM_LOCK_TIMEOUT_MS', 3 * 60 * 1000),
      staleLockMs: envNumber('SYCM_STALE_LOCK_MS', 2 * 60 * 1000)
    };
  }
  if (normalized === '1688') {
    return {
      cacheTtlMs: envNumber('ALI1688_CACHE_TTL_MS', 6 * 60 * 60 * 1000),
      minCooldownMs: envNumber('ALI1688_MIN_COOLDOWN_MS', 2_000),
      maxCooldownMs: envNumber('ALI1688_MAX_COOLDOWN_MS', 6_000),
      breakerCooldownMs: envNumber('ALI1688_BREAKER_COOLDOWN_MS', envNumber('API_429_COOLDOWN', 60 * 60 * 1000)),
      failureThreshold: envNumber('ALI1688_BREAKER_FAIL_THRESHOLD', 2),
      lockTimeoutMs: envNumber('ALI1688_LOCK_TIMEOUT_MS', 60_000),
      staleLockMs: envNumber('ALI1688_STALE_LOCK_MS', 60_000)
    };
  }
  return {
    cacheTtlMs: envNumber('PLATFORM_GUARD_CACHE_TTL_MS', 24 * 60 * 60 * 1000),
    minCooldownMs: envNumber('PLATFORM_GUARD_MIN_COOLDOWN_MS', 5_000),
    maxCooldownMs: envNumber('PLATFORM_GUARD_MAX_COOLDOWN_MS', 15_000),
    breakerCooldownMs: envNumber('PLATFORM_GUARD_BREAKER_COOLDOWN_MS', 15 * 60 * 1000),
    failureThreshold: envNumber('PLATFORM_GUARD_FAIL_THRESHOLD', 3),
    lockTimeoutMs: envNumber('PLATFORM_GUARD_LOCK_TIMEOUT_MS', 60_000),
    staleLockMs: envNumber('PLATFORM_GUARD_STALE_LOCK_MS', 60_000)
  };
}

function normalizePlatform(platform) {
  return String(platform || 'platform').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
}

function resolveDataDir(options = {}) {
  return options.dataDir || process.env.ECOM_PLATFORM_GUARD_DIR || DEFAULT_DATA_DIR;
}

function platformDir(platform, options = {}) {
  return path.join(resolveDataDir(options), normalizePlatform(platform));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, payload) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function cacheHash(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function sleep(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomBetween(min, max, random = Math.random) {
  if (max <= min) return min;
  return min + Math.floor(random() * (max - min + 1));
}

function statusFiles(platform, options = {}) {
  const dir = platformDir(platform, options);
  return {
    dir,
    cacheDir: path.join(dir, 'cache'),
    lockDir: path.join(dir, 'lock'),
    state: path.join(dir, 'state.json'),
    breaker: path.join(dir, 'breaker.json'),
    manualAction: path.join(dir, 'manual-action.json')
  };
}

function readCache(platform, cacheKey, options) {
  if (options.cache === false || !cacheKey) return { hit: false };
  const files = statusFiles(platform, options);
  const hash = cacheHash({ platform: normalizePlatform(platform), cacheKey });
  const file = path.join(files.cacheDir, `${hash}.json`);
  const cached = readJson(file, null);
  if (!cached) return { hit: false };
  const ttlMs = options.cacheTtlMs;
  if (ttlMs > 0 && Date.now() - Date.parse(cached.createdAt || 0) > ttlMs) {
    return { hit: false, expired: true };
  }
  return { hit: true, value: cached.value, file };
}

function writeCache(platform, cacheKey, value, options) {
  if (options.cache === false || !cacheKey) return;
  const files = statusFiles(platform, options);
  const hash = cacheHash({ platform: normalizePlatform(platform), cacheKey });
  writeJson(path.join(files.cacheDir, `${hash}.json`), {
    createdAt: new Date().toISOString(),
    value
  });
}

async function withPlatformLock(platform, options, fn) {
  const files = statusFiles(platform, options);
  const timeoutAt = Date.now() + options.lockTimeoutMs;
  ensureDir(files.dir);

  while (true) {
    try {
      fs.mkdirSync(files.lockDir);
      writeJson(path.join(files.lockDir, 'owner.json'), {
        pid: process.pid,
        host: os.hostname(),
        acquiredAt: new Date().toISOString()
      });
      break;
    } catch (err) {
      const owner = readJson(path.join(files.lockDir, 'owner.json'), null);
      const acquiredAt = owner && Date.parse(owner.acquiredAt);
      if (acquiredAt && Date.now() - acquiredAt > options.staleLockMs) {
        try {
          fs.rmSync(files.lockDir, { recursive: true, force: true });
          continue;
        } catch (_) {}
      }
      if (Date.now() >= timeoutAt) {
        throw new PlatformAccessError(`${platform} access guard lock timeout`, {
          platform,
          status: 'lock_timeout',
          code: 'PLATFORM_ACCESS_LOCK_TIMEOUT'
        });
      }
      await sleep(200);
    }
  }

  try {
    return await fn();
  } finally {
    try {
      fs.rmSync(files.lockDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

function breakerStatus(platform, options) {
  const files = statusFiles(platform, options);
  const breaker = readJson(files.breaker, {});
  const openUntil = Date.parse(breaker.openUntil || 0);
  if (openUntil && Date.now() < openUntil) {
    return {
      open: true,
      openUntil: breaker.openUntil,
      cooldownRemainingMs: openUntil - Date.now(),
      reason: breaker.reason || '',
      status: breaker.status || 'blocked'
    };
  }
  return {
    open: false,
    openUntil: breaker.openUntil || '',
    cooldownRemainingMs: 0,
    reason: breaker.reason || '',
    status: breaker.status || ''
  };
}

function throwIfBreakerOpen(platform, options) {
  const status = breakerStatus(platform, options);
  if (!status.open) return;
  throw new PlatformAccessError(`${platform} access is cooling down: ${status.reason || status.status}`, {
    platform,
    status: status.status || 'blocked',
    code: 'PLATFORM_ACCESS_BLOCKED',
    cooldownRemainingMs: status.cooldownRemainingMs,
    breaker: status
  });
}

function openBreaker(platform, options, details) {
  const files = statusFiles(platform, options);
  const cooldownMs = details.cooldownMs || options.breakerCooldownMs;
  const payload = {
    status: details.status || 'blocked',
    reason: details.message || details.reason || '',
    openedAt: new Date().toISOString(),
    openUntil: new Date(Date.now() + cooldownMs).toISOString(),
    cooldownMs
  };
  writeJson(files.breaker, payload);
  writeJson(files.manualAction, {
    ok: false,
    platform: normalizePlatform(platform),
    status: payload.status,
    message: payload.reason,
    createdAt: payload.openedAt,
    openUntil: payload.openUntil,
    userMessage: details.userMessage || '平台访问已暂停。请完成登录/验证或等待冷却后再重试。'
  });
}

function clearBreaker(platform, options) {
  const files = statusFiles(platform, options);
  writeJson(files.breaker, {
    status: 'closed',
    reason: '',
    openedAt: '',
    openUntil: '',
    failures: 0,
    closedAt: new Date().toISOString()
  });
}

function classifyPlatformError(err) {
  const raw = [
    err && err.status,
    err && err.code,
    err && err.message,
    err && err.stderr,
    err && err.stdout
  ].filter(Boolean).join(' ').toLowerCase();

  if (/slider|captcha|验证|滑块|人机/.test(raw)) return 'slider_required';
  if (/login|登录|session|cookie/.test(raw)) return 'login_required';
  if (/429|rate.?limit|too many|限流|频率|风控/.test(raw)) return 'rate_limited';
  if (/permission|unauthorized|forbidden|权限|未订购|功能未开通/.test(raw)) return 'permission_required';
  return 'transient_failure';
}

function recordFailure(platform, options, err) {
  const files = statusFiles(platform, options);
  const existing = readJson(files.breaker, {});
  const failures = Number(existing.failures || 0) + 1;
  const status = err && (err.status || classifyPlatformError(err));
  const isHard = HARD_BLOCKER_STATUSES.has(String(status || '').toLowerCase()) ||
    /slider|captcha|login|required|429|rate.?limit/i.test(String(status || '') + ' ' + String(err && err.message || ''));

  if (isHard || failures >= options.failureThreshold) {
    openBreaker(platform, options, {
      status: status || (isHard ? 'blocked' : 'transient_failures'),
      message: err && err.message ? err.message : String(err),
      cooldownMs: err && err.cooldownRemainingMs ? err.cooldownRemainingMs : options.breakerCooldownMs
    });
    return;
  }

  writeJson(files.breaker, {
    ...existing,
    status: 'closed',
    failures,
    lastFailureAt: new Date().toISOString(),
    reason: err && err.message ? err.message : String(err)
  });
}

async function waitForCooldown(platform, options) {
  const files = statusFiles(platform, options);
  const state = readJson(files.state, {});
  const last = Date.parse(state.lastAccessAt || 0);
  if (!last) return;
  const cooldownMs = randomBetween(options.minCooldownMs, options.maxCooldownMs, options.random);
  const waitMs = Math.max(0, last + cooldownMs - Date.now());
  await sleep(waitMs);
}

function recordSuccess(platform, options) {
  const files = statusFiles(platform, options);
  writeJson(files.state, {
    lastAccessAt: new Date().toISOString()
  });
  clearBreaker(platform, options);
}

function mergeOptions(platform, options = {}) {
  return {
    ...platformDefaults(platform),
    cache: options.cache,
    cacheKey: options.cacheKey,
    dataDir: resolveDataDir(options),
    random: options.random || Math.random,
    cacheTtlMs: options.cacheTtlMs == null ? platformDefaults(platform).cacheTtlMs : options.cacheTtlMs,
    minCooldownMs: options.minCooldownMs == null ? platformDefaults(platform).minCooldownMs : options.minCooldownMs,
    maxCooldownMs: options.maxCooldownMs == null ? platformDefaults(platform).maxCooldownMs : options.maxCooldownMs,
    breakerCooldownMs: options.breakerCooldownMs == null ? platformDefaults(platform).breakerCooldownMs : options.breakerCooldownMs,
    failureThreshold: options.failureThreshold == null ? platformDefaults(platform).failureThreshold : options.failureThreshold,
    lockTimeoutMs: options.lockTimeoutMs == null ? platformDefaults(platform).lockTimeoutMs : options.lockTimeoutMs,
    staleLockMs: options.staleLockMs == null ? platformDefaults(platform).staleLockMs : options.staleLockMs
  };
}

async function runWithPlatformGuard(platform, options, operation) {
  if (typeof options === 'function') {
    operation = options;
    options = {};
  }
  if (typeof operation !== 'function') {
    throw new Error('operation is required');
  }
  const guardOptions = mergeOptions(platform, options || {});

  const cached = readCache(platform, guardOptions.cacheKey, guardOptions);
  if (cached.hit) {
    if (cached.value && typeof cached.value === 'object' && !Array.isArray(cached.value)) {
      return { ...cached.value, _guard: { cacheHit: true, platform: normalizePlatform(platform) } };
    }
    return cached.value;
  }

  throwIfBreakerOpen(platform, guardOptions);

  return withPlatformLock(platform, guardOptions, async () => {
    const lockedCached = readCache(platform, guardOptions.cacheKey, guardOptions);
    if (lockedCached.hit) {
      if (lockedCached.value && typeof lockedCached.value === 'object' && !Array.isArray(lockedCached.value)) {
        return { ...lockedCached.value, _guard: { cacheHit: true, platform: normalizePlatform(platform) } };
      }
      return lockedCached.value;
    }

    throwIfBreakerOpen(platform, guardOptions);
    await waitForCooldown(platform, guardOptions);

    try {
      const value = await operation();
      recordSuccess(platform, guardOptions);
      writeCache(platform, guardOptions.cacheKey, value, guardOptions);
      return value;
    } catch (err) {
      recordFailure(platform, guardOptions, err);
      throw err;
    }
  });
}

function reportPlatformBlocker(platform, details = {}) {
  const options = mergeOptions(platform, details);
  openBreaker(platform, options, {
    status: details.status || 'blocked',
    message: details.message || details.reason || `${platform} access blocked`,
    cooldownMs: details.cooldownMs || details.cooldownRemainingMs || options.breakerCooldownMs,
    userMessage: details.userMessage
  });
}

function getPlatformAccessStatus(platform, options = {}) {
  const guardOptions = mergeOptions(platform, options);
  const files = statusFiles(platform, guardOptions);
  const breaker = breakerStatus(platform, guardOptions);
  const manualAction = readJson(files.manualAction, null);
  const state = readJson(files.state, null);
  const cooldownRemainingMs = breaker.cooldownRemainingMs || 0;
  return {
    platform: normalizePlatform(platform),
    dataDir: files.dir,
    available: !breaker.open,
    status: breaker.open ? (breaker.status || 'blocked') : 'ready',
    cooldownRemainingMs,
    queueLength: 0,
    breaker,
    manualAction,
    state
  };
}

function resetPlatformAccessState(options = {}) {
  const dataDir = resolveDataDir(options);
  if (fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

module.exports = {
  PlatformAccessError,
  getPlatformAccessStatus,
  reportPlatformBlocker,
  resetPlatformAccessState,
  runWithPlatformGuard,
  _private: {
    cacheHash,
    mergeOptions,
    stableJson
  }
};
