const path = require('path');
const { extractCoreAndModifiers } = require('./extract-core');
const { searchAndFilter } = require('./search-1688');
const { searchTaobaoTitles } = require('./search-taobao');
const GLMClient = require('./glm-client');
const { postProcessTitle, constructFallbackTitle, cleanTitle } = require('./title-utils');
const { removeBannedWords } = require('./banned-words');
const { ResultCache } = require('./cache');

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
    item['选品理由'] = reasons.join('，') + '，符合核心词描述';
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
  const cached = cache.get(blueOceanWord, maxLength, limit);
  if (cached) {
    log('📦 命中缓存，直接返回');
    return cached;
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
        try {
          imageSearchResults = await searchPeerTitlesByImage(searchResult);
          taobaoTitles = imageSearchResults
            .filter(r => r.hasMatch && Array.isArray(r.peerTitles))
            .flatMap(r => r.peerTitles);
          log('🔎 以图搜图完成，提取同行标题数量: ' + taobaoTitles.length);
        } catch (err) {
          warn('⚠️ 以图搜图失败，降级到文字搜索:', err && err.message ? err.message : err);
          taobaoTitles = [];
          try {
            taobaoTitles = await require('./search-taobao').searchTaobaoTitles(blueOceanWord);
          } catch (e) {
            taobaoTitles = [];
          }
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
  // Step 2+3 的最终产物：将结果赋给统一的 products/taobaoTitles 变量
  products = Array.isArray(searchResult) ? searchResult : [];

  const seen = new Set();
  products = products.filter(p => {
    const urlMatch = (p.url || '').match(/\/offer\/(\d+)\.html/);
    const offerId = urlMatch ? urlMatch[1] : '';
    const normalizedTitle = (p.title || '').replace(/\s+/g, '').toLowerCase();
    if (offerId && seen.has('id:' + offerId)) return false;
    if (offerId) seen.add('id:' + offerId);
    const titlePrefix = normalizedTitle.substring(0, 15);
    if (titlePrefix.length >= 10 && seen.has('title:' + titlePrefix)) return false;
    if (titlePrefix.length >= 10) seen.add('title:' + titlePrefix);
    return true;
  });

  const stats = {
    coreWord,
    modifiers: modifiers.map(m => m.word),
    alibaba1688Total: Array.isArray(searchResult) ? searchResult.length : 0,
    taobaoTitlesTotal: Array.isArray(taobaoTitles) ? taobaoTitles.length : 0,
    imageSearchTotal: Array.isArray(imageSearchResults) ? imageSearchResults.length : 0,
    imageSearchMatched: Array.isArray(imageSearchResults) ? imageSearchResults.filter(r => r.hasMatch).length : 0,
    taobaoSource: (Array.isArray(imageSearchResults) && imageSearchResults.length > 0)
      ? 'image_search'
      : (Array.isArray(taobaoTitles) && taobaoTitles.length > 0 ? 'text_search' : 'none'),
  };

  if (!Array.isArray(products) || products.length === 0) {
    log('  ⚠️  没有找到匹配的商品');
    return {
      coreWord,
      blueOceanWord,
      modifiers,
      products: [],
      filteredCount: 0,
      titles: [],
      stats
    };
  }

  log(`  过滤后剩余 ${products.length} 个商品`);

  if (limit > 0 && products.length > limit) {
    log(`  限制处理数量: ${limit} 个`);
    products = products.slice(0, limit);
  }

  stats.matchedProducts = products.length;

  log(`  过滤后剩余 ${products.length} 个商品`);

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
    const cleanedPeerTitles = (peerTitles || []).map(t => cleanTitle(removeBannedWords(t || ''))).filter(Boolean);
    
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

  // 构造标题映射（归一化 productId，在 postProcessTitle 之后构建）
  const titleMap = {};
  if (Array.isArray(allTitleObjs)) {
    allTitleObjs.forEach(t => {
      if (t && t.productId) {
        const normalizedId = String(t.productId).trim();
        titleMap[normalizedId] = t.title;
      }
    });
  }

  mappedTitles = allTitleObjs.map(t => t && t.title);

  const enriched = products.map((p, idx) => {
    const selected = Array.isArray(allSelectedProducts) ? allSelectedProducts[idx] || {} : {};
    // 构建1688产品详情页链接
    const productId = p.id || p.offerId || p.productId;
    const detailUrl = productId ? `https://detail.1688.com/offer/${productId}.html` : p.url;
    // 归一化用于 titleMap 的键
    const normalizedId = String(productId || '').trim();
    let shopTitle = titleMap[normalizedId];
    if (!shopTitle) {
      // 选用来自图片搜索的同行标题（如存在），否则回落到 taobaoTitles
      const imageResult = (imageSearchResults || []).find(r => r && (r.productId === normalizedId || r.productId === String(productId)));
      const fallbackPeerTitles = (imageResult && imageResult.hasMatch && imageResult.peerTitles)
        ? imageResult.peerTitles
        : (taobaoTitles || []);
      shopTitle = constructFallbackTitle(blueOceanWord, p.title || '', fallbackPeerTitles, maxLength);
      warn(`⚠️ 产品 ${normalizedId} 无GLM标题，使用构造标题: ${shopTitle}`);
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

  const result = {
    coreWord,
    blueOceanWord,
    modifiers,
    products: enriched,
    filteredCount: products.length,
    titles: mappedTitles,
    stats
  };
  cache.set(blueOceanWord, maxLength, limit, result);
  return result;
  } catch (err) {
    // 备用降级路径：使用本地评分 + 生成标题，或简单标题生成
    warn('⚠️ GLM selectAndGenerate 失败，降级到本地标题生成... ', err && err.message ? err.message : err);
    try {
      // 调用本地生成（需要传入原始参数）
      const titles = await glmClient.generateTitles({ blueOceanWord, coreWord, modifiers, peerTitles, products, maxLength });
      mappedTitles = titles.map(t => postProcessTitle(t, blueOceanWord, 40, maxLength) || t.replace(/\s+/g, ''));
      const enriched = products.map((p, index) => ({
        '链接原标题': p.title,
        '产品链接': p.url,
        '铺货标题': (Array.isArray(mappedTitles) && mappedTitles.length > index) ? mappedTitles[index] : (Array.isArray(mappedTitles) && mappedTitles.length > 0 ? mappedTitles[0] : p.title),
        '商品原价': p.price,
        '30天销量': p.stats && typeof p.stats.last30DaysSales === 'number' ? p.stats.last30DaysSales : 0,
        '好评率': p.stats && typeof p.stats.goodRates === 'number' ? p.stats.goodRates : 0,
        '复购率': p.stats && typeof p.stats.repurchaseRate === 'number' ? p.stats.repurchaseRate : 0,
        '蓝海词': blueOceanWord,
        '选品理由': '',
        '定价建议': '',
        '风险提示': ''
      }));
      enriched.forEach(fillFallbackAdvice);
      const result = {
        coreWord,
        blueOceanWord,
        modifiers,
        products: enriched,
        filteredCount: products.length,
        titles: mappedTitles,
        stats: { ...stats, degraded: 'local_generation' }
      };
      cache.set(blueOceanWord, maxLength, limit, result);
      return result;
    } catch (e2) {
      // 最后降级：直接返回简单结构，避免中断流程
      warn('降级失败，返回简化结构：', e2 && e2.message ? e2.message : e2);
      const simple = products.map(p => ({
        '链接原标题': p.title,
        '产品链接': p.url,
        '铺货标题': postProcessTitle(p.title, blueOceanWord, 40, maxLength) || p.title.replace(/\s+/g, ''),
        '商品原价': p.price,
        '30天销量': p.stats && typeof p.stats.last30DaysSales === 'number' ? p.stats.last30DaysSales : 0,
        '好评率': p.stats && typeof p.stats.goodRates === 'number' ? p.stats.goodRates : 0,
        '复购率': p.stats && typeof p.stats.repurchaseRate === 'number' ? p.stats.repurchaseRate : 0,
        '蓝海词': blueOceanWord,
        '选品理由': '',
        '定价建议': '',
        '风险提示': ''
      }));
      simple.forEach(fillFallbackAdvice);
      const result = {
        coreWord,
        blueOceanWord,
        modifiers,
        products: simple,
        filteredCount: products.length,
        titles: [],
        stats: { ...stats, degraded: 'simple_fallback' }
      };
      cache.set(blueOceanWord, maxLength, limit, result);
      return result;
    }
  }
}

module.exports = { run };
