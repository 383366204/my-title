'use strict';

/**
 * 注册领域接口，保留业务逻辑并复用应用注入的能力。
 * @param {object} app Express 应用。
 * @param {object} dependencies 数据存取与平台能力。
 * @returns {void}
 */
function registerPlatformRoutes(app, {
  getPlatformAccessStatus,
  parsePositiveNumber,
  isValidWorkflowRunIdParam,
  readRuntimeState,
  SYCM_SELECTORS,
  getSycmChromeLauncher,
  recoverSycmAccessAfterChrome,
  getSycmChromePageOpener,
  launchTaobaoDesktop,
  TaobaoNativeClient
}) {
  // GET /api/platform/status - Get current status of Taobao, SYCM, and 1688 access guards
  app.get('/api/platform/status', (req, res) => {
    try {
      res.json({
        ok: true,
        data: {
          taobao: getPlatformAccessStatus('taobao'),
          sycm: getPlatformAccessStatus('sycm'),
          '1688': getPlatformAccessStatus('1688')
        }
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 8.6. POST /api/workflows/sycm/chrome/start - 启动生意参谋调试浏览器
  app.post('/api/workflows/sycm/chrome/start', async (req, res) => {
    const port = parsePositiveNumber(req.body?.port || process.env.SYCM_DEBUG_PORT || 9222, 9222);
    const chromeProfileDir = req.body?.chromeProfileDir || process.env.SYCM_CHROME_PROFILE_DIR;
    const workflowRuntime = req.body?.runId && isValidWorkflowRunIdParam(req.body.runId)
      ? readRuntimeState({ runId: req.body.runId })
      : null;
    const manualOrderSheetCollection = req.body?.nodeId === 'collectRank'
      && workflowRuntime?.mode === 'order-sheet'
      && workflowRuntime.params?.inputMode === 'manual';
    const firstManualItemId = manualOrderSheetCollection
      ? String(workflowRuntime.params?.manualItems?.[0]?.itemId || '').trim()
      : '';
    const manualProductUrl = /^\d+$/.test(firstManualItemId)
      ? `https://item.taobao.com/item.htm?id=${firstManualItemId}`
      : 'https://item.taobao.com/';
    const targetUrl = req.body?.url
      || (manualOrderSheetCollection ? manualProductUrl : '')
      || (req.body?.nodeId === 'collectRank' ? 'https://sycm.taobao.com/cc/item_rank' : '')
      || process.env.SYCM_START_URL
      || SYCM_SELECTORS.SEARCH_URL;
    try {
      const launchResult = await getSycmChromeLauncher()(port, { userDataDir: chromeProfileDir });
      if (!launchResult || launchResult.success !== true) {
        return res.status(500).json({
          ok: false,
          status: 'chrome_launch_failed',
          port,
          message: launchResult?.message || 'Chrome 启动失败',
          userMessage: manualOrderSheetCollection
            ? 'Chrome 启动失败。请手动启动带远程调试端口的 Chrome，登录淘宝后重试获取商品资料。'
            : 'Chrome 启动失败。请手动启动带远程调试端口的 Chrome，然后重跑验真。'
        });
      }
      if (!manualOrderSheetCollection) await recoverSycmAccessAfterChrome(port, { assumeReady: true });
      let openResult = null;
      try {
        openResult = await getSycmChromePageOpener()(port, targetUrl);
      } catch (openErr) {
        return res.json({
          ok: true,
          status: 'ready',
          port,
          url: targetUrl,
          message: launchResult.message || 'Chrome 已启动并就绪',
          openStatus: 'open_page_failed',
          openMessage: openErr.message,
          userMessage: manualOrderSheetCollection
            ? `Chrome 已启动，但没有自动打开淘宝商品页。请在该 Chrome 中手动打开：${targetUrl}`
            : `Chrome 已启动，但没有自动打开生意参谋页面。请在该 Chrome 中手动打开：${targetUrl}`
        });
      }
      return res.json({
        ok: true,
        status: 'ready',
        port,
        url: targetUrl,
        openStatus: openResult?.success === false ? 'open_page_failed' : 'opened',
        message: launchResult.message || 'Chrome 已启动并就绪',
        userMessage: manualOrderSheetCollection
          ? 'Chrome 已启动并打开待读取的淘宝商品。请确认淘宝已登录，然后点击“重试获取商品资料”。'
          : 'Chrome 已启动并就绪，已打开生意参谋页面。请登录或完成验证后重跑验真。'
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        status: 'chrome_launch_failed',
        port,
        message: err.message,
        userMessage: 'Chrome 启动失败。请手动启动带远程调试端口的 Chrome，然后重跑验真。'
      });
    }
  });

  // 8.65 POST /api/workflows/taobao-native/start - 打开淘宝客户端供同行采集恢复。
  app.post('/api/workflows/taobao-native/start', async (_req, res) => {
    const launched = await launchTaobaoDesktop();
    if (!launched) {
      return res.status(500).json({
        ok: false,
        status: 'taobao_native_unavailable',
        userMessage: '淘宝桌面版启动失败，请确认客户端已经安装。'
      });
    }
    try {
      const result = await new TaobaoNativeClient().navigate('home');
      return res.json({
        ok: true,
        status: 'ready',
        data: result,
        userMessage: '淘宝客户端已打开。请完成登录或安全验证后，重试当前同行分析节点。'
      });
    } catch (err) {
      if (err.code === 'TAOBAO_LOGIN_REQUIRED' || err.code === 'TAOBAO_SECURITY_VERIFICATION_REQUIRED') {
        return res.json({
          ok: true,
          status: err.code === 'TAOBAO_LOGIN_REQUIRED' ? 'login_required' : 'verification_required',
          userMessage: err.code === 'TAOBAO_LOGIN_REQUIRED'
            ? '淘宝登录页已打开。请完成登录后重试当前同行分析节点。'
            : '淘宝安全验证页已打开。请完成验证后重试当前同行分析节点。'
        });
      }
      if (err.code === 'TAOBAO_NATIVE_ACCESS_RESTRICTED') {
        return res.json({
          ok: true,
          status: 'access_restricted',
          userMessage: '淘宝桌面版当前返回“内测期间仅开放部分用户”。请先完全退出并重新启动客户端；如果重启后仍持续出现，再检查客户端版本或账号开放状态。'
        });
      }
      if (err.code === 'TAOBAO_NATIVE_NOT_READY' || err.code === 'TAOBAO_NATIVE_TOOL_ERROR') {
        return res.json({
          ok: true,
          status: 'tool_not_ready',
          userMessage: `淘宝桌面版已打开，但自动化执行层尚未就绪。请等待首页加载完成后重试；若客户端显示“内测期间仅开放部分用户”，则当前账号暂时无法自动采集。${err.message ? ` 原始提示：${err.message}` : ''}`
        });
      }
      return res.status(500).json({
        ok: false,
        status: 'taobao_native_unavailable',
        error: err.message,
        userMessage: `淘宝客户端自动化调用失败：${err.message || '未知错误'}`
      });
    }
  });

  // 8.7. POST /api/distribution/chrome/start - 启动铺货专用调试浏览器
  app.post('/api/distribution/chrome/start', async (req, res) => {
    const port = parsePositiveNumber(req.body?.port || process.env.BROWSER_CDP_PORT || process.env.CHROME_DEBUG_PORT || 9222, 9222);
    const chromeProfileDir = req.body?.chromeProfileDir || process.env.SYCM_CHROME_PROFILE_DIR;
    const distributionUrl = req.body?.url || 'https://item.jnesoft.com/';
    try {
      const launchResult = await getSycmChromeLauncher()(port, { userDataDir: chromeProfileDir });
      if (!launchResult || launchResult.success !== true) {
        return res.status(500).json({
          ok: false,
          status: 'chrome_launch_failed',
          port,
          message: launchResult?.message || 'Chrome 启动失败',
          userMessage: `铺货 Chrome 启动失败（调试端口 ${port}）。请关闭占用该端口的 Chrome 后重试。`
        });
      }
      try {
        await getSycmChromePageOpener()(port, distributionUrl);
      } catch (openErr) {
        return res.json({
          ok: true,
          status: 'ready',
          port,
          url: distributionUrl,
          openStatus: 'open_page_failed',
          openMessage: openErr.message,
          userMessage: `Chrome 已启动，但铺货页面未自动打开。请在该 Chrome 中手动打开：${distributionUrl}`
        });
      }
      return res.json({
        ok: true,
        status: 'ready',
        port,
        url: distributionUrl,
        openStatus: 'opened',
        message: launchResult.message || 'Chrome 已启动并就绪',
        userMessage: '铺货 Chrome 已启动，并已打开铺货平台。登录后点击重新检查。'
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        status: 'chrome_launch_failed',
        port,
        message: err.message,
        userMessage: `铺货 Chrome 启动失败（调试端口 ${port}）。请确认 Chrome 已安装后重试。`
      });
    }
  });
}

module.exports = { registerPlatformRoutes };
