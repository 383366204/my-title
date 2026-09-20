import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ECOM_PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../../apps/web', import.meta.url));
const harness = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { DistributionExportPanel } from '/src/features/workflow/components/distribution-export-panel.jsx';
import '/src/App.css';
import '/src/index.css';
window.copied = []; window.failCopy = false;
const app = createRoot(document.getElementById('root'));
window.renderPanel = (directPreview = true, text = 'https://detail.1688.com/offer/1.html$$标题一$$家居\\nhttps://detail.1688.com/offer/2.html$$标题二$$日用') => {
  app.render(React.createElement(DistributionExportPanel, {
    artifactState: {status:'ready', artifact:{nodeId:'export', type:'text', text}}, currentRunId:'fixture', directPreview,
    onCopyText: async text => { if(window.failCopy) throw new Error('剪贴板拒绝访问'); window.copied.push(text); }
  }));
};
window.renderPanel();
`;
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, proxy: {} }, plugins: [{
  name: 'copy-format-fixture',
  resolveId(id) { if (id === '/__copy.js') return id; },
  load(id) { if (id === '/__copy.js') return harness; },
  configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (req.url !== '/__copy') return next();
      res.setHeader('Content-Type', 'text/html');
      vite.transformIndexHtml('/__copy', '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root" style="padding:16px;max-width:1100px;margin:auto"></div><script type="module" src="/__copy.js"></script></body></html>').then(html => res.end(html)).catch(next);
    });
  }
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  const requests = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  await page.route('**/api/**', route => {
    const request = route.request();
    if (!new URL(request.url()).pathname.startsWith('/api/')) return route.continue();
    requests.push({ url: request.url(), method: request.method(), body: request.postDataJSON() });
    if (request.url().endsWith('/api/distribution/shops')) return route.fulfill({ json: { ok: true, data: [{ id: 'fixture-shop', name: '测试店', platformShopName: '平台测试店', port: 9222, enabled: true, isDefault: true }] } });
    return route.fulfill({ json: request.url().endsWith('/check') ? { canSubmit: false, blockers: [] } : { ok: true, data: {} } });
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__copy`);
  const select = page.getByRole('button', { name: '铺货复制格式', exact: true });
  const labels = { full: '链接$$标题$$类目', title: '链接$$标题', url: '链接' };
  const selectFormat = async (format, scope = page) => {
    await scope.getByRole('button', { name: '铺货复制格式', exact: true }).click();
    await scope.getByRole('menuitemradio', { name: labels[format], exact: true }).click();
  };
  const assertFormat = async format => assert.equal(await select.first().getAttribute('title'), `铺货复制格式：${labels[format]}`);
  const copy = page.getByRole('button', { name: '复制铺货内容', exact: true });
  const dismissSuccess = async () => {
    const dialog = page.getByRole('dialog', { name: '复制成功', exact: true });
    await dialog.waitFor();
    assert.ok(await dialog.evaluate(element => {
      const box = element.getBoundingClientRect();
      return Math.abs(box.left + box.width / 2 - innerWidth / 2) < 2
        && Math.abs(box.top + box.height / 2 - innerHeight / 2) < 2;
    }));
    assert.match(await dialog.innerText(), /已复制 \d+ 条铺货内容/);
    await dialog.getByRole('button', { name: '知道了' }).click();
  };
  try { await copy.waitFor(); } catch (error) { console.error(await page.locator('body').innerText()); throw error; }
  await assertFormat('full');
  await select.click();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator(':focus').innerText(), labels.title);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('menu').isVisible(), false);
  await select.click();
  await copy.click();
  await dismissSuccess();
  assert.equal(await page.getByRole('menu').isVisible(), false);
  for (const format of ['full', 'title', 'url']) {
    await selectFormat(format);
    await copy.click();
    await dismissSuccess();
    const result = await page.evaluate(() => window.copied.at(-1));
    const fields = { full: 3, title: 2, url: 1 }[format];
    assert.equal(result.split('\n').length, 2);
    assert.ok(result.split('\n').every(line => line.split('$$').length === fields));
  }
  await page.getByRole('button', { name: '移除', exact: true }).first().click();
  await copy.click();
  await dismissSuccess();
  assert.equal(await page.evaluate(() => window.copied.at(-1)), 'https://detail.1688.com/offer/2.html');
  await page.getByRole('button', { name: '恢复全部', exact: true }).click();
  await page.getByRole('textbox', { name: '铺货标题', exact: true }).first().fill('');
  await copy.click();
  await dismissSuccess();
  assert.equal(await page.getByRole('button', { name: '标记人工铺货完成' }).isDisabled(), true);
  await selectFormat('title');
  assert.equal(await copy.isDisabled(), true);
  await page.getByRole('textbox', { name: '铺货标题', exact: true }).first().fill('标题一');
  await selectFormat('title');
  assert.equal(await page.getByRole('button', { name: '标记人工铺货完成' }).isDisabled(), true);
  await page.reload();
  await copy.waitFor();
  await assertFormat('title');
  await page.evaluate(() => { window.failCopy = true; });
  await copy.click();
  await page.getByRole('status').filter({ hasText: '复制失败：剪贴板拒绝访问' }).waitFor();
  assert.equal(await page.getByRole('dialog', { name: '复制成功', exact: true }).isVisible(), false);
  await page.evaluate(() => { window.failCopy = false; window.renderPanel(true, 'https://detail.1688.com/offer/1.html$$标题一$$'); });
  await selectFormat('full');
  await page.getByRole('alert').filter({ hasText: '缺少类目' }).waitFor();
  assert.equal(await copy.isDisabled(), true);
  await selectFormat('url');
  await copy.click();
  await dismissSuccess();
  assert.equal(await page.evaluate(() => window.copied.at(-1)), 'https://detail.1688.com/offer/1.html');
  await page.evaluate(() => window.renderPanel(false));
  await page.getByRole('button', { name: '人工复制铺货', exact: true }).click();
  await dismissSuccess();
  await assertFormat('url');
  await page.getByRole('button', { name: '选择店铺并检查', exact: true }).click();
  await page.getByRole('button', { name: '确认并开始自动铺货', exact: true }).click();
  await page.waitForFunction(() => document.body.textContent.includes('暂时无法开始自动铺货'));
  assert.ok(requests.find(row => row.url.endsWith('/check')).body.input.includes('$$标题一$$家居'));
  const dialog = page.getByRole('dialog', { name: '导出清单预览' });
  await selectFormat('title', dialog);
  await assertFormat('title');
  await dialog.getByRole('button', { name: '关闭弹窗' }).click();
  await page.evaluate(() => window.renderPanel(true));
  mkdirSync('/tmp/distribution-copy-qa', { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await copy.waitFor();
    assert.ok(await select.evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; }));
    await select.click();
    const menuWidth = await page.getByRole('menu').evaluate(element => element.getBoundingClientRect().width);
    assert.equal(await page.getByRole('menu').locator('svg').count(), 0);
    const buttonWidth = await page.locator('.distribution-copy-split').evaluate(element => element.getBoundingClientRect().width);
    assert.ok(Math.abs(menuWidth - buttonWidth) < 1);
    assert.ok(await page.getByRole('menu').evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight; }));
    await page.screenshot({ path: '/tmp/distribution-copy-qa/' + width + '.png', fullPage: true });
    await page.keyboard.press('Escape');
  }
  assert.deepEqual(errors, []);
  assert.equal(requests.filter(row => row.method === 'POST' && !row.url.endsWith('/check')).length, 0);
  console.log('PASS: copy formats, persistence, validation, failure feedback, shared entries, unchanged automatic payload, desktop/mobile.');
} finally {
  await browser?.close();
  await server.close();
}
