const http = require('http');
const WebSocket = require('ws');
const iconv = require('iconv-lite');

const DEFAULT_PORT = 9222;
const DEFAULT_WAIT_MS = 10000;
const DEFAULT_MAX_PRODUCTS = 20;
const DEFAULT_MAX_RESOLVE_LINKS = 8;
const DEFAULT_PAGE_FILTER_WAIT_MS = 5000;
const DEFAULT_SCROLL_STEPS = 8;
const DEFAULT_SCROLL_WAIT_MS = 1200;
const DEFAULT_SCROLL_STABLE_ROUNDS = 2;
const DEFAULT_MAX_REASONABLE_PRICE = 1000;
const SELECTORS_VERSION = '1688-search-card-v2';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchText(url, options = {}) {
  const method = options.method || 'GET';
  const timeout = options.timeout || 10000;
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, timeout }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('HTTP timeout: ' + url));
    });
    req.end();
  });
}

async function fetchJson(url, options = {}) {
  const res = await fetchText(url, options);
  return JSON.parse(res.body);
}

class CdpClient {
  constructor(webSocketDebuggerUrl) {
    this.ws = new WebSocket(webSocketDebuggerUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    this.ws.on('message', raw => this._handleMessage(raw));
  }

  _handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    if (!msg.id || !this.pending.has(msg.id)) return;
    const pending = this.pending.get(msg.id);
    clearTimeout(pending.timer);
    this.pending.delete(msg.id);
    if (msg.error) {
      pending.reject(new Error('CDP ' + msg.error.code + ': ' + msg.error.message));
      return;
    }
    pending.resolve(msg.result);
  }

  async send(method, params = {}, timeoutMs = 30000) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('CDP timeout: ' + method));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, timeoutMs = 30000) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    }, timeoutMs);
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception &&
        result.exceptionDetails.exception.description;
      throw new Error(description || result.exceptionDetails.text || 'CDP Runtime.evaluate failed');
    }
    return result.result && result.result.value;
  }

  close() {
    this.pending.forEach(p => {
      clearTimeout(p.timer);
      p.reject(new Error('CDP client closed'));
    });
    this.pending.clear();
    this.ws.close();
  }
}

function cdpBase(port) {
  return 'http://127.0.0.1:' + (port || DEFAULT_PORT);
}

async function listTargets(port = DEFAULT_PORT) {
  return fetchJson(cdpBase(port) + '/json/list');
}

async function createTarget(port = DEFAULT_PORT, url = 'about:blank') {
  return fetchJson(cdpBase(port) + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
}

async function closeTarget(port = DEFAULT_PORT, targetId) {
  if (!targetId) return;
  try {
    await fetchText(cdpBase(port) + '/json/close/' + targetId);
  } catch (e) {
    // Closing a temporary tab is best effort.
  }
}

function isSearchTarget(target) {
  return target &&
    target.type === 'page' &&
    /(^|\.)1688\.com/.test(target.url || '') &&
    !/detail\.1688\.com|jnesoft|g\.alicdn/.test(target.url || '');
}

async function getSearchTarget(port = DEFAULT_PORT) {
  const targets = await listTargets(port);
  let target = targets.find(isSearchTarget);
  if (!target) {
    target = await createTarget(port, 'https://www.1688.com/');
  }
  if (!target.webSocketDebuggerUrl) {
    throw new Error('Chrome target has no webSocketDebuggerUrl');
  }
  return target;
}

function buildSearchUrl(keyword, options = {}) {
  const params = new URLSearchParams();
  if (options.sort === 'sales' || options.pageSort === 'sales') params.set('sortType', 'va_rmdarkgmv30rt');
  if (options.beginPage && Number(options.beginPage) > 1) params.set('beginPage', String(Number(options.beginPage)));
  const query = params.toString();
  const encodedKeyword = encodeGbkURIComponent(keyword || '');
  return 'https://s.1688.com/selloffer/offer_search.htm?keywords=' + encodedKeyword + (query ? '&' + query : '');
}

function encodeGbkURIComponent(value) {
  const buf = iconv.encode(String(value || ''), 'gbk');
  return Array.from(buf).map(byte => '%' + byte.toString(16).toUpperCase().padStart(2, '0')).join('');
}

function parseNumberText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/,/g, '').replace(/\s+/g, '');
  const match = text.match(/(\d+(?:\.\d+)?)(万|w|W|千|k|K)?/);
  if (!match) return null;
  let num = Number(match[1]);
  const unit = match[2];
  if (unit === '万' || unit === 'w' || unit === 'W') num *= 10000;
  if (unit === '千' || unit === 'k' || unit === 'K') num *= 1000;
  return Math.round(num);
}


function parseCurrencyAmount(integerPart, decimalPart) {
  const integerText = String(integerPart || '').replace(/[,\s]/g, '');
  const decimalText = decimalPart === undefined ? '' : String(decimalPart || '').replace(/\s/g, '');
  const numberText = integerText + (decimalText ? '.' + decimalText : '');
  const value = Number(numberText);
  return Number.isFinite(value) ? value : null;
}

