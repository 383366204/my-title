const { removeBannedWords } = require('./banned-words');

/**
 * 统计标题列表中的词频
 * @param {Array<object>} products - 商品列表
 * @returns {Map<string, number>} 词频统计
 */
function countWordFrequency(products) {
  const freq = new Map();
  
  products.forEach(product => {
    const title = product.subject || '';
    // 简单分词（按空格分割）
    const words = title.split(/\s+/).filter(w => w.length > 1);
    
    words.forEach(word => {
      const lower = word.toLowerCase();
      freq.set(lower, (freq.get(lower) || 0) + 1);
    });
  });
  
  return freq;
}

/**
 * 生成标题，符合淘宝 SEO 规范
 * @param {string} userInput - 用户原始输入
 * @param {string} coreWord - 核心词
 * @param {Array<object>} products - 过滤后的商品列表
 * @param {Array<{word: string, rigidity: 'rigid'|'optional'}>} modifiers - 修饰词
 * @param {number} maxLength - 最大字符数（默认60）
 * @returns {Array<string>} 生成的标题列表（3-5个）
 */
function generateTitles(userInput, coreWord, products, modifiers, maxLength = 60) {
  if (!Array.isArray(products) || products.length === 0) {
    return [];
  }

  // 统计高频词
  const freq = countWordFrequency(products);
  
  // 按词频排序，取高频词作为属性词
  const sortedWords = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .filter(([word]) => word !== coreWord.toLowerCase())
    .slice(0, 10)
    .map(([word]) => word);
  
  // 获取刚性修饰词（用户输入的刚性修饰词优先）
  const rigidWords = modifiers
    .filter(m => m.rigidity === 'rigid')
    .map(m => m.word);
  
  // 生成多个候选标题（不同组合）
  const candidates = [];
  
  // 三段式结构：[核心词前置] + [刚性修饰词] + [高频属性词] + [可选修饰词]
  // 核心词必须前置（SEO 权重高）
  
  // 候选 1: 核心词 + 刚性修饰词 + 用户原始输入 + 高频词
  const candidate1 = buildTitle([coreWord, ...rigidWords, userInput, ...sortedWords], maxLength);
  if (candidate1 && candidate1.length >= 10) {
    candidates.push(removeBannedWords(candidate1));
  }
  
  // 候选 2: 核心词 + 用户原始输入 + 高频词
  const candidate2 = buildTitle([coreWord, userInput, ...sortedWords], maxLength);
  if (candidate2 && candidate2.length >= 10 && !candidates.includes(removeBannedWords(candidate2))) {
    candidates.push(removeBannedWords(candidate2));
  }
  
  // 候选 3: 刚性修饰词 + 核心词 + 高频词
  if (rigidWords.length > 0) {
    const candidate3 = buildTitle([...rigidWords, coreWord, ...sortedWords], maxLength);
    if (candidate3 && candidate3.length >= 10 && !candidates.includes(removeBannedWords(candidate3))) {
      candidates.push(removeBannedWords(candidate3));
    }
  }
  
  // 去重并返回前 3-5 个
  return [...new Set(candidates)].filter(t => t.length > 0).slice(0, 5);
}

/**
 * 拼接标题并控制长度
 * @param {Array<string>} parts - 标题部分
 * @param {number} maxLength - 最大长度
 * @returns {string|null} 拼接后的标题
 */
function buildTitle(parts, maxLength) {
  // 去重
  const uniqueParts = [...new Set(parts.filter(p => p && p.length > 0))];
  
  let result = '';
  for (const part of uniqueParts) {
    const newResult = result ? `${result} ${part}` : part;
    // 中文按字符数计算长度
    if (getLength(newResult) > maxLength) {
      break;
    }
    result = newResult;
  }
  
  return result.length >= 5 ? result : null;
}

/**
 * 获取字符串的字符长度（中文每个字算 2 字符？不，淘宝是按字符数，中文每个字算 1 字符）
 * 实际上淘宝标题限制 60 字符 = 60 个中文汉字
 * @param {string} str
 * @returns {number}
 */
function getLength(str) {
  // JavaScript length 按 UTF-16 编码单元计算，中文每个字占 1 个编码单元
  // 在 BMP 范围内（大部分常用汉字都在这里），一个汉字就是一个 length
  return str.length;
}

module.exports = { generateTitles, countWordFrequency };
