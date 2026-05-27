'use strict';

const crypto = require('crypto');
const { run } = require('./index');
const { extractKeywords } = require('./extract-core');
const { recommendResearchKeywords } = require('./keyword-analyzer');

/**
 * Create a stable, privacy-light hash for product inputs.
 * @param {Array<object>} products - Product candidates.
 * @returns {string} Short md5 hash, or empty string when no products exist.
 */
function hashProducts(products) {
  if (!Array.isArray(products) || products.length === 0) return '';
  const normalized = products.map(p => ({
    id: p.id || p.offerId || p.productId || p.itemId || '',
    title: p.title || p.subject || p.name || '',
    price: p.price || p.priceInfo || ''
  }));
  return crypto.createHash('md5').update(JSON.stringify(normalized)).digest('hex').slice(0, 8);
}

function normalizeSycmData(data) {
  if (!data) return data;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  return data;
}

/**
 * End-to-end title generation pipeline with injectable search adapters.
 * @param {string} keyword - User keyword or blue-ocean word.
 * @param {object} [options] - Pipeline options.
 * @param {Function} [options.searchProducts] - Adapter returning product candidates.
 * @param {Function} [options.searchPeerTitles] - Adapter returning competitor titles.
 * @param {Function} [options.fetchKeywordData] - Adapter returning SYCM keyword data text.
 * @returns {Promise<object>} Generation result or research keywords.
 */
async function generateTitlePipeline(keyword, options = {}) {
  const {
    coreWord: providedCoreWord,
    modifiers: providedModifiers,
    semanticGroups: providedSemanticGroups,
    products: providedProducts,
    peerTitles: providedPeerTitles,
    searchProducts,
    searchPeerTitles,
    fetchKeywordData,
    research = false,
    ...runOptions
  } = options;

  const extracted = (providedCoreWord && Array.isArray(providedModifiers))
    ? {
      coreWord: providedCoreWord,
      modifiers: providedModifiers,
      semanticGroups: providedSemanticGroups || {}
    }
    : await extractKeywords('keyword', { data: keyword });

  let peerTitles = Array.isArray(providedPeerTitles) ? providedPeerTitles : [];
  if (peerTitles.length === 0 && typeof searchPeerTitles === 'function') {
    peerTitles = await searchPeerTitles({
      keyword,
      blueOceanWord: keyword,
      coreWord: extracted.coreWord,
      modifiers: extracted.modifiers,
      semanticGroups: extracted.semanticGroups || {},
      products: []
    });
    if (!Array.isArray(peerTitles)) peerTitles = [];
  }

  if (research) {
    const { keywords } = recommendResearchKeywords({
      coreWord: extracted.coreWord,
      blueOceanWord: keyword,
      modifiers: extracted.modifiers,
      peerTitles
    });
    return {
      ok: true,
      coreWord: extracted.coreWord,
      modifiers: extracted.modifiers,
      semanticGroups: extracted.semanticGroups || {},
      researchKeywords: keywords,
      _trace: { peerTitles: peerTitles.length }
    };
  }

  let products = Array.isArray(providedProducts) ? providedProducts : [];
  if (products.length === 0 && typeof searchProducts === 'function') {
    products = await searchProducts({
      keyword,
      blueOceanWord: keyword,
      coreWord: extracted.coreWord,
      modifiers: extracted.modifiers,
      semanticGroups: extracted.semanticGroups || {}
    });
    if (!Array.isArray(products)) products = [];
  }

  let sycmData = runOptions.sycmData;
  if (!sycmData && runOptions.sycmAuto && typeof fetchKeywordData === 'function') {
    try {
      sycmData = normalizeSycmData(await fetchKeywordData({
        keyword,
        blueOceanWord: keyword,
        coreWord: extracted.coreWord,
        modifiers: extracted.modifiers,
        semanticGroups: extracted.semanticGroups || {},
        products
      }));
    } catch (err) {
      sycmData = '';
      runOptions.sycmFetchError = err && err.message ? err.message : String(err);
    }
  }

  return run(keyword, {
    ...runOptions,
    sycmData,
    peerTitles,
    products,
    productsHash: hashProducts(products),
    coreWord: extracted.coreWord,
    modifiers: extracted.modifiers,
    semanticGroups: extracted.semanticGroups || {}
  });
}

module.exports = { generateTitlePipeline, hashProducts };
