const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { researchRoot, rootResearchStatus, discoverySnapshot, ROOT_RESEARCH_COOLDOWN_MS } = require('../../../../skills/keyword-mining/src/root-research-store');

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'root-research-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('completed queries cool for exactly 30 days across sources and cycles', async t => {
  const dataDir = directory(t);
  let time = Date.parse('2026-01-31T12:00:00Z');
  const options = { dataDir, now: () => time, cycleId: 'first' };
  await researchRoot('收纳盒', options, async () => ({ data: [{ keyword: '桌面收纳盒' }] }));
  time += ROOT_RESEARCH_COOLDOWN_MS - 1;
  assert.equal(rootResearchStatus(' 收纳盒！', { dataDir, now: time }).state, 'cooling');
  assert.equal((await researchRoot('收纳盒', { ...options, cycleId: 'new-source' }, () => assert.fail('must not query'))).skipped, true);
  assert.equal(rootResearchStatus('整理盒', { dataDir, now: time }).state, 'new');
  time += 1;
  assert.equal(rootResearchStatus('收纳盒', { dataDir, now: time }).state, 'due');
  const result = await researchRoot('收纳盒', { ...options, cycleId: 'second' }, async () => ({ data: [{ keyword: '厨房收纳盒' }, { keyword: '桌面收纳盒' }] }));
  assert.deepEqual(result.cycle.comparison.newKeywords, ['厨房收纳盒']);
  assert.deepEqual(result.cycle.comparison.retainedKeywords, ['桌面收纳盒']);
});

test('technical failures do not cool; valid empty results do', async t => {
  const dataDir = directory(t);
  const options = { dataDir, cycleId: 'a' };
  await assert.rejects(researchRoot('茶托', options, async () => ({ ok: false, data: [], status: 'login_required' })));
  assert.equal(rootResearchStatus('茶托', { dataDir }).state, 'new');
  await assert.rejects(researchRoot('茶托', options, async () => ({})));
  await researchRoot('茶托', options, async () => ({ data: [] }));
  assert.equal(rootResearchStatus('茶托', { dataDir }).state, 'cooling');
});

test('concurrent claims cannot query the same normalized root twice', async t => {
  const dataDir = directory(t);
  let resolve;
  const first = researchRoot('茶托', { dataDir, cycleId: 'one' }, () => new Promise(done => { resolve = done; }));
  const second = await researchRoot(' 茶托 ', { dataDir, cycleId: 'two' }, () => assert.fail('duplicate request'));
  assert.equal(second.state, 'running');
  resolve({ data: [] });
  await first;
  const resumed = await researchRoot('茶托', { dataDir, cycleId: 'one' }, () => assert.fail('completed query repeated'));
  assert.equal(resumed.reused, true);
});

test('same attempt preserves its original discovery snapshot', async t => {
  const file = path.join(directory(t), 'snapshot.json');
  await discoverySnapshot(file, async () => ({ selectedRoots: ['茶托'] }));
  assert.deepEqual(await discoverySnapshot(file, () => assert.fail('LLM rerun')), { selectedRoots: ['茶托'] });
});

test('legacy completed queries also honor the monthly cooldown', t => {
  const dataDir = directory(t);
  const now = Date.now();
  fs.writeFileSync(path.join(dataDir, 'root-history.jsonl'), [
    { root: '茶托', result: 'success', checkedAt: new Date(now - 86400000).toISOString() },
    { root: '茶杯', result: 'failed', checkedAt: new Date(now).toISOString() }
  ].map(row => JSON.stringify(row)).join('\n'));
  assert.equal(rootResearchStatus('茶托', { dataDir, now }).state, 'cooling');
  assert.equal(rootResearchStatus('茶杯', { dataDir, now }).state, 'new');
});
