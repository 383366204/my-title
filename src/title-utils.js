const { removeBannedWords } = require('./banned-words');

// 惰性加载 nodejieba（仅 constructFallbackTitle 使用，避免影响其他函数的加载速度）
let _nodejieba = null;
function getNodejieba() {
  if (!_nodejieba) {
    _nodejieba = require('nodejieba');
  }
  return _nodejieba;
}

// 电商字符长度计算：1个中文字符=2字节，ASCII字符=1字节
// 淘宝/1688 标题限制 60 字符 = 最多 30 个汉字
function byteLen(str) {
  if (typeof str !== 'string') return 0;
  let len = 0;
  for (let i = 0; i < str.length; i++) {
    len += str.charCodeAt(i) > 127 ? 2 : 1;
  }
  return len;
}

/**
 * 按电商字符长度截断字符串（1汉字=2字节）
 * @param {string} str - 原始字符串
 * @param {number} maxBytes - 最大字节数
 * @returns {string} 截断后的字符串
 */
function truncateByBytes(str, maxBytes) {
  if (typeof str !== 'string') return '';
  let len = 0;
  for (let i = 0; i < str.length; i++) {
    len += str.charCodeAt(i) > 127 ? 2 : 1;
    if (len > maxBytes) return str.substring(0, i);
  }
  return str;
}

function cleanTitle(title) {
  if (typeof title !== 'string') return '';
  return title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '');
}

function ensureBlueOceanPrefix(title, blueOceanWord) {
  if (typeof title !== 'string' || typeof blueOceanWord !== 'string') return title || '';
  if (!blueOceanWord) return title;
  if (title.startsWith(blueOceanWord)) return title;
  if (title.includes(blueOceanWord)) {
    return blueOceanWord + title.replaceAll(blueOceanWord, '');
  }
  return blueOceanWord + title;
}

function normalizeLength(title, minLength = 30, maxLength = 60) {
  if (typeof title !== 'string') return null;
  if (byteLen(title) < minLength) return null;
  if (byteLen(title) > maxLength) return truncateByBytes(title, maxLength);
  return title;
}

function postProcessTitle(title, blueOceanWord, minLength = 30, maxLength = 60) {
  if (typeof title !== 'string' || !title.trim()) return null;
  let result = removeBannedWords(title);
  result = cleanTitle(result);
  result = ensureBlueOceanPrefix(result, blueOceanWord);
  result = normalizeLength(result, minLength, maxLength);
  if (result === null) {
    console.warn(`⚠️ 标题过短被丢弃: "${title}"`);
    return null;
  }
  result = result.replace(/\s+/g, '');
  return result;
}

/**
 * 构造回退标题：蓝海词前置 + 从原标题和淘宝同行标题中提取关键词
 * @param {string} blueOceanWord - 蓝海词（用户原始输入）
 * @param {string} originalTitle - 1688 原标题
 * @param {string[]} [taobaoTitles=[]] - 淘宝同行标题数组
 * @param {number} [maxLength=60] - 最大标题长度
 * @returns {string} 构造的铺货标题
 */
function constructFallbackTitle(blueOceanWord, originalTitle, taobaoTitles = [], maxLength = 60) {
  // 1. 校验 blueOceanWord
  if (typeof blueOceanWord !== 'string' || !blueOceanWord) return '';
  // 2. 获取 jieba 实例，进行分词
  const jieba = getNodejieba();
  // 3. blueOceanWord 作为词集合（word-level 去重）
  const blueWords = new Set(jieba.cut(blueOceanWord));

  // 4. 清理原标题
  let cleaned = removeBannedWords(originalTitle || '');
  cleaned = cleanTitle(cleaned);
  // 5. 移除蓝海词整词在 cleaned 中的出现，防止重复前缀
    cleaned = cleaned.replaceAll(blueOceanWord, '');

  // 6. 使用 jieba.cut() 将 cleaned 拆分为词组，按词级过滤
  const titleWords = jieba.cut(cleaned);
  const filteredWords = [];
  for (const w of titleWords) {
    if (!blueWords.has(w) && w.trim()) {
      filteredWords.push(w);
    }
  }
  // 7. 组装：蓝海词前缀 + 过滤后的词拼接
  let result = blueOceanWord + filteredWords.join('');

  // 8. 淘宝同行标题辅助：按词级追加，不重复且不过长
  if (Array.isArray(taobaoTitles) && taobaoTitles.length > 0) {
    const resultWords = new Set(jieba.cut(result)); // 词级去重集合
    for (const t of taobaoTitles) {
      if (typeof t !== 'string') continue;
      let tClean = removeBannedWords(t);
      tClean = cleanTitle(tClean);
      const tWords = jieba.cut(tClean);
      for (const w of tWords) {
        if (!blueWords.has(w) && !resultWords.has(w) && w.trim()) {
          result += w;
          resultWords.add(w); // 保持Set与result同步
          if (typeof maxLength === 'number' && byteLen(result) >= maxLength) break;
        }
      }
      if (typeof maxLength === 'number' && byteLen(result) >= maxLength) break;
    }
  }

  // 9. 截断
  if (typeof maxLength === 'number' && maxLength > 0 && byteLen(result) > maxLength) {
    result = truncateByBytes(result, maxLength);
  }
  // 10. 去空格
  return result.replace(/\s+/g, '');
}

module.exports = { byteLen, truncateByBytes, cleanTitle, ensureBlueOceanPrefix, normalizeLength, postProcessTitle, constructFallbackTitle };
