const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { registerHttpFallbacks } = require('../core/server/http-fallbacks');

test('HTTP fallbacks preserve API 404, SPA navigation and payload error limits', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'http-fallbacks-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<main>fixture app</main>');
  fs.writeFileSync(path.join(dir, 'asset.txt'), 'fixture asset');
  const app = express();
  app.use(express.json({ limit: 1024 }));
  app.get('/api/fixture', (req, res) => res.json({ ok: true }));
  app.post('/api/fixture', (req, res) => res.json({ ok: true }));
  app.post('/api/file', express.raw({ type: 'image/png', limit: '1mb' }), (req, res) => res.sendStatus(204));
  app.get('/api/error', (req, res, next) => next(new Error('fixture error')));
  registerHttpFallbacks(app, { reactWebPath: dir, jsonBodyLimit: '25mb' });
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.deepEqual(await (await fetch(`${base}/api/fixture`)).json(), { ok: true });
    const missing = await fetch(`${base}/api/missing`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { ok: false, error: 'API not found' });
    assert.equal(await (await fetch(`${base}/asset.txt`)).text(), 'fixture asset');
    assert.equal(await (await fetch(`${base}/workflows/fixture`)).text(), '<main>fixture app</main>');
    assert.equal((await fetch(`${base}/workflows/fixture`, { method: 'HEAD' })).status, 200);
    for (const method of ['POST', 'DELETE']) {
      assert.equal((await fetch(`${base}/workflows/fixture`, { method })).status, 404);
    }
    const oversized = await fetch(`${base}/api/fixture`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(2048) })
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).code, 'PAYLOAD_TOO_LARGE');
    const image = await fetch(`${base}/api/file`, {
      method: 'POST', headers: { 'Content-Type': 'image/png' }, body: Buffer.alloc(1024 * 1024 + 1)
    });
    assert.equal(image.status, 413);
    assert.match(image.headers.get('content-type'), /application\/json/);
    const payload = await image.json();
    assert.match(payload.error, /1MB/);
    assert.doesNotMatch(payload.error, /25mb/i);
    assert.match(payload.userMessage, /图片/);
    assert.deepEqual(await (await fetch(`${base}/api/error`)).json(), { error: 'fixture error' });
    fs.unlinkSync(path.join(dir, 'index.html'));
    assert.equal((await fetch(`${base}/workflows/fixture`)).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
