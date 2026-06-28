'use strict';

let jieba = null;
try {
  jieba = require('nodejieba');
} catch (e) {
  // Silence C++ native load error if it happens in environments without binary support
}

// Common stop words and generic modifiers that are not core products
const IGNORED_WORDS = new Set([
  '的', '和', '与', '或', '等', '及', '是', '在', '有', '了', '不', '也', '就', '都', '而', '到', '为', '中', '对',
  '新款', '爆款', '网红', '高级', '韩国', '日系', '韩版', '百搭', '神器', '大容量', '高颜值', '超火', '同款', '高级感',
  '小众', '设计', '设计感', '女款', '男款', '情侣', '送礼', '礼物', '一件', '包邮', '批发', '厂家', '直销', '源头'
]);

// Valid noun part of speech tags
const VALID_NOUN_TAGS = new Set(['n', 'vn', 'nz', 'an']);

function extractNouns(titles) {
  if (!Array.isArray(titles)) return [];
  const wordCounts = {};

  const processWords = (words) => {
    for (const word of words) {
      const cleaned = word.trim();
      if (
        cleaned.length >= 2 &&
        cleaned.length <= 6 &&
        !IGNORED_WORDS.has(cleaned) &&
        /^[\u4e00-\u9fa5]+$/.test(cleaned)
      ) {
        wordCounts[cleaned] = (wordCounts[cleaned] || 0) + 1;
      }
    }
  };

  if (!jieba) {
    // Fallback if nodejieba is unavailable
    for (const title of titles) {
      if (!title || typeof title !== 'string') continue;
      const words = title.split(/[\s,，、。·・\-–_+/\\|()（）[\]【】]+/);
      processWords(words);
    }
  } else {
    for (const title of titles) {
      if (!title || typeof title !== 'string') continue;
      try {
        const words = jieba.cut(title);
        processWords(words);
      } catch (err) {
        // Fallback
        const words = title.split(/[\s,，、。·・\-–_+/\\|()（）[\]【】]+/);
        processWords(words);
      }
    }
  }

  return Object.entries(wordCounts)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count);
}

module.exports = { extractNouns };
