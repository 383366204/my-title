import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ECOM_PLAYWRIGHT_MODULE || 'playwright');
const { scoreRootReviewCandidate } = require('../../skills/pipeline-flow/src/root-opportunity-review');
const defaults = { demandSupplyRatio: { enabled: true, value: 1 }, searchPopularity: { enabled: true, value: 50 }, conversionRate: { enabled: true, value: 1 }, tmallClickShare: { enabled: true, value: 50 } };
const source = [
  { keyword: '杯垫', root: '垫子', sycmData: { searchPopularity: 100, searchPopularity_trend: '35%', searchPopularity_trendDirection: 'up', demandSupplyRatio: 2, demandSupplyRatio_trend: '12%', demandSupplyRatio_trendDirection: 'down', conversionRate: '2%', conversionRate_trend: '8%', conversionRate_trendDirection: 'up', tmallClickShare: '20%', tmallClickShare_trend: '6%', tmallClickShare_trendDirection: 'down' } },
  { keyword: '茶托', root: '茶具', sycmData: { searchPopularity: '20 ~ 50-35%', demandSupplyRatio: 2, conversionRate: '2%', tmallClickShare: '60%' } }
];
const artifact = config => ({ combinedOpportunityReview: true, keywordFilter: config, rows: source.map(row => {
  const scored = scoreRootReviewCandidate(row, config);
  // 模拟未保存新版展示字段的历史筛选结果。
  if (row.keyword === '茶托') for (const check of scored.metricFilter.checks) {
    delete check.displayValue; delete check.trendRaw; delete check.trendDirection;
  }
  return scored;
}) });
const harness = `import React from 'react';import {createRoot} from 'react-dom/client';
import '/src/index.css';import '/src/App.css';
import {KeywordReviewOperationPanel} from '/src/features/workflow/components/keyword-review-operation-panel.jsx';
import {KeywordFilterModal} from '/src/features/workflow/components/keyword-filter-modal.jsx';
function App(){const [state,setState]=React.useState({status:'ready',artifact:${JSON.stringify(artifact(defaults))}});
 const [solo,setSolo]=React.useState(false);window.showSolo=()=>setSolo(true);window.submissions=window.submissions||0;
 return solo?React.createElement(KeywordFilterModal,{runId:'fixture',onApplied:()=>{},onRecollected:result=>{window.recollected=result},onClose:()=>setSolo(false)}):React.createElement(KeywordReviewOperationPanel,{
 currentRunId:'fixture',artifactState:state,canConfirm:true,canRetryMine:false,
 onConfirmKeywordReview:async()=>{window.submissions++},onKeywordFilterApplied:result=>setState({status:'ready',artifact:result.artifact})});}
createRoot(document.getElementById('root')).render(React.createElement(App));`;
const server = await createServer({ root: fileURLToPath(new URL('../../apps/web', import.meta.url)), server: { host: '127.0.0.1', port: 0, proxy: {} }, plugins: [{
  name: 'filter-fixture', resolveId: id => id === '/__filter.js' ? id : null, load: id => id === '/__filter.js' ? harness : null,
  configureServer(vite) { vite.middlewares.use((req, res, next) => {
    if (req.url !== '/__filter') return next();
    res.setHeader('Content-Type', 'text/html');
    vite.transformIndexHtml('/__filter', '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__filter.js"></script></body></html>').then(html => res.end(html)).catch(next);
  }); }
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let config = structuredClone(defaults), version = 0, editable = true, conflict = false, requiresRecollection = false;
  const recollections = [];
  const posts = [];
  await page.route('**/api/**', async route => {
    if (!new URL(route.request().url()).pathname.startsWith('/api/')) return route.continue();
    if (route.request().url().endsWith('/keyword-filter/recollect')) {
      recollections.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true, data: { runId: 'new-fixture' } } });
    }
    assert.ok(route.request().url().endsWith('/keyword-filter'), 'No external collection or workflow advance');
    if (route.request().method() === 'POST') {
      const input = route.request().postDataJSON();
      posts.push(input);
      if (conflict) return route.fulfill({ status: 409, json: { ok: false, error: '筛选条件已更新，请重新打开弹窗' } });
      assert.equal(input.version, version);
      config = input.config;
      version++;
    }
    await route.fulfill({ json: { ok: true, data: { config, version, editable, requiresRecollection, recollectionSupported: true, artifact: { ...artifact(config), keywordFilterVersion: version } } } });
  });
  const url = `http://127.0.0.1:${server.httpServer.address().port}/__filter`;
  await page.goto(url);
  const left = page.getByRole('region', { name: '不符合 / 待判断', exact: true });
  const right = page.getByRole('region', { name: '符合条件 / 已保留', exact: true });
  assert.equal(await left.getByText('茶托', { exact: true }).count(), 1);
  assert.equal(await right.getByText('杯垫', { exact: true }).count(), 1);
  assert.equal(await page.locator('.keyword-transfer-row').getByText(/^(不符合条件|符合条件)$/).count(), 0);
  assert.equal(await page.locator('.keyword-transfer-row details').count(), 0);
  assert.equal(await page.getByText('指标与筛选原因', { exact: true }).count(), 0);
  assert.equal(await right.locator('.keyword-transfer-metrics .keyword-check-passed').count(), 4);
  assert.equal(await left.locator('.keyword-transfer-metrics .keyword-check-failed').count(), 2);
  assert.equal(await right.locator('.keyword-check-passed').first().evaluate(el => getComputedStyle(el).color), 'rgb(110, 231, 183)');
  assert.equal(await left.locator('.keyword-check-failed').first().evaluate(el => getComputedStyle(el).color), 'rgb(248, 113, 113)');
  const heading = right.locator('.keyword-transfer-heading');
  const legacyMetric = left.locator('.keyword-transfer-metrics > span').first();
  assert.ok((await legacyMetric.innerText()).includes('人气 20 ~ 50'));
  assert.equal(await legacyMetric.locator('.keyword-metric-trend').innerText(), '-35%');
  assert.equal(await legacyMetric.locator('[aria-label="下降"]').count(), 1);
  assert.equal(await legacyMetric.locator('.keyword-metric-trend').evaluate(el => getComputedStyle(el).color), 'rgb(110, 231, 183)');
  assert.equal(await heading.getByText('词根：垫子', { exact: true }).count(), 1);
  const metrics = right.locator('.keyword-transfer-metrics');
  assert.equal(await metrics.locator(':scope > span').count(), 4);
  for (const [index, label, trend, direction] of [[0, '人气 100', '35%', '上涨'], [1, '供需 2', '12%', '下降'], [2, '转化 2%', '8%', '上涨'], [3, '天猫占比 20%', '6%', '下降']]) {
    const item = metrics.locator(':scope > span').nth(index);
    assert.ok((await item.innerText()).includes(label));
    assert.equal((await item.locator('.keyword-metric-trend').innerText()).trim(), trend);
    assert.equal(await item.locator(`[aria-label="${direction}"]`).count(), 1);
  }
  const headingBox = await heading.boundingBox();
  const metricsBox = await metrics.boundingBox();
  assert.ok(metricsBox.y >= headingBox.y + headingBox.height);
  await left.getByRole('checkbox', { name: '选择 茶托', exact: true }).check();
  await left.getByRole('button', { name: '保留所选 1', exact: true }).click();
  assert.equal(await right.getByText('茶托', { exact: true }).count(), 1);
  await page.getByRole('button', { name: '确认 2 个词并继续' }).click();
  await page.getByRole('alertdialog', { name: '确认人工放行' }).waitFor();
  await page.getByRole('button', { name: '返回调整', exact: true }).click();
  await page.getByRole('button', { name: '筛选条件', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '关键词筛选条件' });
  await dialog.getByRole('button', { name: '应用并重新筛选' }).waitFor();
  for (const [name, value] of [['需求供给比', '1'], ['搜索人气', '50'], ['支付转化率', '1'], ['天猫商品点击占比', '50']]) {
    assert.equal(await dialog.getByRole('spinbutton', { name, exact: true }).inputValue(), value);
  }
  await dialog.getByRole('spinbutton', { name: '搜索人气', exact: true }).fill('200');
  await dialog.getByRole('button', { name: '应用并重新筛选' }).click();
  await dialog.getByText(/筛选条件已保存/).waitFor();
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].decisions, { 茶托: 'approved' });
  assert.equal(await page.evaluate(() => window.submissions), 0);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  assert.equal(await right.getByText('茶托', { exact: true }).count(), 1);
  assert.equal(await left.getByText('杯垫', { exact: true }).count(), 1);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const a = await left.boundingBox(), b = await right.boundingBox();
    assert.ok(a.x + a.width <= b.x);
    await page.screenshot({ path: `/tmp/keyword-transfer-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: '筛选条件', exact: true }).click();
  assert.equal(await dialog.getByRole('spinbutton', { name: '搜索人气', exact: true }).inputValue(), '200');
  await dialog.getByRole('button', { name: '恢复默认' }).click();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(posts.length, 1);
  await page.reload();
  await page.evaluate(() => window.showSolo());
  await dialog.getByRole('button', { name: '应用并重新筛选' }).waitFor();
  assert.equal(await dialog.getByRole('spinbutton', { name: '搜索人气', exact: true }).inputValue(), '200');
  mkdirSync('output/keyword-filter-qa', { recursive: true });
  await page.screenshot({ path: 'output/keyword-filter-qa/desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await dialog.boundingBox();
  await page.screenshot({ path: 'output/keyword-filter-qa/mobile.png' });
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844, JSON.stringify(box));
  assert.ok(Math.abs(box.x + box.width / 2 - 195) < 2);
  assert.ok(Math.abs(box.y + box.height / 2 - 422) < 2);
  assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth));
  const toggle = await dialog.locator('.keyword-filter-toggle').first().evaluate(label => {
    const input = label.querySelector('input').getBoundingClientRect();
    const text = label.querySelector('span').getBoundingClientRect();
    return { width: input.width, gap: text.left - input.right, center: Math.abs((input.top + input.bottom - text.top - text.bottom) / 2) };
  });
  assert.equal(toggle.width, 16);
  assert.ok(toggle.gap >= 0 && toggle.gap <= 10 && toggle.center < 2, JSON.stringify(toggle));
  await page.screenshot({ path: 'output/keyword-filter-qa/mobile.png' });
  conflict = true;
  await dialog.getByRole('button', { name: '应用并重新筛选' }).click();
  await dialog.getByRole('alert').filter({ hasText: '筛选条件已更新' }).waitFor();
  await page.keyboard.press('Escape');
  requiresRecollection = true;
  conflict = false;
  await dialog.waitFor({ state: 'hidden' });
  await page.evaluate(() => window.showSolo());
  await dialog.getByRole('button', { name: '重新采集', exact: true }).click();
  assert.equal(recollections.length, 0);
  await dialog.getByRole('button', { name: '确认重新采集', exact: true }).click();
  await page.waitForFunction(() => window.recollected?.runId === 'new-fixture');
  assert.equal(recollections.length, 1);
  assert.equal(recollections[0].version, version);
  await page.keyboard.press('Escape');
  editable = false;
  await page.reload();
  await page.evaluate(() => window.showSolo());
  await dialog.getByText(/只读/).waitFor();
  assert.equal(await dialog.getByRole('spinbutton', { name: '搜索人气', exact: true }).isDisabled(), true);
  assert.equal(await dialog.getByRole('button', { name: '应用并重新筛选' }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('Keyword filter browser regression passed');
} finally { await browser?.close(); await server.close(); }
