'use strict';

const { setTimeout: delay } = require('node:timers/promises');
const { CdpClient } = require('../../alibaba1688/src/search-web-1688');
const { runWithPlatformGuard, PlatformAccessError } = require('../../../core/platform-access-guard');
const { readTaobaoWebShop, normalizeTaobaoWebShop } = require('./taobao-web-shop');
const { createShopBatchAccumulator } = require('./shop-batch-accumulator');

/**
 * Validate the observed shop entry instead of synthesizing shop addresses.
 * @param {string} value Observed shop URL.
 * @returns {string} HTTPS shop URL.
 */
function validateWebShopUrl(value) {
  const url = new URL(value);
  const host = url.hostname;
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port ||
      !(host === 'store.taobao.com' && url.pathname === '/shop/view_shop.htm' ||
        /^[a-z0-9]+\.taobao\.com$/.test(host) && !['www.taobao.com', 'login.taobao.com', 'item.taobao.com', 's.taobao.com'].includes(host) && url.pathname === '/')) {
    throw new Error('需要有效的淘宝店铺入口');
  }
  url.protocol = 'https:';
  return url.href;
}

/**
 * Collect ordered batches from the observed modern Taobao shop layout.
 * @param {object} shop Stable shopKey and observed shopUrl.
 * @param {string} sort hot or new.
 * @param {object} options Debug port, abort signal and guard options.
 * @returns {Promise<object>} Incomplete raw snapshot; no payment filtering.
 */
async function collectTaobaoWebShop(shop, sort = 'hot', options = {}) {
  const url = validateWebShopUrl(shop?.shopUrl);
  if (!shop?.shopKey || !['hot', 'new'].includes(sort)) throw new Error('店铺身份或排序无效');
  const port = options.port ?? 9222;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Chrome端口无效');
  const { signal } = options;
  const batches = createShopBatchAccumulator(options.limit ?? 40);
  const assertActive = () => {
    if (signal?.aborted) throw Object.assign(new Error('店铺采集已中断'), { code: 'PLATFORM_ACCESS_INTERRUPTED' });
  };
  return runWithPlatformGuard('taobao', {
    ...options.guardOptions, cache: false, shouldStop: () => signal?.aborted,
    staleLockMs: 300000, lockTimeoutMs: 300000,
  }, async () => {
    let browser, page, targetId;
    let success = false;
    const label = sort === 'hot' ? '销量' : '新品';
    try {
      assertActive();
      const version = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(5000) }).then(r => r.json());
      browser = new CdpClient(version.webSocketDebuggerUrl);
      ({ targetId } = await browser.send('Target.createTarget', { url }));
      page = new CdpClient(`ws://127.0.0.1:${port}/devtools/page/${targetId}`);
      let clicked = false, previous = null, stable = 0, baseline = null;
      const deadline = Date.now() + 120000;
      let accumulated, lastGrowth = Date.now(), lastScroll = 0;
      while (Date.now() < deadline) {
        assertActive();
        const gate = await page.evaluate(`({login:location.hostname==='login.taobao.com',challenge:Array.from(document.querySelectorAll('iframe[src*="captcha"],iframe[src*="punish"],#nc_1_wrapper')).some(e=>e.getBoundingClientRect().height>0),frequent:/访问过于频繁|操作过于频繁/.test(document.body?.innerText||'')})`);
        const status = gate.challenge ? 'captcha_required' : gate.frequent ? 'rate_limited' : gate.login ? 'login_required' : null;
        if (status) throw new PlatformAccessError('请处理淘宝登录或安全验证后重试店铺采集', { platform: 'taobao', status });
        const raw = await page.evaluate(`(${readTaobaoWebShop.toString()})()`);
        if (accumulated && raw.sortLabel !== label) {
          throw Object.assign(new Error('滚动期间店铺排序发生变化，请重新采集'), { code: 'SHOP_SORT_UNVERIFIED' });
        }
        const identity = JSON.stringify(raw.products.map(p => [p.url, p.paymentText]));
        if (raw.sortLabel !== label && !clicked && raw.products.length) {
          baseline = identity;
          const result = await page.send('Runtime.evaluate', {
            expression: `(()=>{const e=Array.from(document.querySelectorAll('[class*="leftTags--"] > div')).find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!e)return false;e.click();return true;})()`, userGesture: true, returnByValue: true,
          });
          clicked = result.result?.value === true;
        }
        // 排序高亮可能先于商品刷新；至少等待列表改变及连续两次相同快照。
        if (raw.sortLabel === label && raw.products.length && (baseline === null || identity !== baseline)) {
          stable = previous === identity ? stable + 1 : 0;
          previous = identity;
          if (stable >= 1) {
            const snapshot = normalizeTaobaoWebShop(raw, { shopKey: shop.shopKey, sort, maxAgeMs: options.evidenceMaxAgeMs ?? 86400000 });
            accumulated = batches.add(snapshot);
            if (accumulated.added) {
              lastGrowth = Date.now();
              options.onProgress?.({ collected: accumulated.totalCollected, target: options.limit ?? 40 });
            }
            assertActive();
            if (accumulated.stopReason) {
              success = true;
              return accumulated;
            }
            if (Date.now() - lastGrowth >= 15000) {
              return { ...accumulated, stopReason: 'load_stalled' };
            }
            if (Date.now() - lastScroll >= 3000) {
              await page.evaluate(`document.querySelector('[class*="loadmoreFlag--"]')?.scrollIntoView({block:'center'})`);
              lastScroll = Date.now();
            }
          }
        } else { stable = 0; previous = null; }
        await delay(1000);
      }
      if (accumulated) return { ...accumulated, stopReason: 'time_budget_reached' };
      throw Object.assign(new Error('店铺排序或商品加载未确认，已保留页面，请检查后重试'), { code: 'SHOP_COLLECTION_UNVERIFIED' });
    } finally {
      page?.close();
      if (success && browser && targetId) await browser.send('Target.closeTarget', { targetId }).catch(() => {});
      browser?.close();
    }
  });
}

module.exports = { validateWebShopUrl, collectTaobaoWebShop };
