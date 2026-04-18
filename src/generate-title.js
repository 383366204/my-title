const { removeBannedWords } = require('./banned-words');
const GLMClient = require('./glm-client');

/**
 * 使用 GLM 生成中文标题，包含降级兜底逻辑。
 * 注：当前实现不进行中文分词，直接拼接、过滤和去重。
 *
 * @param {string} coreWord 核心词
 * @param {Array<{word: string, rigidity: 'rigid'|'optional'}>} modifiers 修饰词列表
 * @param {string[]} peerTitles 淘宝同行标题（用于上下文/引导）
 * @param {Array<object>} products 1688 商品列表（用于 GLM 的上下文参考）
 * @param {number} [maxLength=60] 最大标题长度（字符数）
 * @returns {Promise<string[]>} 3-5 条候选标题
 */
async function generateTitles(coreWord, modifiers = [], peerTitles = [], products = [], maxLength = 60) {
  // GLM 客户端实例，API KEY 等由环境变量提供
  const glmClient = new GLMClient({
    apiKey: process.env.GLM_API_KEY,
    apiBase: process.env.GLM_API_BASE,
    model: process.env.GLM_MODEL
  });

  // 尝试通过 GLM 生成标题
  try {
    const glmTitles = await glmClient.generateTitles({
      coreWord,
      modifiers,
      peerTitles,
      products,
      maxLength
    });
    // 过滤违禁词并去重
    const filtered = glmTitles
      .map(t => removeBannedWords(t))
      .filter(t => typeof t === 'string' && t.trim().length > 0 && t.length >= 10);
    const unique = Array.from(new Set(filtered));
    // 返回最多 5 条，符合 3-5 的要求
    return unique.slice(0, 5);
  } catch (err) {
    // 降级策略：基于核心词 + 所有 rigid 修饰词简单拼接，去除空格分词
    console.warn('GLM generateTitles 调用失败，执行降级方案：', err && err.message ? err.message : err);
    const rigidWords = (modifiers || [])
      .filter(m => m && m.rigidity === 'rigid')
      .map(m => m.word)
      .filter(Boolean);
    const suffix = rigidWords.length ? rigidWords.join('') : '';
    let degraded = coreWord ? coreWord + suffix : suffix;
    if (degraded.length > maxLength) degraded = degraded.substring(0, maxLength);
    return degraded.length > 0 ? [degraded] : [];
  }
}

module.exports = { generateTitles };
