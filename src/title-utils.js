const { removeBannedWords } = require('./banned-words');

// 惰性加载 nodejieba（仅 constructFallbackTitle 使用，避免影响其他函数的加载速度）
let _nodejieba = null;
let _nodejiebaTried = false;

function getNodejieba() {
  if (!_nodejiebaTried) {
    _nodejiebaTried = true;
    try {
      _nodejieba = require('nodejieba');
    } catch (_) {
      _nodejieba = null;
    }
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
  return title.replace(/[^a-zA-Z0-9\u4e00-\u9fff\u3400-\u4dbf·]/g, '');
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
  
  // 定义中文停用词（内联，不创建外部文件）
  const STOPWORDS = new Set(['的', '了', '是', '在', '有', '和', '与', '或', '及', '等', '之', '为', '于', '以', '而', '被', '把', '给', '让', '向', '从', '到', '对', '将', '还', '也', '就', '都', '要', '会', '能', '可', '很', '非常']);
  
  // 2. 获取 jieba 实例，进行分词
  const jieba = getNodejieba();
  // jieba 不可用时降级为简单的空格分词
  if (!jieba) {
    const raw = blueOceanWord + (originalTitle || '').replace(/\s+/g, '');
    const fallback = truncateByBytes(raw, maxLength);
    return fallback.replace(/\s+/g, '');
  }
  const blueWords = new Set(jieba.cut(blueOceanWord));

  // 4. 清理原标题
  let cleaned = removeBannedWords(originalTitle || '');
  cleaned = cleanTitle(cleaned);
  let uncleaned = cleaned; // keep original cleaned for later
  // 5. 移除蓝海词整词在 cleaned 中的出现，防止重复前缀（避免破坏子串）
  if (blueOceanWord.length >= 2) {
    // 安全替换：避免破坏子串（如"项链"在"项链款"中）
    let idx = cleaned.indexOf(blueOceanWord);
    while (idx !== -1) {
      const nextChar = cleaned[idx + blueOceanWord.length];
      // 如果下一个字符是汉字，说明 blueOceanWord 是更长词的前缀，不替换
      if (nextChar && /[\u4e00-\u9fa5]/.test(nextChar)) {
        idx = cleaned.indexOf(blueOceanWord, idx + 1);
        continue;
      }
      cleaned = cleaned.slice(0, idx) + cleaned.slice(idx + blueOceanWord.length);
      idx = cleaned.indexOf(blueOceanWord, idx);
    }
  }

  // 6. 使用 jieba.cut() 将 cleaned 拆分为词组，按词级过滤
  const titleWords = jieba.cut(cleaned);
  let filteredWords = [];
  let needsRelax = false;
  
  // First pass: filter single chars and stopwords
  for (const w of titleWords) {
    if (!blueWords.has(w) && w.trim() && w.length >= 2 && !STOPWORDS.has(w)) {
      filteredWords.push(w);
    }
  }
  let result = blueOceanWord + filteredWords.join('');
  
  // If result is still too short, relax constraints (allow single chars except stopwords)
  if (byteLen(result) < 30) {
    needsRelax = true;
    filteredWords = [];
    for (const w of titleWords) {
      if (!blueWords.has(w) && w.trim() && !STOPWORDS.has(w)) {
        filteredWords.push(w);
      }
    }
    result = blueOceanWord + filteredWords.join('');
  }

  // If still too short, just use the original cleaned without removing blue ocean word
  if (byteLen(result) < 30) {
    result = blueOceanWord + uncleaned;
  }

  // 8. 淘宝同行标题辅助：按词级追加，不重复且不过长
  if (Array.isArray(taobaoTitles) && taobaoTitles.length > 0) {
    const resultWords = new Set(jieba.cut(result)); // 词级去重集合
    needsRelax = byteLen(result) < 30;
    for (const t of taobaoTitles) {
      if (typeof t !== 'string') continue;
      let tClean = removeBannedWords(t);
      tClean = cleanTitle(tClean);
      const tWords = jieba.cut(tClean);
      for (const w of tWords) {
        const isValid = 
          !blueWords.has(w) && 
          !resultWords.has(w) && 
          w.trim() && 
          !STOPWORDS.has(w) && 
          (needsRelax || w.length >= 2);
        if (isValid) {
          result += w;
          resultWords.add(w); // 保持Set与result同步
          if (byteLen(result) >= 30) needsRelax = false;
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

/**
 * 从全标题提取导购标题（20-30字符，用于主图/短描述）
 * @param {string} fullTitle - 完整铺货标题
 * @param {string} blueOceanWord - 蓝海词前缀
 * @returns {string} 导购标题
 */
function extractShoppingGuideTitle(fullTitle, blueOceanWord) {
  if (!fullTitle || typeof fullTitle !== 'string') return blueOceanWord || '';
  
  // 如果全标题 ≤ 30字符，直接作为导购标题
  if (byteLen(fullTitle) <= 30) return fullTitle;
  
  // 确保以蓝海词开头
  let title = fullTitle;
  if (!title.startsWith(blueOceanWord)) {
    title = ensureBlueOceanPrefix(title, blueOceanWord);
  }
  
  // 截断到20-30字符范围
  // 策略：截断到30字符以内，尽量保留语义完整
  let guide = truncateByBytes(title, 30);
  
  // 如果截断后 < 20字符，尝试放宽（这种情况很少）
  if (byteLen(guide) < 20 && byteLen(title) >= 20) {
    // 重新截断到更近的语义点
    guide = title.slice(0, Math.floor(title.length * 0.8));
    // 确保不超过30字符
    if (byteLen(guide) > 30) {
      guide = truncateByBytes(guide, 30);
    }
  }
  
  return guide;
}

module.exports = { byteLen, truncateByBytes, cleanTitle, ensureBlueOceanPrefix, normalizeLength, postProcessTitle, constructFallbackTitle, extractShoppingGuideTitle };
