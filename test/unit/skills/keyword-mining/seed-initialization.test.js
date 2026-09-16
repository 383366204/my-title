const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSeeds, saveSeeds } = require('../../../../skills/keyword-mining/src/seed-store');

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-init-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('missing seed file is initialized from the clean bundled template', t => {
  const dir = directory(t);
  const template = path.resolve(__dirname, '../../../../data/keyword-mining/seeds.example.json');
  fs.copyFileSync(template, path.join(dir, 'seeds.example.json'));
  const expected = JSON.parse(fs.readFileSync(template, 'utf8'));
  assert.ok(expected.length > 0);
  assert.deepEqual(loadSeeds(dir), expected);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'seeds.json'), 'utf8')), expected);
  for (const row of expected) {
    assert.deepEqual(Object.keys(row).sort(), ['category', 'keyword', 'priority', 'source', 'status', 'type']);
  }
});

test('existing empty and customized seeds are never overwritten by a template', t => {
  const dir = directory(t);
  const template = path.join(dir, 'seeds.example.json');
  fs.writeFileSync(template, 'invalid template must not be read');
  for (const existing of [[], [{ keyword: '茶托', status: 'paused', successCount: 9 }]]) {
    saveSeeds(existing, dir);
    const before = fs.readFileSync(path.join(dir, 'seeds.json'));
    assert.deepEqual(loadSeeds(dir), existing);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'seeds.json')), before);
  }
});

test('custom directories without a template stay empty', t => {
  const dir = directory(t);
  assert.deepEqual(loadSeeds(dir), []);
  assert.equal(fs.existsSync(path.join(dir, 'seeds.json')), false);
});

test('invalid templates do not create a runtime file', t => {
  const dir = directory(t);
  for (const content of ['{', '{}']) {
    fs.writeFileSync(path.join(dir, 'seeds.example.json'), content);
    assert.throws(() => loadSeeds(dir));
    assert.equal(fs.existsSync(path.join(dir, 'seeds.json')), false);
  }
});
