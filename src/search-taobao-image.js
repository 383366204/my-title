const { execSync, exec, spawnSync, spawn } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const fs = require('fs');
const path = require('path');
const os = require('os');

const { TAOBAO_NATIVE_PATH, isTaobaoNativeInstalled, toWindowsPath, launchTaobaoDesktop } = require('./taobao-utils');

/**
 * 主入口：对一批1688商品逐一执行以图搜图
 * @param {Array<{id:string, url:string, title:string}>} products - 1688商品列表
 * @param {object} options - 配置选项
 * @returns {Promise<Array<{productId:string, peerTitles:string[], priceRange:{min:number,max:number}, hasMatch:boolean}>>}
 */
async function searchPeerTitlesByImage(products, options = {}) {
  const { coreWord, concurrency = 2, intervalMs = 4000, timeout = 30000 } = options;

  // 记录开始时间
  const startTime = Date.now();
  console.log(`\n🖼️  开始以图搜图任务`);
  console.log(`   总商品数: ${products.length}`);
  console.log(`   并发数: ${concurrency}, 批次间隔: ${intervalMs}ms, 超时: ${timeout}ms`);

  // 过滤无图片URL的商品
  const validProducts = [];
  const skippedProducts = [];

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    // 验证商品是否有有效的图片URL
    if (!p.url || !p.url.startsWith('http')) {
      skippedProducts.push({ index: i, product: p, reason: !p.url ? '无图片URL' : 'URL不以http开头' });
    } else {
      validProducts.push({ index: i, product: p });
    }
  }

  // 记录跳过数量日志
  if (skippedProducts.length > 0) {
    console.log(`\n⚠️  跳过 ${skippedProducts.length} 个无效商品（无有效图片URL）：`);
    skippedProducts.forEach(({ index, product, reason }) => {
      console.log(`   [${index + 1}] ID:${product.id || 'unknown'} - ${reason}`);
    });
  }

  console.log(`\n✅ 有效商品: ${validProducts.length}/${products.length}`);

  // 如果没有有效商品，直接返回空结果
  if (validProducts.length === 0) {
    const emptyResults = products.map(p => ({
      productId: p.id,
      peerTitles: [],
      priceRange: { min: null, max: null },
      hasMatch: false
    }));
    console.log('⚠️  无有效商品可处理，返回空结果');
    return emptyResults;
  }

  // 只启动一次淘宝桌面版
  console.log('\n🚀 启动淘宝桌面版...');
  const launched = await launchTaobaoDesktop();

  if (!launched) {
    console.warn('⚠️  淘宝桌面版启动失败，返回空结果');
    const emptyResults = products.map(p => ({
      productId: p.id,
      peerTitles: [],
      priceRange: { min: null, max: null },
      hasMatch: false
    }));
    return emptyResults;
  }

  // 等待桌面版就绪（5000ms）
  console.log('⏳ 等待淘宝桌面版准备就绪...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  console.log('✅ 淘宝桌面版准备就绪，开始处理图片搜索\n');

  // 创建结果数组（最终返回，与输入 products 长度一致）
  const finalResults = new Array(products.length);

  // 对跳过的商品填充默认结果
  skippedProducts.forEach(({ index, product }) => {
    finalResults[index] = {
      productId: product.id,
      peerTitles: [],
      priceRange: { min: null, max: null },
      hasMatch: false
    };
  });

  // 准备要处理的有效商品列表
  const itemsToProcess = validProducts.map(({ index, product }) => ({
    ...product,
    originalIndex: index
  }));

  // 定义 handler：对单个商品执行图片搜索
  async function handleItem(item, handlerIndex) {
    // imageSearchSingle 已改为异步，确保返回 Promise 并在这里等待结果
    let result = await imageSearchSingle(item.url, item.id, { timeout });

    // 失败重试：无匹配结果时等 2s 重试 1 次
    if (!result.hasMatch && (!result.peerTitles || result.peerTitles.length === 0)) {
      console.log(`🔄 [Worker-${handlerIndex}] 首次失败，2s 后重试...`);
      await new Promise(r => setTimeout(r, 2000));
      result = await imageSearchSingle(item.url, item.id, { timeout: 45000 }); // 更长超时
    }

    // 保存原始索引以便回填结果
    result.originalIndex = item.originalIndex;
    return result;
  }

  // 调用 withRateLimit 处理所有有效商品
  const processedResults = await withRateLimit(itemsToProcess, handleItem, concurrency, intervalMs);

  // 将处理结果回填到最终数组的正确位置
  processedResults.forEach((result, idx) => {
    const originalIndex = itemsToProcess[idx].originalIndex;
    finalResults[originalIndex] = result;
  });

  // 收集所有同行标题进行清洗
  let taobaoTitles = finalResults
    .filter(r => r && r.hasMatch && Array.isArray(r.peerTitles))
    .flatMap(r => r.peerTitles);

  let cleanedTitles = null;
  let originalCount = taobaoTitles.length;
  let filteredCount = originalCount;

  if (coreWord && taobaoTitles.length > 0) {
    try {
      cleanedTitles = await cleanPeerTitles(
        taobaoTitles,
        coreWord,
        options.blueOceanWord || '',
        null
      );
      filteredCount = cleanedTitles.length;
      console.log(`🧹 标题清洗: ${originalCount} 条 → 过滤后 ${filteredCount} 条 → 精选 ${Math.min(filteredCount, 50)} 条`);

      finalResults.forEach(r => {
        if (r && r.hasMatch) {
          r.peerTitles = cleanedTitles;
        }
      });
    } catch (e) {
      console.warn('⚠️ 标题清洗失败，使用原始标题:', e.message);
    }
  }

  // 计算统计数据
  const endTime = Date.now();
  const totalTime = endTime - startTime;
  const matchedCount = finalResults.filter(r => r && r.hasMatch).length;
  const peerTitlesTotal = finalResults.reduce((sum, r) => sum + (r && r.peerTitles ? r.peerTitles.length : 0), 0);

  // 打印统计日志
  console.log('\n📊 以图搜图任务统计：');
  console.log(`   总商品数: ${products.length}`);
  console.log(`   有效商品: ${validProducts.length}`);
  console.log(`   跳过商品: ${skippedProducts.length}`);
  console.log(`   匹配成功: ${matchedCount}`);
  console.log(`   获取同行标题: ${peerTitlesTotal} 条`);
  console.log(`   总耗时: ${(totalTime / 1000).toFixed(1)}s`);
  console.log(`   平均耗时/商品: ${(totalTime / validProducts.length / 1000).toFixed(1)}s\n`);

  return finalResults;
}

