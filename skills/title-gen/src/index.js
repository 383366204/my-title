const path = require('path');
const { extractKeywords } = require('./extract-core');
const { searchTaobaoTitles } = require('./search-taobao');
const { createLLMClient, getLLMCacheVersion, PROMPT_VERSION } = require('../../../core/llm');
const { postProcessTitle, constructFallbackTitle, cleanTitle, completeTitle, scoreTitle, extractShoppingGuideTitle } = require('./title-utils');
const { removeBannedWords } = require('../../../core/banned-words');
const { ResultCache } = require('./cache');
const { analyzePeerTitles, recommendResearchKeywords } = require('./keyword-analyzer');
const { parseSycmData } = require('./sycm-parser');
const { selectSycmTitleKeywords } = require('./sycm-keyword-selector');

const SCHEMA_VERSION = 4; // bump when output structure changes
const RUN_TIMEOUT = parseInt(process.env.RUN_TIMEOUT) || 120000;
const MIN_TITLE_BYTES = parseInt(process.env.MIN_TITLE_BYTES, 10) || 60;

function fillFallbackAdvice(item) {
  if (!item['选品理由']) {
    const price = parseFloat(item['商品原价']) || 0;
    const sales = item['30天销量'] || 0;
    const rating = item['好评率'] || 0;
    const reasons = [];
    if (sales > 50) reasons.push('销量较高');
    else if (sales > 10) reasons.push('有一定销量');
    else reasons.push('新品需测试');
    if (rating >= 95) reasons.push('好评率优秀');
    if (price > 0 && price < 5) reasons.push('价格有优势');
    item['选品理由'] = reasons.join('，');
  }
  if (!item['定价建议']) {
    const price = parseFloat(item['商品原价']) || 0;
    if (price > 0) {
      const low = Math.ceil(price * 2.5);
      const high = Math.ceil(price * 4);
      item['定价建议'] = `1688价${price}元，建议零售${low}-${high}元`;
    } else {
      item['定价建议'] = '参考同类商品定价';
    }
  }
  if (!item['风险提示']) {
    const price = parseFloat(item['商品原价']) || 0;
    const sales = item['30天销量'] || 0;
    const risks = [];
    if (price > 0 && price < 2) risks.push('价格极低，注意材质质量');
    if (sales === 0) risks.push('无销量参考，需谨慎');
    item['风险提示'] = risks.length > 0 ? risks.join('；') : '常规商品，注意验货';
  }
}

/**
 * 统一构建输出结果（消除 3 处降级路径的重复代码）
 * @param {Object} params
 * @param {string} params.coreWord - 核心词
 * @param {string} params.blueOceanWord - 蓝海词
 * @param {Array} params.modifiers - 修饰词列表
 * @param {Array} params.products - 商品列表（原始 1688 数据）
 * @param {Array} [params.selectedProducts] - GLM 选品结果（可为空）
 * @param {Array} [params.titleObjs] - GLM 标题对象列表 [{productId, title}]
 * @param {Object} params.stats - 统计信息
 * @param {Array} [params.imageSearchResults] - 以图搜图结果
 * @param {Array} [params.taobaoTitles] - 淘宝同行标题
 * @param {number} params.maxLength - 最大标题长度
 * @param {string} [params.overallAdvice] - 整体建议（来自 GLM）
 * @returns {{ coreWord, blueOceanWord, modifiers, products, filteredCount, titles, stats, overallAdvice }}
 */
