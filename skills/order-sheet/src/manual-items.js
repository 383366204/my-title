'use strict';

const axios = require('axios');
const WebSocket = require('ws');

const ALLOWED_DOMAINS = [
  'item.taobao.com',
  'detail.tmall.com',
  'detail.tmall.hk'
];

/**
 * Check whether a hostname belongs to allowed Taobao/Tmall/short-link domains.
 * @param {string} hostname Hostname to validate.
 * @returns {boolean} True if allowed.
 */
function isAllowedDomain(hostname) {
  const host = String(hostname || '').toLowerCase().trim();
  if (ALLOWED_DOMAINS.includes(host)) return true;
  if (host === 'm.taobao.com' || host.endsWith('.m.taobao.com')) return true;
  if (host === 'tb.cn' || host === 'm.tb.cn' || host.endsWith('.tb.cn')) return true;
  return false;
}

function isAllowedEndpoint({ protocol = '', hostname = '', port = '' } = {}) {
  const normalizedProtocol = String(protocol || '').toLowerCase();
  const normalizedPort = String(port || '');
  const allowedPorts = normalizedProtocol === 'https:'
    ? ['', '443']
    : normalizedProtocol === 'http:'
      ? ['', '80']
      : [];
  return isAllowedDomain(hostname) && allowedPorts.includes(normalizedPort);
}

function normalizeSkuOptions(options) {
  if (!Array.isArray(options)) return [];
  const seen = new Set();
  return options.map((option) => {
    const skuId = String(option?.skuId || option?.id || '').trim();
    const name = String(option?.name || option?.label || '').trim();
    const price = Number(option?.price);
    const originalPrice = Number(option?.originalPrice);
    const quantity = Number(option?.quantity);
    return {
      skuId,
      name,
      price: Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : null,
      originalPrice: Number.isFinite(originalPrice) && originalPrice > 0 ? Math.round(originalPrice * 100) / 100 : null,
      quantity: Number.isFinite(quantity) ? quantity : null,
      available: option?.available !== false && (!Number.isFinite(quantity) || quantity > 0),
      propPath: String(option?.propPath || '').trim(),
      imageUrl: String(option?.imageUrl || option?.image || '').trim()
    };
  }).filter((option) => {
    const key = option.skuId || `${option.name}:${option.price}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return option.available && option.price != null;
  });
}

/**
 * Parse a single manual item input (string, number, or object).
 * @param {string|number|object} input Manual item input.
 * @returns {object|null} Normalized manual item object, or null if invalid.
 */
function parseManualItem(input) {
  if (input == null) return null;

  let raw = {};
  if (typeof input === 'string' || typeof input === 'number') {
    raw = { url: String(input).trim() };
  } else if (typeof input === 'object' && !Array.isArray(input)) {
    raw = { ...input };
  } else {
    return null;
  }

  const rawUrlValue = String(raw.url || raw.productUrl || raw.link || '').trim();
  const rawUrl = rawUrlValue.match(/https?:\/\/[^\s，,；;]+/i)?.[0] || rawUrlValue;
  const rawItemId = raw.itemId != null ? String(raw.itemId).trim() : (raw.id != null ? String(raw.id).trim() : '');
  const title = String(raw.title || '').trim();
  const imageUrl = String(raw.imageUrl || raw.image || '').trim();
  const storeName = String(raw.storeName || '').trim();

  const parseAmount = (val) => {
    if (val == null || val === '') return null;
    const num = Number(val);
    return Number.isFinite(num) ? Math.round(num * 100) / 100 : null;
  };

  const orderAmount = parseAmount(raw.orderAmount);
  const paymentAmount = parseAmount(raw.paymentAmount);
  const selectedSkuId = String(raw.selectedSkuId || raw.skuId || '').trim();
  const selectedSkuName = String(raw.selectedSkuName || raw.skuName || '').trim();
  const selectedSkuPrice = parseAmount(raw.selectedSkuPrice != null ? raw.selectedSkuPrice : raw.skuPrice);
  const selectedSkuImageUrl = String(raw.selectedSkuImageUrl || '').trim();
  const lowestSkuId = String(raw.lowestSkuId || '').trim();
  const lowestSkuName = String(raw.lowestSkuName || '').trim();
  const lowestSkuPrice = parseAmount(raw.lowestSkuPrice);
  const skuOptions = normalizeSkuOptions(raw.skuOptions);

  let itemId = '';
  let productUrl = '';
  let isValidDomain = false;

  if (rawItemId && /^\d+$/.test(rawItemId)) {
    itemId = rawItemId;
    isValidDomain = true;
  }

  if (rawUrl) {
    if (/^\d+$/.test(rawUrl)) {
      itemId = rawUrl;
      isValidDomain = true;
      productUrl = `https://item.taobao.com/item.htm?id=${itemId}`;
    } else {
      let urlObj = null;
      try {
        urlObj = new URL(rawUrl.startsWith('http://') || rawUrl.startsWith('https://') ? rawUrl : `https://${rawUrl}`);
      } catch (_e) {
        return null;
      }

      if (!isAllowedEndpoint(urlObj)) {
        return null;
      }

      isValidDomain = true;
      const qId = urlObj.searchParams.get('id') || urlObj.searchParams.get('itemId');
      if (qId && /^\d+$/.test(qId)) {
        itemId = qId;
      } else {
        const match = urlObj.pathname.match(/\/i?(\d+)(?:\.htm)?/i) || urlObj.pathname.match(/\/item\/(\d+)/i);
        if (match && match[1] && /^\d+$/.test(match[1])) {
          itemId = match[1];
        }
      }

      productUrl = urlObj.href;
    }
  }

  if (!itemId && !isValidDomain) {
    return null;
  }

  const sourceKey = itemId || (productUrl ? `url:${productUrl}` : '');
  if (!sourceKey) return null;

  if (!productUrl && /^\d+$/.test(itemId)) {
    productUrl = `https://item.taobao.com/item.htm?id=${itemId}`;
  }

  return {
    itemId,
    ...(itemId ? {} : { sourceKey }),
    title,
    productUrl,
    imageUrl,
    storeName,
    orderAmount,
    paymentAmount,
    ...(selectedSkuId ? { selectedSkuId } : {}),
    ...(selectedSkuName ? { selectedSkuName } : {}),
    ...(selectedSkuPrice != null ? { selectedSkuPrice } : {}),
    ...(selectedSkuImageUrl ? { selectedSkuImageUrl } : {}),
    ...(lowestSkuId ? { lowestSkuId } : {}),
    ...(lowestSkuName ? { lowestSkuName } : {}),
    ...(lowestSkuPrice != null ? { lowestSkuPrice } : {}),
    ...(skuOptions.length > 0 ? { skuOptions } : {}),
    ...(
      raw.skuSelectionMode || selectedSkuId || selectedSkuName
        ? { skuSelectionMode: raw.skuSelectionMode === 'manual' ? 'manual' : 'lowest' }
        : {}
    ),
    sourceType: 'manual',
    enrichmentStatus: raw.enrichmentStatus || 'normalized'
  };
}

