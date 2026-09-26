import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ECOM_PLAYWRIGHT_MODULE || 'playwright');
const harness = `import React from 'react'; import {createRoot} from 'react-dom/client';
import {DiscoveryDimensionFields} from '/src/features/workflow/components/keyword-mining/discovery-dimension-fields.jsx';
function App() { const [data,setData]=React.useState({}); return React.createElement(DiscoveryDimensionFields,{node:{id:'start',data},onUpdateField:(id,key,value)=>{window.saved=value;setData({...data,[key]:value});}}); }
createRoot(document.getElementById('root')).render(React.createElement(App));`;
const server = await createServer({ root: fileURLToPath(new URL('../../apps/web', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'direction-fixture', resolveId: id => id === '/__direction.js' ? id : null, load: id => id === '/__direction.js' ? harness : null,
  configureServer(vite) { vite.middlewares.use((req,res,next) => {
    if (req.url !== '/__direction') return next();
    res.setHeader('Content-Type','text/html');
    vite.transformIndexHtml('/__direction','<html><body><div id="root"></div><script type="module" src="/__direction.js"></script></body></html>').then(html=>res.end(html)).catch(next);
  }); }
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__direction`);
  await page.getByRole('textbox', { name: '选词方向' }).fill('租房青年厨房收纳\n排除电器');
  assert.equal(await page.getByRole('textbox').count(), 1);
  assert.equal(await page.getByRole('checkbox').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.saved), { direction: ['租房青年厨房收纳\n排除电器'] });
  console.log('Direction input browser test passed');
} finally { await browser?.close(); await server.close(); }
