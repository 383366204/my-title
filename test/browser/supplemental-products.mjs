import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ECOM_PLAYWRIGHT_MODULE || 'playwright');
const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ManualProductSelectionPanel } from '/src/features/workflow/components/manual-product-selection-panel.jsx';
import { DistributionShopPicker } from '/src/features/workflow/components/distribution/shop-picker.jsx';
import '/src/styles/node-workbench.css';
const artifactState = { artifact: { items: [{ status: 'selected', url: 'https://detail.1688.com/offer/456.html', title: '测试商品长标题'.repeat(10), keyword: '项链', recommendedCategory: '饰品 > 项链' }] } };
function App() {
 const [shops, setShops] = useState(null);
 window.shops = shops;
 return React.createElement(React.Fragment, null,
  React.createElement(ManualProductSelectionPanel, { currentRunId: 'test', artifactState, onConfirm: async data => { window.submitted = data; } }),
  React.createElement(DistributionShopPicker, { value: shops, onChange: setShops, onModeChange: () => {} })
 );
}
createRoot(document.getElementById('root')).render(React.createElement(App));
`;
const server = await createServer({
 root: fileURLToPath(new URL('../../apps/web', import.meta.url)),
 server: { host: '127.0.0.1', port: 0, proxy: {} },
 plugins: [{ name: 'supplemental-products-fixture',
  resolveId(id) { if (id === '/__fixture.js') return id; },
  load(id) { if (id === '/__fixture.js') return harness; },
  configureServer(vite) {
   vite.middlewares.use((req, res, next) => {
    if (req.url !== '/__fixture') return next();
    res.setHeader('Content-Type', 'text/html');
    vite.transformIndexHtml('/__fixture', '<div id="root"></div><script type="module" src="/__fixture.js"></script>').then(html => res.end(html));
   });
  }
 }]
});
let browser;
try {
 await server.listen();
 browser = await chromium.launch({ channel: 'chrome', headless: true });
 const page = await browser.newPage();
 await page.route('**/api/distribution/shops', route => route.fulfill({ json: { ok: true, data: [
  { id: 'a', name: 'A', enabled: true }, { id: 'b', name: 'B', enabled: true }, { id: 'c', name: 'C', enabled: false }
 ] } }));
 await page.route('**/api/1688/resolve-share', route => {
  const { input } = route.request().postDataJSON();
  return route.fulfill(input === 'invalid' ? { status: 422, json: { ok: false, error: '无效链接' } } : { json: { ok: true, data: { url: 'https://detail.1688.com/offer/123.html' } } });
 });
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__fixture`);
 await page.waitForFunction(() => window.shops?.length === 2);
 await page.getByRole('group', { name: '目标店铺' }).getByRole('checkbox').nth(0).uncheck();
 assert.equal(await page.getByText('勾选 1688 货源', { exact: true }).count(), 0);
 for (const width of [1000, 390]) {
  await page.setViewportSize({ width, height: 800 });
  const boxes = await page.locator('.manual-product-choice > div > *').evaluateAll(elements => elements.map(el => { const box = el.getBoundingClientRect(); return { top: box.top, right: box.right }; }));
  assert.equal(new Set(boxes.map(box => box.top)).size, 1, 'title, category and URL share one line');
  assert.ok(boxes.every(box => box.right <= width), 'row stays within viewport');
  assert.ok((await page.locator('.manual-product-choice').boundingBox()).height <= 36);
 }
 assert.equal(await page.locator('.manual-product-choice input').isChecked(), true);
 await page.getByText('1 个已选 / 1 个商品', { exact: true }).waitFor();
 assert.deepEqual(await page.evaluate(() => window.shops.map(shop => shop.id)), ['b']);
 await page.getByLabel('补充货源链接').fill('link\nlink\ninvalid');
 await page.getByRole('button', { name: '加入列表', exact: true }).click();
 await page.getByText(/忽略 1 个重复链接/).waitFor();
 assert.equal(await page.getByLabel('补充货源链接').inputValue(), 'invalid');
 assert.equal(await page.locator('.supplemental-product-row').count(), 1);
 await page.getByLabel('补充货源链接').fill('');
 await page.getByRole('button', { name: '确认并继续生成标题' }).click();
 await page.getByText(/请补全第 1 个/).waitFor();
 await page.getByLabel('商品标题', { exact: true }).fill('纯银项链');
 await page.getByLabel('关联关键词', { exact: true }).fill('项链');
 await page.getByLabel('铺货类目（淘宝／生意参谋）', { exact: true }).fill('饰品 > 项链');
 await page.getByRole('button', { name: '确认并继续生成标题' }).click();
 await page.waitForFunction(() => window.submitted);
 assert.equal((await page.evaluate(() => window.submitted)).manualProducts[0].keyword, '项链');
 assert.deepEqual(await page.evaluate(() => window.shops.map(shop => shop.id)), ['b']);
 console.log('Supplemental products and shop defaults passed');
} finally {
 await browser?.close();
 await server.close();
}
