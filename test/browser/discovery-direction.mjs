import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ECOM_PLAYWRIGHT_MODULE || 'playwright');
const harness = `import React from 'react'; import {createRoot} from 'react-dom/client';
import '/src/styles/node-workbench.css';
import {SelectionSourcePanel} from '/src/features/workflow/components/selection-source-panel.jsx';
function App() { return React.createElement(SelectionSourcePanel,{node:{id:'start',data:{selectionMode:'daily'}},saveAsNew:true,onSave:(id,value)=>{window.saved=value;},onClose:()=>{}}); }
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
  assert.equal(await page.getByRole('checkbox', { name: '拓词前暂停，人工检查词根' }).count(), 1);
  await page.getByRole('checkbox', { name: '拓词前暂停，人工检查词根' }).check();
  for (const width of [1200, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const boxes = await page.locator('.inspiration-root-review-toggle').evaluate(label => {
      const input = label.querySelector('input').getBoundingClientRect();
      const text = label.querySelector('span').getBoundingClientRect();
      return { gap: text.left - input.right, center: Math.abs((input.top + input.bottom - text.top - text.bottom) / 2) };
    });
    assert.ok(boxes.gap >= 0 && boxes.gap <= 10);
    assert.ok(boxes.center < 2);
  }
  assert.equal(await page.getByRole('button', { name: /关闭|取消|完成配置/ }).count(), 0);
  await page.getByRole('button', { name: '保存为新流程' }).click();
  assert.deepEqual(await page.evaluate(() => window.saved.customInputs), { direction: ['租房青年厨房收纳\n排除电器'] });
  assert.equal(await page.evaluate(() => window.saved.reviewInspirationRoots), true);
  console.log('Direction input browser test passed');
} finally { await browser?.close(); await server.close(); }
