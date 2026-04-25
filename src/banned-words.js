const bannedWords = require('../data/banned-words.json');

const allBanned = [...new Set(Object.values(bannedWords).flat())];
const bannedRegexes = allBanned.map(w =>
  new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
);

function checkBannedWords(title) {
  const found = [];
  Object.values(bannedWords).flat().forEach(word => {
    if (title.includes(word)) found.push(word);
  });
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

module.exports = { checkBannedWords, removeBannedWords };
