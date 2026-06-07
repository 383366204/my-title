const { test } = require('node:test');
const assert = require('assert');

const {
  buildSearchUrl,
  encodeGbkURIComponent,
  buildPageFilterConfig,
  pageFilterExpression,
  productLinkCountExpression,
  parsePrice,
  parsePriceBand,
  buildAggregatePriceBand,
  parseSales,
  parseTitle,
  normalizeCard,
  filterWebProducts,
  dedupeProducts
} = require('../src/search-web-1688');

test('encodeGbkURIComponent encodes Chinese keyword for 1688 search', () => {
  assert.strictEqual(encodeGbkURIComponent('\u6212\u6307'), '%BD%E4%D6%B8');
  assert.strictEqual(encodeGbkURIComponent('\u9879\u94fe'), '%CF%EE%C1%B4');
});

test('buildSearchUrl uses GBK keyword encoding', () => {
  const url = buildSearchUrl('\u6212\u6307');
  assert.ok(url.startsWith('https://s.1688.com/selloffer/offer_search.htm?'));
  assert.ok(url.includes('keywords=%BD%E4%D6%B8'));
});

test('parse product card price, sales, and title', () => {
  const text = '\u91cd\u5de5\u9506\u77f3\u7231\u5fc3\u53cc\u5c42\u5f00\u53e3\u6212\u6307\u4e2a\u6027\u8f7b\u5962\u65f6\u5c1a\u98df\u6307\u6212 \u79cd\u7c7b:\u6d3b\u53e3 \uff5c \u5904\u7406\u5de5\u827a:\u9576\u9506\u77f3 \u00a5 14 .90 \u950010+\u4ef6 \u4e49\u4e4c\u5e02\u5b9d\u94b0\u7f51\u7edc\u79d1\u6280\u6709\u9650\u516c\u53f8';
  assert.strictEqual(parsePrice(text), 14.9);
  assert.strictEqual(parseSales(text), 10);
  assert.strictEqual(parseTitle(text), '\u91cd\u5de5\u9506\u77f3\u7231\u5fc3\u53cc\u5c42\u5f00\u53e3\u6212\u6307\u4e2a\u6027\u8f7b\u5962\u65f6\u5c1a\u98df\u6307\u6212');
});

test('parsePriceBand returns min, max, and observed price samples', () => {
  const single = parsePriceBand('\u6212\u6307 \u00a5 2 .80 \u5df2\u552e400+\u4ef6');
  assert.deepStrictEqual(single, {
    minPrice: 2.8,
    maxPrice: 2.8,
    prices: [2.8],
    display: '2.8'
  });

  const range = parsePriceBand('\u6212\u6307 \u00a5 2.80-6.50 \u6279\u53d1');
  assert.deepStrictEqual(range, {
    minPrice: 2.8,
    maxPrice: 6.5,
    prices: [2.8, 6.5],
    display: '2.8-6.5'
  });
});

test('parsePriceBand does not absorb sales text after spaced price', () => {
  const band = parsePriceBand('\u6212\u6307 \u00a5 2 .5 1500+\u4ef6 \u56de\u5934\u738765%');
  assert.deepStrictEqual(band, {
    minPrice: 2.5,
    maxPrice: 2.5,
    prices: [2.5],
    display: '2.5'
  });
});

test('parsePriceBand stops at the first integer when sales text follows without decimal point', () => {
  const band = parsePriceBand('\u6212\u6307 \u00a5 3 4100+\u4ef6');
  assert.deepStrictEqual(band, {
    minPrice: 3,
    maxPrice: 3,
    prices: [3],
    display: '3'
  });
});

test('parse sales with ten-thousand unit', () => {
  assert.strictEqual(parseSales('\u6210\u4ea41.4\u4e07+\u5143'), 14000);
  assert.strictEqual(parseSales('\u8fd130\u5929\u9500\u91cf 167'), 167);
});

