const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWorkbenchCliArgs, appendCappedOutput } = require('../core/server/workbench-cli');

test('workbench CLI preserves mode-specific flags and numeric filtering', () => {
  assert.deepEqual(buildWorkbenchCliArgs('daily', '', {
    mine: '10', verify: 5, generate: 2, export: 20, productsPerKeyword: 3, length: 60, port: 9222, pages: 4
  }), ['bin/cli.js', 'flow', 'daily', '--json', '--mine', '10', '--verify', '5', '--generate', '2', '--export', '20', '--products-per-keyword', '3', '--length', '60', '--port', '9222', '--pages', '4']);
  const keyword = '杯垫 空格; echo fixture';
  assert.deepEqual(buildWorkbenchCliArgs('keyword', keyword, { mine: 10, verify: 5, generate: 2 }), [
    'bin/cli.js', 'flow', 'keyword', keyword, '--json'
  ]);
  for (const value of [0, -1, '', null, undefined, NaN, Infinity, 'invalid']) {
    assert.deepEqual(buildWorkbenchCliArgs('daily', '', { mine: value, port: value }), ['bin/cli.js', 'flow', 'daily', '--json']);
  }
});

test('workbench output retains the most recent bounded log bytes', () => {
  const limit = 200 * 1024;
  assert.equal(appendCappedOutput('old', Buffer.from('new')), 'oldnew');
  assert.equal(appendCappedOutput('', ''), '');
  const exact = 'x'.repeat(limit);
  assert.equal(appendCappedOutput('', exact), exact);
  assert.equal(appendCappedOutput(exact, 'tail'), 'x'.repeat(limit - 4) + 'tail');
  assert.equal(appendCappedOutput('old', 'y'.repeat(limit + 10)), 'y'.repeat(limit));
  const unicode = '标题'.repeat(limit);
  const originalBytes = Buffer.from(unicode);
  assert.equal(appendCappedOutput('', unicode), originalBytes.subarray(originalBytes.length - limit).toString('utf8'));
});
