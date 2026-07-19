'use strict';

/**
 * 平台与节点状态归一化 Helper
 */

/**
 * 校验并归一化节点状态
 * @param {string} status 原始状态
 * @returns {string} 归一化后的状态
 */
function normalizeNodeStatus(status) {
  const allowed = [
    'idle',
    'running',
    'completed',
    'failed',
    'cancelled',
    'paused',
    'blocked',
    'waiting_manual',
    'retryable'
  ];
  const s = String(status || '').toLowerCase();
  return allowed.includes(s) ? s : 'failed';
}

/**
 * 构造统一的节点进度对象。
 * @param {object} progress 原始进度。
 * @returns {object} 归一化后的进度。
 */
function normalizeNodeProgress(progress = {}) {
  return {
    status: normalizeNodeStatus(progress.status || 'running'),
    current: Number.isFinite(Number(progress.current)) ? Number(progress.current) : 0,
    total: Number.isFinite(Number(progress.total)) ? Number(progress.total) : 0,
    percent: Number.isFinite(Number(progress.percent)) ? Math.max(0, Math.min(100, Number(progress.percent))) : 0,
    message: String(progress.message || '')
  };
}

/**
 * 根据平台访问错误或自定义错误属性，归一化为节点状态和描述信息
 * @param {Error|object} err 错误对象
 * @returns {object} 归一化后的状态字段
 */
function normalizePlatformError(err) {
  if (!err) {
    return {
      status: 'failed',
      blocker: null,
      actionHint: null,
      platform: null,
      platformStatus: null,
      cooldownRemainingMs: 0
    };
  }

  // 获取 status, platform, cooldownRemainingMs 等属性
  // 可能是 PlatformAccessError 实例，也可能是带有这些字段的普通错误/对象
  const platform = err.platform || '';
  const rawStatus = err.status || '';
  const cooldownRemainingMs = Number(err.cooldownRemainingMs) || 0;

  // 归纳 platform 标识
  const displayPlatform = platform ? String(platform).toUpperCase() : '平台';

  // 1. 人工干预类错误 (需要登录/滑动验证码/人机验证)
  if (/login|登录/i.test(rawStatus) || /login/i.test(err.message || '')) {
    return {
      status: 'waiting_manual',
      blocker: 'login_required',
      actionHint: `需要人工登录: 请在网页端重新登录 ${displayPlatform}`,
      platform: platform || null,
      platformStatus: rawStatus || 'login_required',
      cooldownRemainingMs: 0
    };
  }

  if (/slider|captcha|验证|滑块|人机/i.test(rawStatus) || /slider|captcha|verification/i.test(err.message || '')) {
    return {
      status: 'waiting_manual',
      blocker: 'captcha_required',
      actionHint: `需要人工干预: 请在网页端完成 ${displayPlatform} 的验证码/滑块验证`,
      platform: platform || null,
      platformStatus: rawStatus || 'captcha_required',
      cooldownRemainingMs: 0
    };
  }

  // 2. 限流与冷却类错误 (被限流，需等待冷却)
  if (/rate_limited|429|limit|限流|频率/i.test(rawStatus) || cooldownRemainingMs > 0 || /429|rate.?limit/i.test(err.message || '')) {
    const waitSec = cooldownRemainingMs > 0 ? Math.ceil(cooldownRemainingMs / 1000) : 60;
    return {
      status: 'blocked',
      blocker: 'platform_cooldown',
      actionHint: `访问受限: 触发 ${displayPlatform} 防护，需等待冷却 ${waitSec} 秒后重试`,
      platform: platform || null,
      platformStatus: rawStatus || 'rate_limited',
      cooldownRemainingMs
    };
  }

  // 3. 其它功能未开通/无权限
  if (/permission|forbidden|unauthorized|feature_required|未开通|权限/i.test(rawStatus) || /permission|forbidden|未开通|功能/i.test(err.message || '')) {
    return {
      status: 'blocked',
      blocker: 'permission_required',
      actionHint: `无访问权限: ${displayPlatform} 相关服务未订购或功能未开通`,
      platform: platform || null,
      platformStatus: rawStatus || 'permission_required',
      cooldownRemainingMs: 0
    };
  }

  // 4. 可重试的临时错误
  if (err.retryable || /transient|timeout|retry|lock_timeout|queued|超时/i.test(rawStatus) || /timeout|network|conn/i.test(err.message || '')) {
    return {
      status: 'retryable',
      blocker: 'network_transient_failure',
      actionHint: `网络或接口临时故障，可以尝试重试`,
      platform: platform || null,
      platformStatus: rawStatus || 'transient_failure',
      cooldownRemainingMs: 0
    };
  }

  // 5. 默认兜底失败
  return {
    status: 'failed',
    blocker: 'execution_error',
    actionHint: `执行出错: ${err.message || '未知错误'}`,
    platform: platform || null,
    platformStatus: rawStatus || 'error',
    cooldownRemainingMs: 0
  };
}

module.exports = {
  normalizeNodeStatus,
  normalizeNodeProgress,
  normalizePlatformError
};
