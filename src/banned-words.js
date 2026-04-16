const bannedWords = require('../data/banned-words.json');

function checkBannedWords(title) {
  const found = [];
  [...bannedWords.limitWords, ...bannedWords.falseWords].forEach(word => {
    if (title.includes(word)) found.push(word);
  });
  return { valid: found.length === 0, words: found };
}

function removeBannedWords(title) {
  const allBanned = [
    ...bannedWords.limitWords,
    ...bannedWords.falseWords,
    ...bannedWords.prohibitedWords
  ];
  let result = title;
  allBanned.forEach(word => {
    result = result.replace(new RegExp(word, 'g'), '');
  });
  result = result.replace(/\s+/g, ' ').trim();
  return result;
}

module.exports = { checkBannedWords, removeBannedWords };
