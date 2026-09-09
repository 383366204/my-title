import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ECOM_PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../../apps/web', import.meta.url));
const harness = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useWorkflowConfirmations } from '/src/features/workflow/hooks/use-workflow-confirmations.js';
import { useWorkflowCommands } from '/src/features/workflow/hooks/use-workflow-commands.js';
window.requests = []; window.effects = []; window.operations = {};
window.fetch = (url, options) => new Promise(resolve => window.requests.push({ url, options, resolve }));
window.alert = message => window.effects.push(['alert', message]);
function Harness({ runId, templateId }) {
  const record = name => (...args) => { window.effects.push([name, runId]); };
  const options = { currentRunId: runId, activeTemplateId: templateId, canCancelRun: true, activeTemplateMode: 'keyword',
    setLogs: record('logs'), setNodes: record('nodes'), setRunStatus: record('status'),
    setArtifactState: record('artifact'), closeOverlay: record('close'), listenToRunEvents: record('listen'),
    reloadRun: record('reload'), loadHistoryRun: record('history'), runWorkflowOperation: record('resume') };
  window.actions = { ...useWorkflowConfirmations(options), ...useWorkflowCommands(options) };
  return null;
}
const app = createRoot(document.getElementById('root'));
window.renderRun = (runId, templateId = 'daily') => flushSync(() => app.render(React.createElement(React.StrictMode, null, React.createElement(Harness, {runId, templateId}))));
window.clearRun = () => flushSync(() => app.render(null));
window.start = (key, method, args) => { window.operations[key] = window.actions[method](...args); };
window.reply = (index, ok) => window.requests[index].resolve(new Response(JSON.stringify({ok, data: {}, error: 'fixture failure'}), {status: ok ? 200 : 400}));
window.renderRun('A');
`;
const server = await createServer({
  root, configFile: false, server: { host: '127.0.0.1', port: 0 },
  optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client'], noDiscovery: true },
  plugins: [{
    name: 'isolated-hook-race-fixture',
    resolveId(id) { if (id === '/__hooks.js') return id; },
    load(id) { if (id === '/__hooks.js') return harness; },
    configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        if (req.url !== '/__hooks') return next();
        res.setHeader('Content-Type', 'text/html');
        res.end('<div id="root"></div><script type="module" src="/__hooks.js"></script>');
      });
    }
  }]
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = `http://127.0.0.1:${server.httpServer.address().port}/__hooks`;
  for (const [method, args] of [
    ['confirmKeywordReview', [[], []]], ['confirmProductReview', [{}]],
    ['confirmReviewDrafts', [[]]], ['confirmOrderSheetProducts', [[]]],
    ['handleCancelWorkflow', []], ['runRemoteOperation', ['pause', 'select']]
  ]) {
    for (const ok of [true, false]) {
      await page.goto(url);
      await page.waitForFunction(() => window.actions);
      await page.evaluate(({ method, args }) => {
        window.start('old', method, args);
        window.start('duplicate', method, args);
      }, { method, args });
      assert.equal(await page.evaluate(() => window.requests.length), 1, `${method}: duplicate request`);
      await page.evaluate(({ method, args }) => {
        window.renderRun('B'); window.start('new', method, args); window.effects = [];
      }, { method, args });
      assert.equal(await page.evaluate(() => window.requests.length), 2, `${method}: new run could not start`);
      await page.evaluate(async ok => { window.reply(0, ok); await window.operations.old; }, ok);
      assert.deepEqual(await page.evaluate(() => window.effects), [], `${method}: stale response wrote state`);
      await page.evaluate(({ method, args }) => window.start('newDuplicate', method, args), { method, args });
      assert.equal(await page.evaluate(() => window.requests.length), 2, `${method}: stale finally unlocked new request`);
      await page.evaluate(async () => {
        window.clearRun(); window.reply(1, true); await window.operations.new;
      });
      assert.deepEqual(await page.evaluate(() => window.effects), [], `${method}: response wrote after unmount`);
    }
    await page.goto(url);
    await page.waitForFunction(() => window.actions);
    await page.evaluate(({ method, args }) => {
      window.finished = false;
      window.start('normal', method, args);
      window.operations.normal.then(() => { window.finished = true; });
    }, { method, args });
    let replied = 0;
    while (!await page.evaluate(() => window.finished)) {
      await page.waitForFunction(count => window.finished || window.requests.length > count, replied);
      replied = await page.evaluate(count => {
        for (let i = count; i < window.requests.length; i++) window.reply(i, true);
        return window.requests.length;
      }, replied);
    }
    assert.ok(await page.evaluate(() => window.effects.some(([kind]) => kind === 'logs')), `${method}: current response was dropped`);
    await page.evaluate(({ method, args }) => window.start('again', method, args), { method, args });
    assert.equal(await page.evaluate(() => window.requests.length), replied + 1, `${method}: completed request remained locked`);
    await page.evaluate(async count => { window.clearRun(); window.reply(count, true); await window.operations.again; }, replied);
  }
  await page.goto(url);
  await page.waitForFunction(() => window.actions);
  await page.evaluate(async () => {
    window.renderRun(null, 'daily');
    window.start('chrome', 'runRemoteOperation', ['start-sycm-chrome', 'mine']);
    window.renderRun(null, 'keyword');
    window.effects = [];
    window.reply(0, true);
    await window.operations.chrome;
  });
  assert.deepEqual(await page.evaluate(() => window.effects), [], 'Chrome response leaked to a different unstarted template');
  assert.deepEqual(errors, []);
  console.log('PASS: 19 real React hook scenarios; success/release, duplicate, run/template switch, late success/failure, unmount. All HTTP mocked.');
} finally {
  await browser?.close();
  await server.close();
}
