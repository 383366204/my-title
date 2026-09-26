import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ECOM_PLAYWRIGHT_MODULE || 'playwright');
const harness = `import React from 'react'; import {createRoot} from 'react-dom/client';
import {useDistributionJob} from '/src/features/workflow/hooks/use-distribution-job.js';
function App(){const {job,control}=useDistributionJob({initialJobId:'refresh-test',onJobChange:()=>{}});return React.createElement('div',null,React.createElement('output',null,job?.status||'loading'),React.createElement('button',{onClick:()=>control('recheck')},'核对'));}
createRoot(document.getElementById('root')).render(React.createElement(App));`;
const server = await createServer({ root: fileURLToPath(new URL('../../apps/web', import.meta.url)), server: { host: '127.0.0.1', port: 0, proxy: {} }, plugins: [{
  name: 'refresh-fixture', resolveId: id => id === '/__refresh.js' ? id : null, load: id => id === '/__refresh.js' ? harness : null,
  configureServer(vite) { vite.middlewares.use((req,res,next) => {
    if (req.url !== '/__refresh') return next();
    res.setHeader('Content-Type','text/html');
    vite.transformIndexHtml('/__refresh','<html><body><div id="root"></div><script type="module" src="/__refresh.js"></script></body></html>').then(html=>res.end(html)).catch(next);
  }); }
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  let requests = 0, delayed, scenario = 'race';
  const reply = (route, status) => route.fulfill({ json: { ok: true, data: { jobId: 'refresh-test', status } } });
  await page.route('**/api/distribution/runs/**', async route => {
    if (route.request().method() === 'POST') return reply(route, 'completed');
    requests++;
    if (scenario === 'race' && requests === 2) { delayed = route; return; }
    return reply(route, scenario === 'poll' && requests >= 3 ? 'completed' : 'completed_with_issues');
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__refresh`);
  await page.getByText('completed_with_issues', { exact: true }).waitFor();
  for (let i = 0; i < 100 && !delayed; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(delayed, 'issue status continues polling');
  await page.getByRole('button', { name: '核对' }).click();
  await page.getByText('completed', { exact: true }).waitFor();
  await reply(delayed, 'completed_with_issues');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('output').textContent(), 'completed');
  scenario = 'poll'; requests = 0;
  await page.reload();
  await page.getByText('completed', { exact: true }).waitFor({ timeout: 10000 });
  const terminalRequests = requests;
  await page.waitForTimeout(3200);
  assert.equal(requests, terminalRequests, 'completed jobs stop polling');
  console.log('Distribution polling and stale-response regression passed');
} finally { await browser?.close(); await server.close(); }
