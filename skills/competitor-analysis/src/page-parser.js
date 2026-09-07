'use strict';

const SKIP_PRODUCT_LINES = [
  /^¥$/, /^\d+(?:\.\d+)?$/, /^加载中$/, /^进入直播间$/,
  /^(?:综合|销量|新品|价格|客服|关注|全部宝贝|店铺首页|搜本店)$/,
  /(?:退货宝|包邮|免息|已降|满\d|折|立减|价保|淘金币)/,
  /榜[·\s]*第\d+名/, /^第\d+名$/
];

function cleanLines(content) {
  return String(content || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function parseCompactNumber(value) {
  const text = String(value || '').replace(/[,，\s]/g, '');
  const match = text.match(/(\d+(?:\.\d+)?)(万|千|百)?\+?/);
  if (!match) return null;
  const multiplier = { 万: 10000, 千: 1000, 百: 100 }[match[2]] || 1;
  return Math.round(Number(match[1]) * multiplier);
}

function paymentSignal(line) {
  const match = String(line || '').match(/^(\d+(?:\.\d+)?(?:万|千|百)?\+?)人付款$/);
  if (!match) return null;
  return {
    paymentText: line,
    paymentLowerBound: parseCompactNumber(match[1]),
    paymentExact: !match[1].includes('+')
  };
}

function likelyProductTitle(line) {
  const text = String(line || '').trim();
  if (text.length < 7 || text.length > 120) return false;
  return !SKIP_PRODUCT_LINES.some(pattern => pattern.test(text));
}

function parseShopName(title, lines) {
  const titleMatch = String(title || '').match(/^首页-(.+?)-(?:淘宝网|天猫)/);
  if (titleMatch) return titleMatch[1].trim();
  const searchIndex = lines.indexOf('搜本店');
  return searchIndex >= 0 ? String(lines[searchIndex + 1] || '').trim() : '';
}

function parseShopKey(urlValue) {
  try {
    const url = new URL(urlValue);
    const numeric = url.hostname.match(/^shop(\d+)\.taobao\.com$/i)?.[1]
      || url.searchParams.get('shopId')
      || url.searchParams.get('shop_id');
    const appUid = url.searchParams.get('appUid');
    return numeric ? `shop:${numeric}` : appUid ? `app:${appUid}` : `host:${url.hostname.toLowerCase()}`;
  } catch (_error) {
    return '';
  }
}

function canonicalShopUrl(urlValue) {
  try {
    const url = new URL(urlValue);
    const appUid = url.searchParams.get('appUid');
    if (/^shop\d+\.taobao\.com$/i.test(url.hostname)) return `${url.protocol}//${url.hostname}/`;
    if (url.hostname === 'store.taobao.com' && appUid) {
      return `https://store.taobao.com/category.htm?appUid=${encodeURIComponent(appUid)}`;
    }
    if (url.hostname.endsWith('.tmall.com')) {
      return appUid
        ? `${url.protocol}//${url.hostname}/category.htm?appUid=${encodeURIComponent(appUid)}`
        : `${url.protocol}//${url.hostname}/`;
    }
    return `${url.protocol}//${url.hostname}${url.pathname || '/'}`;
  } catch (_error) {
    return String(urlValue || '').trim();
  }
}

/**
 * Parse visible shop profile data returned by taobao-native.
 * @param {object} page Current page snapshot.
 * @returns {object} Normalized shop profile.
 */
function parseShopPage(page = {}) {
  const lines = cleanLines(page.content);
  const name = parseShopName(page.title, lines);
  const followerLine = lines.find(line => /粉丝$/.test(line)) || '';
  const start = lines.indexOf('全部宝贝');
  const end = lines.indexOf('综合', Math.max(0, start));
  const categories = start >= 0 && end > start
    ? lines.slice(start + 1, end).filter(line => line.length <= 20 && !['客服', '关注'].includes(line)).slice(0, 40)
    : [];
  const signals = lines.filter(line => /近(?:半年|一年|90天|30天)|综合体验|宝贝质量|物流速度|服务保障/.test(line)).slice(0, 12);
  return {
    shopKey: parseShopKey(page.url),
    shopName: name,
    shopUrl: canonicalShopUrl(page.url),
    resolvedUrl: String(page.url || ''),
    followerText: followerLine,
    followerLowerBound: parseCompactNumber(followerLine),
    categories,
    signals
  };
}

/**
 * Parse product rows from a sorted Taobao shop listing.
 * @param {string} content Visible page text.
 * @param {object} [options] Parsing options.
 * @param {string} [options.sortType] `hot` or `new`.
 * @param {number} [options.limit] Maximum rows.
 * @returns {Array<object>} Product rows in visible order.
 */
function parseSortedProducts(content, options = {}) {
  const lines = cleanLines(content);
  const limit = Math.max(1, Math.min(100, Number.parseInt(options.limit, 10) || 20));
  const rows = [];
  let previousPaymentIndex = -1;
  for (let index = 0; index < lines.length && rows.length < limit; index += 1) {
    const payment = paymentSignal(lines[index]);
    if (!payment) continue;
    const segment = lines.slice(previousPaymentIndex + 1, index);
    previousPaymentIndex = index;
    const candidates = segment.filter(likelyProductTitle);
    const title = candidates.sort((a, b) => b.length - a.length)[0] || '';
    if (!title) continue;
    const labels = segment.filter(line => line !== title && line.length <= 32 && !['¥'].includes(line)).slice(-5);
    rows.push({
      sortType: options.sortType === 'new' ? 'new' : 'hot',
      rank: rows.length + 1,
      title,
      ...payment,
      labels
    });
  }
  return rows;
}

function firstElementIndex(dom, label) {
  const target = String(label || '').trim();
  for (const line of String(dom || '').split(/\r?\n/)) {
    if (!line.includes(target)) continue;
    const match = line.match(/\[(\d+)\]/);
    if (match) return Number(match[1]);
  }
  return null;
}

module.exports = {
  canonicalShopUrl,
  cleanLines,
  firstElementIndex,
  parseCompactNumber,
  parseShopPage,
  parseSortedProducts,
  paymentSignal
};
