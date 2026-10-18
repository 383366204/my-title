'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { parseCompetitorInputs } = require('../../competitor-analysis/src/input-parser');
const { parseShopKey, canonicalShopUrl } = require('../../competitor-analysis/src/page-parser');
const { CdpClient } = require('../../alibaba1688/src/search-web-1688');
const { runWithPlatformGuard } = require('../../../core/platform-access-guard');

const DOM_EXTRACT_EXPRESSION = `(() => {
  const img = document.querySelector('#J_UlThumb img, .PicGallery--mainPic img, .mainPic img, [class*="mainPic"] img, [class*="main-img"] img, [class*="mainImage"] img');
  const titleEl = document.querySelector('#J_Title h3, .ItemHeader--mainTitle, h1[data-title], [class*="mainTitle"], h1');
  const title = titleEl ? titleEl.textContent.trim() : document.title;
  const priceEl = document.querySelector('.tm-promo-price .tm-price, .Price--priceInt, [class*="priceInt"], [class*="priceText"], [class*="currentPrice"]');
  const price = priceEl ? parseFloat(priceEl.textContent.replace(/[^\\d.]/g, '')) : null;
  const shopLink = document.querySelector('a[href*="shop"], .ShopHeader--shopName a, [class*="shopName"] a');
  const shopNameEl = document.querySelector('.ShopHeader--shopName, [class*="shopName"], [class*="shop-name"]');
  const shopName = shopNameEl ? shopNameEl.textContent.trim() : '';
  const shopUrl = shopLink ? shopLink.href : '';
  return {
    mainImageUrl: img ? (img.src || img.dataset.src || '') : '',
    title,
    price: Number.isFinite(price) ? price : null,
    shopName,
    shopUrl
  };
})()`;

/**
 * Extract itemId from a Taobao or Tmall URL.
 * @param {string} urlString
 * @returns {string|null}
 */
function extractItemId(urlString) {
  try {
    const url = new URL(urlString);
    const id = url.searchParams.get('id');
    if (id && /^\d+$/.test(id)) return id;
    const match = url.pathname.match(/\/item\/(\d+)\.htm/i);
    return match ? match[1] : null;
  } catch (_) {
    return null;
  }
}

/**
 * Extract source products from user provided Taobao links.
 * @param {object} options
 * @param {string|string[]|object[]} options.inputs - Raw pasted text, links, or parsed objects
 * @param {string} [options.runDir] - Pipeline run directory
 * @param {string} [options.dataDir] - Data root directory
 * @param {string} [options.runId] - Run ID
 * @param {string} [options.channel='auto'] - Channel 'auto' | 'native' | 'web'
 * @param {number} [options.port=9222] - CDP port
 * @param {Function} [options.extractor] - Injectable custom extractor for testing
 * @param {Function} [options.onProgress] - Progress callback
 * @param {AbortSignal} [options.signal] - Cancellation signal
 * @returns {Promise<object>} Extraction results with products and errors
 */