function priceBandFromNumbers(prices) {
  const uniquePrices = Array.from(new Set((prices || []).filter(n => Number.isFinite(n) && n >= 0)));
  if (uniquePrices.length === 0) {
    return { minPrice: null, maxPrice: null, prices: [], display: '' };
  }
  const minPrice = Math.min(...uniquePrices);
  const maxPrice = Math.max(...uniquePrices);
  return {
    minPrice,
    maxPrice,
    prices: uniquePrices.sort((a, b) => a - b),
    display: minPrice === maxPrice ? String(minPrice) : minPrice + '-' + maxPrice
  };
}


function parseAmountAt(text, startIndex) {
  let i = startIndex;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  let integerPart = '';
  while (i < text.length && /[0-9]/.test(text[i])) {
    integerPart += text[i];
    i += 1;
  }
  if (!integerPart) return null;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  let decimalPart = '';
  if (text[i] === '.') {
    i += 1;
    while (i < text.length && /\s/.test(text[i])) i += 1;
    while (i < text.length && /[0-9]/.test(text[i]) && decimalPart.length < 2) {
      decimalPart += text[i];
      i += 1;
    }
  }
  const value = Number(integerPart + (decimalPart ? '.' + decimalPart : ''));
  return Number.isFinite(value) ? { value, nextIndex: i } : null;
}

function parsePriceBand(text) {
  if (!text) {
    return { minPrice: null, maxPrice: null, prices: [], display: '' };
  }
  const source = String(text);
  const prices = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '\u00a5' && source[i] !== '\uffe5') continue;
    const first = parseAmountAt(source, i + 1);
    if (!first) continue;
    prices.push(first.value);
    let j = first.nextIndex;
    while (j < source.length && /\s/.test(source[j])) j += 1;
    if ('-~\u2013\u2014\u81f3'.includes(source[j])) {
      const second = parseAmountAt(source, j + 1);
      if (second) prices.push(second.value);
    }
  }
  return priceBandFromNumbers(prices);
}

function parsePrice(text) {
  if (!text) return null;
  const band = parsePriceBand(text);
  if (band.minPrice !== null) return band.minPrice;
  const match = String(text).match(/(?:\u4ef7\u683c|price)[:\uff1a]?\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
  return match ? Number(match[1]) : null;
}

function buildAggregatePriceBand(products) {
  const prices = [];
  for (const product of products || []) {
    if (product.priceBand && Array.isArray(product.priceBand.prices)) {
      prices.push(...product.priceBand.prices);
    } else if (Number.isFinite(Number(product.price))) {
      prices.push(Number(product.price));
    }
  }
  return priceBandFromNumbers(prices);
}

function parseSales(text) {
  if (!text) return 0;
  const patterns = [
    /(?:近30天销量|30天销量|月销|销量|已售|全网)\s*([0-9.,]+\s*(?:万|w|W|千|k|K)?)/,
    /成交\s*([0-9.,]+\s*(?:万|w|W|千|k|K)?)/,
    /([0-9.,]+\s*(?:万|w|W|千|k|K)?)\+?\s*(?:件|人)/
  ];
  for (const pattern of patterns) {
    const match = String(text).match(pattern);
    if (match) return parseNumberText(match[1]) || 0;
  }
  return 0;
}

const PLACEHOLDER_KEYWORDS = [
  '点此可以直接和卖家交流',
  '相互交流网购体验',
  '语音视频',
  '选好的宝贝',
  '综合服务',
  '面单支持'
];

function isPlaceholderTitle(text) {
  if (!text || typeof text !== 'string') return true;
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 5) return true;
  return PLACEHOLDER_KEYWORDS.some(keyword => t.includes(keyword));
}

function stripTitleSuffix(text) {
  return String(text || '')
    .replace(/\s*(元宝可抵|分享再减)\s*\d+%?/g, '')
    .replace(/\s*商机组货[：:].*$/g, '')
    .replace(/\s*(退货包运费|先采后付|\d+天无理由|官方物流|代发包邮|明天达|后天达).*$/g, '')
    .trim();
}

function extractTitleFromCardText(cardText) {
  if (!cardText) return '';
  const normalized = String(cardText).replace(/\s+/g, ' ').trim();
  const beforePrice = normalized.split(/[\u00a5\uffe5]/)[0];
  return stripTitleSuffix(beforePrice).slice(0, 160);
}

function parseTitle(text) {
  if (!text) return '';
  const normalized = String(text).replace(/\s+/g, ' ').trim();
  const beforePrice = normalized.split(/[\u00a5\uffe5]/)[0];
  const beforeAttrs = beforePrice.split(/\s(?:种类|处理工艺|流行元素分类|流行元素|适用人群|风格|材质|样式|品牌|货号)[:：]/)[0];
  return stripTitleSuffix(beforeAttrs).slice(0, 160);
}

function smartTitle(anchorText, cardText) {
  if (!isPlaceholderTitle(anchorText)) {
    return parseTitle(anchorText);
  }
  const fromCard = extractTitleFromCardText(cardText);
  if (fromCard.length >= 5) return fromCard;
  return parseTitle(cardText || anchorText);
}

function normalizeOfferUrl(url) {
  if (!url) return '';
  const text = String(url);
  const detailMatch = text.match(/https?:\/\/detail\.1688\.com\/offer\/(\d+)\.html/i);
  if (detailMatch) return 'https://detail.1688.com/offer/' + detailMatch[1] + '.html';
  const queryMatch = text.match(/[?&]offerId=(\d+)/i);
  if (queryMatch) return 'https://detail.1688.com/offer/' + queryMatch[1] + '.html';
  return text;
}

