import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ECOM_PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../../apps/web', import.meta.url));
const harness = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {PeerReviewPanel} from '/src/features/workflow/components/peer-review-panel.jsx';
import '/src/App.css';
import '/src/index.css';
createRoot(document.getElementById('root')).render(React.createElement(PeerReviewPanel, {runId:'fixture'}));
`;
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, proxy: {} }, plugins: [{
  name: 'peer-review-fixture',
  resolveId(id) { if (id === '/__peer.js') return id; },
  load(id) { if (id === '/__peer.js') return harness; },
  configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (req.url !== '/__peer') return next();
      res.setHeader('Content-Type', 'text/html');
      vite.transformIndexHtml('/__peer', '<html><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root" style="padding:16px;max-width:1000px;margin:auto"></div><script type="module" src="/__peer.js"></script></body></html>').then(html => res.end(html)).catch(next);
    });
  },
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  let bundle = { draftRevision: 'r1', activeDrafts: [{ draftKey: 'd1', offerId: '123', title: '测试商品', category: '家居', needsInput: true }] };
  let allocations = 0;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let data;
    if (url.pathname.endsWith('/shops')) data = [{ id: 's1', name: '测试店铺', revision: 's1r', enabled: true }];
    else if (url.pathname.endsWith('/drafts')) {
      const body = route.request().postDataJSON();
      assert.equal(body.expectedDraftRevision, 'r1');
      bundle = { draftRevision: 'r2', activeDrafts: [{ ...bundle.activeDrafts[0], ...body.edits.d1, needsInput: false }] };
      data = { bundle, draftRevision: 'r2' };
    } else if (url.pathname.endsWith('/allocation')) {
      const body = route.request().postDataJSON();
      assert.equal(body.expectedDraftRevision, 'r2');
      assert.deepEqual(body.shopRevisions, { s1: 's1r' });
      allocations++;
      data = { plan: { counts: [{ targetShopId: 's1', count: 1 }] } };
    } else data = { bundle, allocationPlan: null, submissions: { entries: [] } };
    await route.fulfill({ json: { ok: true, data } });
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__peer`);
  try { await page.getByLabel('标题 123').fill('已修改的标题', { timeout: 10000 }); }
  catch (error) { console.error(await page.locator('body').innerText()); throw error; }
  assert.equal(await page.getByRole('button', { name: '生成分配预览' }).isDisabled(), true);
  await page.getByRole('button', { name: '保存复核' }).click();
  await page.getByText('草稿已保存', { exact: true }).waitFor();
  await page.getByRole('button', { name: '生成分配预览' }).click();
  await page.getByRole('region', { name: '分配预览' }).waitFor();
  assert.equal(allocations, 1);
  await page.screenshot({ path: '/tmp/peer-review-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '/tmp/peer-review-mobile.png' });
  await page.getByLabel('随机分配', { exact: true }).check();
  assert.equal(await page.getByRole('region', { name: '分配预览' }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('Peer review browser regression passed');
} finally {
  await browser?.close();
  await server.close();
}