async function extractSourceProducts(options = {}) {
  const { signal, onProgress } = options;
  signal?.throwIfAborted();

  const rawInputs = options.inputs || options.links || options.rawLinks || [];
  let parsed;
  if (Array.isArray(rawInputs) && rawInputs.length && typeof rawInputs[0] === 'object' && rawInputs[0].inputUrl) {
    parsed = {
      links: rawInputs,
      invalid: [],
      duplicateCount: 0,
      truncatedCount: 0
    };
  } else {
    parsed = parseCompetitorInputs(rawInputs, { limit: options.limit || 10 });
  }

  const runDir = options.runDir || (options.dataDir && options.runId ? path.join(options.dataDir, 'pipeline', 'runs', options.runId) : null);

  // 落盘 peer-input.json
  if (runDir) {
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(
      path.join(runDir, 'peer-input.json'),
      JSON.stringify({ ...parsed, savedAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
  }

  if (!parsed.links.length) {
    return {
      ok: false,
      status: 'manual_action_required',
      message: '没有有效的商品链接',
      products: [],
      errors: [{ code: 'NO_VALID_INPUTS', message: '没有有效的商品链接', invalid: parsed.invalid }],
      totalValid: 0
    };
  }

  const products = [];
  const errors = [];
  const port = options.port ?? 9222;

  for (const [index, link] of parsed.links.entries()) {
    signal?.throwIfAborted();
    onProgress?.({ current: index + 1, total: parsed.links.length, message: `正在提取商品信息: ${link.inputUrl}` });

    const itemId = extractItemId(link.inputUrl);
    if (!itemId) {
      errors.push({ inputUrl: link.inputUrl, code: 'INVALID_ITEM_ID', message: '无法从链接中识别商品ID' });
      continue;
    }

    try {
      let extracted;
      if (typeof options.extractor === 'function') {
        extracted = await options.extractor(link, { signal });
      } else {
        // 使用 Chrome CDP 网页抽取
        extracted = await runWithPlatformGuard('taobao', {
          ...options.guardOptions,
          cache: false,
          shouldStop: () => signal?.aborted,
          staleLockMs: 60000,
          lockTimeoutMs: 60000
        }, async () => {
          let client;
          let target;
          let success = false;
          const base = `http://127.0.0.1:${port}`;
          try {
            const response = await fetch(`${base}/json/new?${encodeURIComponent(link.inputUrl)}`, {
              method: 'PUT',
              signal: AbortSignal.timeout(10000)
            });
            if (!response.ok) throw new Error(`Chrome打开商品标签失败: ${response.status}`);
            target = await response.json();
            client = new CdpClient(target.webSocketDebuggerUrl);

            // 等待页面加载完成并执行提取
            const deadline = Date.now() + 20000;
            while (Date.now() < deadline) {
              signal?.throwIfAborted();
              const state = await client.evaluate(DOM_EXTRACT_EXPRESSION);
              if (state && (state.title || state.mainImageUrl)) {
                success = true;
                return state;
              }
              await delay(500);
            }
            throw new Error('商品页面提取超时');
          } finally {
            client?.close();
            if (success && target?.id) {
              await fetch(`${base}/json/close/${encodeURIComponent(target.id)}`, {
                signal: AbortSignal.timeout(5000)
              }).catch(() => {});
            }
          }
        });
      }

      if (!extracted || !extracted.mainImageUrl) {
        errors.push({ inputUrl: link.inputUrl, code: 'MISSING_MAIN_IMAGE', message: '未能提取到商品主图，无法参与图搜' });
        continue;
      }

      const shopUrl = extracted.shopUrl ? canonicalShopUrl(extracted.shopUrl) : null;
      const shopKey = extracted.shopKey || (shopUrl ? parseShopKey(shopUrl) : null);

      products.push({
        inputUrl: link.inputUrl,
        itemId,
        title: extracted.title || '',
        price: extracted.price !== undefined ? extracted.price : null,
        mainImageUrl: extracted.mainImageUrl,
        shopName: extracted.shopName || '',
        shopUrl,
        shopKey,
        extractedAt: new Date().toISOString()
      });
    } catch (err) {
      errors.push({ inputUrl: link.inputUrl, code: err.code || 'EXTRACTION_FAILED', message: err.message });
    }

    // 链接之间适当限流防封
    if (index < parsed.links.length - 1 && !options.extractor) {
      await delay(2000);
    }
  }

  // 持久化 source-products.jsonl
  if (runDir && products.length > 0) {
    const lines = products.map(p => JSON.stringify(p)).join('\n') + '\n';
    await fs.writeFile(path.join(runDir, 'source-products.jsonl'), lines, 'utf8');
  }

  const ok = products.length > 0;
  return {
    ok,
    status: ok ? 'completed' : 'manual_action_required',
    message: ok ? `成功提取 ${products.length} 个源商品` : '所有链接提取失败，请检查链接或浏览器状态',
    products,
    errors,
    totalValid: products.length
  };
}

module.exports = {
  extractSourceProducts,
  extractItemId,
  DOM_EXTRACT_EXPRESSION
};