function extractOfferId(url) {
  const text = String(url || '');
  const pathMatch = text.match(/offer\/(\d+)\.html/i);
  if (pathMatch) return pathMatch[1];
  const queryMatch = text.match(/[?&]offerId=(\d+)/i);
  return queryMatch ? queryMatch[1] : '';
}

function normalizeCard(raw) {
  const text = raw.cardText || raw.text || raw.anchorText || '';
  const url = normalizeOfferUrl(raw.finalUrl || raw.url || raw.href || '');
  const offerId = extractOfferId(url);
  const priceBand = parsePriceBand(text);
  const price = priceBand.minPrice !== null ? priceBand.minPrice : parsePrice(text);
  return {
    id: offerId || raw.id || '',
    offerId,
    title: smartTitle(raw.anchorText, raw.cardText || raw.text || ''),
    subject: smartTitle(raw.anchorText, raw.cardText || raw.text || ''),
    url,
    redirectUrl: raw.redirectUrl || (/^https?:\/\/detail\.1688\.com/.test(raw.url || '') ? '' : raw.url || ''),
    price,
    priceBand,
    priceMin: priceBand.minPrice,
    priceMax: priceBand.maxPrice,
    sales30days: parseSales(text),
    stats: {
      last30DaysSales: parseSales(text)
    },
    shopName: raw.shopName || '',
    imageUrl: raw.imageUrl || raw.img || '',
    source: '1688-web',
    raw
  };
}

function filterWebProducts(products, options = {}) {
  const minPrice = options.minPrice === undefined ? null : Number(options.minPrice);
  const maxPrice = options.maxPrice === undefined ? null : Number(options.maxPrice);
  const minSales30d = options.minSales30d === undefined ? null : Number(options.minSales30d);
  const includeKeywords = Array.isArray(options.includeKeywords) ? options.includeKeywords.filter(Boolean) : [];
  const excludeKeywords = Array.isArray(options.excludeKeywords) ? options.excludeKeywords.filter(Boolean) : [];
  const maxProducts = Number(options.maxProducts || DEFAULT_MAX_PRODUCTS);

  return products.filter(product => {
    const title = product.title || product.subject || '';
    const price = Number(product.price || 0);
    const sales = Number(product.sales30days || product.stats && product.stats.last30DaysSales || 0);
    if (minPrice !== null && price && price < minPrice) return false;
    if (maxPrice !== null && price && price > maxPrice) return false;
    if (minSales30d !== null && sales < minSales30d) return false;
    if (includeKeywords.length && !includeKeywords.every(word => title.includes(word))) return false;
    if (excludeKeywords.length && excludeKeywords.some(word => title.includes(word))) return false;
    return true;
  }).slice(0, maxProducts);
}

function incReason(reasons, reason) {
  reasons[reason] = (reasons[reason] || 0) + 1;
}

function filterWebProductsDetailed(products, options = {}) {
  const minPrice = options.minPrice === undefined ? null : Number(options.minPrice);
  const maxPrice = options.maxPrice === undefined ? null : Number(options.maxPrice);
  const minSales30d = options.minSales30d === undefined ? null : Number(options.minSales30d);
  const maxReasonablePrice = options.maxReasonablePrice === undefined
    ? DEFAULT_MAX_REASONABLE_PRICE
    : Number(options.maxReasonablePrice);
  const filterExtremePrice = options.filterExtremePrice !== false;
  const dropMissingOfferId = options.dropMissingOfferId !== false;
  const dropMissingImage = !!options.dropMissingImage;
  const includeKeywords = Array.isArray(options.includeKeywords) ? options.includeKeywords.filter(Boolean) : [];
  const excludeKeywords = Array.isArray(options.excludeKeywords) ? options.excludeKeywords.filter(Boolean) : [];
  const maxProducts = Number(options.maxProducts || DEFAULT_MAX_PRODUCTS);
  const droppedReasons = {};
  const kept = [];

  for (const product of products || []) {
    const title = product.title || product.subject || '';
    const price = Number(product.price || 0);
    const sales = Number(product.sales30days || product.stats && product.stats.last30DaysSales || 0);
    let reason = '';
    if (dropMissingOfferId && !product.offerId) reason = 'missingOfferId';
    else if (dropMissingImage && !product.imageUrl) reason = 'missingImage';
    else if (minPrice !== null && price && price < minPrice) reason = 'belowMinPrice';
    else if (maxPrice !== null && price && price > maxPrice) reason = 'aboveMaxPrice';
    else if (filterExtremePrice && maxReasonablePrice && price > maxReasonablePrice) reason = 'extremePrice';
    else if (minSales30d !== null && sales < minSales30d) reason = 'belowMinSales30d';
    else if (includeKeywords.length && !includeKeywords.every(word => title.includes(word))) reason = 'missingIncludeKeyword';
    else if (excludeKeywords.length && excludeKeywords.some(word => title.includes(word))) reason = 'hasExcludeKeyword';

    if (reason) {
      incReason(droppedReasons, reason);
      continue;
    }
    kept.push(product);
  }

  if (kept.length > maxProducts) {
    droppedReasons.overLimit = kept.length - maxProducts;
  }

  return {
    products: kept.slice(0, maxProducts),
    droppedReasons
  };
}

