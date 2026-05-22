'use strict';

/**
 * 1688 API 全局限流器
 * 滑动窗口限流 + 429 冷却 + 请求排队
 * 防止 OpenClaw 等 MCP 客户端高频调用导致 1688 API 429 限流（限流一天）
 */

/**
 * 限流错误（供上层区分限流错误和普通 API 错误）
 */
class RateLimitError extends Error {
  /**
   * @param {string} message - 错误信息
   * @param {number} cooldownRemainingMs - 冷却剩余时间（毫秒）
   */
  constructor(message, cooldownRemainingMs) {
    super(message);
    this.name = 'RateLimitError';
    this.cooldownRemainingMs = cooldownRemainingMs || 0;
  }
}

/**
 * 滑动窗口限流器
 * 追踪指定时间窗口内的 API 请求次数，超出则排队或拒绝
 */
class SlidingWindowRateLimiter {
  /**
   * @param {object} options
   * @param {number} options.maxRequests - 窗口内最大请求数
   * @param {number} options.windowMs - 窗口大小（毫秒）
   */
  constructor({ maxRequests, windowMs }) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    /** @type {Array<number>} 请求时间戳数组 */
    this.timestamps = [];
  }

  /**
   * 清理过期的时间戳
   * @param {number} now - 当前时间戳
   */
  _cleanExpired(now) {
    const cutoff = now - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] <= cutoff) {
      this.timestamps.shift();
    }
  }

  /**
   * 获取当前窗口内的请求数
   * @returns {number}
   */
  getCurrentCount() {
    this._cleanExpired(Date.now());
    return this.timestamps.length;
  }

  /**
   * 记录一次请求
   * @param {number} [now] - 当前时间戳
   */
  record(now) {
    now = now || Date.now();
    this._cleanExpired(now);
    this.timestamps.push(now);
  }

  /**
   * 尝试获取一个请求槽位（不记录时间戳）
   * @returns {boolean} 是否有可用槽位
   */
  hasSlot() {
    this._cleanExpired(Date.now());
    return this.timestamps.length < this.maxRequests;
  }

  /**
   * 获取最早时间戳过期还需要的毫秒数
   * 窗口滚动后自然会释放一个槽位
   * @returns {number} 毫秒数，0 表示无待过期或无记录
   */
  getNextSlotReleaseMs() {
    this._cleanExpired(Date.now());
    if (this.timestamps.length === 0) return 0;
    return Math.max(0, this.timestamps[0] + this.windowMs - Date.now());
  }
}

/**
 * 429 冷却管理器
 * 检测到 429 后进入冷却期，冷却期间拒绝所有 1688 API 请求
 */
class CooldownManager {
  /**
   * @param {number} cooldownMs - 冷却时间（毫秒）
   */
  constructor(cooldownMs) {
    this.cooldownMs = cooldownMs;
    /** 冷却截止时间戳，0 表示未冷却 */
    this._cooldownUntil = 0;
  }

  /**
   * 报告收到 429，触发冷却
   */
  report429() {
    this._cooldownUntil = Date.now() + this.cooldownMs;
  }

  /**
   * 报告请求成功（预留：未来用于自适应恢复）
   */
  reportSuccess() {
    // 预留：冷却恢复后可在此实现渐进式提速
  }

  /**
   * 是否处于冷却中
   * @returns {boolean}
   */
  isCooldown() {
    return Date.now() < this._cooldownUntil;
  }

  /**
   * 冷却剩余时间（毫秒）
   * @returns {number}
   */
  getRemainingMs() {
    if (!this.isCooldown()) return 0;
    return this._cooldownUntil - Date.now();
  }

  /**
   * 手动重置冷却
   */
  resetCooldown() {
    this._cooldownUntil = 0;
  }
}

/**
 * 请求排队队列
 * 超限请求排队等待，窗口滚动时自动释放
 */
class RequestQueue {
  /**
   * @param {number} maxSize - 最大排队数量
   */
  constructor(maxSize) {
    this.maxSize = maxSize;
    /** @type {Array<{resolve: Function, reject: Function, addedAt: number}>} */
    this._queue = [];
    /** 自动释放定时器 */
    this._releaseTimer = null;
  }

  /**
   * 当前队列长度
   * @returns {number}
   */
  getLength() {
    return this._queue.length;
  }

  /**
   * 入队等待
   * @param {number} waitMs - 预计等待时间
   * @returns {Promise<{allowed: boolean, waitMs: number}>} 等待结束后返回 acquire 结果
   */
  enqueue(waitMs) {
    if (this._queue.length >= this.maxSize) {
      return Promise.resolve({
        allowed: false,
        waitMs,
        queuePosition: -1,
        queueFull: true,
      });
    }

    return new Promise((resolve, reject) => {
      this._queue.push({ resolve, reject, addedAt: Date.now() });
    });
  }

  /**
   * 释放队列头部的请求
   * @param {SlidingWindowRateLimiter} limiter - 滑动窗口限流器
   */
  releaseOne(limiter) {
    if (this._queue.length === 0) return;
    const item = this._queue.shift();
    limiter.record();
    item.resolve({ allowed: true, waitMs: 0, fromQueue: true });
  }