function buildOutput({ coreWord, blueOceanWord, modifiers, products, selectedProducts = [], titleObjs = [], stats, imageSearchResults = [], taobaoTitles = [], maxLength = 60, overallAdvice = '' }) {
  // 构建标题映射（归一化 productId）
  const titleMap = {};
  if (Array.isArray(titleObjs)) {
    titleObjs.forEach(t => {
      if (t && t.productId) {
        titleMap[String(t.productId).trim()] = t.title;
      }
    });
  }

  const mappedTitles = titleObjs
    .map(t => t && t.title)
    .filter(Boolean)
    .map(t => completeTitle(t, blueOceanWord, taobaoTitles || [], MIN_TITLE_BYTES, maxLength) || t);

  // Build a Map for ID-based lookup of selected products
  const selectedMap = new Map();
  if (Array.isArray(selectedProducts)) {
    for (const s of selectedProducts) {
      if (s && (s.productId || s.product_id || s.id)) {
        const key = String(s.productId || s.product_id || s.id || '').trim();
        selectedMap.set(key, s);
      }
    }
  }

  const enriched = products.map((p, idx) => {
    // Use ID-based lookup for selected products
    const productId = p.id;
    const selected = selectedMap.get(String(productId || '').trim()) || {};
    // 构建1688产品详情页链接
    const detailUrl = productId ? `https://detail.1688.com/offer/${productId}.html` : `https://s.1688.com/searchoffer/searchOffer.htm?keywords=${encodeURIComponent(p.title || coreWord || '')}`;
    // 归一化用于 titleMap 的键
    const normalizedId = String(productId || '').trim();
    let shopTitle = titleMap[normalizedId];
    if (!shopTitle) {
      // 选用来自图片搜索的同行标题（如存在），否则回落到 taobaoTitles
      const imageResult = (imageSearchResults || []).find(r => {
        if (!r) return false;
        const rId = String(r.productId || '').trim();
        const pId = String(productId || '').trim();
        return rId === pId;
      });
      const fallbackPeerTitles = (imageResult && imageResult.hasMatch && imageResult.peerTitles)
        ? imageResult.peerTitles
        : (taobaoTitles || []);
      shopTitle = constructFallbackTitle(blueOceanWord, p.title || '', fallbackPeerTitles, maxLength, MIN_TITLE_BYTES);
    }
    const imageResult = (imageSearchResults || []).find(r => {
      if (!r) return false;
      const rId = String(r.productId || '').trim();
      const pId = String(productId || '').trim();
      return rId === pId;
    });
    const titlePeerTitles = (imageResult && imageResult.hasMatch && imageResult.peerTitles)
      ? imageResult.peerTitles
      : (taobaoTitles || []);
    const titleBeforeCompletion = shopTitle;
    shopTitle = completeTitle(shopTitle, blueOceanWord, [p.title || '', ...titlePeerTitles], MIN_TITLE_BYTES, maxLength)
      || constructFallbackTitle(blueOceanWord, p.title || '', titlePeerTitles, maxLength, MIN_TITLE_BYTES);

    const usedSycmWords = (stats && Array.isArray(stats.sycmKeywordsUsed) ? stats.sycmKeywordsUsed : [])
      .filter(k => k && k.keyword && shopTitle && shopTitle.includes(k.keyword))
      .slice(0, 4);
    const titleKeywordBasis = usedSycmWords.length > 0
      ? usedSycmWords.map(k => `${k.keyword}(${k.score})`).join('，')
      : '';
    const titleQuality = scoreTitle({
      title: shopTitle,
      blueOceanWord,
      coreWord,
      modifiers,
      sycmKeywords: stats && Array.isArray(stats.sycmKeywordsUsed) ? stats.sycmKeywordsUsed : [],
      minLength: MIN_TITLE_BYTES,
      maxLength
    });
    const completionChanged = titleBeforeCompletion !== shopTitle;

    return {
        // 原输出字段
        '链接原标题': p.title,
        '产品链接': detailUrl,
        '主图链接': p.url,
        '铺货标题': shopTitle,
        '商品原价': p.price,
        '30天销量': p.stats && typeof p.stats.last30DaysSales === 'number' ? p.stats.last30DaysSales : 0,
        '好评率': p.stats && typeof p.stats.goodRates === 'number' ? p.stats.goodRates : 0,
        '复购率': p.stats && typeof p.stats.repurchaseRate === 'number' ? p.stats.repurchaseRate : 0,
        '蓝海词': blueOceanWord,
        // 新增字段
        '选品理由': selected.reason || '',
        '定价建议': selected.priceAdvice || '',
        '风险提示': selected.risk || '',
        '标题用词依据': titleKeywordBasis,
        '标题字节数': titleQuality.byteLength,
        '标题质量分': titleQuality.score,
        '标题诊断': titleQuality.issues.length > 0 ? titleQuality.issues.join('；') : 'OK',
        '标题补全': completionChanged ? '已补全' : '原始合格',
        '导购标题': extractShoppingGuideTitle(shopTitle, blueOceanWord)
      };
  });

  enriched.forEach(fillFallbackAdvice);

  return {
    coreWord,
    blueOceanWord,
    modifiers,
    products: enriched,
    filteredCount: products.length,
    titles: mappedTitles,
    stats,
    peerTitles: taobaoTitles || [],
    overallAdvice
  };
}

/**
 * 主入口：重构后的流程编排
 * 单一任务：将用户输入重构为核心词/修饰词后，完成双重搜索、同行标题并产出标题
 *
 * 新签名：run(blueOceanWord, options)
 * - blueOceanWord: 用户原始输入，称为蓝海词
 * - options.maxLength: 生成标题的最大长度
 * - options.peerTitles: 可选的同行标题，若提供将跳过淘宝搜索
 * - options.useImageSearch: 是否启用以图搜图功能（默认 false）
 * - options.signal: AbortSignal 用于取消操作（默认 null）
 *
 * 返回对象结构：
 * {
 *   coreWord, blueOceanWord, modifiers,
 *   products: [ { 原字段按选品表 8 字段 }, ... ],
 *   filteredCount,
 *   titles,
 *   stats: { coreWord, modifiers, alibaba1688Total, taobaoTitlesTotal, matchedProducts, batchesProcessed, totalProductsEnriched, totalTitlesGenerated, degraded? }
 * }
 */
