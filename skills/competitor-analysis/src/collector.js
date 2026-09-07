'use strict';

const {
  canonicalShopUrl,
  parseShopPage,
  parseSortedProducts
} = require('./page-parser');
const { TaobaoNativeClient, TaobaoNativeError } = require('./taobao-native-client');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function waitForTab(client, predicate, options = {}) {
  const timeoutMs = Math.max(2000, Number(options.timeoutMs) || 8000);
  const intervalMs = Math.max(200, Number(options.intervalMs) || 400);
  const deadline = Date.now() + timeoutMs;
  let tab = {};
  do {
    tab = await client.getCurrentTab();
    if (predicate(tab || {})) return tab;
    await wait(intervalMs);
  } while (Date.now() < deadline);
  return tab;
}

function isProductPage(url) {
  return /(?:item\.taobao\.com\/item\.htm|detail\.tmall\.(?:com|hk)\/item\.htm)/i.test(String(url || ''));
}

async function enterProductShop(client) {
  const labels = ['进店', '进入店铺', '店铺首页'];
  let lastError = null;
  for (const label of labels) {
    try {
      await client.clickByText(label);
      await wait(800);
      return client.getCurrentTab();
    } catch (error) {
      lastError = error;
    }
  }
  throw new TaobaoNativeError(
    `已打开商品，但无法识别店铺入口：${lastError?.message || '页面没有店铺按钮'}`,
    'TAOBAO_SHOP_LINK_NOT_FOUND'
  );
}

/**
 * Resolve one shared/product/shop link to a canonical shop profile.
 * @param {object} input Parsed competitor input.
 * @param {object} [options] Resolve options.
 * @param {TaobaoNativeClient} [options.client] Injectable client.
 * @param {number} [options.waitMs] Navigation settle delay.
 * @returns {Promise<object>} Resolved shop profile.
 */
async function resolveCompetitorShop(input, options = {}) {
  const client = options.client || new TaobaoNativeClient(options);
  const waitMs = Math.max(0, Number(options.waitMs) || 900);
  await client.navigateToUrl(input.inputUrl);
  await wait(waitMs);
  let tab = await waitForTab(client, current => {
    const url = String(current.url || '');
    return Boolean(current.title && url && !/(?:m\.tb\.cn|s\.click\.taobao\.com)/i.test(url));
  }, { timeoutMs: Math.max(8000, waitMs * 8) });
  if (isProductPage(tab.url)) tab = await enterProductShop(client);
  const page = await client.readPageContent(20000);
  const shop = parseShopPage({ ...page, url: tab.url || page.url, title: tab.title || page.title });
  if (!shop.shopName || !shop.shopKey) {
    throw new TaobaoNativeError('页面已打开，但没有识别到淘宝店铺信息。', 'TAOBAO_SHOP_NOT_RECOGNIZED', { tab });
  }
  return { ...shop, inputUrl: input.inputUrl, inputKind: input.kind };
}

function sortedShopUrl(shopUrl, sortType) {
  const url = new URL(canonicalShopUrl(shopUrl));
  url.pathname = '/search.htm';
  url.searchParams.set('orderType', sortType === 'new' ? 'newOn_desc' : 'hotsell_desc');
  return url.href;
}

async function readSortedProducts(client, sortType, limit, options = {}) {
  const attempts = Math.max(1, Number(options.attempts) || 4);
  const waitMs = Math.max(250, Number(options.waitMs) || 900);
  let page = {};
  let products = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await wait(waitMs);
    page = await client.readPageContent(30000);
    products = parseSortedProducts(page.content, { sortType, limit });
    if (products.length > 0) break;
  }
  return { page, products };
}

async function openSortedShopPage(client, shop, sortType, options = {}) {
  const limit = Math.max(1, Math.min(50, Number.parseInt(options.limit, 10) || 20));
  const waitMs = Math.max(250, Number(options.waitMs) || 900);
  const sortLabel = sortType === 'new' ? '新品' : '销量';
  let interactiveError = null;

  // 淘宝新版店铺在首页以内嵌状态切换排序，旧的 search.htm 链接可能只有空壳页面。
  try {
    await client.navigateToUrl(canonicalShopUrl(shop.shopUrl));
    await wait(waitMs);
    await client.clickByText(sortLabel);
    await wait(waitMs);
    const interactive = await readSortedProducts(client, sortType, limit, { waitMs });
    if (interactive.products.length > 0) return interactive;
  } catch (error) {
    interactiveError = error;
  }

  // 兼容仍支持传统排序地址的旧版店铺模板。
  try {
    await client.navigateToUrl(sortedShopUrl(shop.shopUrl, sortType));
    await wait(waitMs);
    const legacy = await readSortedProducts(client, sortType, limit, { waitMs, attempts: 2 });
    if (legacy.products.length > 0) return legacy;
  } catch (error) {
    if (!interactiveError) interactiveError = error;
  }

  if (interactiveError && [
    'TAOBAO_LOGIN_REQUIRED',
    'TAOBAO_SECURITY_VERIFICATION_REQUIRED',
    'TAOBAO_NATIVE_TIMEOUT',
    'TAOBAO_NATIVE_UNAVAILABLE',
    'TAOBAO_NATIVE_ACCESS_RESTRICTED',
    'TAOBAO_NATIVE_NOT_READY',
    'TAOBAO_NATIVE_TOOL_ERROR',
    'TAOBAO_NATIVE_FAILED'
  ].includes(interactiveError.code)) {
    throw interactiveError;
  }

  throw new TaobaoNativeError(
    `店铺页面已打开，但${sortLabel}排序后没有读取到商品。请确认店铺页面已完整加载后重试。`,
    'TAOBAO_PRODUCT_LIST_EMPTY',
    {
      shopUrl: shop.shopUrl,
      sortType,
      interactiveError: interactiveError?.message || ''
    }
  );
}

