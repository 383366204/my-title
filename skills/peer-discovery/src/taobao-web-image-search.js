'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { CdpClient } = require('../../alibaba1688/src/search-web-1688');
const { runWithPlatformGuard, PlatformAccessError } = require('../../../core/platform-access-guard');
const { downloadSearchImage } = require('./image-search-provider');
const { prepareUploadImage } = require('./upload-image');
const { readTaobaoWebCards, normalizeTaobaoWebCards } = require('./taobao-web-cards');

/**
 * 识别图搜地址，不能仅凭淘宝搜索域名接收普通搜索结果。
 * @param {string} value 待确认的地址。
 * @returns {boolean} 是否具有明确图搜标记。
 */
function isTaobaoImageResultUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 's.taobao.com'
      && url.pathname === '/search'
      && (url.searchParams.get('tab') === 'imgsearch'
        || /^localImgSearchKey[\w-]+$/.test(url.searchParams.get('localImgKey') || ''));
  } catch { return false; }
}

/**
 * 读取可见阻塞和上传入口，不读取账号或浏览器私有状态。
 * @param {void} unused 页面上下文中执行。
 * @returns {object} 当前页面证据。
 */
function readTaobaoImagePage() {
  const visible = e => e.getBoundingClientRect().height > 0;
  const text = document.body?.innerText || '';
  return {
    url: location.href,
    login: location.hostname === 'login.taobao.com' || Array.from(document.querySelectorAll('iframe[src*="login.taobao.com"]')).some(visible),
    challenge: Array.from(document.querySelectorAll('iframe[src*="captcha"],iframe[src*="punish"],#nc_1_wrapper')).some(visible) || /请完成安全验证|拖动滑块/.test(text),
    frequent: /访问过于频繁|操作过于频繁/.test(text),
    networkError: /网络信号走丢|网络异常|网络连接失败/.test(text),
    unsupportedImage: /仅支持\s*jpe?g[、,，\s]+png\s*格式/.test(text),
    inputs: document.querySelectorAll('input[type="file"]').length,
  };
}

/**
 * 使用明确选择的网页通道上传商品图；不将首页推荐卡片当图搜结果。
 * @param {object} source 含 mainImageUrl 的源商品。
 * @param {object} options CDP端口、取消信号、进度以及测试依赖。
 * @returns {Promise<object>} 已加载的图搜商品，非全量结果。
 */