/**
 * Parse and deduplicate manual items from array and/or text input.
 * Deduplication is stable by itemId and capped at 100 items.
 * @param {Array<object|string>} [manualItems] Array of item objects or strings.
 * @param {string} [manualItemsText] Delimited text input.
 * @returns {Array<object>} Array of normalized manual items.
 */
function parseManualItems(manualItems, manualItemsText) {
  const candidates = [];

  if (typeof manualItemsText === 'string' && manualItemsText.trim()) {
    const lines = manualItemsText.split(/[\r\n,，;；、]+/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) candidates.push(trimmed);
    }
  }

  if (Array.isArray(manualItems)) {
    for (const item of manualItems) {
      if (item != null) candidates.push(item);
    }
  }

  const byId = new Map();

  for (const candidate of candidates) {
    const parsed = parseManualItem(candidate);
    if (!parsed) continue;
    const key = parsed.itemId || parsed.sourceKey;
    if (!key) continue;
    const existing = byId.get(key);
    if (existing) {
      byId.set(key, {
        ...existing,
        ...(parsed.title ? { title: parsed.title } : {}),
        ...(parsed.imageUrl ? { imageUrl: parsed.imageUrl } : {}),
        ...(parsed.storeName ? { storeName: parsed.storeName } : {}),
        ...(parsed.orderAmount != null ? { orderAmount: parsed.orderAmount } : {}),
        ...(parsed.paymentAmount != null ? { paymentAmount: parsed.paymentAmount } : {}),
        ...(parsed.selectedSkuId ? { selectedSkuId: parsed.selectedSkuId } : {}),
        ...(parsed.selectedSkuName ? { selectedSkuName: parsed.selectedSkuName } : {}),
        ...(parsed.selectedSkuPrice != null ? { selectedSkuPrice: parsed.selectedSkuPrice } : {}),
        ...(parsed.lowestSkuId ? { lowestSkuId: parsed.lowestSkuId } : {}),
        ...(parsed.lowestSkuName ? { lowestSkuName: parsed.lowestSkuName } : {}),
        ...(parsed.lowestSkuPrice != null ? { lowestSkuPrice: parsed.lowestSkuPrice } : {}),
        ...(parsed.skuOptions?.length > 0 ? { skuOptions: parsed.skuOptions } : {}),
        ...(parsed.skuSelectionMode ? { skuSelectionMode: parsed.skuSelectionMode } : {})
      });
      continue;
    }
    if (byId.size >= 100) continue;
    byId.set(key, parsed);
  }

  return [...byId.values()];
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\u([0-9a-f]{4})/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .trim();
}

