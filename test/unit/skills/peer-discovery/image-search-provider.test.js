'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createImageSearchProvider, downloadSearchImage, imagePageBlocker } = require('../../../../skills/peer-discovery/src/image-search-provider');
const { normalizeImageSearchCard } = require('../../../../skills/peer-discovery/src/image-search-cards');
const { evidenceStatus } = require('../../../../skills/peer-discovery/src/evidence');

test('only explicit login/challenge/rate-limit state blocks image search', () => {
  assert.equal(imagePageBlocker({ url: 'https://www.1688.com/', text: '登录 搜索' }), null);
  assert.equal(imagePageBlocker({ url: 'https://login.taobao.com/' }), 'login_required');
  assert.equal(imagePageBlocker({ text: '请完成安全验证' }), 'captcha_required');
  assert.equal(imagePageBlocker({ text: '操作过于频繁' }), 'rate_limited');
  assert.equal(imagePageBlocker({ text: '页面加载中' }), null);
});

test('image downloader rejects private hosts and credential-bearing URLs before fetching', async () => {
  for (const url of ['http://cbu01.alicdn.com/a.jpg', 'https://127.0.0.1/a.jpg', 'https://alicdn.com.evil.test/a.jpg', 'https://user@cbu01.alicdn.com/a.jpg', 'https://cbu01.alicdn.com:9999/a.jpg']) {
    await assert.rejects(downloadSearchImage(url), /HTTPS/);
  }
  assert.throws(() => createImageSearchProvider({ port: '9222' }), /端口/);
});

test('cancelled searches do not download or operate Chrome', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createImageSearchProvider().search({ imageUrl: 'https://cbu01.alicdn.com/a.jpg' }, { signal: controller.signal }), { code: 'PLATFORM_ACCESS_INTERRUPTED' });
});

test('card timestamps use the shared evidence contract', () => {
  const card = normalizeImageSearchCard({ renderKey: '1_0_normal_1234', title: '示例', displayPrice: '¥1' }, { now: 1000, maxAgeMs: 5000 });
  assert.equal(evidenceStatus(card, { now: 1001 }), 'current');
  assert.equal(evidenceStatus(card, { now: 6000 }), 'expired');
});

test('downloader checks actual image bytes, streamed size and redirect policy', async t => {
  let bytes = Buffer.from('not an image');
  let requested;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requested = options;
    return new Response(bytes, { status: 200 });
  });
  await assert.rejects(downloadSearchImage('https://cbu01.alicdn.com/a.jpg'), /格式不支持/);
  assert.equal(requested.redirect, 'error');
  bytes = Buffer.alloc(10 * 1024 * 1024 + 1);
  await assert.rejects(downloadSearchImage('https://cbu01.alicdn.com/a.jpg'), /超过10MB/);
  bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const result = await downloadSearchImage('https://cbu01.alicdn.com/a.jpg');
  assert.equal(result.extension, 'jpg');
  assert.match(result.digest, /^[a-f0-9]{64}$/);
});