/**
 * 提取核心词与修饰词（对外不可见实现）
 * @param {string} blueOceanWord
 * @param {Function} log
 * @returns {Promise<{coreWord: string, modifiers: Array, semanticGroups: Object}>}
 */
async function _extractCore(blueOceanWord, log) {
  const { coreWord, modifiers, semanticGroups } = await extractKeywords('keyword', { data: blueOceanWord });
  return { coreWord, modifiers, semanticGroups };
}



/**
 * 根据条件进行同行标题检索（图搜/文字搜索）
 * @param {Object} params
 * @param {Array} params.products
 * @param {string} params.blueOceanWord
 * @param {Array} params.peerTitles
 * @param {Object} params glmClient
 * @param {Function} params.log
 * @param {Function} params.warn
 * @param {boolean} [params.useImageSearch=false] - 是否启用以图搜图
 * @param {number} [params.maxImageSearch=0] - 图搜最大商品数（0=不限制）
 * @param {AbortSignal|null} [params.signal=null] - 取消信号
 * @param {Object} [params.trace=null] - 追踪信息对象
 * @returns {Promise<{taobaoTitles: Array, imageSearchResults: Array}>}
 */
async function _searchPeerTitles({ products, blueOceanWord, peerTitles, glmClient, log, warn, useImageSearch = false, maxImageSearch = 0, signal = null, trace = null, skipFlag = null, onProgress = null }) {
  let taobaoTitles = [];
  let imageSearchResults = [];
  let peerSource = 'none';
  if (peerTitles && peerTitles.length > 0) {
    taobaoTitles = peerTitles;
    peerSource = 'manual_input';
   } else {
      if (Array.isArray(products) && products.length > 0) {
        const isImageSearchAvailable = () => {
          try {
            const m = require('./search-taobao-image');
            return typeof m.isImageSearchAvailable === 'function' ? m.isImageSearchAvailable() : false;
          } catch (e) {
            console.error('[peerTitles] search-taobao-image 模块加载失败:', e.message);
            return false;
          }
        };
         if (useImageSearch && isImageSearchAvailable()) {
           const { searchPeerTitlesByImage } = require('./search-taobao-image');
            try {
              console.error('[peerTitles] 开始以图搜图, 商品数:', products.length);
               // 每个商品都需要自己的同行标题来生成专属标题，全部搜图
               // 串行 + 40秒基础间隔 + 随机0-20秒抖动，避免触发淘宝限流
                  const imageSearchResponse = await searchPeerTitlesByImage(products, { coreWord: blueOceanWord, glmClient, concurrency: 1, intervalMs: 15000, jitterMs: 20000, timeout: 60000, maxImageSearch, signal, skipFlag, onProgress: (progress) => {
                   if (onProgress) onProgress(progress);
                 }});
                imageSearchResults = imageSearchResponse.results;
                // 检查是否检测到验证码
                if (imageSearchResponse.captchaDetected) {
                  if (trace) {
                    trace.captchaDetected = true;
                  }
                  console.error('[peerTitles] 检测到验证码，使用部分搜图结果继续生成');
                }
              taobaoTitles = imageSearchResults
               .filter(r => r.hasMatch && Array.isArray(r.peerTitles))
               .flatMap(r => r.peerTitles);
            log('🔎 以图搜图完成，提取同行标题数量: ' + taobaoTitles.length);
            if ((taobaoTitles || []).length === 0) {
              log('🔎 以图搜图无结果，尝试文字搜索...');
              taobaoTitles = await require('./search-taobao').searchTaobaoTitles(blueOceanWord).catch((e) => { console.error('[peerTitles] 以图搜图无结果后文字搜索失败:', e.message); return []; });
              peerSource = taobaoTitles.length > 0 ? 'taobao_text' : 'none';
            } else {
              peerSource = 'image_search';
            }
            console.error('[peerTitles] 以图搜图结果: peerTitles=' + taobaoTitles.length + ', source=' + peerSource);
           } catch (err) {
              console.error('[peerTitles] 以图搜图失败:', err && err.message ? err.message : err);
              taobaoTitles = await require('./search-taobao').searchTaobaoTitles(blueOceanWord).catch((e2) => { console.error('[peerTitles] 以图搜图失败后文字搜索也失败:', e2.message); return []; });
              peerSource = taobaoTitles.length > 0 ? 'taobao_text' : 'none';
           }
         } else if (useImageSearch && !isImageSearchAvailable()) {
           console.error('[peerTitles] 用户要求图搜但不可用，降级到文字搜索');
            taobaoTitles = await require('./search-taobao').searchTaobaoTitles(blueOceanWord).catch((e) => { console.error('[peerTitles] 文字搜索失败:', e.message); return []; });
            peerSource = taobaoTitles.length > 0 ? 'taobao_text' : 'none';
          } else {
            console.error('[peerTitles] 以图搜图不可用，尝试文字搜索');
           try {
            taobaoTitles = await require('./search-taobao').searchTaobaoTitles(blueOceanWord);
           peerSource = taobaoTitles.length > 0 ? 'taobao_text' : 'none';
          } catch (err) {
            console.error('[peerTitles] 淘宝文字搜索失败:', err && err.message ? err.message : err);
            taobaoTitles = [];
            peerSource = 'none';
          }
        }
      } else if (!useImageSearch) {
        try {
          taobaoTitles = await require('./search-taobao').searchTaobaoTitles(blueOceanWord);
          peerSource = taobaoTitles.length > 0 ? 'taobao_text' : 'none';
        } catch (err) {
          console.error('[peerTitles] 淘宝文字搜索失败:', err && err.message ? err.message : err);
          taobaoTitles = [];
          peerSource = 'none';
        }
      } else {
        console.error('[peerTitles] 无商品数据，跳过以图搜图 (products=' + (products ? products.length : 'null') + ')');
      }
    }
    return { taobaoTitles, imageSearchResults, peerSource };
}

