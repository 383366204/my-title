let bannedWords = {};
let allBanned = [];
let bannedRegexes = [];

try {
  bannedWords = require('../data/banned-words.json');
  allBanned = [...new Set(Object.values(bannedWords).flat())].sort((a, b) => b.length - a.length);
  bannedRegexes = allBanned.map(w =>
    new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
  );
  if (allBanned.length === 0) {
    console.warn('[banned-words] 警告: 违禁词列表为空，请检查 data/banned-words.json');
  }
} catch (err) {
  console.error('[banned-words] 加载违禁词文件失败:', err && err.message ? err.message : err);
  bannedWords = {};
  allBanned = [];
  bannedRegexes = [];
}

function checkBannedWords(title) {
  if (typeof title !== 'string' || !title) {
    return { valid: true, words: [] };
  }
  const found = [];
  for (const word of allBanned) {
    if (title.includes(word)) found.push(word);
  }
  return { valid: found.length === 0, words: found };
}

/**
 * 移除标题中的违禁词
 * @param {string} title - 原始标题
 * @returns {string} 清洗后的标题
 */
function removeBannedWords(title) {
  if (typeof title !== 'string' || !title) return '';
  let result = title;
  for (const regex of bannedRegexes) {
    result = result.replace(regex, '');
  }
  return result.replace(/\s+/g, ' ').trim();
}

module.exports = { checkBannedWords, removeBannedWords, getBannedWordVersion: () => allBanned.length };
