const { extractCoreAndModifiers } = require('./extract-core');
const { searchAndFilter } = require('./search-1688');
const { searchTaobaoTitles } = require('./search-taobao');
const GLMClient = require('./glm-client');
const { postProcessTitle, constructFallbackTitle, cleanTitle } = require('./title-utils');
const { removeBannedWords } = require('./banned-words');

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
 *   titles
 * }
 */
async function run(blueOceanWord, options = {}) {
  const { maxLength = 60, peerTitles = [], silent = false, limit = 0, onBatch = null } = options;
  const log = silent ? () => {} : console.log.bind(console);
  const warn = silent ? () => {} : console.warn.bind(console);
  log(`🔍 正在处理: ${blueOceanWord}`);

  // 步骤 1: 提取核心词和修饰词
  log('📝 提取核心词和修饰词...');
  const { coreWord, modifiers } = await extractCoreAndModifiers(blueOceanWord);
  log(`  核心词: ${coreWord}`);
  log(`  修饰词: ${modifiers.map(m => `${m.word}(${m.rigidity})`).join(', ')}`);

  // Step 2: 1688 搜索（优先走 API，失败回退到本地筛选）
  log('🔎 搜索 1688 商品...');
  let products = [];
  let mappedTitles = [];
  try {
    products = await require('./search-1688').searchAll(coreWord, blueOceanWord, modifiers);
  } catch (err) {
    warn('⚠️ 1688 搜索失败，尝试本地筛选回退:', err && err.message ? err.message : err);
    try {
      const { searchAndFilter } = require('./search-1688');
      products = await searchAndFilter(coreWord, modifiers);
    } catch (e) {
      products = [];
    }
  }

  // 若没有符合条件的商品，直接返回空结果
  if (!Array.isArray(products) || products.length === 0) {
    log('  ⚠️  没有找到匹配的商品');
    return {
      coreWord,
      blueOceanWord,
      modifiers,
      products: [],
      filteredCount: 0,
      titles: []
    };
  }

  log(`  过滤后剩余 ${products.length} 个商品`);

  if (limit > 0 && products.length > limit) {
    log(`  限制处理数量: ${limit} 个`);
    products = products.slice(0, limit);
  }

  // 步骤 3: 淘宝同行标题（并行获取，若提供了 peerTitles 则优先使用）
  log('🔎 获取淘宝同行标题（并行）...');
  let taobaoTitles = [];
  if (peerTitles && peerTitles.length > 0) {
    taobaoTitles = peerTitles;
  } else {
    try {
      taobaoTitles = await require('./search-taobao').searchTaobaoTitles(blueOceanWord);
    } catch (err) {
      taobaoTitles = [];
      warn('⚠️  淘宝同行标题检索失败，降级为空：', err && err.message ? err.message : err);
    }
  }

  // Step 4: 优先通过 GLM 的 selectAndGenerate 实现多字段输出
  log('✍️  尝试 GLM selectAndGenerate 以输出更多字段...');
  const glmClient = new GLMClient({
    apiKey: process.env.GLM_API_KEY,
    apiBase: process.env.GLM_API_BASE,
    model: process.env.GLM_API_MODEL
  });
  
  try {
    // 批量处理：每批5个产品，确保所有产品都获得高质量标题
    const BATCH_SIZE = 5;
    let allSelectedProducts = [];
    let allTitleObjs = [];
    // 预过滤淘宝同行标题，避免 GLM 学习违禁词
    const cleanedPeerTitles = (peerTitles || []).map(t => cleanTitle(removeBannedWords(t || ''))).filter(Boolean);
    
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batch = products.slice(i, i + BATCH_SIZE);
      // 对当前批次的产品标题进行违禁词清洗
      const cleanedBatch = batch.map(p => ({
        ...p,
        title: cleanTitle(removeBannedWords(p.title || ''))
      }));
      log(`  正在处理第 ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(products.length/BATCH_SIZE)} 批产品 (${batch.length}个)...`);
      
      try {
      const { selectedProducts, titles: titleObjs } = await glmClient.selectAndGenerate({
        blueOceanWord,
        coreWord,
        modifiers,
        peerTitles: cleanedPeerTitles,
        products: cleanedBatch,
        maxLength
      });
      
      if (Array.isArray(selectedProducts)) {
        allSelectedProducts = allSelectedProducts.concat(selectedProducts);
      }
      if (Array.isArray(titleObjs)) {
        allTitleObjs = allTitleObjs.concat(titleObjs);
      }
      if (onBatch) {
        await onBatch({
          batch: Math.floor(i / BATCH_SIZE) + 1,
          total: Math.ceil(products.length / BATCH_SIZE),
          productsSoFar: allSelectedProducts.length,
          titlesSoFar: allTitleObjs.length,
        });
      }
    } catch (batchErr) {
      warn(`  ⚠️ 第 ${Math.floor(i/BATCH_SIZE) + 1} 批处理失败:`, batchErr.message);
      // 继续处理下一批
    }
  }
  
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
      // 构造回退标题：从原标题和淘宝同行标题中提取关键词
      shopTitle = constructFallbackTitle(blueOceanWord, p.title || '', taobaoTitles || [], maxLength);
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

  // 返回最终结构
  return {
    coreWord,
    blueOceanWord,
    modifiers,
    products: enriched,
    filteredCount: products.length,
    titles: mappedTitles
  };
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
      return {
        coreWord,
        blueOceanWord,
        modifiers,
        products: enriched,
        filteredCount: products.length,
        titles: mappedTitles
      };
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
      return {
        coreWord,
        blueOceanWord,
        modifiers,
        products: simple,
        filteredCount: products.length,
        titles: []
      };
    }
  }
}

module.exports = { run };
