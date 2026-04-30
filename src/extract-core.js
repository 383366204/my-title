const GLMClient = require('./glm-client');

// 共享的刚性/可选修饰词判断规则（供两个 GLM prompt 复用）
const RIGIDITY_RULES_TEXT = `- 材质相关词（如"纯银"、"纯棉"、"真皮"）→ rigid
- 颜色相关词（如"黑色"、"白色"、"金色"）→ rigid
- 规格尺寸（如"XL"、"加大"、"长款"）→ rigid
- 目标人群（如"女"、"男"、"学生"）→ rigid
- 品类限定词 → rigid（如"猫咪"限定宠物用品、"婴儿"限定婴儿用品、"汽车"限定汽车用品。这些词虽然不是材质/颜色/规格，但不匹配则商品完全错误）
- 风格（如"韩版"、"ins风"、"简约"）→ optional
- 流行词（如"高级感"、"气质"、"百搭"）→ optional
- 时间/季节（如"新款"、"夏季"、"2026"）→ optional`;

/**
 * @deprecated 请使用 extractKeywords('keyword', {data: input}) 替代
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

/**
 * @deprecated 请使用 extractKeywords('peerTitles', {data: peerTitles}) 替代
 * 从同行标题数组中提取核心词、蓝海词和修饰词
 * @param {string[]} peerTitles - 同行标题数组
 * @returns {Promise<{
 *   coreWord: string,
 *   blueOceanWord: string,
 *   modifiers: Array<{word: string, rigidity: 'rigid'|'optional'}>
 * }>}
 */
async function extractCoreFromPeerTitles(peerTitles) {
  const apiKey = process.env.GLM_API_KEY;
  if (!apiKey) {
    throw new Error('环境变量 GLM_API_KEY 未设置');
  }

  const apiBase = process.env.GLM_API_BASE;
  const client = new GLMClient({ apiKey, apiBase });

  try {
    return await client.extractKeywordsFromPeers(peerTitles);
  } catch (error) {
    console.warn(`⚠️  GLM API 调用失败，使用降级提取: ${error.message}`);
    return fallbackExtractFromPeers(peerTitles);
  }
}

/**
 * 降级提取（当 GLM API 失败时使用简单规则分析同行标题）
 * @param {string[]} peerTitles - 同行标题数组
 * @returns {{
 *   coreWord: string,
 *   blueOceanWord: string,
 *   modifiers: Array<{word: string, rigidity: 'rigid'|'optional'}>
 * }}
 */
