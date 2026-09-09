'use strict';

/**
 * 创建 Chrome 连接恢复后的访问状态清理服务。
 * @param {object} deps 请求时读取的运行状态或平台状态依赖。
 * @returns {object} 共享适配方法。
 */
function createSycmAccessRecovery({ getSycmAccessStatus, getSycmChromeAvailabilityChecker, clearSycmAccessBlocker }) {
  function isRecoverableChromeBlocker(access = {}) {
    const reason = String(access.breaker?.reason || access.manualAction?.message || '');
    return /no chrome tab found|127\.0\.0\.1:9222|econnrefused|chrome[^\n]*(?:tab|debug)|cdp|devtools/i.test(reason);
  }

  async function recoverSycmAccessAfterChrome(port, { assumeReady = false } = {}) {
    const access = getSycmAccessStatus();
    const recoverableManualStatus = ['login_required', 'slider_required', 'sycm_feature_required', 'transient_failure', 'transient_failures']
      .includes(String(access.breaker?.status || ''));
    if (!access.breaker?.open || (!isRecoverableChromeBlocker(access) && !(assumeReady && recoverableManualStatus))) {
      return { cleared: false, chromeReady: true, access };
    }
    const chromeReady = assumeReady || await getSycmChromeAvailabilityChecker()(port);
    if (!chromeReady) return { cleared: false, chromeReady: false, access };
    return { cleared: true, chromeReady: true, access: clearSycmAccessBlocker() };
  }

  return { recoverSycmAccessAfterChrome };
}

module.exports = { createSycmAccessRecovery };
