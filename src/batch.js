'use strict';

const { run } = require('./index');

// 批量关键词最大数量
const BATCH_MAX_KEYWORDS = 20;

// 核心词搜索间隔（毫秒）
const BATCH_SEARCH_INTERVAL = parseInt(process.env.API_BATCH_SEARCH_INTERVAL, 10) || 3000;

// 默认每个关键词处理的商品数量上限（避免 GLM 生成过慢）
const DEFAULT_BATCH_LIMIT = parseInt(process.env.BATCH_DEFAULT_LIMIT, 10) || 5;

/**
 * 轻量级本地核心词提取（仅用于分组，不调用 GLM）
 * 取关键词中最后一个有意义的词作为临时核心词
 * @param {string} keyword - 用户输入的关键词
 * @returns {string} 临时核心词（用于分组去重）
 */
function lightExtractCoreWord(keyword) {
  if (!keyword || typeof keyword !== 'string') return keyword || '';
  // 常见品类词（优先匹配）
  const categoryPattern = /(项链|手链|耳环|戒指|手镯|连衣裙|T恤|衬衫|外套|裤子|鞋子|包包|帽子|围巾|腰带|袜子|内衣|泳衣|防晒|面膜|眼影|口红|面霜|洗面奶|身体乳|香水|收纳|摆件|挂件|贴纸|手机壳|数据线|充电宝|耳机|键盘|鼠标|垫子|台灯|风扇|加湿器|保温杯|水杯|雨伞|背包|行李箱|帐篷|睡袋|野餐垫)/;
  const match = keyword.match(categoryPattern);
  if (match) return match[1];
  // 兜底：取最后一个 2+ 字符的中文词
  const words = keyword.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  return words.length > 0 ? words[words.length - 1] : keyword;
}

/**
 * 批量蓝海词选品编排器
 * 一次处理多个关键词，自动去重核心词共享 1688 搜索结果
 * @param {string[]} keywords - 蓝海词数组（1-20个）
 * @param {object} [options] - 配置选项
 * @param {number} [options.maxLength=60] - 标题最大长度
 * @param {boolean} [options.silent=true] - 静默模式
 * @param {Function} [options.onProgress] - 进度回调 ({ completed, total, currentKeyword })
 * @param {AbortSignal} [options.signal] - 取消信号
 * @param {number} [options.limit] - 每个关键词处理的商品数量上限（默认 5）
 * @returns {Promise<{ok: boolean, results: Array, failed: Array, summary: object}>}
 */
async function batchRun(keywords, options = {}) {
  const { maxLength = 60, silent = true, onProgress, signal, sycmAuto = false } = options;

  // 输入验证
  if (!Array.isArray(keywords) || keywords.length === 0) {
    throw new Error('keywords 必须是非空数组');
  }
  if (keywords.length > BATCH_MAX_KEYWORDS) {
    throw new Error(`批量关键词最多 ${BATCH_MAX_KEYWORDS} 个，当前 ${keywords.length} 个`);
  }

  // 步骤1：轻量级核心词分组（不调用 GLM，避免与 run() 内部提取重复）
  const coreWordGroups = new Map(); // coreWord -> [keyword1, keyword2, ...]

  for (const keyword of keywords) {
    const coreWord = lightExtractCoreWord(keyword);
    if (!coreWordGroups.has(coreWord)) {
      coreWordGroups.set(coreWord, []);
    }
    coreWordGroups.get(coreWord).push(keyword);
  }

  // 步骤2：串行处理每个关键词（按核心词去重后处理）
  const results = [];
  const failed = [];
  const processedCoreWords = new Set();
  let completed = 0;
  const total = keywords.length;

  for (const keyword of keywords) {
    // 检查取消信号
    if (signal?.aborted) {
      // 剩余的关键词标记为失败
      const remaining = keywords.slice(completed);
      for (const r of remaining) {
        failed.push({ keyword: r, error: '任务已取消' });
      }
      break;
    }

    const coreWord = lightExtractCoreWord(keyword);

    // 如果是同核心词的关键词，run() 内部 ResultCache 会命中缓存

    try {
      // 进度回调
      if (onProgress) {
        onProgress({ completed, total, currentKeyword: keyword });
      }

      // 核心词搜索间隔（避免 1688 API 限流）
      if (processedCoreWords.size > 0) {
        const jitter = Math.floor(Math.random() * 1000);
        await new Promise(resolve => setTimeout(resolve, BATCH_SEARCH_INTERVAL + jitter));
      }

      // 调用 run() 处理单个关键词（limit 控制商品数，避免 GLM 生成过慢）
      const result = await run(keyword, {
        maxLength,
        silent,
        signal,
        limit: options.limit || DEFAULT_BATCH_LIMIT,
        sycmAuto,
      });

      results.push({
        keyword,
        coreWord,
        titles: result.titles || [],
        products: result.products || [],
        filteredCount: result.filteredCount || 0,
        stats: result.stats || {},
        blueOceanWord: result.blueOceanWord || keyword,
      });

      processedCoreWords.add(coreWord);
    } catch (err) {
      // 限流错误：将当前关键词加入失败列表，继续处理
      if (err.name === 'RateLimitError') {
        failed.push({
          keyword,
          error: err.message,
          cooldownRemainingMs: err.cooldownRemainingMs,
        });
        // 继续处理下一个关键词（限流器会在 Client 层阻止新的 1688 请求）
      } else {
        failed.push({ keyword, error: err.message });
      }
    }

    completed++;
  }

  // 最终进度回调
  if (onProgress) {
    onProgress({ completed: total, total, currentKeyword: null });
  }

  // 步骤3：构建返回结果
  return {
    ok: true,
    results,
    failed,
    summary: {
      total: keywords.length,
      success: results.length,
      failed: failed.length,
      dedupedCoreWords: coreWordGroups.size,
    },
  };
}

module.exports = { batchRun, BATCH_MAX_KEYWORDS, DEFAULT_BATCH_LIMIT };