function fallbackExtractFromPeers(peerTitles) {
  if (!Array.isArray(peerTitles) || peerTitles.length === 0) {
    return {
      coreWord: '',
      blueOceanWord: '',
      modifiers: []
    };
  }

  // 简单中文分词：提取常见电商关键词模式
  const wordFrequency = {};
  const rigidPattern = /纯银|合金|纯棉|羊毛|真丝|真皮|不锈钢|黄铜|金色|银色|黑色|白色|红色|蓝色|女|男|女款|男款|XL|L|M|S|加大|长款|短款|中长款|学生|儿童|成人|人群|材质|颜色|规格|尺寸|925|足银|纯金|镀金/;

  // 常见电商词模式（2-4字符）
  const commonPatterns = [
    /(项链|手链|耳环|戒指|手镯|连衣裙|T恤|衬衫|外套|裤子|鞋子|包包)/,
    /(纯银|纯棉|纯金|真皮|真丝|羊毛|牛仔|雪纺)/,
    /(黑色|白色|红色|蓝色|金色|银色|灰色|粉色)/,
    /(女款|男款|儿童|学生|成人|中老年)/,
    /(新款|时尚|流行|经典|简约|复古|韩版|ins风)/,
    /(加厚|薄款|长袖|短袖|宽松|修身|加大)/,
    /([0-9]+克|[0-9]+cm|[0-9]+mm)/,
  ];

  peerTitles.forEach(title => {
    if (typeof title === 'string') {
      const words = new Set();
      
      // 1. 提取匹配常见模式的词
      commonPatterns.forEach(pattern => {
        const matches = title.match(new RegExp(pattern.source, 'g'));
        if (matches) {
          matches.forEach(match => words.add(match));
        }
      });
      
      // 2. 提取2-4字符的连续中文词（避免单个字符）
      for (let i = 0; i < title.length - 1; i++) {
        for (let len = 2; len <= 4 && i + len <= title.length; len++) {
          const word = title.substring(i, i + len);
          // 只添加看起来像有意义的词（包含常见品类词或修饰词）
          if (rigidPattern.test(word) || word.match(/[项链手链耳环衣裤鞋包]/)) {
            words.add(word);
          }
        }
      }
      
      // 统计词频
      words.forEach(word => {
        wordFrequency[word] = (wordFrequency[word] || 0) + 1;
      });
    }
  });

  // 按频率排序，只保留出现2次以上的词
  const sortedWords = Object.entries(wordFrequency)
    .filter(([word, freq]) => freq >= 2 && word.length >= 2)
    .sort((a, b) => {
      // 先按频率，再按长度（优先长词）
      if (b[1] !== a[1]) return b[1] - a[1];
      return b[0].length - a[0].length;
    })
    .map(entry => entry[0]);

  if (sortedWords.length === 0) {
    // 如果没有高频词，找最长公共子串作为核心词
    const lcs = findLongestCommonSubstring(peerTitles.filter(t => typeof t === 'string'));
    const coreWord = lcs || (peerTitles[0] || '').substring(0, 4);
    return {
      coreWord,
      blueOceanWord: coreWord,
      modifiers: []
    };
  }

  // 选取核心词：最高频且最长的词
  const coreWord = sortedWords[0] || '';

  // 选取蓝海词：核心词 + 下一个高频修饰词（如果有）
  let blueOceanWord = coreWord;
  if (sortedWords.length >= 2) {
    // 找第一个不是核心词子串的词
    const nextWord = sortedWords.find(word => !coreWord.includes(word) && word !== coreWord);
    if (nextWord) {
      blueOceanWord = coreWord + nextWord;
    }
  }

  // 其他高频词作为修饰词，判断刚性
  const modifiers = sortedWords.slice(1).map(word => ({
    word,
    rigidity: rigidPattern.test(word) ? 'rigid' : 'optional'
  }));

  return {
    coreWord,
    blueOceanWord,
    modifiers
  };
}

// 辅助函数：查找字符串数组的最长公共子串
function findLongestCommonSubstring(strings) {
  if (strings.length === 0) return '';
  if (strings.length === 1) return strings[0];
  
  const first = strings[0];
  let longest = '';
  
  for (let i = 0; i < first.length; i++) {
    for (let j = i + 1; j <= first.length; j++) {
      const substr = first.substring(i, j);
      if (substr.length > longest.length && strings.every(s => s.includes(substr))) {
        longest = substr;
      }
    }
  }
  
  return longest;
}

/**
 * 统一关键词提取入口
 * @param {'keyword'|'peerTitles'} source - 输入类型
 * @param {object} options - 配置选项
 * @param {string} [options.data] - source='keyword' 时为用户关键词字符串
 * @param {string[]} [options.data] - source='peerTitles' 时为同行标题数组
 * @returns {Promise<{coreWord: string, blueOceanWord?: string, modifiers: Array<{word: string, rigidity: 'rigid'|'optional'}>}>}
 */
async function extractKeywords(source, options = {}) {
  if (source === 'peerTitles') {
    return extractCoreFromPeerTitles(options.data);
  }
  // default: keyword mode
  return extractCoreAndModifiers(options.data);
}

module.exports = { extractCoreAndModifiers, fallbackExtract, extractCoreFromPeerTitles, fallbackExtractFromPeers, extractKeywords, RIGIDITY_RULES_TEXT };