function dedupeProducts(products) {
  const map = new Map();
  for (const product of products) {
    const key = product.offerId || product.id || product.url || product.redirectUrl || product.title;
    if (!key || map.has(key)) continue;
    map.set(key, product);
  }
  return Array.from(map.values());
}

function buildSearchDiagnostics(stage) {
  const rawCards = stage.snapshot && Array.isArray(stage.snapshot.cards) ? stage.snapshot.cards.length : 0;
  const normalizedProducts = stage.normalizedProducts || [];
  const dedupedProducts = stage.dedupedProducts || [];
  const resolvedProducts = stage.resolvedProducts || [];
  const finalProducts = stage.finalProducts || [];
  const filterDiagnostics = stage.filterDiagnostics || { droppedReasons: {} };
  const resolveDiagnostics = stage.resolveDiagnostics || {};
  const validOfferIds = finalProducts.filter(product => product.offerId).length;
  const warnings = [];

  if (rawCards === 0) warnings.push('noCardsExtracted');
  if (validOfferIds === 0) warnings.push('noValidOfferIds');
  if (stage.pageFiltersApplied && stage.pageFiltersApplied.missed && stage.pageFiltersApplied.missed.length) {
    warnings.push('pageFilterMissed');
  }
  if (stage.scrollLoad && stage.scrollLoad.enabled && stage.scrollLoad.finalCount < Number(stage.options.maxProducts || DEFAULT_MAX_PRODUCTS)) {
    warnings.push('lowScrollCardCount');
  }
  if (filterDiagnostics.droppedReasons && Object.keys(filterDiagnostics.droppedReasons).length) {
    warnings.push('productsDropped');
  }

  return {
    selectorsVersion: SELECTORS_VERSION,
    extractedCards: rawCards,
    normalizedProducts: normalizedProducts.length,
    dedupedProducts: dedupedProducts.length,
    resolvedProducts: resolvedProducts.length,
    finalProducts: finalProducts.length,
    validOfferIds,
    missingOfferIds: finalProducts.length - validOfferIds,
    resolvedLinks: resolveDiagnostics.resolvedLinks || 0,
    unresolvedLinks: resolveDiagnostics.unresolvedLinks || 0,
    skippedResolveLinks: resolveDiagnostics.skippedResolveLinks || 0,
    droppedReasons: filterDiagnostics.droppedReasons || {},
    warnings
  };
}

function asList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
  return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

function buildPageFilterConfig(options = {}) {
  const pageFilters = options.pageFilters || {};
  const config = {
    sort: pageFilters.sort || options.pageSort || options.sort || '',
    minPrice: pageFilters.minPrice !== undefined ? pageFilters.minPrice : options.minPrice,
    maxPrice: pageFilters.maxPrice !== undefined ? pageFilters.maxPrice : options.maxPrice,
    minOrderQuantity: pageFilters.minOrderQuantity !== undefined ? pageFilters.minOrderQuantity : options.minOrderQuantity,
    maxOrderQuantity: pageFilters.maxOrderQuantity !== undefined ? pageFilters.maxOrderQuantity : options.maxOrderQuantity,
    minShopProducts: pageFilters.minShopProducts !== undefined ? pageFilters.minShopProducts : options.minShopProducts,
    featureKeywords: asList(pageFilters.featureKeywords || options.pageFeatureKeywords || options.featureKeywords),
    clickKeywords: asList(pageFilters.clickKeywords || options.pageFilterKeywords)
  };
  config.hasFilters = !!(
    config.sort ||
    config.minPrice !== undefined ||
    config.maxPrice !== undefined ||
    config.minOrderQuantity !== undefined ||
    config.maxOrderQuantity !== undefined ||
    config.minShopProducts !== undefined ||
    config.featureKeywords.length ||
    config.clickKeywords.length
  );
  return config;
}

