'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { searchTaobaoWebImage, isTaobaoImageResultUrl } = require('../../../../skills/peer-discovery/src/taobao-web-image-search');

test('accepts observed desktop image marker but rejects ordinary and foreign URLs', () => {
  assert.equal(isTaobaoImageResultUrl('https://s.taobao.com/search?tab=all&localImgKey=localImgSearchKey1_792_426'), true);
  for (const url of ['https://s.taobao.com/search?tab=all', 'https://s.taobao.com/search?localImgKey=', 'https://evil.example/search?tab=imgsearch']) {
    assert.equal(isTaobaoImageResultUrl(url), false);
  }
});

test('actual desktop result URL is accepted by upload pipeline', async () => {
  const h = harness({ resultUrl: 'https://s.taobao.com/search?tab=all&localImgKey=localImgSearchKey1_792_426' });
  assert.equal((await searchTaobaoWebImage({}, h.options)).products.length, 1);
});

test('conversion failure stops before browser upload', async () => {
  const h = harness();
  h.options.prepareImage = async () => { throw new Error('转换失败'); };
  await assert.rejects(searchTaobaoWebImage({}, h.options), /转换失败/);
  assert.equal(h.calls.length, 0);
});

function harness({ login = false, resultUrl = 'https://s.taobao.com/search?tab=imgsearch', inputs = 1, networkErrors = 0, challenge = false, frequent = false, redirected = false } = {}) {
  const calls = [];
  let file;
  class Client {
    constructor(url) { this.isResult = url.endsWith('/result'); }
    async send(method, params) {
      calls.push(method);
      if (method === 'Target.createTarget') return { targetId: 'home' };
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (method === 'DOM.querySelector') return { nodeId: 2 };
      if (method === 'DOM.setFileInputFiles') {
        file = params.files[0];
        assert.equal((await fs.readFile(file)).toString(), 'fixture');
      }
      if (method === 'Target.getTargets') return { targetInfos: [
        { type: 'page', targetId: 'other', url: resultUrl },
        { type: 'page', targetId: 'result', openerId: 'home', url: resultUrl },
      ] };
      return {};
    }
    async evaluate(expression) {
      if (expression.includes('function readTaobaoImagePage')) return {
        login, inputs, challenge, frequent,
        url: this.isResult && redirected ? 'https://www.taobao.com/' : resultUrl,
        networkError: this.isResult && networkErrors-- > 0,
      };
      return [{ url: 'https://item.taobao.com/item.htm?id=12', title: '商品', shopUrl: 'https://shop123.taobao.com/' }];
    }
    close() {}
  }
  return { calls, file: () => file, options: {
    Client, fetcher: async () => ({ ok: true, json: async () => ({ webSocketDebuggerUrl: 'ws://fixture' }) }),
    guard: async (_platform, _options, fn) => fn(),
    downloadImage: async () => ({ extension: 'png', bytes: Buffer.from('fixture') }),
    sleep: async () => {}, timeoutMs: 0,
  } };
}

test('web image search uploads using CDP, normalizes cards and cleans its files', async () => {
  const h = harness();
  const result = await searchTaobaoWebImage({}, h.options);
  assert.equal(result.products[0].itemId, '12');
  assert.equal(result.complete, false);
  assert.ok(h.calls.includes('DOM.setFileInputFiles'));
  assert.equal(h.calls.filter(x => x === 'Target.closeTarget').length, 2);
  await assert.rejects(fs.stat(h.file()), { code: 'ENOENT' });
});

test('network failure refreshes only the result page once', async () => {
  const h = harness({ networkErrors: 1 });
  h.options.timeoutMs = 100;
  assert.equal((await searchTaobaoWebImage({}, h.options)).products.length, 1);
  assert.equal(h.calls.filter(x => x === 'Page.reload').length, 1);
});

test('persistent network failure blocks without repeated refresh', async () => {
  const h = harness({ networkErrors: 2 });
  h.options.timeoutMs = 100;
  await assert.rejects(searchTaobaoWebImage({}, h.options), /刷新一次后仍未恢复/);
  assert.equal(h.calls.filter(x => x === 'Page.reload').length, 1);
  assert.equal(h.calls.includes('Target.closeTarget'), false);
  await assert.rejects(fs.stat(h.file()), { code: 'ENOENT' });
});

test('captcha and rate limiting never trigger upload or refresh', async () => {
  for (const state of [{ challenge: true }, { frequent: true }]) {
    const h = harness(state);
    await assert.rejects(searchTaobaoWebImage({}, h.options), /安全验证/);
    assert.equal(h.calls.includes('Page.reload'), false);
    assert.equal(h.calls.includes('DOM.setFileInputFiles'), false);
  }
});

test('redirected result page cannot supply recommendation cards', async () => {
  const h = harness({ redirected: true });
  await assert.rejects(searchTaobaoWebImage({}, h.options), /未读取到有效图搜商品/);
});

test('login blocks before upload and retains the page for recovery', async () => {
  const h = harness({ login: true });
  await assert.rejects(searchTaobaoWebImage({}, h.options), /登录/);
  assert.equal(h.calls.includes('DOM.setFileInputFiles'), false);
  assert.equal(h.calls.includes('Target.closeTarget'), false);
});

test('ordinary search is never accepted as image search', async () => {
  const h = harness({ resultUrl: 'https://s.taobao.com/search?q=keyword' });
  await assert.rejects(searchTaobaoWebImage({}, h.options), /图搜结果页/);
});

test('ambiguous upload inputs are rejected', async () => {
  const h = harness({ inputs: 2 });
  await assert.rejects(searchTaobaoWebImage({}, h.options), /多个上传入口/);
  assert.equal(h.calls.includes('DOM.setFileInputFiles'), false);
});
