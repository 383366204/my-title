'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createDistributionShopStore } = require('../../../core/distribution-shops');
const { ensureSelectedShop } = require('../../../skills/1688-distribution/shop-selection');
const { createBatchHash, splitDistributionBatches, resolveDistributionMode } = require('../../../skills/1688-distribution');
const { distributionTargetKey } = require('../../../core/distribution-targets');

test('shop configuration persists, validates duplicates, and keeps only one enabled default', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shops-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'shops.json');
  const store = createDistributionShopStore(file);
  const a = store.save({ name: '一店', platformShopName: '平台一店', isDefault: true });
  const b = store.save({ name: '二店', platformShopName: '平台二店', isDefault: true, port: 9223 });
  assert.equal(createDistributionShopStore(file).list().length, 2);
  assert.equal(store.get(a.id).isDefault, false);
  assert.equal(store.get(b.id).isDefault, true);
  assert.throws(() => store.save({ name: '重复', platformShopName: '平台一店' }), /已配置/);
  assert.throws(() => store.save({ name: '错', platformShopName: '店铺', port: 65536 }), /端口/);
  assert.throws(() => store.get('missing'), /有效/);
  store.save({ ...b, enabled: false });
  assert.throws(() => store.get(b.id), /启用/);
  assert.equal(store.list().find(row => row.id === b.id).isDefault, false);
  store.remove(a.id);
  assert.throws(() => store.get(a.id), /有效/);
});

test('configured selection deselects other shops and refuses absent, ambiguous or disabled targets', async () => {
  const label = (name, checked = false) => {
    const input = { checked, disabled: false };
    return { input, textContent: name, querySelector: selector => selector === '.el-checkbox__label' ? { textContent: name } : input,
      classList: { contains: () => false }, click: () => { input.checked = !input.checked; } };
  };
  const rows = [label('甲店', true), label('乙店')];
  const client = { evaluate: async expression => vm.runInNewContext(expression, { document: { querySelectorAll: () => rows } }) };
  const shop = { platformShopName: '乙店' };
  await ensureSelectedShop(client, shop, 'available');
  assert.equal(rows[0].input.checked, true);
  await ensureSelectedShop(client, shop, true);
  assert.equal(rows[0].input.checked, false);
  assert.equal(rows[1].input.checked, true);
  await ensureSelectedShop(client, [{ platformShopName: '甲店' }, shop], true);
  assert.equal(rows[0].input.checked, true);
  assert.equal(rows[1].input.checked, true);
  rows[0].input.checked = true;
  await assert.rejects(ensureSelectedShop(client, shop), /不一致/);
  await assert.rejects(ensureSelectedShop(client, { platformShopName: '不存在' }, true), /未找到/);
  rows[1].input.disabled = true;
  await assert.rejects(ensureSelectedShop(client, shop, true), /不可用/);
  rows[1].input.disabled = false;
  rows.push(label('乙店'));
  await assert.rejects(ensureSelectedShop(client, shop, true), /重复/);
});

test('multi-shop fingerprints preserve order independence and distinguish all four modes', () => {
  const items = [{ url: 'https://detail.1688.com/offer/1.html', title: '杯垫' }];
  const a = { platformShopName: '甲店', port: 9222 }, b = { platformShopName: '乙店', port: 9222 };
  const modes = ['sequential-average', 'random-average', 'random', 'repeat'];
  assert.equal(new Set(modes.map(distributionMode => createBatchHash(items, { targetShops: [a, b], distributionMode }))).size, 4);
  assert.equal(createBatchHash(items, { targetShops: [a, b] }), createBatchHash(items, { targetShops: [b, a] }));
  assert.equal(createBatchHash(items, { shop: a }), createBatchHash(items, { targetShops: [a], distributionMode: 'random-average' }));
  assert.equal(distributionTargetKey({ targetShops: [a, b] }), distributionTargetKey({ targetShops: [b, a] }));
  for (const mode of modes) assert.equal(resolveDistributionMode({ preferredMode: mode }), mode);
  assert.throws(() => resolveDistributionMode({ preferredMode: 'invalid' }), /分配方式/);
});

test('average distribution balances the last batch and never silently drops shops', () => {
  const items = Array.from({ length: 21 }, (_, id) => ({ id }));
  const targetShops = [{ platformShopName: '甲店' }, { platformShopName: '乙店' }];
  const batches = splitDistributionBatches(items, { targetShops, distributionMode: 'sequential-average' });
  assert.deepEqual(batches.map(batch => batch.length), [11, 10]);
  assert.deepEqual(batches.flat(), items);
  assert.throws(() => splitDistributionBatches(items.slice(0, 1), { targetShops }), /平均分配/);
  assert.deepEqual(splitDistributionBatches(items.slice(0, 1), { targetShops, distributionMode: 'repeat' }), [items.slice(0, 1)]);
});

test('duplicate fingerprint separates shops but ignores display aliases', () => {
  const items = [{ url: 'https://detail.1688.com/offer/1.html', title: '杯垫', category: '家居' }];
  const shop = { platformShopName: '甲店', port: 9222, name: '显示名' };
  assert.notEqual(createBatchHash(items, { shop }), createBatchHash(items, { shop: { ...shop, platformShopName: '乙店' } }));
  assert.equal(createBatchHash(items, { shop }), createBatchHash(items, { shop: { ...shop, name: '新显示名' } }));
});