test('normalizeCard extracts offer id from final detail URL', () => {
  const product = normalizeCard({
    finalUrl: 'https://detail.1688.com/offer/718298042743.html?abc=1',
    anchorText: '\u7eaf\u94f6s925\u62c9\u4e1d\u5de5\u827a\u7b80\u7ea6\u661f\u8292\u7d20\u5708\u767e\u642d\u53e0\u6234\u6212\u6307 \u00a5 79 .00 \u6210\u4ea41.4\u4e07+\u5143',
    cardText: '\u7eaf\u94f6s925\u62c9\u4e1d\u5de5\u827a\u7b80\u7ea6\u661f\u8292\u7d20\u5708\u767e\u642d\u53e0\u6234\u6212\u6307 \u00a5 79 .00 \u6210\u4ea41.4\u4e07+\u5143',
    shopName: '\u6df1\u5733\u5e02\u9f99\u5c97\u533a\u9648\u5bb6\u6cf0\u6cf0\u9996\u9970\u5382'
  });
  assert.strictEqual(product.offerId, '718298042743');
  assert.strictEqual(product.url, 'https://detail.1688.com/offer/718298042743.html');
  assert.strictEqual(product.price, 79);
  assert.deepStrictEqual(product.priceBand, {
    minPrice: 79,
    maxPrice: 79,
    prices: [79],
    display: '79'
  });
  assert.strictEqual(product.sales30days, 14000);
  assert.strictEqual(product.source, '1688-web');
});

test('normalizeCard canonicalizes mobile detail URL with offerId query', () => {
  const product = normalizeCard({
    finalUrl: 'http://detail.m.1688.com/page/index.html?offerId=1027613366552&trace_log=normal',
    anchorText: '\u6212\u6307 \u00a5 2 .11',
    cardText: '\u6212\u6307 \u00a5 2 .11'
  });
  assert.strictEqual(product.offerId, '1027613366552');
  assert.strictEqual(product.url, 'https://detail.1688.com/offer/1027613366552.html');
});

test('filterWebProducts applies price and sales filters', () => {
  const products = [
    { title: '\u6212\u6307A', price: 5, sales30days: 100 },
    { title: '\u6212\u6307B', price: 15, sales30days: 500 },
    { title: '\u6212\u6307C', price: 55, sales30days: 1000 }
  ];
  const filtered = filterWebProducts(products, {
    minPrice: 10,
    maxPrice: 30,
    minSales30d: 200
  });
  assert.deepStrictEqual(filtered.map(p => p.title), ['\u6212\u6307B']);
});

test('dedupeProducts prefers first stable key', () => {
  const products = [
    { offerId: '1', title: 'A' },
    { offerId: '1', title: 'A duplicate' },
    { url: 'https://detail.1688.com/offer/2.html', title: 'B' }
  ];
  const deduped = dedupeProducts(products);
  assert.strictEqual(deduped.length, 2);
  assert.strictEqual(deduped[0].title, 'A');
});

test('buildAggregatePriceBand summarizes returned products', () => {
  const band = buildAggregatePriceBand([
    { priceBand: { prices: [2.8, 6.5] } },
    { price: 10 },
    { priceBand: { prices: [2.8, 12] } }
  ]);
  assert.deepStrictEqual(band, {
    minPrice: 2.8,
    maxPrice: 12,
    prices: [2.8, 6.5, 10, 12],
    display: '2.8-12'
  });
});

test('buildPageFilterConfig enables page filters from top-level options', () => {
  const config = buildPageFilterConfig({
    minPrice: 2,
    maxPrice: 30,
    pageSort: 'sales',
    minOrderQuantity: 1,
    pageFeatureKeywords: ['48H delivery', 'dropship']
  });
  assert.strictEqual(config.hasFilters, true);
  assert.strictEqual(config.minPrice, 2);
  assert.strictEqual(config.maxPrice, 30);
  assert.strictEqual(config.sort, 'sales');
  assert.strictEqual(config.minOrderQuantity, 1);
  assert.deepStrictEqual(config.featureKeywords, ['48H delivery', 'dropship']);
});

test('pageFilterExpression contains stable selectors and unicode labels', () => {
  const script = pageFilterExpression(buildPageFilterConfig({
    minPrice: 2,
    maxPrice: 30,
    pageSort: 'sales',
    minOrderQuantity: 1,
    minShopProducts: 50,
    pageFeatureKeywords: ['48H delivery']
  }));
  assert.ok(script.includes('\\u6700\\u4f4e\\u4ef7'));
  assert.ok(script.includes('\\u6700\\u9ad8\\u4ef7'));
  assert.ok(script.includes('\\u9500\\u91cf'));
  assert.ok(script.includes('\\u6700\\u4f4e\\u6570\\u91cf'));
  assert.ok(script.includes('minShopProducts'));
});

test('productLinkCountExpression counts the same product link candidates used for extraction', () => {
  const script = productLinkCountExpression();
  assert.ok(script.includes('search-offer-wrapper'));
  assert.ok(script.includes('search-offer-item'));
  assert.ok(script.includes('ad-offer'));
});