function metaContent(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i')
  ];
  return decodeHtml(patterns.map(pattern => html.match(pattern)?.[1]).find(Boolean) || '');
}

function jsonStringValue(html, keys) {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const value = html.match(new RegExp(`["']${escaped}["']\\s*:\\s*["']((?:\\\\.|[^"'])+)["']`, 'i'))?.[1];
    if (value) return decodeHtml(value.replace(/\\\//g, '/'));
  }
  return '';
}

function parseTaobaoItemHtml(html, finalUrl = '') {
  const source = String(html || '');
  const titleTag = decodeHtml(source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/[-_–—]\s*(淘宝网|天猫.*)$/i, '').trim();
  const title = pickTitle([
    metaContent(source, 'og:title'),
    jsonStringValue(source, ['itemTitle', 'title']),
    titleTag
  ]);
  const imageUrl = metaContent(source, 'og:image') || jsonStringValue(source, ['picUrl', 'image', 'mainImage']);
  const storeName = jsonStringValue(source, ['shopName', 'sellerNick', 'sellerName']);
  const referencePriceText = metaContent(source, 'product:price:amount') || jsonStringValue(source, ['priceText', 'price']);
  const referencePrice = Number(String(referencePriceText).replace(/[^\d.]/g, ''));
  const finalItem = parseManualItem(finalUrl);
  const itemId = finalItem?.itemId || jsonStringValue(source, ['itemId', 'item_id', 'itemNumId']).match(/^\d+$/)?.[0] || '';
  return {
    itemId,
    title,
    imageUrl,
    storeName,
    referencePrice: Number.isFinite(referencePrice) && referencePrice > 0 ? Math.round(referencePrice * 100) / 100 : null,
    finalUrl: String(finalUrl || '')
  };
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createCdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 1;
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('连接淘宝商品页超时')), 8000);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });

  ws.on('message', raw => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (_error) {
      return;
    }
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message || '淘宝商品页操作失败'));
    else request.resolve(message.result || {});
  });
  ws.on('close', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('淘宝商品页连接已关闭'));
    }
    pending.clear();
  });

  async function send(method, params = {}, timeout = 20000) {
    await ready;
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`淘宝商品页操作超时: ${method}`));
      }, timeout);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression, timeout) {
    const response = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    }, timeout);
    if (response.exceptionDetails) {
      const detail = response.exceptionDetails.exception?.description || response.exceptionDetails.text;
      throw new Error(detail || '读取淘宝商品页失败');
    }
    return response.result ? response.result.value : undefined;
  }

  return {
    ready,
    send,
    evaluate,
    close() {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    }
  };
}

function cleanBrowserTitle(value) {
  return decodeHtml(value)
    .replace(/\s*[-_–—]\s*(淘宝网|天猫(?:国际)?(?:官方网站)?|淘！我喜欢)\s*$/i, '')
    .trim();
}

// 淘宝商品页是 SPA，首屏 document.title 字面上就是「商品详情」，等渲染完成后才换成真实商品标题。
const PLACEHOLDER_TITLE_PATTERN = /^\s*(商品详情|商品详情页|产品详情|详情|加载中[^ ]*|页面不存在|登录[^ ]*|淘宝网?|天猫(商城|国际)?)\s*(?:[-–—_]\s*(?:淘宝网?|天猫\S*))?\s*$/i;

