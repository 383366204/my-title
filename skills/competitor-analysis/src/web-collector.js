'use strict';

const { setTimeout: delay } = require('node:timers/promises');
const { CdpClient } = require('../../alibaba1688/src/search-web-1688');
const { runWithPlatformGuard } = require('../../../core/platform-access-guard');
const { collectTaobaoWebShop, validateWebShopUrl } = require('../../peer-discovery/src/taobao-web-shop-collector');
const { parseShopPage, parseCompactNumber } = require('./page-parser');

/**
 * 在已登录的 Chrome 中解析分享链接及商品所属店铺。
 * @param {object} input 已验证的分享输入。
 * @param {object} options 调试端口与限流配置。
 * @returns {Promise<object>} 店铺身份。
 */
async function resolveWebCompetitorShop(input, options = {}) {
  const initial = new URL(input.inputUrl);
  if (!['https:', 'http:'].includes(initial.protocol) || initial.username || initial.password || initial.port
      || !/(^|\.)(taobao\.com|tmall\.com|tb\.cn)$/.test(initial.hostname)) throw new Error('无效的淘宝分享链接');
  return runWithPlatformGuard('taobao', { ...options.guardOptions, cache: false }, async () => {
    let browser, page, targetId, success = false;
    try {
      const port = options.port || 9222;
      const version = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(5000) }).then(r => r.json());
      browser = new CdpClient(version.webSocketDebuggerUrl);
      ({ targetId } = await browser.send('Target.createTarget', { url: initial.href }));
      page = new CdpClient(`ws://127.0.0.1:${port}/devtools/page/${targetId}`);
      const deadline = Date.now() + 45000;
      let enteredShop = false;
      while (Date.now() < deadline) {
        if (options.shouldStop?.()) throw new Error('网页识别已停止，请继续流程后重试');
        const raw = await page.evaluate(`(() => ({
          url: location.href, title: document.title, content: document.body?.innerText || '',
          captcha: Array.from(document.querySelectorAll('iframe[src*="captcha"],iframe[src*="punish"],#nc_1_wrapper')).some(e => e.getBoundingClientRect().height > 0),
          shopLink: Array.from(document.querySelectorAll('a[href]')).find(e => /进店|进入店铺|店铺首页/.test(e.innerText || ''))?.href || ''
        }))()`);
        if (raw.captcha || new URL(raw.url).hostname === 'login.taobao.com') {
          throw new Error('请在保留的 Chrome 页面完成淘宝登录或安全验证，再重试当前节点');
        }
        let shopUrl;
        try { shopUrl = validateWebShopUrl(raw.url); } catch { /* 等待分享跳转或商品店铺入口。 */ }
        if (shopUrl) {
          const shop = parseShopPage(raw);
          if (shop.shopName && shop.shopKey) {
            success = true;
            return { ...shop, shopUrl, inputUrl: input.inputUrl, inputKind: input.kind, channel: 'web' };
          }
        }
        if (!enteredShop && raw.shopLink) {
          let entry;
          try { entry = validateWebShopUrl(raw.shopLink); } catch { /* 不跟随广告或非店铺链接。 */ }
          if (entry) { await page.send('Page.navigate', { url: entry }); enteredShop = true; }
        }
        await delay(1000);
      }
      throw new Error('网页分享链接未能识别店铺。已保留 Chrome 页面，请检查登录、跳转及店铺入口后重试');
    } catch (error) {
      error.code = 'TAOBAO_WEB_REQUIRED';
      if (/fetch failed|ECONNREFUSED/.test(error.message)) error.message = 'Chrome 调试连接不可用，请启动调试 Chrome 后重试';
      throw error;
    } finally {
      page?.close();
      if (success && browser && targetId) await browser.send('Target.closeTarget', { targetId }).catch(() => {});
      browser?.close();
    }
  });
}

/**
 * 复用已验证排序的网页榜单采集，转换为同行分析字段。
 * @param {object} shop 店铺信息。
 * @param {string} sortType hot 或 new。
 * @param {object} options 采集参数。
 * @returns {Promise<object>} 排名商品列表。
 */
async function collectWebCompetitorProducts(shop, sortType, options = {}) {
  const result = await collectTaobaoWebShop(shop, sortType, options);
  if (['load_stalled', 'time_budget_reached'].includes(result.stopReason)) throw new Error('网页榜单加载不完整，请检查保留的 Chrome 页面后重试');
  return { ...result, products: result.products.map((product, index) => ({
    ...product, shopKey: shop.shopKey, shopName: shop.shopName, sortType, rank: index + 1,
    productUrl: product.url, price: Number(product.displayPriceText) || null,
    paymentLowerBound: /人付款/.test(product.paymentText || '') ? parseCompactNumber(product.paymentText) : null,
    paymentExact: /人付款/.test(product.paymentText || '') && !/[+万千]/.test(product.paymentText)
  })) };
}

module.exports = { resolveWebCompetitorShop, collectWebCompetitorProducts };