/**
 * 对单个商品执行一次 image_search 调用
 * @param {string} imageUrl - 1688商品主图CDN URL
 * @param {string} productId - 商品ID（用于关联结果）
 * @param {object} options - 配置
 * @returns {{productId:string, peerTitles:string[], priceRange:{min:number|null,max:number|null}, hasMatch:boolean}}
 */
async function imageSearchSingle(imageUrl, productId, options = {}) {
  const startTime = Date.now();
  console.log(`\n🖼️ [${productId}] 开始以图搜图`);
  console.log(`   图片URL: ${imageUrl.substring(0, 60)}...`);
  
  // 单例锁：等待前一个搜索完成
  while (isSearching) {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  isSearching = true;
  
  try {
    // 1) 验证 imageUrl 非空且是有效 URL
    if (!imageUrl || typeof imageUrl !== 'string') {
      console.warn(`⚠️ [${productId}] image_search: imageUrl 为空或非字符串`);
      return { productId, hasMatch: false, peerTitles: [], priceRange: { min: null, max: null } };
    }
    try {
      new URL(imageUrl);
    } catch (e) {
      console.warn(`⚠️ [${productId}] image_search: imageUrl 非有效 URL`);
      return { productId, hasMatch: false, peerTitles: [], priceRange: { min: null, max: null } };
    }

    // 2) 构建 CLI 参数并执行（使用 --request 文件模式完全绕过 shell 转义问题）
    const timeout = options.timeout || 30000;
    // 使用 Windows 可访问的共享目录（C:\Windows\Temp）而非 WSL 的 /tmp
    const sharedTmpDir = '/mnt/c/Windows/Temp';
    const outFile = path.join(sharedTmpDir, `taobao-image-${productId}-${Date.now()}.json`);
    const reqFile = path.join(sharedTmpDir, `taobao-image-req-${productId}-${Date.now()}.json`);
    const winPath = toWindowsPath(TAOBAO_NATIVE_PATH);

    // 将参数写入文件，完全避免 shell 转义问题
    const requestPayload = {
      tool: 'image_search',
      arguments: { imagePath: imageUrl, sourceApp: 'my-title' }
    };
    fs.writeFileSync(reqFile, JSON.stringify(requestPayload), 'utf8');

    // 将请求文件路径转换为 Windows 格式（供 CLI 读取）
    const winReqFile = toWindowsPath(reqFile);
    const winOutFile = toWindowsPath(outFile);
    // 3) 使用异步方式执行 baton 脚本，避免阻塞
    let stdout = '';
    let batFile = null;
    return new Promise((resolve) => {
      // 使用 .bat 包装器在 Windows 原生上下文中执行
      batFile = path.join(sharedTmpDir, `taobao-img-${productId}-${Date.now()}.bat`);
      const winBatFile = toWindowsPath(batFile);
      const escPath = p => p.replace(/\\/g, '\\\\');
      const batContent = [
        '@echo off',
        `chcp 65001 >nul 2>&1`,
        `"${escPath(winPath)}" --request "${escPath(winReqFile)}" -o "${escPath(winOutFile)}"`,
      ].join('\r\n');
      fs.writeFileSync(batFile, batContent, 'utf8');

      const child = spawn('cmd.exe', ['/c', winBatFile], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let timer;
      let killed = false;

      child.stdout.on('data', data => { stdout += data; });
      child.stderr.on('data', data => { /* 可忽略或 log */ });

      timer = setTimeout(() => {
        killed = true;
        const elapsed = Date.now() - startTime;
        console.warn(`⏱️  [${productId}] 超时! (${elapsed}ms > ${timeout}ms)，强制终止进程 PID=${child.pid}`);
        try {
          // 尝试强制结束进程
          child.kill();
        } catch (_) {}
        try {
          execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'ignore' });
          console.log(`🔪 [${productId}] taskkill 执行成功`);
        } catch (e) {
          console.warn(`⚠️ [${productId}] taskkill 失败:`, e.message);
        }
        // 直接返回无匹配的结果
        resolve({ productId, hasMatch: false, peerTitles: [], priceRange: { min: null, max: null }, timeout: true });
      }, timeout);

      child.on('close', (code) => {
        clearTimeout(timer);
        if (killed) return;
        
        const elapsed = Date.now() - startTime;

        // 3) 读取输出文件并解析 JSON，支持 stdout 回退
        let data = null;
        try {
          const text = fs.readFileSync(outFile, 'utf8');
          data = JSON.parse(text);
        } catch (e) {
          // 尝试从 stdout 回退提取 JSON 行
          try {
            const line = (stdout || '').split('\n').find(l => l && l.trim().startsWith('{'));
            if (line) data = JSON.parse(line);
          } catch (e2) {
            data = null;
          }
        } finally {
          // 4) 清理临时文件
          try {
            if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
          } catch (_) {}
        }

        // 5) 解析嵌套结构并扁平化
        if (!data || typeof data !== 'object') {
          // 清理 reqFile 与 batFile
          try { if (fs.existsSync(reqFile)) fs.unlinkSync(reqFile); } catch (_) {}
          try { if (batFile && fs.existsSync(batFile)) fs.unlinkSync(batFile); } catch (_) {}
          resolve({ productId, hasMatch: false, peerTitles: [], priceRange: { min: null, max: null } });
          return;
        }

        const categories = Array.isArray(data.result?.categories) ? data.result.categories : [];
        const allProducts = categories.flatMap(cat => Array.isArray(cat.products) ? cat.products : []);
        const peerTitles = allProducts
          .map(p => (p && p.title) ? p.title : '')
          .filter(t => typeof t === 'string' && t.length > 0);

        // 6) 价格区间提取
        let min = null;
        let max = null;
        allProducts.forEach(p => {
          const priceVal = parseFloat(p && p.price ? p.price : '');
          if (!isNaN(priceVal)) {
            if (min === null || priceVal < min) min = priceVal;
            if (max === null || priceVal > max) max = priceVal;
          }
        });

        const priceRange = {
          min: isNaN(min) ? null : min,
          max: isNaN(max) ? null : max
        };
        const hasMatch = peerTitles.length > 0;

        // 清理 reqFile 与 batFile
        try { if (fs.existsSync(reqFile)) fs.unlinkSync(reqFile); } catch (_) {}
        try { if (batFile && fs.existsSync(batFile)) fs.unlinkSync(batFile); } catch (_) {}

        resolve({ productId, peerTitles, priceRange, hasMatch });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        // 清理临时文件
        try { if (fs.existsSync(reqFile)) fs.unlinkSync(reqFile); } catch (_) {}
        try { if (batFile && fs.existsSync(batFile)) fs.unlinkSync(batFile); } catch (_) {}
        try { if (fs.existsSync(outFile)) fs.unlinkSync(outFile); } catch (_) {}
        resolve({ productId, hasMatch: false, peerTitles: [], priceRange: { min: null, max: null } });
      });
    });
  } finally {
    isSearching = false;
  }
}

