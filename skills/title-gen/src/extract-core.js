const GLMClient = require('../../../core/glm-client');

// 共享的刚性/可选修饰词判断规则（供两个 GLM prompt 复用）
const { RIGIDITY_RULES_TEXT } = require('../../../core/constants');

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
  const client = new GLMClient({
    apiKey: process.env.GLM_API_KEY,
    apiBase: process.env.GLM_API_BASE,
    model: process.env.GLM_API_MODEL
  });

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

  // 判断刚性的简单规则（与 fallbackExtractFromPeers 保持一致）
  const rigidPattern = /纯银|合金|纯棉|羊毛|真丝|真皮|不锈钢|黄铜|金色|银色|黑色|白色|红色|蓝色|女|男|女款|男款|XL|L|M|S|加大|长款|短款|中长款/;

  // 品类核心词正则（用于从中文输入中提取核心词）
  const categoryPattern = /(项链|手链|耳环|戒指|手镯|连衣裙|T恤|衬衫|外套|裤子|鞋子|包包|卫衣|毛衣|羽绒服|夹克|西装|裙|裤|袜|帽|围巾|腰带|眼镜|手表|背包|钱包|皮带|鞋|靴|拖鞋|凉鞋|高跟鞋)/;

  // 先尝试空格分词（兼容英文/已有空格分隔的输入）
  const spaceWords = input.split(/\s+/).filter(Boolean);
  if (spaceWords.length >= 2) {
    // 有空格分隔：最后一个词作为核心词，其余为修饰词
    const coreWord = spaceWords.pop();
    const modifiers = spaceWords.map(word => ({
      word,
      rigidity: rigidPattern.test(word) ? 'rigid' : 'optional'
    }));
    return { coreWord, modifiers };
  }

  // 无空格 / 纯中文输入：使用品类正则提取核心词
  const categoryMatch = input.match(categoryPattern);
  let coreWord;
  let prefix = '';

  if (categoryMatch) {
    // 找到品类词作为核心词
    coreWord = categoryMatch[0];
    const matchIndex = input.indexOf(coreWord);
    // 品类词之前的部分作为修饰词来源
    prefix = input.substring(0, matchIndex);
    // 品类词之后的部分也作为修饰词
    const suffix = input.substring(matchIndex + coreWord.length);

    // 从前缀和后缀中提取修饰词
    const allModifiers = [];

    // 前缀按常见修饰词长度切分（优先匹配长词）
    if (prefix) {
      const prefixModifiers = extractChineseModifiers(prefix, rigidPattern);
      allModifiers.push(...prefixModifiers);
    }

    if (suffix) {
      const suffixModifiers = extractChineseModifiers(suffix, rigidPattern);
      allModifiers.push(...suffixModifiers);
    }

    return { coreWord, modifiers: allModifiers };
  }

  // 无品类词匹配：取最后 2+ 字符的中文词作为核心词，其余为修饰词
  const chineseWordMatches = input.match(/[\u4e00-\u9fa5]{2,}/g);
  if (chineseWordMatches && chineseWordMatches.length > 0) {
    let categoryWord = chineseWordMatches.find(word => categoryPattern.test(word));
    coreWord = categoryWord || chineseWordMatches[chineseWordMatches.length - 1];
    prefix = input.substring(0, input.lastIndexOf(coreWord));
    if (prefix) {
      const modifiers = extractChineseModifiers(prefix, rigidPattern);
      return { coreWord, modifiers };
    }
    return { coreWord, modifiers: [] };
  }

  // 兜底：整个输入作为核心词
  return { coreWord: input, modifiers: [] };
}

/**
 * 从中文字符串中提取修饰词（辅助函数）
 * @param {string} text - 中文文本
 * @param {RegExp} rigidPattern - 刚性词正则
 * @returns {Array<{word: string, rigidity: string}>}
 */
function extractChineseModifiers(text, rigidPattern) {
  const modifiers = [];
  // 按刚性词优先切分（最长匹配优先）
  const rigidWords = [...rigidPattern.source.split('|')].sort((a, b) => b.length - a.length);
  let remaining = text;

  for (const rw of rigidWords) {
    if (remaining.includes(rw)) {
      modifiers.push({ word: rw, rigidity: 'rigid' });
      remaining = remaining.replace(rw, '');
    }
  }

  // 剩余部分中提取 2+ 字符的可选修饰词
  const optionalMatches = remaining.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  for (const ow of optionalMatches) {
    if (ow.length >= 2) {
      modifiers.push({ word: ow, rigidity: 'optional' });
    }
  }

  return modifiers;
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
  const client = new GLMClient({
    apiKey: process.env.GLM_API_KEY,
    apiBase: process.env.GLM_API_BASE,
    model: process.env.GLM_API_MODEL
  });

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
