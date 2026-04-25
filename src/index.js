const path = require('path');
const { extractCoreAndModifiers } = require('./extract-core');
const { searchAndFilter } = require('./search-1688');
const { searchTaobaoTitles } = require('./search-taobao');
const GLMClient = require('./glm-client');
const { postProcessTitle, constructFallbackTitle, cleanTitle } = require('./title-utils');
const { removeBannedWords } = require('./banned-words');
const { ResultCache } = require('./cache');
const { analyzePeerTitles } = require('./keyword-analyzer');

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
    const productId = p.id || p.offerId || p.productId;
    const selected = selectedMap.get(String(productId || '').trim()) || {};
    // 构建1688产品详情页链接
    const detailUrl = productId ? `https://detail.1688.com/offer/${productId}.html` : p.url;
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
      '主图链接': p.url || p.image,
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
async function run(blueOceanWord, options = {}) {
  const { maxLength = 60, peerTitles = [], silent = false, limit = 0, onBatch = null } = options;
  const log = silent ? () => {} : console.log.bind(console);
  const warn = silent ? () => {} : console.warn.bind(console);

  const cache = new ResultCache({ cacheDir: path.join(__dirname, '..', '.cache') });
  // 计算 peerTitles hash 用于缓存键区分
  const _peerTitlesHash = (peerTitles && peerTitles.length > 0)
    ? require('crypto').createHash('md5').update(peerTitles.join('|')).digest('hex').slice(0, 8)
    : '';

  const cached = cache.get(blueOceanWord, maxLength, limit, _peerTitlesHash);
  if (cached) {
    log('📦 命中缓存，直接返回');
    return cached;
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

  log(`🔍 正在处理: ${blueOceanWord}`);

  // 步骤 1: 提取核心词和修饰词
  log('📝 提取核心词和修饰词...');
  const { coreWord, modifiers } = await extractCoreAndModifiers(blueOceanWord);
  log(`  核心词: ${coreWord}`);
  log(`  修饰词: ${modifiers.map(m => `${m.word}(${m.rigidity})`).join(', ')}`);

  // Step 2: 先独立完成 1688 搜索
  log('🔎 第一步：1688 搜索独立完成...');
  let products = [];
  let taobaoTitles = [];
  let searchResult = [];
  let imageSearchResults = [];
  // 保存 imageSearch 的匹配状态用于后续标题回填
  
  try {
    searchResult = await require('./search-1688').searchAll(coreWord, blueOceanWord, modifiers);
  } catch (err) {
    warn('⚠️ 1688 搜索失败，尝试本地筛选回退:', err && err.message ? err.message : err);
    try {
      const { searchAndFilter } = require('./search-1688');
      searchResult = await searchAndFilter(coreWord, modifiers);
    } catch (e) {
      searchResult = [];
    }
  }

  // 提前赋值并对结果进行去重和限制，便于以图搜图在限定范围内执行
  products = Array.isArray(searchResult) ? searchResult : [];
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

  // Step 3: 根据情况串行执行以图搜图/淘宝同行标题或回退
  log('🔎 第三步：根据条件进行图像搜索或文字搜索（串行）...');
  if (peerTitles && peerTitles.length > 0) {
    taobaoTitles = peerTitles;
  } else {
    // 只有在没有传入同行标题且有可用商品时才进行图片-search
    if (Array.isArray(searchResult) && searchResult.length > 0) {
      const isImageSearchAvailable = () => {
        try {
          const m = require('./search-taobao-image');
          return typeof m.isImageSearchAvailable === 'function' ? m.isImageSearchAvailable() : false;
        } catch (e) {
          return false;
        }
      };
      if (isImageSearchAvailable()) {
        const { searchPeerTitlesByImage } = require('./search-taobao-image');
        // text_search 将在需要时按需执行（仅在图片搜索失败后或无结果时才调用）
        try {
          imageSearchResults = await searchPeerTitlesByImage(products, { coreWord, glmClient });
          taobaoTitles = imageSearchResults
            .filter(r => r.hasMatch && Array.isArray(r.peerTitles))
            .flatMap(r => r.peerTitles);
        log('🔎 以图搜图完成，提取同行标题数量: ' + taobaoTitles.length);
        // 如果图搜图没有返回结果，尝试文本搜索作为回退
        if ((taobaoTitles || []).length === 0) {
          log('🔎 以图搜图无结果，尝试文字搜索...');
          taobaoTitles = await require('./search-taobao').searchTaobaoTitles(blueOceanWord).catch(() => []);
        }
        } catch (err) {
          warn('⚠️ 以图搜图失败，使用预取的文本搜索结果:', err && err.message ? err.message : err);
          taobaoTitles = await require('./search-taobao').searchTaobaoTitles(blueOceanWord).catch(() => []);
        }
      } else {
        try {
          taobaoTitles = await require('./search-taobao').searchTaobaoTitles(blueOceanWord);
        } catch (err) {
          warn('⚠️ 淘宝同行标题检索失败，降级为空：', err && err.message ? err.message : err);
          taobaoTitles = [];
        }
      }
    }
  }


  if (!Array.isArray(products) || products.length === 0) {
    log('  ⚠️  没有找到匹配的商品');
    return {
      coreWord,
      blueOceanWord,
      modifiers,
      products: [],
      filteredCount: 0,
      titles: [],
      stats: { coreWord, modifiers: modifiers.map(m => m.word) }
    };
  }

  log(`  过滤后剩余 ${products.length} 个商品`);

  let stats = {
    coreWord,
    modifiers: modifiers.map(m => m.word)
  };

  stats.matchedProducts = products.length;

  // Step 4: 优先通过 GLM 的 selectAndGenerate 实现多字段输出
  log('✍️  尝试 GLM selectAndGenerate 以输出更多字段...');
  const glmClient = new GLMClient({
    apiKey: process.env.GLM_API_KEY,
    apiBase: process.env.GLM_API_BASE,
    model: process.env.GLM_API_MODEL
  });
  
  try {
    const BATCH_SIZE = 5;
    // 预过滤淘宝同行标题，避免 GLM 学习违禁词
    // 优先使用传入的peerTitles，否则使用从图片搜索获取的taobaoTitles
    const titlesToUse = (peerTitles && peerTitles.length > 0) ? peerTitles : taobaoTitles;
    const cleanedPeerTitles = (titlesToUse || []).map(t => cleanTitle(removeBannedWords(t || ''))).filter(Boolean);

    // 关键词分析：提取高频词和竞品缺口词
    let keywordAnalysis = null;
    if (cleanedPeerTitles.length > 0) {
      keywordAnalysis = analyzePeerTitles(cleanedPeerTitles, products.map(p => p.title || ''));
      log('  📊 关键词分析: 高频词 Top5: ' + (keywordAnalysis.topKeywords.slice(0, 5).map(k => k.word + '(' + k.count + ')').join(', ')));
      if (keywordAnalysis.gapKeywords.length > 0) {
        log('  📊 竞品缺口词: ' + keywordAnalysis.gapKeywords.slice(0, 10).map(k => k.word).join(', '));
      }
    }

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
    const batchResults = await Promise.all(batches.map(({ index, products: batch }) =>
      glmClient.selectAndGenerate({
        blueOceanWord, coreWord, modifiers,
        peerTitles: cleanedPeerTitles,
        keywordAnalysis,
        products: batch, maxLength
      }).then(result => {
        log(`  第 ${index + 1}/${batches.length} 批完成`);
        return result;
      }).catch(err => {
        warn(`  ⚠️ 第 ${index + 1} 批处理失败:`, err.message);
        return { selectedProducts: [], titles: [] };
      })
    ));

    const allSelectedProducts = batchResults.flatMap(r => Array.isArray(r.selectedProducts) ? r.selectedProducts : []);
    const allTitleObjs = batchResults.flatMap(r => Array.isArray(r.titles) ? r.titles : []);

    stats.batchesProcessed = batches.length;
    stats.totalProductsEnriched = allSelectedProducts.length;
    stats.totalTitlesGenerated = allTitleObjs.length;
    
    log(`  ✓ 共处理 ${allSelectedProducts.length} 个产品的选品分析, 生成 ${allTitleObjs.length} 个标题`);

  // Apply postProcessTitle pipeline to all titles after batch processing
  allTitleObjs.forEach(t => {
    if (t && t.title) {
      const processed = postProcessTitle(t.title, blueOceanWord, 40, maxLength);
      t.title = processed || t.title;
    }
  });

    // 使用统一的 buildOutput 构建输出
    const result = buildOutput({
      coreWord, blueOceanWord, modifiers, products,
      selectedProducts: allSelectedProducts,
      titleObjs: allTitleObjs,
      stats,
      imageSearchResults,
      taobaoTitles,
      maxLength
    });
    cache.set(blueOceanWord, maxLength, limit, result, _peerTitlesHash);
    return result;
  } catch (err) {
    // 备用降级路径：使用本地评分 + 生成标题，或简单标题生成
    warn('⚠️ GLM selectAndGenerate 失败，降级到本地标题生成... ', err && err.message ? err.message : err);
    try {
      // 降级路径也需要清洗同行标题
      const fallbackPeerTitles = (peerTitles || []).map(t => cleanTitle(removeBannedWords(t || ''))).filter(Boolean);
      // 调用本地生成（需要传入原始参数）
      const titles = await glmClient.generateTitles({ blueOceanWord, coreWord, modifiers, peerTitles: fallbackPeerTitles, products, maxLength });
      const mappedTitles = titles.map(t => postProcessTitle(t, blueOceanWord, 40, maxLength) || t.replace(/\s+/g, ''));
      // 使用 buildOutput 统一构建（降级路径无 selectedProducts/titleObjs）
      const result = buildOutput({
        coreWord, blueOceanWord, modifiers, products,
        stats: { ...stats, degraded: 'local_generation' },
        imageSearchResults,
        taobaoTitles,
        maxLength
      });
      // 覆盖 titles（降级路径的标题来自 generateTitles，不是 selectAndGenerate）
      result.titles = mappedTitles;
      // 覆盖铺货标题（降级路径按索引分配）
      result.products.forEach((p, idx) => {
        p['铺货标题'] = (Array.isArray(mappedTitles) && mappedTitles.length > idx)
          ? mappedTitles[idx]
          : (Array.isArray(mappedTitles) && mappedTitles.length > 0 ? mappedTitles[0] : p['链接原标题']);
      });
      cache.set(blueOceanWord, maxLength, limit, result, _peerTitlesHash);
      return result;
    } catch (e2) {
      // 最后降级：直接返回简单结构，避免中断流程
      warn('降级失败，返回简化结构：', e2 && e2.message ? e2.message : e2);
      const simpleTitles = products.map(p =>
        postProcessTitle(p.title, blueOceanWord, 40, maxLength) || p.title.replace(/\s+/g, '')
      );
      const result = buildOutput({
        coreWord, blueOceanWord, modifiers, products,
        stats: { ...stats, degraded: 'simple_fallback' },
        imageSearchResults,
        taobaoTitles,
        maxLength
      });
      // 覆盖 titles 和铺货标题（最简降级路径）
      result.titles = simpleTitles;
      result.products.forEach((p, idx) => {
        p['铺货标题'] = simpleTitles[idx] || p['链接原标题'];
      });
      cache.set(blueOceanWord, maxLength, limit, result, _peerTitlesHash);
      return result;
    }
  }
}

module.exports = { run };
