const GLMClient = require('./glm-client');

/**
 * 从用户输入提取核心词和带刚性分类的修饰词
 * @param {string} input - 用户输入
 * @returns {Promise<{
 *   coreWord: string,
 *   modifiers: Array<{word: string, rigidity: 'rigid'|'optional'}>
 * }>}>
 */
async function extractCoreAndModifiers(input) {
  const apiKey = process.env.GLM_API_KEY;
  if (!apiKey) {
    throw new Error('环境变量 GLM_API_KEY 未设置');
  }

  const apiBase = process.env.GLM_API_BASE;
  const client = new GLMClient({ apiKey, apiBase });

  try {
    return await client.extractCoreAndModifiers(input);
  } catch (error) {
    console.warn(`⚠️  GLM API 调用失败，使用降级提取: ${error.message}`);
    return fallbackExtract(input);
  }
}

/**
 * 降级提取（当 GLM API 失败时使用简单规则）
 * @param {string} input - 用户输入
 * @returns {{
 *   coreWord: string,
 *   modifiers: Array<{word: string, rigidity: 'rigid'|'optional'}>
 * }}
 */
function fallbackExtract(input) {
  if (input == null || typeof input !== 'string') {
    return { coreWord: String(input), modifiers: [] };
  }
  const words = input.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return {
      coreWord: input,
      modifiers: []
    };
  }

  // 简单规则：最后一个词作为核心词，其余作为修饰词
  const coreWord = words.pop();

  // 判断刚性的简单规则
  const rigidPattern = /纯银|合金|纯棉|羊毛|真丝|真皮|不锈钢|黄铜|金色|银色|黑色|白色|红色|蓝色|女|男|女款|男款|XL|L|M|S|加大|长款|短款|中长款/;
  const modifiers = words.map(word => {
    const rigidity = rigidPattern.test(word) ? 'rigid' : 'optional';
    return { word, rigidity };
  });

  return {
    coreWord,
    modifiers
  };
}

module.exports = { extractCoreAndModifiers, fallbackExtract };
