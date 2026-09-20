import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ECOM_PLAYWRIGHT_MODULE || 'playwright');
const { ensureSelectedShop, submitSelectedShop } = require('../../skills/1688-distribution/shop-selection');
const { confirmCopyRecordsStable, selectDistributionModeAndAllShopsStable } = require('../../skills/1688-distribution');
const root = fileURLToPath(new URL('../../apps/web', import.meta.url));
const harness = `import React from 'react'; import {createRoot} from 'react-dom/client';
import {DistributionExportPanel} from '/src/features/workflow/components/distribution-export-panel.jsx';
import '/src/index.css';
import '/src/App.css';
createRoot(document.getElementById('root')).render(React.createElement(DistributionExportPanel, {
currentRunId:'fixture', directPreview:true, onCopyText:async()=>{},
artifactState:{status:'ready',artifact:{nodeId:'export',type:'text',text:'https://detail.1688.com/offer/1.html$$杯垫$$家居'}}
}));`;
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, proxy: {} }, plugins: [{
  name: 'shop-fixture', resolveId: id => id === '/__shops.js' ? id : null, load: id => id === '/__shops.js' ? harness : null,
  configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (req.url !== '/__shops') return next();
      res.setHeader('Content-Type', 'text/html');
      vite.transformIndexHtml('/__shops', '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root" style="padding:16px;max-width:1100px;height:100vh;margin:auto"></div><script type="module" src="/__shops.js"></script></body></html>').then(html => res.end(html)).catch(next);
    });
  }
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [], submissions = [], checks = [];
  const shops = [];
  let job = null;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const req = route.request(), pathname = new URL(req.url()).pathname;
    if (!pathname.startsWith('/api/')) return route.continue();
    let data = {};
    if (pathname === '/api/distribution/shops') {
      if (req.method() === 'POST') { data = { ...req.postDataJSON(), id: `shop-${shops.length}`, revision: `revision-${shops.length}` }; shops.push(data); }
      else data = shops;
    } else if (pathname.endsWith('/distribution/check')) { checks.push(req.postDataJSON()); data = { canSubmit: true }; }
    else if (pathname.endsWith('/distribution/submit')) {
      submissions.push(req.postDataJSON()); job = { jobId: 'fixture-distribution', status: 'completed', total: 1, completed: 1, targetShops: shops.slice(), distributionMode: req.postDataJSON().distributionMode }; data = job;
    } else if (pathname.endsWith('/distribution/runs/fixture-distribution')) {
      if (!job) return route.fulfill({ status: 404, json: { ok: false, error: '未找到铺货任务' } });
      data = job;
    }
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__shops`);
  const submit = page.getByRole('button', { name: '确认并开始自动铺货', exact: true });
  assert.equal(await submit.isDisabled(), true);
  await page.getByRole('button', { name: '新增店铺', exact: true }).click();
  await page.getByLabel('显示名称', { exact: true }).fill('家居一店');
  await page.getByLabel('铺货平台店铺名称', { exact: true }).fill('平台家居店');
  await page.getByLabel('Chrome 调试端口', { exact: true }).fill('9223');
  await page.getByLabel('默认店铺', { exact: true }).check();
  mkdirSync('output/shop-qa', { recursive: true });
  await page.screenshot({ path: 'output/shop-qa/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/shop-qa/mobile.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByRole('button', { name: '保存店铺', exact: true }).click();
  await page.getByText('平台店铺：平台家居店', { exact: false }).waitFor();
  await page.getByRole('button', { name: '新增店铺', exact: true }).click();
  await page.getByLabel('显示名称', { exact: true }).fill('家居二店');
  await page.getByLabel('铺货平台店铺名称', { exact: true }).fill('平台家居二店');
  await page.getByLabel('Chrome 调试端口', { exact: true }).fill('9223');
  await page.getByRole('button', { name: '保存店铺', exact: true }).click();
  await page.getByText('目标店铺 · 已选 2 家', { exact: true }).waitFor();
  const titleBox = await page.getByText('目标店铺 · 已选 2 家', { exact: true }).boundingBox();
  const addBox = await page.getByRole('button', { name: '新增店铺', exact: true }).boundingBox();
  assert.ok(Math.abs(titleBox.y + titleBox.height / 2 - addBox.y - addBox.height / 2) < 2, 'shop title and add button share their vertical center');
  const choices = page.getByRole('group', { name: '目标店铺', exact: true }).getByRole('checkbox');
  await choices.first().uncheck();
  await page.getByText('目标店铺 · 已选 1 家', { exact: true }).waitFor();
  await choices.first().check();
  for (const name of ['顺序平均分配', '随机平均分配', '随机分配', '重复分配']) {
    await page.getByRole('radio', { name, exact: true }).check();
    assert.equal(await page.locator('input[type=radio]:checked').count(), 1);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: 'output/shop-qa/multi-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/shop-qa/multi-mobile.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.equal(await submit.isEnabled(), true);
  await submit.click();
  await page.getByText('铺货已完成', { exact: true }).waitFor();
  assert.deepEqual(checks[0].shopIds, ['shop-1', 'shop-0']);
  assert.deepEqual(submissions[0].shopIds, ['shop-1', 'shop-0']);
  assert.equal(submissions[0].distributionMode, 'repeat');
  assert.deepEqual(submissions[0].shopRevisions, { 'shop-0': 'revision-0', 'shop-1': 'revision-1' });
  assert.equal(await page.getByRole('combobox', { name: '目标店铺' }).count(), 0);
  assert.equal(await choices.first().isDisabled(), true);
  assert.equal(await page.getByRole('radio', { name: '重复分配', exact: true }).isDisabled(), true);
  assert.equal(await submit.isDisabled(), true);
  assert.deepEqual(errors, []);
  job = { ...job, status: 'completed_with_issues', total: 3, completed: 0, failed: 3,
    items: ['1', '2', '3'].map(offerId => ({ offerId, title: `商品${offerId}` })),
    confirmationCheck: { confirmation: { foundOfferIds: ['1'], issueOfferIds: ['2'], byShop: [{ shopName: '平台家居店', perOfferId: { '1': { status: 'success' }, '2': { status: 'failed', reason: 'SKU名称超过38个汉字' } } }] } } };
  await page.reload();
  await page.getByText('成功 1 · 失败 1 · 待确认 1', { exact: true }).waitFor();
  await page.getByText('失败 · 商品2', { exact: true }).waitFor();
  await page.getByText('平台家居店：失败', { exact: true }).waitFor();
  await page.getByText('失败原因：SKU名称超过38个汉字', { exact: true }).waitFor();
  assert.equal(await page.locator('.distribution-confirmation-heading').filter({ hasText: '商品2' }).getByText('ID：2', { exact: true }).count(), 1);
  const resultColors = await page.locator('.distribution-result-label').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).color));
  assert.equal(new Set(resultColors).size, 3, 'success, failure and pending use distinct colors');
  await page.screenshot({ path: 'output/shop-qa/recheck-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);

  // 只在本地夹具里验证复选框与记录归属，不打开真实铺货平台。
  await page.setContent('<div class="shopItem"><label class="el-checkbox"><input type="checkbox" checked><span class="el-checkbox__label">甲店</span></label><label class="el-checkbox"><input type="checkbox"><span class="el-checkbox__label">乙店</span></label></div>');
  const client = { evaluate: expression => page.evaluate(expression) };
  await ensureSelectedShop(client, { platformShopName: '乙店' }, true);
  assert.deepEqual(await page.locator('input').evaluateAll(nodes => nodes.map(n => n.checked)), [false, true]);
  await page.evaluate(() => { window.submitted = 0; window.__ecom1688 = { clickExact: () => { window.submitted++; return { ok: true }; } }; });
  await page.locator('input').first().check();
  await assert.rejects(submitSelectedShop(client, { platformShopName: '乙店' }), /不一致/);
  assert.equal(await page.evaluate(() => window.submitted), 0);
  const targets = [{ platformShopName: '甲店' }, { platformShopName: '乙店' }];
  await ensureSelectedShop(client, targets, true);
  await page.evaluate(() => { document.body.insertAdjacentHTML('beforeend', '<label><input type="radio" name="mode" checked>重复分配</label><label><input type="radio" name="mode">随机分配</label>'); });
  await submitSelectedShop(client, targets, '重复分配');
  assert.equal(await page.evaluate(() => window.submitted), 1);
  await page.getByRole('radio', { name: '随机分配', exact: true }).check();
  await assert.rejects(submitSelectedShop(client, targets, '重复分配'), /分配方式发生变化/);
  assert.equal(await page.evaluate(() => window.submitted), 1);

  await page.setContent('<div class="shopItem"><div class="shopCheck"><label class="el-checkbox"><input type="checkbox"></label></div><div class="flx-align-center f15">甲店 <span class="el-tag">主店铺</span></div></div><div class="shopItem"><div class="shopCheck"><label class="el-checkbox"><input type="checkbox"></label></div><div class="flx-align-center f15">乙店 <!----></div></div><div class="shopItem"><label class="el-checkbox"><input type="checkbox" checked><span class="el-checkbox__label">丙店</span></label></div><label><input type="radio" name="mode">顺序平均分配</label><label><input type="radio" name="mode">随机平均分配</label><label><input type="radio" name="mode">随机分配</label><label><input type="radio" name="mode">重复分配</label>');
  await ensureSelectedShop(client, targets, 'available');
  await assert.rejects(ensureSelectedShop(client, { platformShopName: '不存在' }, 'available'), /已读取店铺：甲店、乙店、丙店/);
  for (const [mode, label] of [['sequential-average', '顺序平均分配'], ['random-average', '随机平均分配'], ['random', '随机分配'], ['repeat', '重复分配']]) {
    const result = await selectDistributionModeAndAllShopsStable(client, { itemCount: 4, targetShops: targets, distributionMode: mode });
    assert.equal(result.distributionModeText, label);
    assert.equal(await page.getByRole('radio', { name: label, exact: true }).isChecked(), true);
    assert.deepEqual(await page.locator('input[type=checkbox]').evaluateAll(nodes => nodes.map(n => n.checked)), [true, true, false]);
  }

  await page.setContent('<input placeholder="逗号或空格"><button>搜索</button><table><tbody><tr><td>甲店</td><td>1</td><td>复制成功</td></tr></tbody></table>');
  await page.evaluate(() => { window.setTimeout = callback => { callback(); return 1; }; });
  const logClient = { evaluate: expression => expression === 'window.__ecom1688.readState()'
    ? Promise.resolve({ url: 'https://item.jnesoft.com/ali_view/ali_batchLog', body: '复制日志' }) : page.evaluate(expression) };
  const wrongShop = await confirmCopyRecordsStable(logClient, ['1'], { platformShopName: '乙店' });
  assert.notEqual(wrongShop.status, 'confirmed');
  const correctShop = await confirmCopyRecordsStable(logClient, ['1'], { platformShopName: '甲店' });
  assert.equal(correctShop.status, 'confirmed');
  const partialRepeat = await confirmCopyRecordsStable(logClient, ['1'], targets, 'repeat');
  assert.notEqual(partialRepeat.status, 'confirmed');
  const distributed = await confirmCopyRecordsStable(logClient, ['1'], targets, 'random');
  assert.equal(distributed.status, 'confirmed');
  await page.locator('tbody').evaluate(node => node.insertAdjacentHTML('beforeend', '<tr><td>乙店</td><td>1</td><td>复制中</td></tr>'));
  assert.notEqual((await confirmCopyRecordsStable(logClient, ['1'], targets, 'repeat')).status, 'confirmed');
  await page.locator('tr').last().locator('td').last().evaluate(node => { node.innerText = '复制成功'; });
  assert.equal((await confirmCopyRecordsStable(logClient, ['1'], targets, 'repeat')).status, 'confirmed');
  console.log('Distribution shops browser regression passed');
} finally { await browser?.close(); await server.close(); }
