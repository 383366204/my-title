import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ECOM_PLAYWRIGHT_MODULE || 'playwright');
const { listProductionWorkflowTemplates } = require('../../core/workflow/pipeline-templates');
const templates = listProductionWorkflowTemplates().filter(t => !['order-sheet', 'review-sheet'].includes(t.mode));
const root = fileURLToPath(new URL('../../apps/web', import.meta.url));
const output = process.env.ECOM_SCREENSHOT_DIR || '/tmp/workflow-studio-qa';
fs.mkdirSync(output, { recursive: true });
const history = { runId: 'fixture-history', mode: 'daily', status: 'completed', workflow: templates[0].workflow,
  nodeStates: Object.fromEntries(templates[0].workflow.nodes.map(n => [n.id, { status: 'completed', output: n.id === 'mine' ? { count: 60 } : null }])),
  logs: [{ timestamp: '2026-09-09T00:00:00Z', level: 'info', message: '离线测试日志' }] };
const requests = [];
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    requests.push({ method: route.request().method(), path: url.pathname });
    let data = {};
    if (url.pathname === '/api/workflows/templates') data = templates;
    else if (url.pathname === '/api/workflows/runs') data = [history];
    else if (url.pathname === '/api/workflows/runs/fixture-history') data = history;
    else if (url.pathname.includes('/artifacts/')) data = { type: 'json', count: 60, items: Array.from({ length: 60 }, (_, i) => ({ keyword: `杯垫${i + 1}`, reason: '离线产物长文本测试。'.repeat(12) })) };
    else if (url.pathname === '/api/seeds') data = { seeds: [] };
    else if (url.pathname === '/api/platform/status') data = {};
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
  });
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 980, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(origin);
    await page.locator('.react-flow__node').first().waitFor();
    await page.screenshot({ path: path.join(output, `initial-${viewport.width}.png`), animations: 'disabled' });
    if (await page.getByRole('button', { name: '展开选品流水线', exact: true }).count()) {
      await page.getByRole('button', { name: '展开选品流水线', exact: true }).click();
    }
    for (const template of templates) {
      await page.locator('#workflow-template-select').selectOption(template.id);
      await page.waitForFunction(count => document.querySelectorAll('.react-flow__node').length === count, template.workflow.nodes.length);
      assert.equal(await page.locator('.workflow-order-step').count(), template.workflow.nodes.length);
    }
    await page.locator('#workflow-template-select').selectOption(templates[0].id);
    await page.getByRole('button', { name: '收起选品流水线', exact: true }).click();
    await page.locator('.workflow-order-step').first().click();
    await page.getByRole('button', { name: '展开节点诊断', exact: true }).click();
    await page.screenshot({ path: path.join(output, `diagnostics-${viewport.width}.png`), animations: 'disabled' });
    if (!process.env.ECOM_CAPTURE_ONLY) {
      const panel = await page.locator('.workflow-right-sidebar').boundingBox();
      assert.ok(panel.width >= 280 && panel.x >= 0 && panel.x + panel.width <= viewport.width + 1);
    }
    await page.getByRole('button', { name: '收起节点诊断', exact: true }).click();
    const geometry = await page.evaluate(() => {
      const canvas = document.querySelector('.workflow-canvas-scroll');
      const consolePanel = document.querySelector('.workflow-console-panel').getBoundingClientRect();
      const run = [...document.querySelectorAll('button')].find(b => b.textContent.includes('运行工作流')).getBoundingClientRect();
      return { canvasWidth: canvas.clientWidth, pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
        consoleBottom: consolePanel.bottom, viewportHeight: innerHeight, runRight: run.right, runLeft: run.left };
    });
    assert.ok(geometry.canvasWidth > 250, JSON.stringify(geometry));
    assert.ok(geometry.pageWidth <= geometry.viewportWidth + 1, JSON.stringify(geometry));
    assert.ok(Math.abs(geometry.consoleBottom - geometry.viewportHeight) < 2, JSON.stringify(geometry));
    if (!process.env.ECOM_CAPTURE_ONLY) {
      assert.ok(geometry.runLeft >= 0 && geometry.runRight <= geometry.viewportWidth, JSON.stringify(geometry));
    }
    await page.getByRole('button', { name: '展开选品流水线', exact: true }).click();
    await page.locator('.monitor-run-card').click();
    await page.waitForFunction(() => document.querySelector('.workflow-top-context').textContent.includes('fixture-history'));
    await page.getByRole('button', { name: '收起选品流水线', exact: true }).click();
    const mine = page.locator('.react-flow__node[data-id="mine"]');
    await mine.getByRole('button', { name: '查看产物', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.locator('.artifact-business-row, .artifact-list pre').first().waitFor();
    await page.screenshot({ path: path.join(output, `artifact-${viewport.width}.png`), animations: 'disabled' });
    const list = page.locator('.artifact-business-list, .artifact-list').first();
    assert.ok(await list.evaluate(el => el.scrollHeight > el.clientHeight), 'long artifacts must have a scrollable viewport');
    await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.ok(await list.evaluate(el => el.scrollTop > 0));
    const dialog = await page.getByRole('dialog').boundingBox();
    assert.ok(dialog.x >= 0 && dialog.y >= 0 && dialog.x + dialog.width <= viewport.width + 1 && dialog.y + dialog.height <= viewport.height + 1);
    await page.getByRole('button', { name: /^关闭/ }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: '展开选品流水线', exact: true }).click();
    await page.locator('#workflow-template-select').selectOption(templates.find(t => t.mode === 'manual').id);
    await page.getByRole('button', { name: '收起选品流水线', exact: true }).click();
    await page.locator('.react-flow__node[data-id="start"] .production-node-action').click();
    const manual = page.getByRole('dialog', { name: '录入1688链接' });
    await manual.waitFor();
    for (let i = 0; i < 8; i++) await manual.getByRole('button', { name: '添加一行' }).click();
    const table = manual.locator('.manual-input-table');
    assert.ok(await table.evaluate(el => el.scrollHeight > el.clientHeight));
    await table.evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.ok(await table.evaluate(el => el.scrollTop > 0));
    await page.screenshot({ path: path.join(output, `manual-input-${viewport.width}.png`), animations: 'disabled' });
    await manual.getByRole('button', { name: '取消', exact: true }).click();
  }
  assert.deepEqual(errors, []);
  assert.equal(requests.filter(r => r.method !== 'GET').length, 0, 'visual tests must not launch workflows or mutate records');
  console.log(`PASS: five selection/analysis templates, three viewports, sidebars, history, long artifacts and manual-input scrolling. Screenshots: ${output}`);
} finally {
  await browser?.close();
  await server.close();
}
