'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const path = require('node:path');

test('dev starts both services, follows a busy backend port and shuts down both', { timeout: 30000 }, async t => {
  const occupied = http.createServer((_req, res) => res.end('wrong backend'));
  occupied.listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  const env = { ...process.env, UI_PORT: String(occupied.address().port), WEB_PORT: '0' };
  delete env.NODE_TEST_CONTEXT;
  const child = fork(path.resolve(__dirname, '../../bin/dev.mjs'), [], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); });
  const ready = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Startup timeout: ${output}`)), 20000);
    child.on('message', message => {
      if (message.type !== 'dev-ready') return;
      clearTimeout(timeout); resolve(message);
    });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Early exit ${code}: ${output}`)); });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
  });
  assert.notEqual(ready.backendPort, occupied.address().port);
  const html = await (await fetch(ready.frontendUrl)).text();
  assert.match(html, /\/@vite\/client/);
  const api = await fetch(new URL('/api/dev-launcher-missing-route', ready.frontendUrl));
  assert.equal(api.status, 404);
  assert.deepEqual(await api.json(), { ok: false, error: 'API not found' });
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const [code] = await exited;
  assert.equal(code, 0, output);
  await assert.rejects(fetch(ready.frontendUrl));
  await assert.rejects(fetch(`http://127.0.0.1:${ready.backendPort}/`));
});
