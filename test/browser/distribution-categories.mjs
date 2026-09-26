import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ECOM_PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../../apps/web', import.meta.url));
const text = 'https://detail.1688.com/offer/1.html$$茶杯隔热垫桌面防滑吸水耐热圆形创意茶托办公水杯防烫垫子$$旧类目';
const harness = `import React from 'react'; import { createRoot } from 'react-dom/client';
import { DistributionExportPanel } from '/src/features/workflow/components/distribution-export-panel.jsx';
import '/src/App.css'; import '/src/index.css';
window.copied = [];
createRoot(document.getElementById('root')).render(React.createElement(DistributionExportPanel, {
  currentRunId: 'fixture', directPreview: true, onCopyText: async text => window.copied.push(text),
  artifactState: { status: 'ready', artifact: { nodeId: 'export', type: 'text', text: ${JSON.stringify(text)} } }
}));`;
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, proxy: {} }, plugins: [{
  name: 'category-fixture', resolveId: id => id === '/__category.js' ? id : null,
  load: id => id === '/__category.js' ? harness : null,
  configureServer(vite) { vite.middlewares.use((req, res, next) => {
    if (req.url !== '/__category') return next();
    res.setHeader('Content-Type', 'text/html');
    vite.transformIndexHtml('/__category', '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root" style="padding:16px;max-width:1100px;height:100vh;margin:auto"></div><script type="module" src="/__category.js"></script></body></html>').then(html => res.end(html)).catch(next);
  }); }
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = [], actions = [];
  const snapshot = { version: 0, job: null, locked: false, rows: [{
    url: 'https://detail.1688.com/offer/1.html', keyword: '杯垫', category: '', candidates: [],
    source1688Category: '1688 > 布艺茶垫', legacyCategory: '旧类目', status: 'missing'
  }] };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    if (!pathname.startsWith('/api/')) return route.continue();
    let data = {};
    if (pathname.endsWith('/categories/copy')) {
      const input = request.postDataJSON();
      data = { text: input.items.map(row => input.format === 'url' ? row.url : `${row.url}$$${row.title}${input.format === 'full' ? '$$' + snapshot.rows[0].category : ''}`).join('\n') };
    } else if (pathname.endsWith('/categories')) {
      if (request.method() === 'POST') {
        const input = request.postDataJSON(); actions.push(input); snapshot.version++;
        if (input.action === 'query' || input.action === 'resume') snapshot.job = { status: 'running', completed: 0, requests: [{}], currentWord: input.queryWord || '杯垫' };
        if (input.action === 'pause') snapshot.job.status = 'paused';
        if (input.action === 'select') { snapshot.rows[0].category = input.category; snapshot.rows[0].source = 'sycm_manual'; }
      }
      data = snapshot;
    } else if (pathname.endsWith('/artifacts/export')) data = { nodeId: 'export', type: 'text', text };
    else if (pathname.endsWith('/distribution/shops')) data = [];
    else if (pathname.includes('/distribution/runs/')) return route.fulfill({ status: 404, json: { ok: false, error: '未找到铺货任务' } });
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__category`);
  await page.getByText('历史类目来源未确认：旧类目').waitFor();
  const select = page.getByRole('combobox', { name: '铺货类目（生意参谋）', exact: true });
  assert.equal(await select.inputValue(), '');
  const copy = page.getByRole('button', { name: '复制铺货内容', exact: true });
  assert.equal(await copy.isDisabled(), true);
  await page.getByRole('button', { name: '获取类目', exact: true }).click();
  await page.getByRole('button', { name: '暂停获取', exact: true }).click();
  await page.getByRole('button', { name: '继续获取', exact: true }).click();
  assert.deepEqual(actions.map(row => row.action), ['query', 'pause', 'resume']);
  snapshot.version++;
  snapshot.job = { status: 'completed', completed: 1, requests: [{}] };
  Object.assign(snapshot.rows[0], { queryWord: '杯垫', collectedAt: '2026-09-26T08:00:00Z', candidates: [
    { category: '餐具 > 杯垫', clickRatio: 0, clickRate: 0 }, { category: '餐具 > 茶托', clickRatio: 0, clickRate: 0 }
  ], status: 'needs_confirmation' });
  await select.getByRole('option', { name: /餐具 > 茶托/ }).waitFor({ state: 'attached' });
  assert.equal(await select.inputValue(), '');
  await select.selectOption('餐具 > 茶托');
  await page.getByText(/已人工确认参谋候选/).waitFor();
  await copy.click();
  await page.getByRole('dialog', { name: '复制成功', exact: true }).waitFor();
  assert.match(await page.evaluate(() => window.copied.at(-1)), /\$\$餐具 > 茶托$/);
  await page.getByRole('button', { name: '知道了' }).click();
  mkdirSync('/tmp/category-qa', { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: `/tmp/category-qa/${width}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`);
    const box = await select.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, JSON.stringify({ width, box }));
  }
  assert.deepEqual(errors, []);
  console.log('PASS: category provenance, pause/resume, zero-metric manual choice, copy, desktop/mobile layout.');
} finally { await browser?.close(); await server.close(); }