/**
 * 并发控制器：限制同时进行的 image_search 数量
 * @param {Array} items - 待处理项
 * @param {Function} handler - 每项的处理函数
 * @param {number} concurrency - 最大并发数
 * @param {number} intervalMs - 批次间隔毫秒数
 * @returns {Promise<Array>}
 */
async function withRateLimit(items, handler, concurrency = 2, intervalMs = 4000) {
  // 初始化结果数组（保持与输入顺序一致）
  const results = new Array(items.length);
  // 共享索引，用于 worker 协作消费队列
  let currentIndex = 0;
  let completedCount = 0;
  let batchCount = 0;

  // 延迟函数：等待指定毫秒数
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // 单个 worker：循环从队列取任务并执行
  async function worker(workerId) {
    while (true) {
      // 获取当前要处理的索引（原子操作）
      const index = currentIndex;
      if (index >= items.length) {
        break; // 队列已空，worker 退出
      }
      currentIndex++;

      const item = items[index];
      const batchNumber = Math.floor(index / concurrency) + 1;

      // 记录批次开始（只在批次第一个任务时记录）
      if (index % concurrency === 0) {
        batchCount++;
        console.log(`📦 [Worker-${workerId}] 开始第 ${batchNumber} 批（索引 ${index}-${Math.min(index + concurrency - 1, items.length - 1)}）`);
      }

      // 执行任务并捕获错误
      try {
        console.log(`🔍 [Worker-${workerId}] 处理第 ${index + 1}/${items.length} 项: ${item.id || 'unknown'}`);
        const startTime = Date.now();
        results[index] = await handler(item, index);
        const elapsed = Date.now() - startTime;
        console.log(`✅ [Worker-${workerId}] 第 ${index + 1} 项完成，耗时 ${elapsed}ms`);
      } catch (err) {
        console.warn(`⚠️ 图片搜索第 ${index + 1} 项失败:`, err.message);
        // 返回默认值，不影响其他 worker
        results[index] = {
          productId: item.id,
          peerTitles: [],
          priceRange: { min: null, max: null },
          hasMatch: false
        };
      }

      completedCount++;

      // 每完成 concurrency 个任务后等待 intervalMs
      if (completedCount % concurrency === 0 && completedCount < items.length) {
        console.log(`⏳ 批次完成，等待 ${intervalMs}ms... (${completedCount}/${items.length})`);
        await delay(intervalMs);
      }
    }
  }

  // 启动 concurrency 个 worker 并行处理
  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker(i + 1));
  }

  // 等待所有 worker 完成
  await Promise.all(workers);

  return results;
}