function pageFilterExpression(config) {
  const json = JSON.stringify(config || {});
  return `(() => {
    const filters = ${json};
    const result = { applied: false, actions: [], missed: [] };
    const textOf = el => (el && (el.innerText || el.textContent || el.value || '') || '').replace(/\\s+/g, '');
    const isVisible = el => {
      if (!el) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const setInput = (input, value, name) => {
      if (!input || value === undefined || value === null || value === '') return false;
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, String(value));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      result.actions.push('set:' + name + '=' + value);
      result.applied = true;
      return true;
    };
    const clickEl = (el, name) => {
      if (!el) return false;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      el.click();
      result.actions.push('click:' + name);
      result.applied = true;
      return true;
    };
    const inputs = Array.from(document.querySelectorAll('input')).filter(isVisible);
    const byPlaceholder = needle => inputs.find(input => (input.placeholder || '').includes(needle));
    const textCandidates = () => Array.from(document.querySelectorAll('a,button,span,div,label'))
      .filter(isVisible)
      .map(el => ({ el, text: textOf(el), rect: el.getBoundingClientRect() }))
      .filter(x => x.text && x.rect.width <= 360 && x.rect.height <= 90)
      .sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height));
    const clickByText = (label) => {
      const compact = String(label || '').replace(/\\s+/g, '');
      if (!compact) return false;
      const found = textCandidates().find(x => x.text === compact || x.text.includes(compact));
      if (!found) {
        result.missed.push('text:' + label);
        return false;
      }
      return clickEl(found.el, 'text:' + label);
    };
    const clickConfirmNear = (input, name) => {
      if (!input) return false;
      let node = input.parentElement;
      for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
        const btn = Array.from(node.querySelectorAll('a,button,span,div'))
          .filter(isVisible)
          .find(el => textOf(el) === '\\u786e\\u5b9a');
        if (btn) return clickEl(btn, 'confirm:' + name);
      }
      return false;
    };
    const minPriceInput = byPlaceholder('\\u6700\\u4f4e\\u4ef7');
    const maxPriceInput = byPlaceholder('\\u6700\\u9ad8\\u4ef7');
    const minPriceSet = setInput(minPriceInput, filters.minPrice, 'minPrice');
    const maxPriceSet = setInput(maxPriceInput, filters.maxPrice, 'maxPrice');
    const hasPrice = minPriceSet || maxPriceSet;
    if (hasPrice) clickConfirmNear(minPriceInput || maxPriceInput, 'price');

    const minOrderInput = byPlaceholder('\\u6700\\u4f4e\\u6570\\u91cf');
    const maxOrderInput = byPlaceholder('\\u6700\\u9ad8\\u6570\\u91cf');
    const minOrderSet = setInput(minOrderInput, filters.minOrderQuantity, 'minOrderQuantity');
    const maxOrderSet = setInput(maxOrderInput, filters.maxOrderQuantity, 'maxOrderQuantity');
    const hasOrder = minOrderSet || maxOrderSet;
    if (hasOrder) clickConfirmNear(minOrderInput || maxOrderInput, 'orderQuantity');

    if (filters.minShopProducts !== undefined && filters.minShopProducts !== null && filters.minShopProducts !== '') {
      const shopInput = inputs.find(input => (input.placeholder || '').includes('\\u8bf7\\u8f93\\u5165'));
      if (setInput(shopInput, filters.minShopProducts, 'minShopProducts')) clickConfirmNear(shopInput, 'shopProducts');
    }

    if (filters.sort === 'sales') clickByText('\\u9500\\u91cf');
    if (filters.sort === 'price') clickByText('\\u4ef7\\u683c');

    [...(filters.featureKeywords || []), ...(filters.clickKeywords || [])].forEach(clickByText);
    return result;
  })()`;
}

async function applyPageFilters(client, options = {}) {
  const config = buildPageFilterConfig(options);
  if (!config.hasFilters) {
    return { applied: false, actions: [], missed: [] };
  }
  const result = await client.evaluate(pageFilterExpression(config), 30000);
  if (result && result.applied) {
    await sleep(Number(options.pageFilterWaitMs || DEFAULT_PAGE_FILTER_WAIT_MS));
  }
  return result || { applied: false, actions: [], missed: [] };
}

async function scrollPageForProducts(client, options = {}) {
  if (options.scrollLoad === false) {
    return { enabled: false, steps: 0, counts: [], finalCount: 0, reason: 'disabled' };
  }
  const targetCount = Number(options.scrollTargetCards || options.maxProducts || DEFAULT_MAX_PRODUCTS) * 2;
  const maxSteps = Number(options.scrollSteps || DEFAULT_SCROLL_STEPS);
  const waitMs = Number(options.scrollWaitMs || DEFAULT_SCROLL_WAIT_MS);
  const stableRoundsLimit = Number(options.scrollStableRounds || DEFAULT_SCROLL_STABLE_ROUNDS);
  const counts = [];
  let stableRounds = 0;
  let lastCount = -1;

  for (let step = 0; step <= maxSteps; step++) {
    const count = await client.evaluate(productLinkCountExpression(), 10000);
    counts.push(Number(count || 0));
    if (count >= targetCount) {
      return { enabled: true, steps: step, counts, finalCount: Number(count || 0), reason: 'target-reached' };
    }
    if (count <= lastCount) stableRounds += 1;
    else stableRounds = 0;
    if (step > 0 && stableRounds >= stableRoundsLimit) {
      return { enabled: true, steps: step, counts, finalCount: Number(count || 0), reason: 'stable' };
    }
    lastCount = Number(count || 0);
    await client.evaluate(`(() => {
      const delta = Math.max(window.innerHeight * 1.6, 900);
      window.scrollBy(0, delta);
      document.documentElement.scrollTop += delta;
      document.body.scrollTop += delta;
      const scrollables = Array.from(document.querySelectorAll('div,main,section'))
        .filter(el => el.scrollHeight > el.clientHeight + 200)
        .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
      for (const el of scrollables.slice(0, 3)) {
        el.scrollTop += delta;
        el.dispatchEvent(new WheelEvent('wheel', { deltaY: delta, bubbles: true, cancelable: true }));
      }
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: delta, bubbles: true, cancelable: true }));
      return true;
    })()`, 10000);
    try {
      await client.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: 600,
        y: 600,
        deltaY: Math.max(900, 1200)
      }, 5000);
    } catch (e) {
      // Runtime scrolling is the primary mechanism; CDP wheel is best effort.
    }
    await sleep(waitMs);
  }
  const finalCount = counts.length ? counts[counts.length - 1] : 0;
  return { enabled: true, steps: maxSteps, counts, finalCount, reason: 'max-steps' };
}


