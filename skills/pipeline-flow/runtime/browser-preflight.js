'use strict';

const { getChromeDevToolsInfo, autoLaunchChrome } = require('../../sycm-research/src/sycm-browser-helper');

/**
 * 在选品开始前准备 CDP；不把端口就绪当作平台已登录。
 * @param {object} params 运行参数。
 * @param {object} dependencies 可替换的浏览器能力。
 * @returns {Promise<object>} 就绪或可恢复的阻塞结果。
 */
async function prepareSelectionBrowser(params = {}, dependencies = {}) {
  const getInfo = dependencies.getInfo || getChromeDevToolsInfo;
  const launch = dependencies.launch || autoLaunchChrome;
  const port = Number(params.port || process.env.SYCM_DEBUG_PORT || 9222);
  const available = async () => {
    try {
      const info = await getInfo(port);
      return Boolean(info?.Browser && /^wss?:\/\//.test(info?.webSocketDebuggerUrl || ''));
    } catch {
      return false;
    }
  };
  try {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Chrome 调试端口无效');
    if (await available()) return { status: 'browser_ready' };
    const result = await launch(port, { userDataDir: params.chromeProfileDir || process.env.SYCM_CHROME_PROFILE_DIR });
    if (!result?.success) throw new Error(result?.message || 'Chrome 启动失败');
    if (!await available()) throw new Error(`Chrome 启动后 CDP 仍不可用（端口 ${port}）`);
    return { status: 'browser_ready' };
  } catch (error) {
    const message = `浏览器准备失败：${error.message}`;
    return {
      status: 'manual_action_required', stepIncomplete: true,
      platform: 'sycm', platformStatus: 'chrome_launch_failed',
      blocker: 'chrome_launch_failed', actionHint: message,
      manualAction: { platform: 'sycm', status: 'chrome_launch_failed', userMessage: message },
      nextRecommendedAction: { action: 'retry-node', label: '重新准备浏览器', description: message }
    };
  }
}

module.exports = { prepareSelectionBrowser };
