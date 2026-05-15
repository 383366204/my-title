const path = require('path');
const { extractKeywords } = require('./extract-core');
const { searchTaobaoTitles } = require('./search-taobao');
const GLMClient = require('./glm-client');
const { postProcessTitle, constructFallbackTitle, cleanTitle } = require('./title-utils');
const { removeBannedWords } = require('./banned-words');
const { ResultCache } = require('./cache');
const { analyzePeerTitles, recommendResearchKeywords, enrichWithSycmData } = require('./keyword-analyzer');
const { parseSycmData } = require('./sycm-parser');

const RUN_TIMEOUT = parseInt(process.env.RUN_TIMEOUT) || 120000;

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
 * @returns {{ coreWord, blueOceanWord, modifiers, products, filteredCount, titles, stats }}
 */
function buildOutput({ coreWord, blueOceanWord, modifiers, products, selectedProducts = [], titleObjs = [], stats, imageSearchResults = [], taobaoTitles = [], maxLength = 60 }) {
  // 构建标题映射（归一化 productId）
  const titleMap = {};
  if (Array.isArray(titleObjs)) {
    titleObjs.forEach(t => {
      if (t && t.productId) {
        titleMap[String(t.productId).trim()] = t.title;
      }
    });
  }

  const mappedTitles = titleObjs.map(t => t && t.title);

  // Build a Map for ID-based lookup of selected products
  const selectedMap = new Map();
  if (Array.isArray(selectedProducts)) {
    for (const s of selectedProducts) {
      if (s && (s.productId || s.product_id)) {
        const key = String(s.productId || s.product_id || '').trim();
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
      shopTitle = constructFallbackTitle(blueOceanWord, p.title || '', fallbackPeerTitles, maxLength);
    }

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
      '风险提示': selected.risk || ''
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
    peerTitles: taobaoTitles || []
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
 * 1688 搜索及去重/截断（对外不可见实现）
 * @param {string} coreWord
 * @param {string} blueOceanWord
 * @param {Array} modifiers
 * @param {number} limit
 * @param {Function} log
 * @param {Function} warn
 * @returns {Promise<{products: Array}>}
 */
async function _search1688(coreWord, blueOceanWord, modifiers, limit, log, warn, semanticGroups = {}) {
  let products = [];
  let searchResult = [];
  let searchOk = true;
  try {
    searchResult = await require('./search-1688').searchAll(coreWord, blueOceanWord, modifiers, semanticGroups);
  } catch (err) {
    warn('⚠️ 1688 搜索失败，尝试本地筛选回退:', err && err.message ? err.message : err);
    searchOk = false;
    try {
      // 内联简化搜索：仅搜核心词 + 刚性过滤（不同于 searchAll 的路径，避免循环）
      const Alibaba1688Client = require('./alibaba1688-client');
      const ak = process.env.ALI_1688_AK;
      if (!ak) throw new Error('环境变量 ALI_1688_AK 未设置');
      const fallbackClient = new Alibaba1688Client(ak);
      const fallbackProducts = await fallbackClient.searchOffers(coreWord);
      // 内联刚性过滤逻辑
      const rigidModifiers = modifiers
        .filter(m => m.rigidity === 'rigid')
        .map(m => m.word.toLowerCase());
        searchResult = rigidModifiers.length === 0 ? fallbackProducts : fallbackProducts.filter(product => {
          const title = (product.title || '').toLowerCase();
          return rigidModifiers.every(word => title.includes(word));
        });
    } catch (e2) {
      searchResult = [];
    }
  }

  products = Array.isArray(searchResult) ? searchResult : [];
  // 去重/简单去重策略
  const _dedupSeen = new Set();
  products = products.filter(p => {
    const urlMatch = (p.url || '').match(/\/offer\/(\d+)\.html/);
    const offerId = urlMatch ? urlMatch[1] : '';
    const normalizedTitle = (p.title || '').replace(/\s+/g, '').toLowerCase();
    if (offerId && _dedupSeen.has('id:' + offerId)) return false;
    if (offerId) _dedupSeen.add('id:' + offerId);
    const titlePrefix = normalizedTitle.substring(0, 15);
    if (titlePrefix.length >= 10 && _dedupSeen.has('title:' + titlePrefix)) return false;
    if (titlePrefix.length >= 10) _dedupSeen.add('title:' + titlePrefix);
    return true;
  });
  if (limit > 0 && products.length > limit) {
    log(`  限制处理数量: ${limit} 个`);
    products = products.slice(0, limit);
  }
  return { products, searchOk };
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
      } else {
        console.error('[peerTitles] 无商品数据，跳过同行标题搜索 (products=' + (products ? products.length : 'null') + ')');
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
async function _generateTitles({ blueOceanWord, coreWord, modifiers, peerTitles, products, taobaoTitles, maxLength, imageSearchResults, stats, cache, _peerTitlesHash, glmClient, log, warn, limit, sycmKeywords = [], sycmDataHash = '', signal = null, useImageSearch = false, maxImageSearch = 0, minPrice = 0, maxPrice = 0 }) {
  // Step 4: 尝试 GLM selectAndGenerate 以输出更多字段...
  // 使用与原实现相同的流程与降级策略
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
        products: batch, maxLength
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
    allTitleObjs.forEach(t => {
      if (t && t.title) {
        const processed = postProcessTitle(t.title, blueOceanWord, 30, maxLength);
        t.title = processed || t.title;
      }
    });

    const result = buildOutput({
      coreWord, blueOceanWord, modifiers, products,
      selectedProducts: allSelectedProducts,
      titleObjs: allTitleObjs,
      stats,
      imageSearchResults,
      taobaoTitles,
      maxLength
     });
     if (!signal?.aborted) cache.set(blueOceanWord, maxLength, limit, result, _peerTitlesHash, sycmDataHash, useImageSearch, maxImageSearch, minPrice, maxPrice);
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
      const titles = await glmClient.generateTitles({ blueOceanWord, coreWord, modifiers, peerTitles: fallbackPeerTitles, products, maxLength });
      const mappedTitles = titles.map(t => postProcessTitle(t, blueOceanWord, 30, maxLength) || removeBannedWords(cleanTitle(t || '')));
      if (stats.trace) stats.trace.titleGeneration = 'local_generation';
      const result = buildOutput({
        coreWord, blueOceanWord, modifiers, products,
        stats: { ...stats, degraded: 'local_generation' },
        imageSearchResults,
        taobaoTitles,
        maxLength
      });
      result.titles = mappedTitles;
       result.products.forEach((p, idx) => {
         p['铺货标题'] = (Array.isArray(mappedTitles) && mappedTitles.length > idx)
           ? mappedTitles[idx]
           : (Array.isArray(mappedTitles) && mappedTitles.length > 0 ? mappedTitles[idx % mappedTitles.length] : p['链接原标题']);
       });
       if (!signal?.aborted) cache.set(blueOceanWord, maxLength, limit, result, _peerTitlesHash, sycmDataHash, useImageSearch, maxImageSearch, minPrice, maxPrice);
       return result;
    } catch (e2) {
      // 最后降级：直接返回简单结构，避免中断流程
      warn('降级失败，返回简化结构：', e2 && e2.message ? e2.message : e2);
      if (stats.trace) stats.trace.titleGeneration = 'simple_fallback';
      const simpleTitles = products.map(p =>
        postProcessTitle(p.title, blueOceanWord, 30, maxLength) || removeBannedWords(cleanTitle(p.title || ''))
      );
      const result = buildOutput({
        coreWord, blueOceanWord, modifiers, products,
        stats: { ...stats, degraded: 'simple_fallback' },
        imageSearchResults,
        taobaoTitles,
        maxLength
      });
      result.titles = simpleTitles;
       result.products.forEach((p, idx) => {
         p['铺货标题'] = simpleTitles[idx] || p['链接原标题'];
       });
       if (!signal?.aborted) cache.set(blueOceanWord, maxLength, limit, result, _peerTitlesHash, sycmDataHash, useImageSearch, maxImageSearch, minPrice, maxPrice);
       return result;
    }
  }
}

async function run(blueOceanWord, options = {}) {
  const { maxLength = 60, peerTitles = [], silent = false, limit = 0, onBatch = null, research = false, sycmData, useImageSearch = false, maxImageSearch = 0, minPrice = 0, maxPrice = 0, signal = null, onProductsFound = null, onProgress = null, skipFlag = null } = options;
  
  const log = silent ? () => {} : console.log.bind(console);
  const warn = silent ? () => {} : console.warn.bind(console);

  const cache = new ResultCache({ cacheDir: path.join(__dirname, '..', '.cache') });
  // 计算 peerTitles hash 用于缓存键区分
  let _peerTitlesHash = (peerTitles && peerTitles.length > 0)
    ? require('crypto').createHash('md5').update(peerTitles.join('|')).digest('hex').slice(0, 8)
    : '';
  // 计算 SYCM 数据哈希，用于缓存键区分（如果存在）
  const _sycmDataHash = sycmData ? require('crypto').createHash('md5').update(sycmData).digest('hex').slice(0, 8) : '';

  // 追踪信息：记录各决策点的执行路径
  const trace = {
    search1688: 'ok',
    peerTitlesSource: 'none',
    sycmEnhanced: false,
    titleGeneration: 'selectAndGenerate',
    taobaoInstalled: false
  };

  const cached = cache.get(blueOceanWord, maxLength, limit, _peerTitlesHash, _sycmDataHash, useImageSearch, maxImageSearch, minPrice, maxPrice);
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
  const { coreWord, modifiers, semanticGroups = {} } = await _extractCore(blueOceanWord, log);
  log(`  核心词: ${coreWord}`);
  log(`  修饰词: ${modifiers.map(m => `${m.word}(${m.rigidity})`).join(', ')}`);
  if (Object.keys(semanticGroups).length > 0) {
    log('  📊 语义族: ' + Object.entries(semanticGroups).map(([k,v]) => `${k}(${v.length}词)`).join(', '));
  }

  // 如果开启 research 模式，先进行研究数据收集，不生成标题
    if (research === true) {
    log('🔬 research 模式：开始提取研究关键词...');

    // 优先从淘宝文字搜索获取同行标题（C端数据更接近生意参谋搜索生态）
    let peerTitlesForResearch = peerTitles || [];
    if (peerTitlesForResearch.length === 0) {
      try {
        const { isTaobaoNativeInstalled } = require('./search-taobao');
        trace.taobaoInstalled = isTaobaoNativeInstalled();
        if (trace.taobaoInstalled) {
          try {
            const { searchTaobaoTitles } = require('./search-taobao');
            log('📱 淘宝文字搜索获取同行标题...');
            const taobaoResult = await searchTaobaoTitles(coreWord);
            if (taobaoResult && taobaoResult.length > 0) {
              peerTitlesForResearch = taobaoResult;
              log(`  获取到 ${taobaoResult.length} 条淘宝同行标题`);
            }
          } catch (e) {
            warn('  淘宝搜索失败，降级使用1688商品标题');
          }
        } else {
          warn('  taobao-native 未安装，使用1688商品标题作为同行数据（C端数据更准确）');
        }
      } catch (e) {
        warn('  检查 taobao-native 安装失败，跳过淘宝搜索');
      }

       // 降级：使用 1688 商品标题
      if (peerTitlesForResearch.length === 0) {
        try {
          const { products } = await _search1688(coreWord, blueOceanWord, modifiers, limit, log, warn, semanticGroups);
          peerTitlesForResearch = products.slice(0, 20).map(p => p.title).filter(Boolean);
          log(`  使用 ${peerTitlesForResearch.length} 条1688商品标题（降级）`);
        } catch (e) {
          warn('  1688 搜索失败，无法获取同行标题');
        }
      }
    }

    const researchKeywordsObj = recommendResearchKeywords({ coreWord, blueOceanWord, modifiers, peerTitles: peerTitlesForResearch });
    const researchKeywords = researchKeywordsObj && Array.isArray(researchKeywordsObj.keywords) ? researchKeywordsObj.keywords : [];
    return { ok: true, researchKeywords, coreWord, modifiers, _trace: trace };
  }

  // 初始化 GLM client 以便在并行步骤中使用
  const glmClient = new GLMClient({
    apiKey: process.env.GLM_API_KEY,
    apiBase: process.env.GLM_API_BASE,
    model: process.env.GLM_API_MODEL
  });

  // 步骤 2 和 3 并行（1688搜索 + 淘宝文字搜索）
  log('🔎 并行处理 1688 搜索与淘宝文字搜索...');
  const [
    { products: rawProducts, searchOk },
    { taobaoTitles: initialTaobaoTitles, peerSource: textPeerSource }
  ] = await Promise.all([
    // 任务1: 1688 搜索
    _search1688(coreWord, blueOceanWord, modifiers, limit, log, warn, semanticGroups),
    // 任务2: 淘宝文字搜索（在获取 products 前进行）
    (async () => {
      // 如果有用户提供的 peerTitles，则不需要文字搜索
      if (peerTitles && peerTitles.length > 0) {
        return { taobaoTitles: [], peerSource: 'manual_input' };
      }
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
      return result;
    })()
  ]);

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
  if (sycmData) {
    try {
      const titlesForAnalysis = (taobaoTitles && taobaoTitles.length > 0) ? taobaoTitles : peerTitles;
      const productTitles = products.map(p => p.title || '');
      const topKeys = analyzePeerTitles(titlesForAnalysis, productTitles);
      const { sycmKeywords: _sycmKeywords } = enrichWithSycmData(topKeys, parseSycmData(sycmData));
      sycmKeywords = _sycmKeywords || [];
      trace.sycmEnhanced = sycmKeywords.length > 0;
    } catch (e) {
      warn('⚠️ SYCM 数据解析失败:', e.message);
      sycmKeywords = [];
    }
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
      stats: { coreWord, modifiers: modifiers.map(m => m.word), trace }
    };
  }

  log(`  过滤后剩余 ${products.length} 个商品`);

  // 步骤 4: GLM 标题生成（含降级路径 + 超时保护）
  log('✍️  尝试 GLM selectAndGenerate 以输出更多字段...');
   const stats = {
     coreWord,
     modifiers: modifiers.map(m => m.word),
     matchedProducts: products.length,
     trace
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
      _generateTitles({ blueOceanWord, coreWord, modifiers, peerTitles, products, taobaoTitles: finalTaobaoTitles, maxLength, imageSearchResults, stats, cache, _peerTitlesHash, glmClient, log, warn, limit, sycmKeywords, sycmDataHash: _sycmDataHash, signal, useImageSearch, maxImageSearch, minPrice, maxPrice }),
      timeoutPromise
    ]).finally(() => { if (_raceTimeoutId) clearTimeout(_raceTimeoutId); });
}