function productLinkCountExpression() {
  return `(() => {
    const isVisible = el => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 80 && rect.height > 80 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const selector = '.search-offer-wrapper, .search-offer-item, .ad-offer, [class*="offer-wrapper"], [class*="major-offer"]';
    const cards = Array.from(document.querySelectorAll(selector)).filter(isVisible);
    const seen = new Set();
    let count = 0;
    for (const card of cards) {
      const text = (card.innerText || '').replace(/\\s+/g, ' ').trim();
      if ((!text.includes('\\u00a5') && !text.includes('\\uffe5') && !/\\d+\\s*\\.\\s*\\d+/.test(text)) || !card.querySelector('img')) continue;
      const rect = card.getBoundingClientRect();
      const key = Math.round(rect.x) + ':' + Math.round(rect.y) + ':' + Math.round(rect.width) + ':' + Math.round(rect.height);
      if (seen.has(key)) continue;
      seen.add(key);
      count += 1;
    }
    return count;
  })()`;
}

function domExtractionExpression(maxCards) {
  return `(() => {
    const maxCards = ${Number(maxCards || DEFAULT_MAX_PRODUCTS) * 3};
    const candidates = [];
    const seenCards = new Set();
    const productHref = href => /detail\\.1688\\.com\\/offer\\/\\d+\\.html/i.test(href || '') ||
      /detail\\.m\\.1688\\.com\\/page\\/index\\.html\\?[^#]*offerId=\\d+/i.test(href || '') ||
      /[?&]offerId=\\d+/i.test(href || '') ||
      /dj\\.1688\\.com\\/ci_(?:bb|king)/i.test(href || '');
    const isVisible = el => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 80 && rect.height > 80 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const pushCard = (card, fallbackAnchor) => {
      if (!card) return;
      const cardText = (card.innerText || '').replace(/\\s+/g, ' ').trim();
      if (!cardText || (!cardText.includes('\\u00a5') && !cardText.includes('\\uffe5') && !/\\d+\\s*\\.\\s*\\d+/.test(cardText))) return;
      const rect = card.getBoundingClientRect();
      const cardKey = Math.round(rect.x) + ':' + Math.round(rect.y) + ':' + Math.round(rect.width) + ':' + Math.round(rect.height) + ':' + cardText.slice(0, 24);
      if (seenCards.has(cardKey)) return;
      const links = Array.from(card.querySelectorAll('a'));
      const productLink = links.find(x => productHref(x.href) && (x.innerText || x.title || '').replace(/\\s+/g, ' ').trim().length > 20) ||
        links.find(x => productHref(x.href)) ||
        (fallbackAnchor && productHref(fallbackAnchor.href) ? fallbackAnchor : null);
      if (!productLink) return;
      seenCards.add(cardKey);
      const href = productLink.href || '';
      const text = (productLink.innerText || productLink.title || cardText).replace(/\\s+/g, ' ').trim();
      const img = card.querySelector('img.main-img, img');
      const shop = Array.from(card.querySelectorAll('a,span,div'))
        .map(x => (x.innerText || '').replace(/\\s+/g, ' ').trim())
        .find(x => x.length <= 60 && /\\u516c\\u53f8|\\u5546\\u884c|\\u5de5\\u5382|\\u5e97|\\u5382/.test(x));
      candidates.push({
        url: href,
        anchorText: text,
        cardText,
        imageUrl: img ? (img.currentSrc || img.src || img.getAttribute('data-src') || '') : '',
        shopName: shop || ''
      });
    };

    const selector = '.search-offer-wrapper, .search-offer-item, .ad-offer, [class*="offer-wrapper"], [class*="major-offer"]';
    for (const card of Array.from(document.querySelectorAll(selector)).filter(isVisible)) {
      pushCard(card, null);
      if (candidates.length >= maxCards) break;
    }

    if (candidates.length < maxCards) {
      for (const a of Array.from(document.links || [])) {
        const href = a.href || '';
        const text = (a.innerText || a.title || '').replace(/\\s+/g, ' ').trim();
        if (!productHref(href) && !(String(a.className || '').includes('offer') && text.length > 20)) continue;
        let card = a;
        for (let i = 0; i < 8 && card && card !== document.body; i++) {
          const t = (card.innerText || '').replace(/\\s+/g, ' ');
          if (t.length > 40 && (t.includes('\\u00a5') || t.includes('\\uffe5') || /\\d+\\s*\\.\\s*\\d+/.test(t))) break;
          card = card.parentElement;
        }
        pushCard(card || a, a);
        if (candidates.length >= maxCards) break;
      }
    }

    return {
      url: location.href,
      title: document.title,
      textLength: document.body ? document.body.innerText.length : 0,
      hasLoginText: document.body ? document.body.innerText.includes('\\u767b\\u5f55') : false,
      hasCaptchaText: document.body ? (document.body.innerText.includes('\\u9a8c\\u8bc1') || document.body.innerText.includes('\\u6ed1\\u5757')) : false,
      cards: candidates
    };
  })()`;
}

async function resolveOfferUrl(port, redirectUrl, timeoutMs = 12000) {
  if (!redirectUrl) return '';
  if (/^https?:\/\/detail\.1688\.com\/offer\/\d+\.html/i.test(redirectUrl)) {
    return normalizeOfferUrl(redirectUrl);
  }
  let target;
  let client;
  try {
    target = await createTarget(port, 'about:blank');
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Page.navigate', { url: redirectUrl }, timeoutMs);
    await sleep(Math.min(timeoutMs, 8000));
    const finalUrl = await client.evaluate('location.href', 5000);
    return normalizeOfferUrl(finalUrl || '');
  } catch (e) {
    return '';
  } finally {
    if (client) client.close();
    if (target && target.id) await closeTarget(port, target.id);
  }
}

