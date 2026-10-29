const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { validateComparison, saveCandidateSnapshot, compareCandidateScreenshot } = require('../../../../skills/peer-discovery/src/screenshot-comparison');
const { screenshotClip, captureCandidateScreenshot } = require('../../../../skills/peer-discovery/src/candidate-screenshot');

test('comparison output must match every candidate exactly, with no fabricated scores', () => {
  const mapping = [{ number: 1, id: '111' }, { number: 2, id: '222' }];
  const rows = [1, 2].map(number => ({ number, label: '疑似同款', reason: '轮廓一致', differences: '规格待确认' }));
  assert.deepEqual(validateComparison({ results: rows }, mapping).map(r => r.offerId), ['111', '222']);
  assert.throws(() => validateComparison({ results: [rows[0], rows[0]] }, mapping));
  assert.throws(() => validateComparison({ results: rows.slice(0, 1) }, mapping));
  assert.throws(() => validateComparison({ results: [{ ...rows[0], number: 3 }, rows[1]] }, mapping));
  assert.throws(() => validateComparison({ results: [{ ...rows[0], reason: '相似95%' }, rows[1]] }, mapping));
});

test('screenshot rejects unloaded cards and excessively large regions', () => {
  const row = { id: '1', x: 0, y: 0, width: 200, height: 300, ready: true };
  assert.equal(screenshotClip([row]).height, 300);
  assert.throws(() => screenshotClip([{ ...row, ready: false }]));
  assert.throws(() => screenshotClip([{ ...row, height: 5000 }]));
  assert.throws(() => screenshotClip([]));
});

test('layout drift rejects capture and always removes temporary numbers', async () => {
  let inspections = 0, cleaned = false;
  const client = {
    evaluate: async expression => {
      if (expression.endsWith(',"clean")')) { cleaned = true; return []; }
      if (expression.endsWith(',"inspect")')) {
        inspections++;
        return [{ id: '1', x: 0, y: inspections === 1 ? 0 : 20, width: 200, height: 300, ready: true }];
      }
      return [];
    }, send: async () => ({ data: 'png' })
  };
  await assert.rejects(captureCandidateScreenshot(client, ['1']), /发生变化/);
  assert.equal(cleaned, true);
});

test('snapshot comparison sends exactly two images in one request and respects disabled configuration', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'comparison-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const bytes = Buffer.from('89504e470d0a1a0a', 'hex');
  const snapshot = await saveCandidateSnapshot(dir, { data: bytes.toString('base64'), original: { extension: 'png', bytes }, mapping: [{ number: 1, id: '123' }] });
  let calls = 0;
  const options = { enabled: true, client: { apiKey: 'test', apiBase: 'https://example.invalid', model: 'test-vision', _buildChatPayload: p => p }, request: async (_url, body) => {
    calls++;
    assert.equal(body.messages[1].content.filter(c => c.type === 'image_url').length, 2);
    return { data: { choices: [{ message: { content: JSON.stringify({ results: [{ number: 1, label: '无法判断', reason: '细节不足', differences: '需核对' }] }) } }] } };
  } };
  const result = await compareCandidateScreenshot(dir, snapshot, options);
  assert.equal(result.results[0].offerId, '123');
  assert.equal(calls, 1);
  assert.equal((await compareCandidateScreenshot(dir, snapshot, { ...options, enabled: false })).status, 'unavailable');
  assert.equal(calls, 1);
});