/**
 * Collect one sorted product list from a shop page.
 * @param {object} shop Resolved shop profile.
 * @param {'hot'|'new'} sortType Sort type.
 * @param {object} [options] Collection options.
 * @param {TaobaoNativeClient} [options.client] Injectable client.
 * @param {number} [options.limit] Maximum products.
 * @param {number} [options.waitMs] Navigation settle delay.
 * @returns {Promise<object>} Collection result.
 */
async function collectSortedShopProducts(shop, sortType, options = {}) {
  const client = options.client || new TaobaoNativeClient(options);
  const limit = Math.max(1, Math.min(50, Number.parseInt(options.limit, 10) || 20));
  const waitMs = Math.max(250, Number(options.waitMs) || 900);
  let { page, products } = await openSortedShopPage(client, shop, sortType, { limit, waitMs });
  for (let scroll = 0; products.length < limit && scroll < 3; scroll += 1) {
    await client.scrollPage('down');
    await wait(waitMs);
    page = await client.readPageContent(30000);
    const next = parseSortedProducts(page.content, { sortType, limit });
    if (next.length <= products.length) break;
    products = next;
  }
  return {
    shopKey: shop.shopKey,
    shopName: shop.shopName,
    sortType,
    collectedAt: new Date().toISOString(),
    products: products.map(product => ({ ...product, shopKey: shop.shopKey, shopName: shop.shopName }))
  };
}

function parseItemIdentity(urlValue) {
  try {
    const url = new URL(urlValue);
    const itemId = url.searchParams.get('id') || url.searchParams.get('itemId') || '';
    return {
      itemId: /^\d+$/.test(itemId) ? itemId : '',
      productUrl: /^\d+$/.test(itemId)
        ? `${url.hostname.includes('tmall') ? 'https://detail.tmall.com/item.htm' : 'https://item.taobao.com/item.htm'}?id=${itemId}`
        : url.href
    };
  } catch (_error) {
    return { itemId: '', productUrl: '' };
  }
}

/**
 * Open a product card and resolve its stable item URL.
 * @param {object} shop Shop profile.
 * @param {object} product Product list row.
 * @param {object} [options] Enrichment options.
 * @param {TaobaoNativeClient} [options.client] Injectable client.
 * @returns {Promise<object>} Enriched product.
 */
async function enrichCompetitorProduct(shop, product, options = {}) {
  const client = options.client || new TaobaoNativeClient(options);
  const waitMs = Math.max(250, Number(options.waitMs) || 900);
  await openSortedShopPage(client, shop, product.sortType, { limit: Math.max(20, Number(product.rank) || 1), waitMs });
  const scan = await client.scanPageElements(product.title);
  const line = String(scan.dom || '').split(/\r?\n/).find(item => item.includes(product.title));
  const index = Number(line?.match(/\[(\d+)\]/)?.[1]);
  if (!Number.isFinite(index)) {
    throw new TaobaoNativeError(`没有在店铺列表中找到商品“${product.title}”。`, 'TAOBAO_PRODUCT_NOT_FOUND');
  }
  await client.clickElement(index);
  await wait(waitMs);
  let tab = {};
  try {
    tab = await client.getCurrentTab();
    const identity = parseItemIdentity(tab.url);
    if (!identity.itemId) {
      throw new TaobaoNativeError('商品已打开，但没有解析到商品 ID。', 'TAOBAO_PRODUCT_ID_NOT_FOUND', { tab });
    }
    return { ...product, ...identity, detailTitle: tab.title || product.title, enrichedAt: new Date().toISOString() };
  } finally {
    if (typeof client.closePage === 'function' && isProductPage(tab.url)) {
      try { await client.closePage(); } catch (_error) { /* 下次导航仍可恢复，不覆盖已取得的链接。 */ }
    }
  }
}

module.exports = {
  collectSortedShopProducts,
  enrichCompetitorProduct,
  enterProductShop,
  isProductPage,
  parseItemIdentity,
  openSortedShopPage,
  resolveCompetitorShop,
  sortedShopUrl,
  waitForTab,
  wait
};
