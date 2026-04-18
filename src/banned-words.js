const bannedWords = require('../data/banned-words.json');

function checkBannedWords(title) {
  const found = [];
  Object.values(bannedWords).flat().forEach(word => {
    if (title.includes(word)) found.push(word);
  });
  return { valid: found.length === 0, words: found };
}

function removeBannedWords(title) {
  const allBanned = [...new Set(Object.values(bannedWords).flat())];
  let result = title;
  allBanned.forEach(word => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'g'), '');
  });
  result = result.replace(/\s+/g, ' ').trim();
  return result;
}

module.exports = { checkBannedWords, removeBannedWords };
