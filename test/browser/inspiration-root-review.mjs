import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ECOM_PLAYWRIGHT_MODULE || 'playwright');
const harness = `import React from 'react'; import {createRoot} from 'react-dom/client';
import '/src/index.css';
import {InspirationArtifactPanel} from '/src/features/workflow/components/keyword-mining/inspiration-artifact-panel.jsx';
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,
React.createElement(InspirationArtifactPanel,{state:{status:'ready',nodeId:'inspire',artifact:{
runId:'fixture',type:'jsonl',editable:true,revision:'v1',rows:[{keyword:'杯垫',rootKeyword:'杯垫'}]}}})));`;
const server = await createServer({ root: fileURLToPath(new URL('../../apps/web', import.meta.url)),
  server: { host: '127.0.0.1', port: 0 }, plugins: [{
    name: 'inspiration-review-fixture',
    resolveId: id => id === '/__review.js' ? id : null,
    load: id => id === '/__review.js' ? harness : null,
    configureServer(vite) { vite.middlewares.use((req, res, next) => {
      if (req.url !== '/__review') return next();
      res.setHeader('Content-Type', 'text/html');
      vite.transformIndexHtml('/__review', '<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><main id="root" style="max-width:700px;margin:24px auto;padding:16px"></main><script type="module" src="/__review.js"></script></body></html>')
        .then(html => res.end(html)).catch(next);
    }); }
  }] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route('**/api/workflows/runs/fixture/inspiration-roots', async route => {
      const body = route.request().postDataJSON();
      assert.equal(body.revision, 'v1');
      assert.equal(body.rootsText, '浴室脚垫\n收纳盒');
      await route.fulfill({ json: { ok: true, data: { editable: true, revision: 'v2',
        rows: ['浴室脚垫', '收纳盒'].map(rootKeyword => ({ rootKeyword, keyword: rootKeyword })) } } });
    });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__review`);
    await page.getByRole('textbox', { name: '待查询词根' }).fill('浴室脚垫\n收纳盒');
    await page.getByRole('button', { name: '保存词根' }).click();
    await page.getByRole('status').filter({ hasText: '词根已保存' }).waitFor();
    assert.equal(await page.locator('.artifact-business-row').count(), 2);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: `/tmp/inspiration-root-review-${width}.png`, fullPage: true });
    await page.close();
  }
  console.log('Inspiration root review passed: save, updated results, StrictMode, desktop/mobile. HTTP mocked.');
} finally { await browser?.close(); await server.close(); }