  /**
   * 拒绝队列中所有请求（冷却触发时使用）
   * @param {number} cooldownRemainingMs - 冷却剩余时间
   */
  rejectAll(cooldownRemainingMs) {
    while (this._queue.length > 0) {
      const item = this._queue.shift();
      item.resolve({
        allowed: false,
        waitMs: cooldownRemainingMs,
        cooldown: true,
      });
    }
    if (this._releaseTimer) {
      clearTimeout(this._releaseTimer);
      this._releaseTimer = null;
    }
  }

  /**
   * 设置自动释放定时器
   * @param {number} releaseInMs - 多少毫秒后释放
   * @param {SlidingWindowRateLimiter} limiter - 滑动窗口限流器
   */
  scheduleRelease(releaseInMs, limiter) {
    if (this._releaseTimer) {
      clearTimeout(this._releaseTimer);
    }
    if (this._queue.length === 0) return;
    this._releaseTimer = setTimeout(() => {
      this._releaseTimer = null;
      this.releaseOne(limiter);
      if (this._queue.length > 0) {
        const nextRelease = limiter.getNextSlotReleaseMs();
        if (nextRelease > 0) {
          this.scheduleRelease(nextRelease, limiter);
        }
      }
    }, releaseInMs);
  }

  /**
   * 取消所有排队请求
   */
  cancelAll() {
    this.rejectAll(0);
  }
}

/**
 * 全局限流器
 * 组合滑动窗口、冷却管理器和请求队列
 */
class GlobalRateLimiter {
  /**
   * @param {object} options
   * @param {number} [options.maxRequests] - 每窗口最大请求数
   * @param {number} [options.windowMs] - 窗口大小（毫秒）
   * @param {number} [options.cooldownMs] - 429 冷却时间（毫秒）
   * @param {number} [options.maxQueueSize] - 最大排队数量
   */
  constructor(options = {}) {
    const maxRequests = options.maxRequests || parseInt(process.env.API_RATE_LIMIT_MAX, 10) || 20;
    const windowMs = options.windowMs || parseInt(process.env.API_RATE_LIMIT_WINDOW, 10) || 60000;
    const cooldownMs = options.cooldownMs || parseInt(process.env.API_429_COOLDOWN, 10) || 3600000;
    const maxQueueSize = options.maxQueueSize || parseInt(process.env.API_RATE_LIMIT_QUEUE_MAX, 10) || 10;

    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.cooldownMs = cooldownMs;
    this.maxQueueSize = maxQueueSize;

    this._limiter = new SlidingWindowRateLimiter({ maxRequests, windowMs });
    this._cooldown = new CooldownManager(cooldownMs);
    this._queue = new RequestQueue(maxQueueSize);
  }

  /**
   * 请求一个 API 调用令牌
   * @returns {Promise<{allowed: boolean, waitMs: number, cooldown?: boolean, queuePosition?: number, queueFull?: boolean, fromQueue?: boolean}>}
   */
  async acquire() {
    // 优先级1：检查冷却
    if (this._cooldown.isCooldown()) {
      const remaining = this._cooldown.getRemainingMs();
      if (this._queue.getLength() > 0) {
        this._queue.rejectAll(remaining);
      }
      return {
        allowed: false,
        waitMs: remaining,
        cooldown: true,
      };
    }

    // 优先级2：检查窗口配额
    if (this._limiter.hasSlot()) {
      this._limiter.record();
      return { allowed: true, waitMs: 0 };
    }

    // 优先级3：排队等待
    const nextRelease = this._limiter.getNextSlotReleaseMs();
    const estimatedWait = nextRelease + (this._queue.getLength() * nextRelease);

    // 安排自动释放
    if (nextRelease > 0 && this._queue.getLength() === 0) {
      this._queue.scheduleRelease(nextRelease, this._limiter);
    }

    const result = await this._queue.enqueue(estimatedWait);
    return result;
  }

  /**
   * 报告收到 429，触发冷却
   */
  report429() {
    this._cooldown.report429();
    const remaining = this._cooldown.getRemainingMs();
    this._queue.rejectAll(remaining);
  }

  /**
   * 报告请求成功（预留：用于自适应恢复）
   */
  reportSuccess() {
    this._cooldown.reportSuccess();
  }

  /**
   * 手动重置冷却
   */
  resetCooldown() {
    this._cooldown.resetCooldown();
  }

  /**
   * 获取当前限流状态
   * @returns {{requestsInWindow: number, maxRequests: number, windowMs: number, cooldown: boolean, cooldownRemainingMs: number, queueLength: number, maxQueueSize: number, cooldownMs: number}}
   */
  getStatus() {
    return {
      requestsInWindow: this._limiter.getCurrentCount(),
      maxRequests: this.maxRequests,
      windowMs: this.windowMs,
      cooldown: this._cooldown.isCooldown(),
      cooldownRemainingMs: this._cooldown.getRemainingMs(),
      queueLength: this._queue.getLength(),
      maxQueueSize: this.maxQueueSize,
      cooldownMs: this.cooldownMs,
    };
  }
}

// 全局单例
let _instance = null;

/**
 * 获取全局限流器实例（单例）
 * @param {object} [options] - 配置选项（仅首次调用生效，后续调用忽略）
 * @returns {GlobalRateLimiter}
 */
function getRateLimiter(options) {
  if (!_instance) {
    _instance = new GlobalRateLimiter(options);
  }
  return _instance;
}

/**
 * 重置全局单例（仅供测试使用）
 */
function _resetInstance() {
  if (_instance) {
    _instance._queue.cancelAll();
  }
  _instance = null;
}

module.exports = { getRateLimiter, RateLimitError, _resetInstance };