/**
 * 检测以图搜图功能是否可用
 * @returns {boolean} 是否可用
 */
function isImageSearchAvailable() {
  return isTaobaoNativeInstalled();
}

// ============================================================
// 清洗管道函数
// ============================================================

/**
 * 品类过滤：从标题列表中排除指定品类词
 * @param {string[]} titles - 原始标题列表
 * @param {string[]} excludeCategories - 要排除的品类词列表
 * @returns {string[]} 过滤后的标题列表
 */
function filterByCategory(titles, excludeCategories) {
  if (!excludeCategories || excludeCategories.length === 0) return titles;
  return titles.filter(title =>
    !excludeCategories.some(word => title.includes(word))
  );
}

/**
 * 指纹去重：标准化后取前 20 字符作为指纹去重
 * @param {string[]} titles - 原始标题列表
 * @returns {string[]} 去重后的标题列表
 */
function dedupeTitles(titles) {
  const seen = new Set();
  return titles.filter(title => {
    // 标准化：去空格、统一标点、小写
    const normalized = title
      .replace(/\s+/g, '')
      .replace(/[，。！？]/g, '')
      .toLowerCase();
    // 取前 20 字符作为指纹
    const fingerprint = normalized.slice(0, 20);
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

/**
 * 计算标题与蓝海词/核心词的相关性得分
 * @param {string} title - 标题
 * @param {string} blueOceanWord - 蓝海词
 * @param {string} coreWord - 核心词
 * @returns {number} 相关性得分
 */
function calculateRelevanceScore(title, blueOceanWord, coreWord) {
  let score = 0;
  // 包含核心词 +10
  if (title.includes(coreWord)) score += 10;
  // 标题长度适中 (15-40 字符) +5
  if (title.length >= 15 && title.length <= 40) score += 5;
  // 不含降级词 +3
  const downgradeWords = ['仿', '假', '沙金', '越南'];
  if (!downgradeWords.some(w => title.includes(w))) score += 3;
  // 包含蓝海词中的词 +2 每个（简单实现：检查蓝海词的分词）
  const blueWords = blueOceanWord.split(/\s+/);
  blueWords.forEach(word => {
    if (word.length > 1 && title.includes(word)) score += 2;
  });
  return score;
}

/**
 * 精选 Top-N 标题（按相关性得分降序）
 * @param {string[]} titles - 标题列表
 * @param {string} blueOceanWord - 蓝海词
 * @param {string} coreWord - 核心词
 * @param {number} maxCount - 最大返回数量，默认 50
 * @returns {string[]} 精选后的标题列表
 */
function selectTopTitles(titles, blueOceanWord, coreWord, maxCount = 50) {
  const scored = titles.map(title => ({
    title,
    score: calculateRelevanceScore(title, blueOceanWord, coreWord)
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxCount).map(item => item.title);
}

/**
 * 清洗管道编排：过滤 → 去重 → 精选
 * @param {string[]} rawTitles - 原始标题列表
 * @param {string} coreWord - 核心词
 * @param {string} blueOceanWord - 蓝海词
 * @param {object} glmClient - GLM 客户端（可选，用于 AI 品类过滤）
 * @returns {Promise<string[]>} 清洗后的标题列表
 */
async function cleanPeerTitles(rawTitles, coreWord, blueOceanWord, glmClient) {
  // 硬编码兜底排除词（当 GLM 不可用时使用）
  const fallbackExcludes = ['耳环', '耳钉', '耳饰', '手链', '手镯', '戒指', '脚链', '发饰', '胸针'];

  let excludeCategories = fallbackExcludes;

  // 如果提供了 glmClient，尝试获取 AI 生成的品类词
  if (glmClient && typeof glmClient.generateCategoryFilters === 'function') {
    try {
      const filters = await glmClient.generateCategoryFilters(coreWord, blueOceanWord);
      if (filters && filters.excludeCategories) {
        excludeCategories = filters.excludeCategories;
      }
    } catch (e) {
      console.warn('⚠️ GLM 品类过滤失败，使用兜底词表:', e.message);
    }
  }

  // 管道：过滤 → 去重 → 精选
  const filtered = filterByCategory(rawTitles, excludeCategories);
  const deduped = dedupeTitles(filtered);
  const selected = selectTopTitles(deduped, blueOceanWord, coreWord, 50);

  console.log(`🧹 清洗完成: ${rawTitles.length} → ${filtered.length} → ${deduped.length} → ${selected.length}`);

  return selected;
}

module.exports = {
  searchPeerTitlesByImage,
  isImageSearchAvailable,
  filterByCategory,
  dedupeTitles,
  calculateRelevanceScore,
  selectTopTitles,
  cleanPeerTitles
};
