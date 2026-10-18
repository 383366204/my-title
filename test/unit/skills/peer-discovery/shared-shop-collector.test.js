'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePaymentSignal, collectShopSnapshot, collectShopCandidates } = require('../../../../skills/peer-discovery/src/shared-shop-collector');

test('payment parser distinguishes unknown, zero, lower bounds and unit ranges', () => {
  for (const [text, value] of [
    ['0人付款', 0], ['不足10人付款', 0], ['500+人付款', 500], ['1.5万人付款', 15000],
    ['1.14万人付款', 11400], ['1.13万人付款', 11300], ['1.38万人付款', 13800],
    ['100-200人付款', 100], ['1～2万人付款', 10000]
  ]) assert.deepEqual(parsePaymentSignal(text), { hasSignal: true, value });
  for (const text of ['', null, '月销500', '200-100人付款', '无法显示']) assert.deepEqual(parsePaymentSignal(text), { hasSignal: false, value: 0 });
});

test('refiltering snapshots does not recollect or mutate raw evidence', async () => {
  const shop = { shopKey: 'shop1' };
  let calls = 0;
  const snapshot = await collectShopSnapshot(shop, { collector: async () => { calls++; return { products: [{ paymentText: '5人付款' }, { paymentText: '20人付款' }, { paymentText: '' }] }; } });
  assert.equal(snapshot.completeness, 'uncertain');
  for (const [minPayment, count] of [[10, 1], [3, 2], [30, 0], [0, 2]]) {
    const result = await collectShopCandidates(shop, { snapshot, minPayment });
    assert.equal(result.products.length, count);
  }
  assert.equal(snapshot.products.length, 3);
  assert.equal(calls, 1);
  await assert.rejects(() => collectShopCandidates({ shopKey: 'other' }, { snapshot }));
});

test('platform errors and cancellation never become empty successful snapshots', async () => {
  const error = Object.assign(new Error('login'), { code: 'TAOBAO_LOGIN_REQUIRED' });
  await assert.rejects(() => collectShopSnapshot({ shopKey: 's' }, { collector: async () => { throw error; } }), e => e === error);
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(() => collectShopSnapshot({ shopKey: 's' }, { signal: controller.signal, collector: async () => { calls++; } }));
  assert.equal(calls, 0);
});

test('web collection forwards runtime options and preserves evidence and stopping reason', async () => {
  const onProgress = () => {};
  const signal = new AbortController().signal;
  let received;
  const result = await collectShopSnapshot({ shopKey: 's' }, {
    channel: 'web', port: 9333, collectLimit: 40, onProgress, signal,
    collector: async (shop, sort, options) => {
      received = options;
      assert.equal(sort, 'hot');
      return { shopKey: 's', channel: 'web', observedAt: 100, expiresAt: 200,
        products: [], stopReason: 'load_stalled', collectionCompleteness: 'uncertain' };
    },
  });
  assert.equal(received.port, 9333);
  assert.equal(received.onProgress, onProgress);
  assert.equal(received.signal, signal);
  assert.equal(result.observedAt, 100);
  assert.equal(result.expiresAt, 200);
  assert.equal(result.stopReason, 'load_stalled');
  assert.equal(result.channel, 'web');
});

test('unresolved channels and inconsistent collector identities fail closed', async () => {
  await assert.rejects(() => collectShopSnapshot({ shopKey: 's' }, { channel: 'auto' }));
  for (const extra of [{ shopKey: 'other' }, { channel: 'native' }, { observedAt: NaN }]) {
    await assert.rejects(() => collectShopSnapshot({ shopKey: 's' }, {
      channel: 'web', collector: async () => ({ products: [], ...extra }),
    }));
  }
});

test('evidence policy caps expiration and rejects invalid TTL before collecting', async () => {
  let calls = 0;
  const collector = async () => { calls++; return { products: [], observedAt: 100, expiresAt: 1000 }; };
  await assert.rejects(() => collectShopSnapshot({ shopKey: 's' }, { collector, evidenceMaxAgeMs: 0 }));
  assert.equal(calls, 0);
  const snapshot = await collectShopSnapshot({ shopKey: 's' }, { collector, evidenceMaxAgeMs: 50 });
  assert.equal(snapshot.expiresAt, 150);
});