/**
 * 判断抓取结果是否只是页面未渲染完成时的占位标题。
 * @param {string} value 候选标题
 * @returns {boolean} true 表示这不是有效的商品标题
 */
function isPlaceholderTitle(value) {
  const text = cleanBrowserTitle(value);
  if (!text) return true;
  return PLACEHOLDER_TITLE_PATTERN.test(text);
}

/**
 * 按可信度顺序挑选第一个有效的商品标题。
 * @param {Array<string>} candidates 标题候选，可信度从高到低
 * @returns {string} 有效标题，全部无效时返回空串
 */
function pickTitle(candidates) {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  for (const candidate of list) {
    const text = cleanBrowserTitle(candidate);
    if (text && !isPlaceholderTitle(text)) return text;
  }
  return '';
}

function browserSnapshotExpression() {
  return `(() => {
    const content = (selector, attr = 'content') => document.querySelector(selector)?.getAttribute(attr) || '';
    const text = selector => String(document.querySelector(selector)?.textContent || '').trim();
    const bodyText = String(document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 4000);
    const domTitles = [
      content('meta[property="og:title"]'),
      text('[class*="ItemTitle"]'),
      text('[class*="itemTitle"]'),
      text('h1')
    ];
    const imageCandidates = [
      content('meta[property="og:image"]'),
      document.querySelector('[class*="MainPic"] img,[class*="mainPic"] img')?.currentSrc,
      document.querySelector('[class*="MainPic"] img,[class*="mainPic"] img')?.src
    ].filter(Boolean);
    const scriptText = [...document.scripts].map(script => script.textContent || '').join('\\n');
    const jsonValue = keys => {
      for (const key of keys) {
        const match = scriptText.match(new RegExp('"' + key + '"\\\\s*:\\s*"((?:\\\\\\\\.|[^"])*)"', 'i'));
        if (match?.[1]) return match[1].replace(/\\\\\\//g, '/');
      }
      return '';
    };
    const seen = new WeakSet();
    const findSkuData = (value, depth = 0) => {
      if (!value || typeof value !== 'object' || depth > 10 || seen.has(value)) return null;
      seen.add(value);
      if (value.skuBase?.skus && value.skuCore?.sku2info) return value;
      for (const child of Object.values(value)) {
        const found = findSkuData(child, depth + 1);
        if (found) return found;
      }
      return null;
    };
    const skuData = findSkuData(window.__ICE_APP_CONTEXT__);
    // 标题要等 React 渲染才写进 DOM，但 ICE 全局里通常已经带着它，优先从页面数据取。
    const iceTitles = [];
    const titleSeen = new WeakSet();
    const collectIceTitles = (value, depth) => {
      if (!value || typeof value !== 'object' || depth > 10 || iceTitles.length >= 6 || titleSeen.has(value)) return;
      titleSeen.add(value);
      for (const entry of Object.entries(value)) {
        const key = entry[0];
        const child = entry[1];
        if ((key === 'itemTitle' || key === 'title') && typeof child === 'string') {
          const clean = child.trim();
          if (clean.length > 6 && !/^https?:/i.test(clean)) iceTitles.push(clean);
        } else if (child && typeof child === 'object') {
          collectIceTitles(child, depth + 1);
        }
      }
    };
    collectIceTitles(window.__ICE_APP_CONTEXT__, 0);
    // document.title 排最后：它在首屏几乎必然是占位内容，交给 Node 侧的 pickTitle 过滤
    const titleCandidates = [
      ...domTitles,
      ...iceTitles,
      jsonValue(['itemTitle']),
      jsonValue(['title']),
      document.title
    ].filter(Boolean);
    const skuNames = new Map();
    const skuImages = new Map();
    for (const prop of skuData?.skuBase?.props || []) {
      for (const value of prop.values || []) {
        const path = String(prop.pid || '') + ':' + String(value.vid || '');
        skuNames.set(path, (prop.name ? prop.name + '：' : '') + String(value.name || ''));
        if (value.image) skuImages.set(path, value.image);
      }
    }
    const priceValue = value => {
      const amount = Number(String(value?.priceText || value?.priceMoney || '').replace(/[^\\d.]/g, ''));
      if (!Number.isFinite(amount) || amount <= 0) return null;
      return value?.priceText ? amount : amount / 100;
    };
    const skuOptions = (skuData?.skuBase?.skus || []).map(sku => {
      const info = skuData?.skuCore?.sku2info?.[sku.skuId] || {};
      const paths = String(sku.propPath || '').split(';').filter(Boolean);
      const names = paths.map(path => skuNames.get(path)).filter(Boolean);
      return {
        skuId: String(sku.skuId || ''),
        name: names.join(' / '),
        price: priceValue(info.subPrice) || priceValue(info.price),
        originalPrice: priceValue(info.price),
        quantity: Number.isFinite(Number(info.quantity)) ? Number(info.quantity) : null,
        available: info.quantityText !== '无货' && (!Number.isFinite(Number(info.quantity)) || Number(info.quantity) > 0),
        propPath: String(sku.propPath || ''),
        imageUrl: paths.map(path => skuImages.get(path)).find(Boolean) || ''
      };
    });
    const defaultSkuInfo = skuData?.skuCore?.sku2info?.['0'] || {};
    const defaultSkuPrice = priceValue(defaultSkuInfo.subPrice) || priceValue(defaultSkuInfo.price);
    return {
      readyState: document.readyState,
      url: location.href,
      bodyText,
      title: titleCandidates[0] || '',
      titleCandidates,
      imageUrl: imageCandidates[0] || jsonValue(['picUrl', 'mainImage']),
      storeName: jsonValue(['shopName', 'sellerNick', 'sellerName']),
      priceText: content('meta[property="product:price:amount"]') || jsonValue(['priceText', 'price']),
      defaultSkuPrice,
      skuOptions
    };
  })()`;
}

