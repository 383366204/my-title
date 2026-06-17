'use strict';

const crypto = require('crypto');

function stableProductId(product) {
  const url = product.url || product.link || product.productUrl || product['产品链接'] || '';
  const urlMatch = String(url).match(/offer\/(\d+)\.html/);
  return product.id || product.offerId || product.productId || product.itemId || (urlMatch ? urlMatch[1] : '');
}

function stableTitleToken(title) {
  return String(title || '')
    .replace(/\s+/g, '')
    .slice(0, 40);
}

function hashProducts(products) {
  if (!Array.isArray(products) || products.length === 0) return '';
  const normalized = products.map(p => ({
    id: stableProductId(p),
    title: stableTitleToken(p.title || p.subject || p.name || '')
  }));
  return crypto.createHash('md5').update(JSON.stringify(normalized)).digest('hex').slice(0, 8);
}

module.exports = { hashProducts, stableProductId, stableTitleToken };