/**
 * 从 1688 链接生成标题的完整工作流：1688链接→取图→搜图→生成标题
 * @param {string} url - 1688 商品详情页 URL
 * @param {object} options - 配置选项
 * @param {number} options.maxLength - 生成标题的最大长度（默认 60）
 * @param {boolean} options.silent - 是否静默模式（默认 false）
 * @returns {Promise<object>} 返回结果对象
 */
async function runFromImage(url, options = {}) {
  const { maxLength = 60, silent = false, keyword = '' } = options;
  
  const log = silent ? () => {} : console.log.bind(console);
  const warn = silent ? () => {} : console.warn.bind(console);
  
  log(`🔗 开始处理 1688 链接: ${url}`);
  
  // 步骤 1: URL 解析
  log('🔍 第一步：解析 1688 链接...');
  try {
    const { parse1688Url } = require('./alibaba1688-client');
    const parsed = parse1688Url(url);
    
    if (!parsed) {
      return {
        ok: false,
        error: '无效的1688链接',
        step: 'parse_url',
        sourceUrl: url
      };
    }
    
    const { offerId } = parsed;
    log(`  解析成功，Offer ID: ${offerId}`);
    
    // 步骤 2: 获取商品详情
    log('📦 第二步：获取商品详情...');
    const Alibaba1688Client = require('./alibaba1688-client');
    const apiKey = process.env.ALI_1688_AK;
    
    if (!apiKey) {
      return {
        ok: false,
        error: '环境变量 ALI_1688_AK 未设置',
        step: 'get_detail',
        sourceUrl: url
      };
    }
    
    const client = new Alibaba1688Client(apiKey);
    const detail = await client.getOfferDetail(offerId);
    
    // 步骤 3: 提取主图和标题
    log('🖼️ 第三步：提取主图和原标题...');
    
    // offer_detail API 返回格式: detail.model.bizData[offerId].all_info (Markdown字符串)
    const bizData = detail.model?.bizData?.[offerId];
    if (!bizData || !bizData.all_info) {
      return {
        ok: false,
        error: '获取商品详情失败：数据为空',
        step: 'extract_data',
        sourceUrl: url
      };
    }
    
    // 从 Markdown 中提取标题（格式: "# 商品标题\n标题内容"）
    const titleMatch = bizData.all_info.match(/# 商品标题\n(.+)/);
    const originalTitle = titleMatch ? titleMatch[1].trim() : '';
    if (!originalTitle) {
      log('⚠️ 商品标题为空，使用默认值');
    }
    
    log(`  原标题: ${originalTitle.substring(0, 50)}${originalTitle.length > 50 ? '...' : ''}`);
    
    // offer_detail API 不返回图片URL，需要通过搜索获取主图
    // 用原标题在 1688 搜索，从搜索结果中匹配同 ID 的商品获取主图
    log('🖼️ 通过 1688 搜索获取商品主图...');
    let imageUrl = '';
    try {
      const searchKeyword = originalTitle.substring(0, 20); // 截取标题前20字作为搜索词
      const searchProducts = await client.searchOffers(searchKeyword);
      // 优先匹配相同 offerId 的商品
      const exactMatch = searchProducts.find(p => p.id === offerId);
      if (exactMatch && exactMatch.url) {
        imageUrl = exactMatch.url;
        log('  找到精确匹配的商品主图');
      } else if (searchProducts.length > 0 && searchProducts[0].url) {
        // 降级：使用搜索结果中第一个商品的图片（同类商品近似图）
        imageUrl = searchProducts[0].url;
        log('  使用搜索结果中首个同类商品主图（未找到精确匹配）');
      }
    } catch (searchErr) {
      warn('⚠️ 1688 搜索获取主图失败:', searchErr.message || searchErr);
    }
    
    if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) {
      return {
        ok: false,
        error: '无法获取商品主图 URL',
        step: 'extract_image',
        sourceUrl: url,
        originalTitle
      };
    }
    
    log(`  主图 URL: ${imageUrl.substring(0, 60)}...`);
    
    // 步骤 4: 以图搜图
    log('🔎 第四步：以图搜图获取同行标题...');
    try {
      const { searchPeerTitlesByImage, isImageSearchAvailable } = require('./search-taobao-image');
      
      // 检查以图搜图功能是否可用
      if (!isImageSearchAvailable()) {
        return {
          ok: false,
          error: '以图搜图功能不可用（taobao-native 未安装或配置）',
          step: 'image_search',
          sourceUrl: url,
          imageUrl,
          originalTitle
        };
      }
      
      // 构造合成商品数组
      const products = [{
        id: offerId,
        url: imageUrl,
        title: originalTitle
      }];
      
      // 初始化 GLM 客户端（用于可能的标题清洗）
      const GLMClient = require('./glm-client');
      const glmClient = new GLMClient({
        apiKey: process.env.GLM_API_KEY,
        apiBase: process.env.GLM_API_BASE,
        model: process.env.GLM_API_MODEL
      });
      
      const imageSearchResponse = await searchPeerTitlesByImage(products, {
        coreWord: '', // 先留空，后续从同行标题提取
        glmClient
      });
      
      const imageSearchResults = imageSearchResponse.results;
      const firstResult = imageSearchResults[0] || {};
      const peerTitles = firstResult.peerTitles || [];
      const hasMatch = firstResult.hasMatch || false;
      
      if (!hasMatch || peerTitles.length === 0) {
        return {
          ok: false,
          error: '以图搜图未找到匹配的同行标题',
          step: 'image_search',
          sourceUrl: url,
          imageUrl,
          originalTitle
        };
      }
      
      log(`  找到 ${peerTitles.length} 条同行标题`);
      
      // 步骤 5: 提取核心词
      log('📝 第五步：从同行标题提取核心词、蓝海词和修饰词...');
      
      let coreWord, blueOceanWord, modifiers;
      
      if (keyword) {
        // 用户手动传入蓝海词，跳过 GLM 提取，直接用关键词作为 blueOceanWord
        log(`  使用用户提供的蓝海词: ${keyword}`);
        blueOceanWord = keyword;
        // 从关键词中提取核心词（取最后 1-2 个有意义的词）
        try {
          const extracted = await extractKeywords('keyword', { data: keyword });
          coreWord = extracted.coreWord;
          modifiers = extracted.modifiers;
        } catch (_) {
          coreWord = keyword;
          modifiers = [];
        }
      } else {
        const extracted = await extractKeywords('peerTitles', { data: peerTitles });
        coreWord = extracted.coreWord;
        blueOceanWord = extracted.blueOceanWord;
        modifiers = extracted.modifiers;
      }
      
      log(`  核心词: ${coreWord}`);
      log(`  蓝海词: ${blueOceanWord}`);
      log(`  修饰词: ${modifiers.map(m => `${m.word}(${m.rigidity})`).join(', ')}`);
      
      // 步骤 6: 生成标题
      log('✍️ 第六步：生成优化标题...');
      const { generateTitles } = require('./generate-title');
      
      const titles = await generateTitles(blueOceanWord, coreWord, modifiers, peerTitles, [], maxLength, 20);
      
      if (!Array.isArray(titles) || titles.length === 0) {
        return {
          ok: false,
          error: '标题生成失败',
          step: 'generate_titles',
          sourceUrl: url,
          imageUrl,
          originalTitle,
          coreWord,
          blueOceanWord,
          peerTitles,
          peerSource: 'image_search'
        };
      }
      
      // 步骤 7: 构建输出
      log('✅ 第七步：构建输出结果...');
      const result = {
        ok: true,
        sourceUrl: url,
        imageUrl,
        originalTitle,
        coreWord,
        blueOceanWord,
        titles: titles.slice(0, 5), // 最多返回5条
        peerTitles: peerTitles.slice(0, 20), // 最多返回20条同行标题
        peerSource: 'image_search',
        stats: {
          peerTitlesFound: peerTitles.length,
          titlesGenerated: Math.min(titles.length, 5)
        }
      };
      
      log(`✅ 处理完成！生成 ${titles.length} 条标题`);
      return result;
      
    } catch (error) {
      return {
        ok: false,
        error: error.message || '以图搜图或后续步骤失败',
        step: 'image_search',
        sourceUrl: url,
        imageUrl,
        originalTitle
      };
    }
    
  } catch (error) {
    // 通用错误处理
    return {
      ok: false,
      error: error.message || '未知错误',
      step: 'unknown',
      sourceUrl: url
    };
  }
}

module.exports = { run, runFromImage };
