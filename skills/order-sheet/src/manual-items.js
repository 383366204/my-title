'use strict';

const axios = require('axios');

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
        ...(parsed.paymentAmount != null ? { paymentAmount: parsed.paymentAmount } : {})
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
  const title = metaContent(source, 'og:title') || jsonStringValue(source, ['title', 'itemTitle']) || titleTag;
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
  return parseTaobaoItemHtml(response.data, finalUrl);
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
  for (const [index, item] of items.entries()) {
    if (item.title && item.imageUrl) {
      enriched.push({ ...item, enrichmentStatus: 'complete' });
    } else {
      try {
        const detail = await fetchTaobaoItemPage(item, options);
        const nextItem = {
          ...item,
          itemId: item.itemId || detail.itemId || '',
          title: item.title || detail.title || '',
          imageUrl: item.imageUrl || detail.imageUrl || '',
          storeName: item.storeName || detail.storeName || '',
          referencePrice: detail.referencePrice,
          resolvedUrl: detail.finalUrl || item.productUrl,
          enrichmentStatus: (item.title || detail.title) && (item.itemId || detail.itemId) ? 'complete' : 'partial',
          enrichmentError: !(item.title || detail.title)
            ? '未读取到商品标题'
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
  return enriched;
}

module.exports = {
  fetchTaobaoItemPage,
  isAllowedEndpoint,
  isAllowedDomain,
  parseTaobaoItemHtml,
  parseManualItem,
  parseManualItems,
  enrichManualItems
};
