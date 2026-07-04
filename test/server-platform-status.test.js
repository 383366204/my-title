'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// Ensure we set NODE_ENV to test to prevent server from listening automatically
process.env.NODE_ENV = 'test';

const app = require('../bin/server');

test('GET /api/platform/status returns taobao sycm and 1688 states', async () => {
  let server;
  // Use a random port to avoid conflicts
  const port = 3100 + Math.floor(Math.random() * 1000);
  await new Promise((resolve) => {
    server = app.listen(port, '127.0.0.1', resolve);
  });

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/platform/status`);
    assert.strictEqual(res.status, 200);

    const payload = await res.json();
    assert.strictEqual(payload.ok, true);
    assert.ok(payload.data);
    assert.ok(payload.data.taobao);
    assert.ok(payload.data.sycm);
    assert.ok(payload.data['1688']);
    assert.strictEqual(payload.data.taobao.platform, 'taobao');
    assert.strictEqual(typeof payload.data.taobao.available, 'boolean');
    assert.strictEqual(typeof payload.data.sycm.available, 'boolean');
    assert.strictEqual(typeof payload.data['1688'].available, 'boolean');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