async function resolveProductUrls(products, options = {}) {
  const result = await resolveProductUrlsDetailed(products, options);
  return result.products;
}

async function resolveProductUrlsDetailed(products, options = {}) {
  const port = Number(options.port || DEFAULT_PORT);
  const maxResolveLinks = Number(options.maxResolveLinks || DEFAULT_MAX_RESOLVE_LINKS);
  let resolvedCount = 0;
  let unresolvedLinks = 0;
  let skippedResolveLinks = 0;
  const out = [];
  for (const product of products) {
    if (product.offerId || !product.redirectUrl) {
      out.push(product);
      continue;
    }
    if (resolvedCount >= maxResolveLinks) {
      skippedResolveLinks += 1;
      out.push(product);
      continue;
    }
    const finalUrl = await resolveOfferUrl(port, product.redirectUrl, options.resolveTimeoutMs || 12000);
    resolvedCount += 1;
    if (finalUrl && extractOfferId(finalUrl)) {
      out.push(normalizeCard(Object.assign({}, product.raw, {
        finalUrl,
        redirectUrl: product.redirectUrl
      })));
    } else {
      unresolvedLinks += 1;
      out.push(product);
    }
  }
  return {
    products: dedupeProducts(out),
    diagnostics: {
      resolvedLinks: resolvedCount - unresolvedLinks,
      unresolvedLinks,
      skippedResolveLinks
    }
  };
}

/**
 * Search 1688 in the user's existing Chrome session through CDP.
 * @param {Object} options - Search options.
 * @param {string} options.keyword - Search keyword.
 * @param {number} [options.port=9222] - Chrome remote debugging port.
 * @param {number} [options.maxProducts=20] - Maximum products to return.
 * @param {number} [options.maxResolveLinks=8] - Maximum redirect links to resolve.
 * @returns {Promise<{ok: boolean, products: object[], meta: object}>}
 */
async function searchWeb1688(options = {}) {
  const keyword = String(options.keyword || '').trim();
  if (!keyword) throw new Error('keyword is required');
  const port = Number(options.port || process.env.BROWSER_CDP_PORT || process.env.CHROME_DEBUG_PORT || DEFAULT_PORT);
  const maxProducts = Number(options.maxProducts || DEFAULT_MAX_PRODUCTS);
  const maxPages = options.maxPages === undefined ? (maxProducts > 30 ? 3 : 1) : Math.max(1, Number(options.maxPages || 1));
  const target = await getSearchTarget(port);
  const client = new CdpClient(target.webSocketDebuggerUrl);
  try {
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    const pageResults = [];
    const collectedProducts = [];
    let resolvedLinks = 0;
    let unresolvedLinks = 0;
    let skippedResolveLinks = 0;

    for (let page = 1; page <= maxPages; page++) {
      const pageOptions = Object.assign({}, options, { beginPage: page });
      await client.send('Page.navigate', { url: buildSearchUrl(keyword, pageOptions) }, 15000);
      await sleep(Number(options.waitMs || DEFAULT_WAIT_MS));
      const pageFiltersApplied = await applyPageFilters(client, pageOptions);
      await client.evaluate('window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0; true', 10000);
      const scrollLoad = await scrollPageForProducts(client, pageOptions);
      const snapshot = await client.evaluate(domExtractionExpression(options.maxProducts), 30000);
      const normalizedProducts = (snapshot.cards || []).map(normalizeCard);
      const dedupedProducts = dedupeProducts(normalizedProducts);
      const resolved = await resolveProductUrlsDetailed(dedupedProducts, {
        port,
        maxResolveLinks: options.maxResolveLinks,
        resolveTimeoutMs: options.resolveTimeoutMs
      });
      resolvedLinks += resolved.diagnostics.resolvedLinks || 0;
      unresolvedLinks += resolved.diagnostics.unresolvedLinks || 0;
      skippedResolveLinks += resolved.diagnostics.skippedResolveLinks || 0;
      collectedProducts.push(...resolved.products);
      pageResults.push({
        page,
        snapshot,
        pageFiltersApplied,
        scrollLoad,
        normalizedProducts,
        dedupedProducts,
        resolvedProducts: resolved.products
      });
      if (dedupeProducts(collectedProducts).length >= maxProducts) break;
    }

    const mergedProducts = dedupeProducts(collectedProducts);
    const filtered = filterWebProductsDetailed(mergedProducts, options);
    const products = filtered.products;
    const priceBand = buildAggregatePriceBand(products);
    const lastPage = pageResults[pageResults.length - 1] || {};
    const syntheticSnapshot = {
      url: lastPage.snapshot && lastPage.snapshot.url || '',
      title: lastPage.snapshot && lastPage.snapshot.title || '',
      textLength: pageResults.reduce((sum, page) => sum + (page.snapshot && page.snapshot.textLength || 0), 0),
      cards: pageResults.flatMap(page => page.snapshot && page.snapshot.cards || []),
      hasLoginText: pageResults.some(page => page.snapshot && page.snapshot.hasLoginText),
      hasCaptchaText: pageResults.some(page => page.snapshot && page.snapshot.hasCaptchaText)
    };
    const combinedFilters = {
      applied: pageResults.some(page => page.pageFiltersApplied && page.pageFiltersApplied.applied),
      actions: pageResults.flatMap(page => page.pageFiltersApplied && page.pageFiltersApplied.actions || []),
      missed: pageResults.flatMap(page => page.pageFiltersApplied && page.pageFiltersApplied.missed || [])
    };
    const combinedScroll = {
      enabled: pageResults.some(page => page.scrollLoad && page.scrollLoad.enabled),
      steps: pageResults.reduce((sum, page) => sum + (page.scrollLoad && page.scrollLoad.steps || 0), 0),
      counts: pageResults.flatMap(page => page.scrollLoad && page.scrollLoad.counts || []),
      finalCount: pageResults.reduce((sum, page) => sum + (page.scrollLoad && page.scrollLoad.finalCount || 0), 0),
      reason: pageResults.map(page => page.scrollLoad && page.scrollLoad.reason).filter(Boolean).join(',')
    };
    const diagnostics = buildSearchDiagnostics({
      options,
      snapshot: syntheticSnapshot,
      normalizedProducts: pageResults.flatMap(page => page.normalizedProducts || []),
      dedupedProducts: mergedProducts,
      resolvedProducts: mergedProducts,
      finalProducts: products,
      filterDiagnostics: filtered,
      resolveDiagnostics: { resolvedLinks, unresolvedLinks, skippedResolveLinks },
      pageFiltersApplied: combinedFilters,
      scrollLoad: combinedScroll
    });
    return {
      ok: true,
      products,
      meta: {
        source: '1688-web',
        keyword,
        port,
        pageUrl: syntheticSnapshot.url,
        pageTitle: syntheticSnapshot.title,
        textLength: syntheticSnapshot.textLength,
        rawCards: syntheticSnapshot.cards ? syntheticSnapshot.cards.length : 0,
        hasLoginText: !!syntheticSnapshot.hasLoginText,
        hasCaptchaText: !!syntheticSnapshot.hasCaptchaText,
        pages: pageResults.map(page => ({
          page: page.page,
          url: page.snapshot && page.snapshot.url,
          rawCards: page.snapshot && page.snapshot.cards ? page.snapshot.cards.length : 0,
          scrollLoad: page.scrollLoad,
          pageFiltersApplied: page.pageFiltersApplied
        })),
        pageFiltersApplied: combinedFilters,
        scrollLoad: combinedScroll,
        priceBand,
        diagnostics
      }
    };
  } finally {
    client.close();
  }
}

