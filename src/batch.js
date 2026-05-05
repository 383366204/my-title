'use strict';

const { extractKeywords } = require('./extract-core');
const { run } = require('./index');

// 批量关键词最大数量
const BATCH_MAX_KEYWORDS = 20;

// 核心词搜索间隔（毫秒）
const BATCH_SEARCH_INTERVAL = parseInt(process.env.API_BATCH_SEARCH_INTERVAL, 10) || 3000;

/**
 * 批量蓝海词选品编排器
 * 一次处理多个关键词，自动去重核心词共享 1688 搜索结果
 * @param {string[]} keywords - 蓝海词数组（1-20个）
 * @param {object} [options] - 配置选项
 * @param {number} [options.maxLength=60] - 标题最大长度
 * @param {boolean} [options.silent=true] - 静默模式
 * @param {Function} [options.onProgress] - 进度回调 ({ completed, total, currentKeyword })
 * @param {AbortSignal} [options.signal] - 取消信号
 * @returns {Promise<{ok: boolean, results: Array, failed: Array, summary: object}>}
 */
async function batchRun(keywords, options = {}) {
  const { maxLength = 60, silent = true, onProgress, signal } = options;

  // 输入验证
  if (!Array.isArray(keywords) || keywords.length === 0) {
    throw new Error('keywords 必须是非空数组');
  }
  if (keywords.length > BATCH_MAX_KEYWORDS) {
    throw new Error(`批量关键词最多 ${BATCH_MAX_KEYWORDS} 个，当前 ${keywords.length} 个`);
  }

  // 步骤1：提取所有关键词的核心词
  const keywordCoreMap = new Map(); // keyword -> { coreWord, modifiers }
  const coreWordGroups = new Map(); // coreWord -> [keyword1, keyword2, ...]

  for (const keyword of keywords) {
    try {
      const extracted = await extractKeywords('keyword', { data: keyword });
      const coreWord = extracted.coreWord || keyword;
      const modifiers = extracted.modifiers || [];
      keywordCoreMap.set(keyword, { coreWord, modifiers });

      if (!coreWordGroups.has(coreWord)) {
        coreWordGroups.set(coreWord, []);
      }
      coreWordGroups.get(coreWord).push(keyword);
    } catch (err) {
      // 核心词提取失败，使用关键词本身作为核心词
      keywordCoreMap.set(keyword, { coreWord: keyword, modifiers: [] });
      if (!coreWordGroups.has(keyword)) {
        coreWordGroups.set(keyword, []);
      }
      coreWordGroups.get(keyword).push(keyword);
    }
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

    const { coreWord } = keywordCoreMap.get(keyword);

    // 如果是同核心词的关键词，在搜索间隔后处理
    // run() 内部有 ResultCache，相同参数会命中缓存
    if (processedCoreWords.has(coreWord)) {
      // 同核心词的不同修饰词组合 — 可能不走缓存（因为参数不同）
      // 但 1688 搜索结果会被 searchAll 缓存
    }

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

      // 调用 run() 处理单个关键词
      const result = await run(keyword, {
        maxLength,
        silent,
        signal,
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

module.exports = { batchRun, BATCH_MAX_KEYWORDS };