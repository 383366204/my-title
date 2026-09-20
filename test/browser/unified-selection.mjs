import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ECOM_PLAYWRIGHT_MODULE || 'playwright');
const { listProductionWorkflowTemplates } = require('../../core/workflow/pipeline-templates');
const { validateProductionWorkflow } = require('../../core/workflow/pipeline-params');
const root = fileURLToPath(new URL('../../apps/web', import.meta.url));
const harness = `import React from 'react'; import {createRoot} from 'react-dom/client';
import WorkflowStudio from '/src/WorkflowStudio.jsx';
import '/src/index.css';
import {KeywordReviewOperationPanel} from '/src/features/workflow/components/keyword-review-operation-panel.jsx';
import {ManualProductSelectionPanel} from '/src/features/workflow/components/manual-product-selection-panel.jsx';
const root = createRoot(document.getElementById('root'));
root.render(React.createElement(WorkflowStudio));
window.reviewSubmissions = [];
window.reviewQueries = [];
window.showReview = () => root.render(React.createElement(KeywordReviewOperationPanel, {
  artifactState: {status:'ready',artifact:{combinedOpportunityReview:true,rows:[
    {keyword:'推荐词',reviewRecommended:true,sycmData:{searchPopularity:500},sycmScore:{passed:true,score:80},keywordOpportunity:{score:80}},
    {keyword:'待判断词',reviewRecommended:false,sycmData:{searchPopularity:10},sycmScore:{passed:false,score:20},keywordOpportunity:{score:20}}
  ]}},canConfirm:true,canRetryMine:false,onConfirmKeywordReview:async rows => window.reviewSubmissions.push(rows),
  onQueryKeywords:async input => window.reviewQueries.push(input)
}));
window.productSubmissions = [];
window.showProductSelection = (includeProduct = false) => root.render(React.createElement(ManualProductSelectionPanel, {
  currentRunId:'fixture', canRetry:true, onRetry:()=>{}, onConfirm:async input=>window.productSubmissions.push(input),
  artifactState:{status:'ready',artifact:{rows:[
    {status:'select_failed',keyword:'收纳盒',error:'Request failed with status code 502'},
    ...(includeProduct ? [{keyword:'杯垫',product:{'产品链接':'https://detail.1688.com/offer/123.html',subject:'硅藻土杯垫',categoryName:'杯垫类目'}}] : [])
  ]}}
}));`;
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, proxy: {} }, plugins: [{
  name: 'selection-fixture',
  resolveId(id) { if (id === '/__selection.js') return id; },
  load(id) { if (id === '/__selection.js') return harness; },
  configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (req.url !== '/__selection') return next();
      res.setHeader('Content-Type', 'text/html');
      vite.transformIndexHtml('/__selection', '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__selection.js"></script></body></html>').then(html => res.end(html)).catch(next);
    });
  }
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  const launches = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  // 所有业务请求使用夹具，不能触发真实查询或铺货。
  await page.route('**/api/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.startsWith('/api/')) return route.continue();
    let data = {};
    if (pathname === '/api/workflows/templates') data = listProductionWorkflowTemplates();
    else if (pathname === '/api/workflows/runs') data = [];
    else if (pathname === '/api/workflows/validate') {
      const input = route.request().postDataJSON();
      const result = validateProductionWorkflow(input.workflow, input);
      return route.fulfill({ json: { ok: result.ok, data: result } });
    } else if (pathname === '/api/workflows/run') {
      launches.push(route.request().postDataJSON());
      data = { message: '模拟运行完成' };
    }
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__selection`);
  const start = page.locator('.react-flow__node').filter({ has: page.getByRole('group', { name: '选词模式' }) });
  try { await page.getByRole('radio', { name: '精确关键词', exact: true }).check(); }
  catch (error) { console.error(await page.locator('body').innerText()); throw error; }
  await page.getByRole('button', { name: '输入关键词', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '选词来源', exact: true });
  await dialog.getByRole('textbox').fill('杯垫\n桌面收纳盒');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '输入关键词', exact: true }).click();
  assert.equal(await dialog.getByRole('textbox').inputValue(), '');
  await dialog.getByRole('textbox').fill('杯垫\n桌面收纳盒');
  await dialog.getByRole('button', { name: '保存配置' }).click();
  await page.getByRole('radio', { name: '词根拓词', exact: true }).check();
  await page.getByRole('button', { name: '输入词根', exact: true }).click();
  await dialog.getByRole('button', { name: '类目词', exact: true }).click();
  await dialog.getByRole('checkbox', { name: '男装', exact: true }).check();
  await dialog.getByRole('button', { name: /加入.*词根|添加.*词根|加入输入框/ }).click();
  await dialog.getByRole('button', { name: '保存配置' }).click();
  await page.getByRole('radio', { name: '精确关键词', exact: true }).check();
  await page.getByRole('button', { name: '输入关键词', exact: true }).click();
  assert.equal(await dialog.getByRole('textbox').inputValue(), '杯垫\n桌面收纳盒');
  await dialog.getByRole('button', { name: '保存配置' }).click();
  await start.getByRole('button', { name: '启动流水线', exact: true }).click();
  await page.waitForFunction(() => document.body.textContent.includes('模拟运行完成'));
  assert.equal(launches.length, 1);
  assert.equal(launches[0].templateId, 'selection-v1');
  assert.equal(launches[0].mode, 'keyword');
  assert.deepEqual(launches[0].params.keywords, ['杯垫', '桌面收纳盒']);
  assert.deepEqual(launches[0].workflow.nodes.map(node => node.id), ['start', 'verify', 'keywordReview', 'select', 'generate', 'export', 'end']);
  mkdirSync('output/selection-qa', { recursive: true });
  await page.screenshot({ path: 'output/selection-qa/desktop.png', fullPage: true });
  await page.getByRole('button', { name: '输入关键词', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await dialog.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 391 && box.y >= 0 && box.y + box.height <= 845);
  assert.equal(await dialog.getByRole('button', { name: '保存配置' }).isVisible(), true);
  await page.screenshot({ path: 'output/selection-qa/mobile.png', fullPage: true });
  await page.evaluate(() => window.showReview());
  assert.equal(await page.getByRole('checkbox', { name: '采用 推荐词', exact: true }).isChecked(), true);
  assert.equal(await page.getByRole('checkbox', { name: '采用 待判断词', exact: true }).isChecked(), false);
  await page.getByRole('combobox', { name: '筛选候选词' }).selectOption('recommended');
  assert.equal(await page.getByRole('checkbox').count(), 1);
  await page.getByRole('combobox', { name: '筛选候选词' }).selectOption('all');
  await page.getByRole('checkbox', { name: '采用 待判断词', exact: true }).check();
  await page.getByRole('button', { name: '确认 2 个词并继续', exact: true }).click();
  await page.getByRole('alertdialog', { name: '确认人工放行' }).waitFor();
  assert.equal(await page.evaluate(() => window.reviewSubmissions.length), 0);
  await page.getByRole('button', { name: '确认人工放行', exact: true }).click();
  assert.equal(await page.evaluate(() => window.reviewSubmissions.length), 1);
  await page.getByRole('textbox', { name: '手动输入关键词' }).fill('茶杯,茶杯');
  await page.getByRole('button', { name: '查询补充词', exact: true }).click();
  const queryInput = await page.evaluate(() => window.reviewQueries[0]);
  assert.deepEqual(queryInput.keywords, ['茶杯']);
  assert.equal(queryInput.decisions['待判断词'], 'approved');
  await page.screenshot({ path: 'output/selection-qa/review-mobile.png', fullPage: true });
  await page.evaluate(() => window.showProductSelection());
  await page.getByRole('region', { name: '货源查询失败' }).waitFor();
  assert.equal(await page.getByRole('checkbox').count(), 0);
  assert.equal((await page.locator('body').innerText()).includes('未命名商品'), false);
  assert.ok((await page.locator('body').innerText()).includes('HTTP 502'));
  await page.evaluate(() => window.showProductSelection(true));
  await page.getByRole('checkbox').check();
  assert.ok((await page.locator('body').innerText()).includes('硅藻土杯垫'));
  assert.ok((await page.locator('body').innerText()).includes('杯垫类目'));
  await page.getByRole('button', { name: '确认并继续生成标题', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.productSubmissions[0].approvedProductIds), ['https://detail.1688.com/offer/123.html']);
  assert.deepEqual(errors, []);
  console.log('Unified selection browser regression passed');
} finally {
  await browser?.close();
  await server.close();
}
