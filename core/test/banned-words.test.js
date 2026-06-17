const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('custom banned words overlay is loaded from env path', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'banned-')), 'custom.json');
  fs.writeFileSync(file, JSON.stringify({ custom: ['测试禁词'] }));
  process.env.ECOM_BANNED_WORDS_EXTRA = file;
  delete require.cache[require.resolve('../banned-words')];
  const { checkBannedWords } = require('../banned-words');

  const result = checkBannedWords('这是一个测试禁词标题');
  assert.equal(result.valid, false);
  assert.ok(result.words.includes('测试禁词'));
});
