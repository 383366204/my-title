const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Windows 路径（WSL2 环境）— 与 search-taobao.js 保持完全一致
const TAOBAO_NATIVE_PATH = '/mnt/c/Users/38336/AppData/Local/Programs/taobao/bin/taobao-native.cmd';

/**
 * 检测 taobao-native CLI 是否已安装
 * @returns {boolean} 是否已安装
 */
function isTaobaoNativeInstalled() {
  try {
    // 检查 CLI 文件是否存在
    fs.accessSync(TAOBAO_NATIVE_PATH, fs.constants.F_OK);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 将 WSL2 路径转换为 Windows 路径
 * @param {string} wslPath - WSL2 路径
 * @returns {string} Windows 路径
 */
function toWindowsPath(wslPath) {
  return wslPath.replace('/mnt/c/', 'C:\\').replace(/\//g, '\\');
}

/**
 * 启动淘宝桌面版
 * @returns {boolean} 是否成功启动
 */
function launchTaobaoDesktop() {
  try {
    console.log('🚀 正在启动淘宝桌面版...');
    const winPath = toWindowsPath(TAOBAO_NATIVE_PATH);
    execSync(
      `cmd.exe /c "${winPath}" launch`,
      { stdio: 'ignore', timeout: 10000 }
    );
    console.log('✅ 淘宝桌面版已启动');
    return true;
  } catch (error) {
    console.warn('⚠️  启动淘宝桌面版失败:', error.message);
    return false;
  }
}

/**
 * 主入口：对一批1688商品逐一执行以图搜图
 * @param {Array<{id:string, url:string, title:string}>} products - 1688商品列表
 * @param {object} options - 配置选项
 * @returns {Promise<Array<{productId:string, peerTitles:string[], priceRange:{min:number,max:number}, hasMatch:boolean}>>}
 */
async function searchPeerTitlesByImage(products, options = {}) {
  const { concurrency = 2, intervalMs = 4000, timeout = 30000 } = options;

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
  const launched = launchTaobaoDesktop();

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
    const result = imageSearchSingle(item.url, item.id, { timeout });
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
function imageSearchSingle(imageUrl, productId, options = {}) {
  // 1) 验证 imageUrl 非空且是有效 URL
  if (!imageUrl || typeof imageUrl !== 'string') {
    console.warn('⚠️ image_search: imageUrl 为空或非字符串');
    return { productId, hasMatch: false, peerTitles: [], priceRange: { min: null, max: null } };
  }
  try {
    new URL(imageUrl);
  } catch (e) {
    console.warn('⚠️ image_search: imageUrl 非有效 URL');
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

  let stdout = '';
  try {
    const result = spawnSync('cmd.exe', ['/c', winPath, '--request', winReqFile, '-o', winOutFile], {
      encoding: 'utf8',
      timeout: timeout,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    stdout = result.stdout || '';
    if (result.error || result.status !== 0) {
      throw new Error(result.stderr || result.error?.message || `exit code ${result.status}`);
    }
  } catch (err) {
    console.warn('⚠️ image_search 调用失败，API/CLI 异常:', err && err.message ? err.message : err);
    return { productId, hasMatch: false, peerTitles: [], priceRange: { min: null, max: null } };
  } finally {
    // 清理请求文件
    try {
      if (fs.existsSync(reqFile)) {
        fs.unlinkSync(reqFile);
      }
    } catch (_cleanupErr) {
      // 忽略清理错误
    }
  }

  // 3) 读取输出文件并解析 JSON，支持 stdout 回退
  let data = null;
  try {
    const text = fs.readFileSync(outFile, 'utf8');
    data = JSON.parse(text);
  } catch (e) {
    // 尝试从 stdout 回退提取 JSON 行
    try {
      const line = (stdout || '').split('\n').find(l => l && l.trim().startsWith('{'));
      if (line) {
        data = JSON.parse(line);
      }
    } catch (e2) {
      data = null;
    }
  } finally {
    // 4) 清理临时文件
    try {
      if (fs.existsSync(outFile)) {
        fs.unlinkSync(outFile);
      }
    } catch (_cleanupErr) {
      // 忽略清理错误
    }
  }

  // 5) 解析嵌套结构并扁平化
  if (!data || typeof data !== 'object') {
    return { productId, hasMatch: false, peerTitles: [], priceRange: { min: null, max: null } };
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

  return { productId, peerTitles, priceRange, hasMatch };
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

module.exports = {
  searchPeerTitlesByImage,
  isImageSearchAvailable
};