function parseBrowserSnapshot(snapshot = {}, fallbackItem = {}) {
  const bodyText = String(snapshot.bodyText || '');
  const pageUrl = String(snapshot.url || '');
  if (/login\.taobao\.com|passport\.taobao\.com/.test(pageUrl) || /扫码登录|密码登录|短信登录/.test(bodyText)) {
    throw new Error('淘宝登录态不可用，请在 Chrome 登录淘宝后重试');
  }
  if (/punish|captcha/.test(pageUrl) || /安全验证|滑块|验证码|人机验证/.test(bodyText)) {
    throw new Error('淘宝触发了安全验证，请在 Chrome 完成验证后重试');
  }
  const parsedUrl = parseManualItem(pageUrl);
  const skuOptions = normalizeSkuOptions(snapshot.skuOptions);
  const requestedSkuId = String(fallbackItem.selectedSkuId || fallbackItem.skuId || '').trim();
  const requestedSkuName = String(fallbackItem.selectedSkuName || fallbackItem.skuName || '').trim();
  const requestedSku = skuOptions.find(option => option.skuId === requestedSkuId)
    || skuOptions.find(option => requestedSkuName && option.name === requestedSkuName)
    || null;
  const lowestSku = skuOptions.reduce((lowest, option) => (
    !lowest || Number(option.price) < Number(lowest.price) ? option : lowest
  ), null);
  const selectedSku = requestedSku || lowestSku;
  const pagePrice = Number(snapshot.defaultSkuPrice || String(snapshot.priceText || '').replace(/[^\d.]/g, ''));
  const referencePrice = selectedSku?.price || (Number.isFinite(pagePrice) && pagePrice > 0 ? Math.round(pagePrice * 100) / 100 : null);
  return {
    itemId: fallbackItem.itemId || parsedUrl?.itemId || '',
    title: pickTitle(Array.isArray(snapshot.titleCandidates) && snapshot.titleCandidates.length > 0
      ? snapshot.titleCandidates
      : [snapshot.title]),
    imageUrl: String(snapshot.imageUrl || '').trim(),
    storeName: String(snapshot.storeName || '').trim(),
    referencePrice,
    skuOptions,
    selectedSkuId: selectedSku?.skuId || '',
    selectedSkuName: selectedSku?.name || '',
    selectedSkuPrice: selectedSku?.price ?? referencePrice,
    lowestSkuId: lowestSku?.skuId || '',
    lowestSkuName: lowestSku?.name || '',
    lowestSkuPrice: lowestSku?.price ?? referencePrice,
    skuSelectionMode: requestedSku ? 'manual' : 'lowest',
    finalUrl: pageUrl || fallbackItem.productUrl || '',
    enrichmentSource: 'chrome'
  };
}