/**
 * GLM 标题生成主逻辑（包含降级策略）
 * @param {Object} params
 * @param {string} params.blueOceanWord
 * @param {string} params.coreWord
 * @param {Array} params.modifiers
 * @param {Array} params.peerTitles
 * @param {Array} params.products
 * @param {Array} params.taobaoTitles
 * @param {number} params.maxLength
 * @param {Array} params.imageSearchResults
 * @param {Object} params.stats
 * @param {Object} params.cache
 * @param {string} params._peerTitlesHash
 * @param {Object} params glmClient
 * @param {Function} params.log
 * @param {Function} params.warn
 * @param {AbortSignal|null} [params.signal=null] - 取消信号
 * @returns {Promise<any>}
 */
async function _generateTitles({ blueOceanWord, coreWord, modifiers, peerTitles, products, taobaoTitles, maxLength, imageSearchResults, stats, cache, _peerTitlesHash, glmClient, log, warn, limit, sycmKeywords = [], sycmDataHash = '', signal = null, useImageSearch = false, maxImageSearch = 0, minPrice = 0, maxPrice = 0, bannedWordVersion = 0, semanticGroups = {}, productsHash = '', llmCacheVersion = PROMPT_VERSION }) {
  // Step 4: 尝试 GLM selectAndGenerate 以输出更多字段...
  // 使用与原实现相同的流程与降级策略
  let effectiveSemanticGroups = semanticGroups;
  const glmInvoke = async () => {
    // 检查信号是否已取消
    if (signal?.aborted) {
      const err = new Error('标题生成已取消');
      err.name = 'AbortError';
      throw err;
    }
    // 拟定 peer titles 的来源
    const titlesToUse = (peerTitles && peerTitles.length > 0) ? peerTitles : taobaoTitles;
    const cleanedPeerTitles = (titlesToUse || []).map(t => cleanTitle(removeBannedWords(t || ''))).filter(Boolean);
    // 关键词分析
    let keywordAnalysis = null;
    if (cleanedPeerTitles.length > 0) {
      keywordAnalysis = analyzePeerTitles(cleanedPeerTitles, products.map(p => p.title || ''));
      log('  📊 关键词分析: 高频词 Top5: ' + (keywordAnalysis.topKeywords.slice(0, 5).map(k => k.word + '(' + k.count + ')').join(', ')));
      if (keywordAnalysis.gapKeywords.length > 0) {
        log('  📊 竞品缺口词: ' + keywordAnalysis.gapKeywords.slice(0, 10).map(k => k.word).join(', '));
      }
    }
    effectiveSemanticGroups = Object.keys(semanticGroups).length > 0 ? semanticGroups : (keywordAnalysis?.semanticGroups || {});

    const BATCH_SIZE = products.length <= 20 ? products.length : 20;
    const batches = [];
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      batches.push({
        index: Math.floor(i / BATCH_SIZE),
        products: products.slice(i, i + BATCH_SIZE).map(p => ({
          ...p,
          title: cleanTitle(removeBannedWords(p.title || ''))
        }))
      });
    }
    log(`  并行处理 ${batches.length} 批产品...`);
    // 在开始并行处理前再次检查信号
    if (signal?.aborted) {
      const err = new Error('标题生成已取消');
      err.name = 'AbortError';
      throw err;
    }
    const batchResults = await Promise.all(batches.map(({ index, products: batch }) =>
      glmClient.selectAndGenerate({
        blueOceanWord, coreWord, modifiers,
        peerTitles: cleanedPeerTitles,
        sycmKeywords: sycmKeywords,
        keywordAnalysis,
        products: batch, maxLength,
        semanticGroups: effectiveSemanticGroups
      }).then(result => {
        log(`  第 ${index + 1}/${batches.length} 批完成`);
        return result;
      }).catch(err => {
        warn(`  ⚠️ 第 ${index + 1}/${batches.length} 批(${batch.length}个产品)处理失败:`, err.message);
        return { selectedProducts: [], titles: [] };
      })
    ));

    const allSelectedProducts = batchResults.flatMap(r => Array.isArray(r.selectedProducts) ? r.selectedProducts : []);
    const allTitleObjs = batchResults.flatMap(r => Array.isArray(r.titles) ? r.titles : []);

    // 空 result 检测：selectAndGenerate 可能返回 {selectedProducts:[], titles:[]} 而不抛异常
    if (allSelectedProducts.length === 0 && allTitleObjs.length === 0) {
      throw new Error('selectAndGenerate returned empty results (0 products, 0 titles)');
    }

    stats.batchesProcessed = batches.length;
    stats.totalProductsEnriched = allSelectedProducts.length;
    stats.totalTitlesGenerated = allTitleObjs.length;
    log(`  ✓ 共处理 ${allSelectedProducts.length} 个产品的选品分析, 生成 ${allTitleObjs.length} 个标题`);
    
    // 提取 overallAdvice 从 batchResults
    const allOverallAdvice = batchResults.map(r => r.overallAdvice).filter(Boolean);
    const overallAdvice = allOverallAdvice.length > 0 ? allOverallAdvice.join('；') : '';
    allTitleObjs.forEach(t => {
      if (t && t.title) {
        const product = products.find(p => String(p.id || '').trim() === String(t.productId || t.product_id || '').trim());
        const processed = postProcessTitle(t.title, blueOceanWord, MIN_TITLE_BYTES, maxLength);
        t.title = processed || constructFallbackTitle(blueOceanWord, product?.title || t.title, cleanedPeerTitles, maxLength, MIN_TITLE_BYTES);
      }
    });

    const result = buildOutput({
      coreWord, blueOceanWord, modifiers, products,
      selectedProducts: allSelectedProducts,
      titleObjs: allTitleObjs,
      stats,
      imageSearchResults,
      taobaoTitles,
      maxLength,
      overallAdvice
     });
     if (!signal?.aborted) cache.set(blueOceanWord, maxLength, limit, result, _peerTitlesHash, sycmDataHash, useImageSearch, maxImageSearch, minPrice, maxPrice, bannedWordVersion, SCHEMA_VERSION, llmCacheVersion, productsHash);
     return result;
   };
  // 调用 GLM 与降级逻辑
  try {
    return await glmInvoke();
  } catch (e) {
    // 检查信号是否已取消
    if (signal?.aborted) {
      const err = new Error('标题生成已取消');
      err.name = 'AbortError';
      throw err;
    }
    // 降级：简化 GLM 调用
    warn('⚠️ GLM selectAndGenerate 失败，降级到简化 GLM 调用... ', e && e.message ? e.message : e);
    try {
      const fallbackPeerTitles = (peerTitles || []).map(t => cleanTitle(removeBannedWords(t || ''))).filter(Boolean);
      const titles = await glmClient.generateTitles({ blueOceanWord, coreWord, modifiers, peerTitles: fallbackPeerTitles, products, maxLength, semanticGroups: effectiveSemanticGroups });
      const mappedTitles = titles.map((t, idx) => postProcessTitle(t, blueOceanWord, MIN_TITLE_BYTES, maxLength) || constructFallbackTitle(blueOceanWord, products[idx]?.title || t, fallbackPeerTitles, maxLength, MIN_TITLE_BYTES));
      const fallbackTitleObjs = products.map((p, idx) => ({
        productId: p.id,
        title: mappedTitles[idx] || (mappedTitles.length > 0 ? mappedTitles[idx % mappedTitles.length] : p.title)
      }));
      if (stats.trace) stats.trace.titleGeneration = 'local_generation';
      const result = buildOutput({
        coreWord, blueOceanWord, modifiers, products,
        titleObjs: fallbackTitleObjs,
        stats: { ...stats, degraded: 'local_generation' },
        imageSearchResults,
        taobaoTitles,
        maxLength,
        overallAdvice: '' // 降级路径无 overallAdvice
      });
       if (!signal?.aborted) cache.set(blueOceanWord, maxLength, limit, result, _peerTitlesHash, sycmDataHash, useImageSearch, maxImageSearch, minPrice, maxPrice, bannedWordVersion, SCHEMA_VERSION, llmCacheVersion, productsHash);
       return result;
    } catch (e2) {
      // 最后降级：直接返回简单结构，避免中断流程
      warn('降级失败，返回简化结构：', e2 && e2.message ? e2.message : e2);
      if (stats.trace) stats.trace.titleGeneration = 'simple_fallback';
      const simpleTitles = products.map(p =>
        postProcessTitle(p.title, blueOceanWord, MIN_TITLE_BYTES, maxLength) || constructFallbackTitle(blueOceanWord, p.title || '', taobaoTitles || [], maxLength, MIN_TITLE_BYTES)
      );
      const simpleTitleObjs = products.map((p, idx) => ({ productId: p.id, title: simpleTitles[idx] || p.title }));
      const result = buildOutput({
        coreWord, blueOceanWord, modifiers, products,
        titleObjs: simpleTitleObjs,
        stats: { ...stats, degraded: 'simple_fallback' },
        imageSearchResults,
        taobaoTitles,
        maxLength
      });
       if (!signal?.aborted) cache.set(blueOceanWord, maxLength, limit, result, _peerTitlesHash, sycmDataHash, useImageSearch, maxImageSearch, minPrice, maxPrice, bannedWordVersion, SCHEMA_VERSION, llmCacheVersion, productsHash);
       return result;
    }
  }
}