async function checkWeb1688Status(options = {}) {
  const port = Number(options.port || process.env.BROWSER_CDP_PORT || process.env.CHROME_DEBUG_PORT || DEFAULT_PORT);
  try {
    const targets = await listTargets(port);
    const target = targets.find(isSearchTarget) || targets.find(t => t.type === 'page' && /(^|\.)1688\.com/.test(t.url || ''));
    if (!target) {
      return {
        ok: false,
        cdp: { ok: true, port },
        browser: { targetFound: false },
        message: 'No 1688 page target found. Open 1688 in the Chrome CDP session first.'
      };
    }
    if (!target.webSocketDebuggerUrl) {
      return {
        ok: false,
        cdp: { ok: true, port },
        browser: { targetFound: true, url: target.url, title: target.title },
        message: '1688 target has no webSocketDebuggerUrl.'
      };
    }

    const client = new CdpClient(target.webSocketDebuggerUrl);
    try {
      await client.send('Runtime.enable');
      const page = await client.evaluate(`(() => {
        const text = document.body ? document.body.innerText : '';
        return {
          url: location.href,
          title: document.title,
          textLength: text.length,
          hasLoginText: text.includes('\\u767b\\u5f55'),
          hasCaptchaText: text.includes('\\u9a8c\\u8bc1') || text.includes('\\u6ed1\\u5757'),
          productCardCount: ${productLinkCountExpression()}
        };
      })()`, 15000);
      return {
        ok: !page.hasLoginText && !page.hasCaptchaText,
        cdp: { ok: true, port },
        browser: { targetFound: true, url: target.url, title: target.title },
        page,
        diagnostics: {
          selectorsVersion: SELECTORS_VERSION,
          warnings: [
            ...(page.hasLoginText ? ['loginDetected'] : []),
            ...(page.hasCaptchaText ? ['captchaDetected'] : []),
            ...(page.productCardCount === 0 ? ['noProductCardsOnCurrentPage'] : [])
          ]
        }
      };
    } finally {
      client.close();
    }
  } catch (error) {
    return {
      ok: false,
      cdp: { ok: false, port },
      error: error.message,
      message: 'Chrome CDP is not available or cannot be inspected.'
    };
  }
}

module.exports = {
  CdpClient,
  buildSearchUrl,
  encodeGbkURIComponent,
  buildPageFilterConfig,
  pageFilterExpression,
  applyPageFilters,
  productLinkCountExpression,
  scrollPageForProducts,
  parsePrice,
  parsePriceBand,
  buildAggregatePriceBand,
  parseSales,
  parseTitle,
  normalizeCard,
  filterWebProducts,
  dedupeProducts,
  resolveOfferUrl,
  searchWeb1688,
  checkWeb1688Status
};