/**
 * Create a reusable Chrome/CDP session for reading Taobao item pages with the user's login state.
 * @param {object} [options] Browser options.
 * @param {number} [options.port=9222] Chrome debugging port.
 * @param {number} [options.browserTimeout=20000] Per-item loading timeout.
 * @param {number} [options.postCompleteGraceMs=6000] 页面 ready 后继续等待真实标题渲染的时间。
 * @param {Function} [options.openBlankTarget] 注入的空白标签页创建函数，便于测试。
 * @param {Function} [options.createCdpClient] 注入的 CDP 客户端工厂，便于测试。
 * @returns {Promise<{readItem: Function, close: Function}>} Reusable item page session.
 */
async function createTaobaoChromeSession(options = {}) {
  const port = Number(options.port || 9222);
  const timeout = Number(options.browserTimeout || 20000);
  // 页面 readyState 变 complete 只表示静态 HTML 加载完，SPA 还要再渲染才会写入真实标题。
  const postCompleteGrace = Number(options.postCompleteGraceMs || 6000);
  const openBlankTarget = typeof options.openBlankTarget === 'function'
    ? options.openBlankTarget
    : async () => {
        try {
          const response = await axios.put(
            `http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`,
            null,
            { timeout: 5000, proxy: false }
          );
          return response?.data;
        } catch (error) {
          throw new Error(`Chrome 调试连接不可用（端口 ${port}），请先启动 Chrome 后重试：${error.message}`);
        }
      };
  const cdpFactory = typeof options.createCdpClient === 'function' ? options.createCdpClient : createCdpClient;

  const target = await openBlankTarget();
  if (!target?.webSocketDebuggerUrl) {
    throw new Error(`Chrome 调试端口 ${port} 没有创建出可用商品页`);
  }
  const cdp = cdpFactory(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable').catch(() => {});

  return {
    async readItem(item) {
      const targetUrl = String(item?.productUrl || '');
      const parsed = new URL(targetUrl);
      if (!isAllowedEndpoint(parsed)) throw new Error('商品链接不是安全的淘系地址');
      await cdp.send('Page.navigate', { url: targetUrl }, timeout);
      const startedAt = Date.now();
      const deadline = startedAt + timeout;
      let completedAt = null;
      while (Date.now() < deadline) {
        await wait(350);
        const snapshot = await cdp.evaluate(browserSnapshotExpression(), 8000);
        // parseBrowserSnapshot 已过滤占位标题：拿不到真标题就继续轮询，不能提前收工
        const detail = parseBrowserSnapshot(snapshot, item);
        if (detail.title) return detail;
        if (snapshot?.readyState === 'complete') {
          completedAt = completedAt || Date.now();
          if (Date.now() - completedAt >= postCompleteGrace) break;
        }
      }
      throw new Error(`Chrome 已打开商品 ${item?.itemId || ''}，但页面未渲染出商品标题，请手动补充`);
    },
    close() {
      cdp.close();
    }
  };
}

async function fetchTaobaoItemPage(item, options = {}) {
  const request = options.request || axios.get;
  const initialUrl = new URL(item.productUrl);
  if (!isAllowedEndpoint(initialUrl)) throw new Error('商品链接不是安全的淘系地址');
  const response = await request(item.productUrl, {
    timeout: Number(options.timeout || 10000),
    maxRedirects: 4,
    responseType: 'text',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    },
    beforeRedirect(redirectOptions) {
      if (!isAllowedEndpoint(redirectOptions)) {
        throw new Error('商品链接跳转到了非淘系域名');
      }
    }
  });
  const finalUrl = response?.request?.res?.responseUrl || response?.config?.url || item.productUrl;
  if (!isAllowedEndpoint(new URL(finalUrl))) throw new Error('商品链接返回了非淘系页面');
  return { ...parseTaobaoItemHtml(response.data, finalUrl), enrichmentSource: 'http' };
}

/**
 * Injectable dependency or standalone interface for manual item enrichment.
 * Default implementation performs normalization only without network crawling.
 * @param {Array<object>} items Manual items.
 * @param {object} [_options] Enrichment options.
 * @returns {Promise<Array<object>>} Enriched manual items.
 */