async function run(blueOceanWord, options = {}) {
  const { maxLength = 60, peerTitles = [], silent = false, limit = 0, onBatch = null, research = false, sycmData, sycmAuto = false, sycmFetchError = '', useImageSearch = false, maxImageSearch = 0, minPrice = 0, maxPrice = 0, signal = null, onProductsFound = null, onProgress = null, skipFlag = null, products: externalProducts = [], coreWord: providedCoreWord = '', modifiers: providedModifiers = null, semanticGroups: providedSemanticGroups = null, productsHash: providedProductsHash = '' } = options;
  
  const log = silent ? () => {} : console.log.bind(console);
  const warn = silent ? () => {} : console.warn.bind(console);

  const cache = new ResultCache({ cacheDir: path.join(__dirname, '..', '.cache') });
  const glmClient = createLLMClient();
  const _llmCacheVersion = getLLMCacheVersion(glmClient);
  // 计算 peerTitles hash 用于缓存键区分
  let _peerTitlesHash = (peerTitles && peerTitles.length > 0)
    ? require('crypto').createHash('md5').update(peerTitles.join('|')).digest('hex').slice(0, 8)
    : '';
  // 计算 SYCM 数据哈希，用于缓存键区分（如果存在）
  const _sycmDataHash = sycmData ? require('crypto').createHash('md5').update(typeof sycmData === 'string' ? sycmData : JSON.stringify(sycmData)).digest('hex').slice(0, 8) : '';
  const _bannedWordVersion = require('../../../core/banned-words').getBannedWordVersion();
  const _productsHash = providedProductsHash || ((Array.isArray(externalProducts) && externalProducts.length > 0)
    ? require('crypto').createHash('md5').update(JSON.stringify(externalProducts.map(p => ({
      id: p.id || p.offerId || p.productId || p.itemId || '',
      title: p.title || p.subject || p.name || '',
      price: p.price || p.priceInfo || ''
    })))).digest('hex').slice(0, 8)
    : '');

  // 追踪信息：记录各决策点的执行路径
  const trace = {
    search1688: 'ok',
    peerTitlesSource: 'none',
    sycmEnhanced: false,
    titleGeneration: 'selectAndGenerate',
    taobaoInstalled: false
  };
  if (sycmFetchError) {
    trace.sycm = {
      enabled: !!sycmAuto,
      source: 'auto',
      status: 'failed',
      reason: sycmFetchError
    };
  }

  const cached = cache.get(blueOceanWord, maxLength, limit, _peerTitlesHash, _sycmDataHash, useImageSearch, maxImageSearch, minPrice, maxPrice, _bannedWordVersion, SCHEMA_VERSION, _llmCacheVersion, _productsHash);
  if (cached) {
    log('📦 命中缓存，直接返回');
    if (cached.stats && cached.stats.trace) {
      // 浅拷贝返回，避免内存变异
      return {
        ...cached,
        stats: {
          ...cached.stats,
          trace: {
            ...cached.stats.trace,
            titleGeneration: 'cached'
          }
        }
      };
    }
    // 没有 stats.trace 时直接浅拷贝返回
    return { ...cached };
  }

  // 输入校验
  if (!blueOceanWord || typeof blueOceanWord !== 'string') {
    throw new Error('蓝海词不能为空，请提供有效的搜索关键词');
  }
  const trimmed = blueOceanWord.trim();
  if (trimmed.length === 0) {
    throw new Error('蓝海词不能为纯空格，请提供有效的搜索关键词');
  }
  if (trimmed.length > 100) {
    warn(`⚠️ 关键词过长(${trimmed.length}字符)，截断至100字符`);
    blueOceanWord = trimmed.slice(0, 100);
  } else {
    blueOceanWord = trimmed;
  }
  // 特殊字符预清洗
  if (!cleanTitle(blueOceanWord).trim()) {
    throw new Error('输入仅包含特殊字符，请提供有效的搜索关键词');
  }

  log(`🔍 正在处理: ${blueOceanWord}`);

// 步骤 1: 提取核心词和修饰词
log('📝 提取核心词和修饰词...');
let coreWord = providedCoreWord;
let modifiers = Array.isArray(providedModifiers) ? providedModifiers : null;
let semanticGroups = providedSemanticGroups || {};
if (!coreWord || !Array.isArray(modifiers)) {
  const extracted = await _extractCore(blueOceanWord, log);
  coreWord = extracted.coreWord;
  modifiers = extracted.modifiers;
  semanticGroups = extracted.semanticGroups || {};
}
log(`  核心词: ${coreWord}`);
log(`  修饰词: ${modifiers.map(m => `${m.word}(${m.rigidity})`).join(', ')}`);
  if (Object.keys(semanticGroups).length > 0) {
  log('  📊 语义族: ' + Object.entries(semanticGroups).map(([k,v]) => `${k}(${v.length}词)`).join(', '));
}

if (research) {
  const { keywords } = recommendResearchKeywords({
    coreWord,
    blueOceanWord,
    modifiers,
    peerTitles
  });
  return {
    ok: true,
    coreWord,
    blueOceanWord,
    modifiers,
    semanticGroups,
    researchKeywords: keywords,
    _trace: { peerTitles: Array.isArray(peerTitles) ? peerTitles.length : 0 }
  };
}

// SYCM 数据（仅支持手动传入）
let finalSycmData = sycmData;



  // 使用外部提供的商品数据（如果未提供则返回空）
  let rawProducts = externalProducts;
  let searchOk = externalProducts.length > 0 ? 'external' : 'none';
  // 淘宝文字搜索（如果需要）
  let initialTaobaoTitles = [];
  let textPeerSource = 'none';
  // 如果有用户提供的 peerTitles，则不需要文字搜索
  if (peerTitles && peerTitles.length > 0) {
    initialTaobaoTitles = [];
    textPeerSource = 'manual_input';
  } else {
    // 执行文字搜索（不做图像搜索）
    const result = await _searchPeerTitles({
      products: [], // 空数组，避免图像搜索
      blueOceanWord,
      peerTitles: [],
      glmClient,
      log,
      warn,
      useImageSearch: false, // 先只做文字搜索
      maxImageSearch: 0,
      signal,
      trace: {},
      skipFlag,
      onProgress
    });
    initialTaobaoTitles = result.taobaoTitles;
    textPeerSource = result.peerSource;
  }

  trace.search1688 = searchOk ? 'ok' : 'failed';
  let products = rawProducts;
  
  // 1688 搜索完成后触发回调
  if (onProductsFound) onProductsFound(products.length);

  // 价格过滤
  if (minPrice > 0 || maxPrice > 0) {
    const beforeCount = products.length;
    products = (products || []).filter(p => {
        const rawPrice = String(p.price || '0');
      const price = parseFloat(rawPrice.replace(/[^\d.\-]/g, '')) || 0;
      if (minPrice > 0 && price < minPrice) return false;
      if (maxPrice > 0 && price > maxPrice) return false;
      return true;
    });
    warn(`[价格过滤] ${beforeCount} → ${products.length} 个商品 (min=${minPrice}, max=${maxPrice})`);
    if (onProductsFound) onProductsFound(products.length); // 更新预估
  }

  let finalTaobaoTitles = initialTaobaoTitles;
  let imageSearchResults = [];
  let finalPeerSource = textPeerSource;
  // 如果启用了图像搜索，在获取到 products 后执行图像搜索
  if (useImageSearch && products.length > 0) {
    log('🔎 执行以图搜图...');
    const imageResult = await _searchPeerTitles({
      products,
      blueOceanWord,
      peerTitles: finalTaobaoTitles,
      glmClient,
      log,
      warn,
      useImageSearch: true,
      maxImageSearch,
      signal,
      trace,
      skipFlag,
      onProgress
    });
    finalTaobaoTitles = imageResult.taobaoTitles;
    imageSearchResults = imageResult.imageSearchResults;
    finalPeerSource = imageResult.peerSource;
  }
  trace.peerTitlesSource = finalPeerSource;

  // 更新 peerTitlesHash 包含动态获取的 taobao 标题
  if (finalTaobaoTitles && finalTaobaoTitles.length > 0) {
    _peerTitlesHash = require('crypto').createHash('md5').update((peerTitles || []).concat(finalTaobaoTitles).join('|')).digest('hex').slice(0, 8);
  }

  // 若提供了 SYCM 数据，解析并增强关键词，随后在 _generateTitles 调用中注入 sycmKeywords
  let sycmKeywords = [];
  let sycmKeywordSelection = { accepted: [], rejected: [], stats: { total: 0, accepted: 0, rejected: 0 } };
  let sycmParsedData = [];
  if (finalSycmData) {
    try {
      const titlesForAnalysis = (finalTaobaoTitles && finalTaobaoTitles.length > 0) ? finalTaobaoTitles : peerTitles;
      sycmParsedData = Array.isArray(finalSycmData) ? finalSycmData : parseSycmData(finalSycmData);
      sycmKeywordSelection = selectSycmTitleKeywords({
        sycmRows: sycmParsedData,
        coreWord,
        blueOceanWord,
        modifiers,
        semanticGroups,
        products,
        peerTitles: titlesForAnalysis,
        maxKeywords: 8
      });
      sycmKeywords = sycmKeywordSelection.accepted || [];
      trace.sycmEnhanced = sycmKeywords.length > 0;
      trace.sycm = {
        enabled: true,
        source: 'manual',
        status: 'ok',
        parsedCount: sycmParsedData.length,
        acceptedCount: sycmKeywordSelection.accepted.length,
        rejectedCount: sycmKeywordSelection.rejected.length
      };
    } catch (e) {
      warn('⚠️ SYCM 数据解析失败:', e.message);
      sycmKeywords = [];
      sycmKeywordSelection = { accepted: [], rejected: [], stats: { total: 0, accepted: 0, rejected: 0 } };
      trace.sycm = {
        enabled: true,
        source: 'manual',
        status: 'failed',
        reason: e.message
      };
    }
  } else if (!trace.sycm) {
    trace.sycm = {
      enabled: false,
      status: 'skipped'
    };
  }

  // 空结果早期返回
  if (!Array.isArray(products) || products.length === 0) {
    log('  ⚠️  没有找到匹配的商品');
    return {
      coreWord,
      blueOceanWord,
      modifiers,
      products: [],
      filteredCount: 0,
      titles: [],
      stats: { coreWord, modifiers: modifiers.map(m => m.word), trace, blueOceanIndex: null }
    };
  }

  log(`  过滤后剩余 ${products.length} 个商品`);

  // 步骤 4: GLM 标题生成（含降级路径 + 超时保护）
  log('✍️  尝试 GLM selectAndGenerate 以输出更多字段...');
    // 计算蓝海指数：从 SYCM 数据中取最高的 demandSupplyRatio
    let blueOceanIndex = null;
    if (sycmParsedData && sycmParsedData.length > 0) {
      // 找到最高的 demandSupplyRatio
      const maxRatio = Math.max(...sycmParsedData.map(item => item.demandSupplyRatio || 0));
      if (maxRatio > 0) {
        blueOceanIndex = maxRatio;
      }
    }
    
    const stats = {
      coreWord,
      modifiers: modifiers.map(m => m.word),
      matchedProducts: products.length,
      trace,
      semanticGroupsUsed: Object.keys(semanticGroups).length > 0,
      blueOceanIndex,
      sycmKeywordsUsed: sycmKeywordSelection.accepted || [],
      sycmKeywordsRejected: sycmKeywordSelection.rejected || [],
      sycmKeywordStats: sycmKeywordSelection.stats || {}
    };

  let _raceTimeoutId = null;
  const timeoutPromise = new Promise((resolve, reject) => {
    _raceTimeoutId = setTimeout(() => 
      reject(new Error(`标题生成超时(${RUN_TIMEOUT/1000}s)，请简化关键词或减少数量`)), RUN_TIMEOUT
    );
    
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(_raceTimeoutId);
        const err = new Error('标题生成已取消');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
    }
  });

    return Promise.race([
        _generateTitles({ blueOceanWord, coreWord, modifiers, peerTitles, products, taobaoTitles: finalTaobaoTitles, maxLength, imageSearchResults, stats, cache, _peerTitlesHash, glmClient, log, warn, limit, sycmKeywords, sycmDataHash: _sycmDataHash, signal, useImageSearch, maxImageSearch, minPrice, maxPrice, bannedWordVersion: _bannedWordVersion, semanticGroups, productsHash: _productsHash, llmCacheVersion: _llmCacheVersion }),
       timeoutPromise
     ]).finally(() => { if (_raceTimeoutId) clearTimeout(_raceTimeoutId); });
}

module.exports = { run };
