const { postProcessTitle, constructFallbackTitle } = require('./title-utils');
const { createLLMClient } = require('../../../core/llm');

/**
 * 判断两个标题是否高度相似
 * 当字符差异数 < 标题最大长度的30% 时视为重复
 */
function isSimilar(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return true;
  const threshold = Math.max(2, Math.ceil(maxLen * 0.3));
  let diff = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) diff++;
  }
  return diff < threshold;
}

/**
 * 基于相似度去重，保留第一个不重复的标题
 */
function dedupeTitles(titles) {
  const result = [];
  for (const title of titles) {
    if (title && !result.some(existing => isSimilar(title, existing))) {
      result.push(title);
    }
  }
  return result;
}

/**
 * 使用 GLM 生成中文标题，包含降级兜底逻辑。
 * 注：当前实现不进行中文分词，直接拼接、过滤和去重。
 *
 * @param {string} blueOceanWord 蓝海词（用户原始输入，标题必须以此开头）
 * @param {string} coreWord 核心词
 * @param {Array<{word: string, rigidity: 'rigid'|'optional'}>} modifiers 修饰词列表
 * @param {string[]} peerTitles 淘宝同行标题（用于上下文/引导）
 * @param {Array<object>} products 1688 商品列表（用于 GLM 的上下文参考）
 * @param {number} [maxLength=60] 最大标题长度（字符数）
 * @returns {Promise<string[]>} 3-5 条候选标题
 */
async function generateTitles(blueOceanWord, coreWord, modifiers = [], peerTitles = [], products = [], maxLength = 60, minLength = 52) {
  // GLM 客户端实例，API KEY 等由环境变量提供
  const glmClient = createLLMClient();

  // 尝试通过 GLM 生成标题
  try {
    const glmTitles = await glmClient.generateTitles({
      blueOceanWord,
      coreWord,
      modifiers,
      peerTitles,
      products,
      maxLength
    });

    // 使用统一后处理管线：移除违禁词 → 清理标点 → 蓝海词前置 → 长度归一化 → 去空格
    const processedTitles = glmTitles
      .map((title, idx) => postProcessTitle(title, blueOceanWord, minLength, maxLength)
        || constructFallbackTitle(blueOceanWord, products[idx]?.title || title, peerTitles, maxLength, minLength))
      .filter(Boolean);
    const unique = dedupeTitles(processedTitles);
    // 返回最多 5 条
    return unique.slice(0, 5);
  } catch (err) {
    // 降级策略：使用标题兜底生成器（如果可用）
    console.warn('GLM generateTitles 调用失败，执行降级方案：', err && err.message ? err.message : err);
    // 优先使用 constructFallbackTitle，基于 1688 第一个商品的标题以及同行标题
    const originalTitle = Array.isArray(products) && products.length > 0 ? products[0].title : '';
    const taobaoTitles = Array.isArray(peerTitles) ? peerTitles : [];
    const fallback = constructFallbackTitle(blueOceanWord, originalTitle || '', taobaoTitles, maxLength);
    return fallback ? [fallback] : [];
  }
}

module.exports = { generateTitles, isSimilar, dedupeTitles };