async function searchTaobaoWebImage(source, options = {}) {
  const port = options.port ?? 9222;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Chrome端口无效');
  const { signal } = options;
  const Client = options.Client || CdpClient;
  const fetcher = options.fetcher || fetch;
  const sleep = options.sleep || delay;
  const guard = options.guard || runWithPlatformGuard;
  signal?.throwIfAborted();
  const downloaded = await (options.downloadImage || downloadSearchImage)(source.mainImageUrl || source.imageUrl, { signal });
  let image;
  try {
    image = await (options.prepareImage || prepareUploadImage)(downloaded, { signal });
  } catch (error) {
    signal?.throwIfAborted();
    throw new PlatformAccessError(`淘宝图搜图片准备失败：${error.message}`, {
      platform: 'taobao', status: 'image_format_unsupported',
    });
  }
  const leaseManager = options.leaseManager || require('../../../core/runtime/workbench-lease').getLeaseManager();
  return leaseManager.withLease(`cdp:${port}`, { purpose: 'peer-discovery:taobao-image' }, async () => {
    return guard('taobao', { ...options.guardOptions, cache: false,
      shouldStop: () => signal?.aborted, staleLockMs: 300000, lockTimeoutMs: 300000,
    }, async () => {
      let browser, home, result, success = false;
    const targets = new Set();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-taobao-image-'));
    const check = async page => {
      signal?.throwIfAborted();
      const state = await page.evaluate(`(${readTaobaoImagePage.toString()})()`);
      if (state.unsupportedImage) throw new PlatformAccessError('淘宝拒绝了图片格式，请使用 JPEG 或 PNG 图片重试', { platform: 'taobao', status: 'image_format_unsupported' });
      const status = state.challenge ? 'captcha_required' : state.frequent ? 'rate_limited' : state.login ? 'login_required' : null;
      if (status) throw new PlatformAccessError('请处理淘宝登录或安全验证后重试图搜节点', { platform: 'taobao', status });
      return state;
    };
    const poll = async (fn, message) => {
      const deadline = Date.now() + (options.timeoutMs ?? 45000);
      do {
        signal?.throwIfAborted();
        const value = await fn();
        if (value) return value;
        await sleep(500, undefined, { signal });
      } while (Date.now() < deadline);
      throw new PlatformAccessError(message, { platform: 'taobao', status: 'image_search_unverified' });
    };
    try {
      const response = await fetcher(`http://127.0.0.1:${port}/json/version`, {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('无法连接Chrome调试服务');
      browser = new Client((await response.json()).webSocketDebuggerUrl);
      const { targetId } = await browser.send('Target.createTarget', { url: 'https://www.taobao.com/' });
      targets.add(targetId);
      home = new Client(`ws://127.0.0.1:${port}/devtools/page/${targetId}`);
      options.onProgress?.({ message: '打开淘宝搜同款上传入口' });
      let opened = false;
      await poll(async () => {
        const state = await check(home);
        if (state.inputs === 1) return true;
        if (state.inputs > 1) throw new Error('存在多个上传入口，无法安全确定图搜控件');
        if (!opened) {
          const response = await home.send('Runtime.evaluate', {
            expression: `(()=>{const e=Array.from(document.querySelectorAll('span,div,button')).find(e=>e.textContent.trim()==='搜同款'&&e.children.length===0);if(!e)return false;e.click();return true;})()`,
            userGesture: true, returnByValue: true,
          });
          opened = response.result?.value === true;
        }
        return false;
      }, '未找到唯一的淘宝图搜上传入口，请检查保留的页面');
      const file = path.join(dir, `source.${image.extension}`);
      await fs.writeFile(file, image.bytes);
      const { root } = await home.send('DOM.getDocument');
      const { nodeId } = await home.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type="file"]' });
      if (!nodeId) throw new PlatformAccessError('图片上传入口已失效，请重试图搜节点', { platform: 'taobao', status: 'image_search_unverified' });
      signal?.throwIfAborted();
      await home.send('DOM.setFileInputFiles', { nodeId, files: [file] });
      let submitted = false;
      const target = await poll(async () => {
        await check(home);
        const { targetInfos } = await browser.send('Target.getTargets');
        const found = targetInfos.find(t => {
          if (t.type !== 'page' || (t.targetId !== targetId && t.openerId !== targetId)) return false;
          return isTaobaoImageResultUrl(t.url);
        });
        if (found) return found;
        if (!submitted) {
          // 只提交带图片预览的图搜弹层，不点击页面上的普通文字搜索。
          const response = await home.send('Runtime.evaluate', {
            expression: `(()=>{const visible=e=>e.getBoundingClientRect().height>0;const headings=Array.from(document.querySelectorAll('span,div')).filter(e=>e.children.length===0&&e.textContent.trim()==='按图片搜索'&&visible(e));for(const heading of headings){let panel=heading.parentElement;for(let depth=0;panel&&depth<3;depth++,panel=panel.parentElement){if(!panel.querySelector('img')||/正在上传图片/.test(panel.innerText))continue;const buttons=Array.from(panel.querySelectorAll('button,span,div')).filter(e=>e.children.length===0&&e.textContent.trim()==='搜索'&&visible(e));if(buttons.length===1){buttons[0].click();return true;}}}return false;})()`,
            userGesture: true, returnByValue: true,
          });
          submitted = response.result?.value === true;
        }
        return null;
      }, '上传后未确认淘宝图搜结果页，请检查页面提示');
      targets.add(target.targetId);
      result = new Client(`ws://127.0.0.1:${port}/devtools/page/${target.targetId}`);
      options.onProgress?.({ message: '读取淘宝图搜商品及店铺入口' });
      let refreshed = false;
      const products = await poll(async () => {
        const state = await check(result);
        // 导航后再次确认当前地址，避免把重定向后的推荐商品当作同款。
        if (!isTaobaoImageResultUrl(state.url)) return null;
        if (state.networkError) {
          if (refreshed) throw new PlatformAccessError('淘宝图搜网络异常，刷新一次后仍未恢复，请稍后重试', { platform: 'taobao', status: 'image_search_unverified' });
          refreshed = true;
          options.onProgress?.({ message: '淘宝图搜网络异常，正在刷新结果页（仅重试一次）' });
          signal?.throwIfAborted();
          await result.send('Page.reload', { ignoreCache: false });
          return null;
        }
        const rows = await result.evaluate(`(${readTaobaoWebCards.toString()})()`);
        const normalized = normalizeTaobaoWebCards(rows);
        return normalized.length ? normalized : null;
      }, '未读取到有效图搜商品，不能将加载失败判定为无同款');
      signal?.throwIfAborted();
      success = true;
      return { products, channel: 'web', complete: false, resultUrl: target.url };
    } finally {
      result?.close();
      home?.close();
      if (success && browser) for (const targetId of targets) await browser.send('Target.closeTarget', { targetId }).catch(() => {});
      browser?.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
    });
  });
}

module.exports = { searchTaobaoWebImage, readTaobaoImagePage, isTaobaoImageResultUrl };