async function enrichManualItems(items = [], _options = {}) {
  const options = _options || {};
  if (options.autoEnrichManualItems === false) {
    return items.map(item => ({ ...item, enrichmentStatus: item.title ? 'complete' : 'pending' }));
  }
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const enriched = [];
  const pageFetcher = typeof options.fetchTaobaoItemPage === 'function' ? options.fetchTaobaoItemPage : fetchTaobaoItemPage;
  const sessionFactory = typeof options.createTaobaoChromeSession === 'function'
    ? options.createTaobaoChromeSession
    : createTaobaoChromeSession;
  let chromeSession = null;
  let chromeSessionError = null;
  try {
    for (const [index, item] of items.entries()) {
      if (item.title && item.imageUrl) {
        enriched.push({ ...item, enrichmentStatus: 'complete' });
      } else {
        try {
          let detail = null;
          let httpError = null;
          try {
            detail = await pageFetcher(item, options);
          } catch (error) {
            httpError = error;
          }
          if (!detail?.title && options.useChromeFallback !== false) {
            onProgress({ current: index, total: items.length, message: `正在 Chrome 打开第 ${index + 1}/${items.length} 个商品` });
            if (!chromeSession && !chromeSessionError) {
              try {
                chromeSession = await sessionFactory(options);
              } catch (error) {
                chromeSessionError = error;
              }
            }
            if (chromeSession) {
              detail = await chromeSession.readItem(item);
            } else if (chromeSessionError) {
              throw chromeSessionError;
            }
          }
        if (!detail) throw httpError || new Error('商品资料读取失败');
        // 只拿到占位标题时按"未抓到"处理，交给上游拦成人工补录，不能静默出错表
        const fetchedTitle = isPlaceholderTitle(detail.title) ? '' : String(detail.title || '').trim();
        const finalTitle = item.title || fetchedTitle;
        const nextItem = {
          ...item,
          itemId: item.itemId || detail.itemId || '',
          title: finalTitle,
          imageUrl: item.imageUrl || detail.imageUrl || '',
          storeName: item.storeName || detail.storeName || '',
          referencePrice: detail.referencePrice,
          orderAmount: item.orderAmount != null
            ? item.orderAmount
            : (detail.selectedSkuPrice ?? detail.referencePrice ?? null),
          skuOptions: detail.skuOptions || item.skuOptions || [],
          selectedSkuId: detail.selectedSkuId || item.selectedSkuId || '',
          selectedSkuName: detail.selectedSkuName || item.selectedSkuName || '',
          selectedSkuPrice: detail.selectedSkuPrice ?? item.selectedSkuPrice ?? null,
          lowestSkuId: detail.lowestSkuId || item.lowestSkuId || '',
          lowestSkuName: detail.lowestSkuName || item.lowestSkuName || '',
          lowestSkuPrice: detail.lowestSkuPrice ?? item.lowestSkuPrice ?? detail.referencePrice ?? null,
          skuSelectionMode: detail.skuSelectionMode || item.skuSelectionMode || 'lowest',
          resolvedUrl: detail.finalUrl || item.productUrl,
          enrichmentSource: detail.enrichmentSource || '',
          enrichmentStatus: finalTitle && (item.itemId || detail.itemId) ? 'complete' : 'partial',
          enrichmentError: !finalTitle
            ? (detail.title ? '页面未渲染出商品标题，请手动补充' : '未读取到商品标题')
            : !(item.itemId || detail.itemId)
              ? '短链接未解析出商品 ID'
              : ''
        };
          if (nextItem.itemId) delete nextItem.sourceKey;
          enriched.push(nextItem);
        } catch (error) {
          enriched.push({
            ...item,
            enrichmentStatus: item.title ? 'partial' : 'failed',
            enrichmentError: error.message || '商品资料读取失败'
          });
        }
      }
      onProgress({ current: index + 1, total: items.length, message: `已处理第 ${index + 1}/${items.length} 个指定商品` });
      if (index < items.length - 1 && options.skipEnrichmentDelay !== true) {
        await wait(Math.max(300, Number(options.enrichmentIntervalMs || 900)));
      }
    }
  } finally {
    if (chromeSession) chromeSession.close();
  }
  return enriched;
}

module.exports = {
  fetchTaobaoItemPage,
  createTaobaoChromeSession,
  isAllowedEndpoint,
  isAllowedDomain,
  parseTaobaoItemHtml,
  parseManualItem,
  parseManualItems,
  enrichManualItems,
  isPlaceholderTitle,
  pickTitle
};
