import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ECOM_PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../../apps/web', import.meta.url));
const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-session-vite-'));
const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useWorkflowSession } from '/src/features/workflow/hooks/use-workflow-session.js';
import { useWorkflowRuntime } from '/src/features/workflow/hooks/use-workflow-runtime.js';
import { useWorkflowRunCatalog } from '/src/features/workflow/hooks/use-workflow-run-catalog.js';
import { deleteWorkflowRun } from '/src/api/workflow-api.js';
window.requests = []; window.sources = []; window.operations = {};
window.fetch = (url, options) => new Promise(resolve => window.requests.push({ url, options, resolve }));
window.confirm = () => true;
window.EventSource = class {
  constructor(url) { this.url = url; this.readyState = 1; window.sources.push(this); }
  close() { this.closed = true; }
  emit(data) { this.onmessage?.({data: JSON.stringify(data)}); }
};
const template = {id:'fixture-template', mode:'daily', workflow:{ id:'fixture-template', mode:'daily', nodes:[
  {id:'start',type:'production-start',position:{x:0,y:0},data:{}},
  {id:'mine',type:'pipeline-mine',position:{x:300,y:0},data:{}},
  {id:'end',type:'production-end',position:{x:600,y:0},data:{}}
],edges:[]}};
const templates = [template];
const noop = () => {};
function Session() {
  const [nodes,setNodes] = useState([]); const [edges,setEdges] = useState([]);
  const [selected,setSelectedNodeId] = useState(null);
  const runtime = useWorkflowRuntime({setNodes,setSelectedNodeId,refreshHistory:noop});
  const session = useWorkflowSession({nodes,edges,templates,activeTemplateMode:'daily',currentRunId:runtime.currentRunId,
    isRunActive:false,setNodes,setEdges,setSelectedNodeId,setActiveTemplateId:noop,setActiveTemplateMode:noop,
    ...runtime,setArtifactState:noop,closeOverlay:noop,dispatchNodeAction:noop,dispatchNodeArtifactView:noop,dispatchNodeUpdate:noop,
    launchWorkflow:noop,removeHistoryRun:deleteWorkflowRun});
  window.api = {...runtime,...session,reset:()=>session.loadTemplate(template)};
  window.state = {nodes,selected,runId:runtime.currentRunId,status:runtime.runStatus,logs:runtime.logs};
  return null;
}
function Catalog() { const catalog = useWorkflowRunCatalog(); window.api = catalog; window.state = catalog; return null; }
const app = createRoot(document.getElementById('root'));
window.mount = kind => flushSync(()=>app.render(React.createElement(React.StrictMode,null,React.createElement(kind==='catalog'?Catalog:Session))));
window.unmount = () => flushSync(()=>app.render(null));
window.start = (key, method, ...args) => { window.operations[key] = window.api[method](...args); };
window.reply = (index,data,ok=true) => window.requests[index].resolve(new Response(JSON.stringify({ok,data,error:'fixture failure'}),{status:ok?200:500}));
window.record = id => ({runId:id,status:'paused',workflow:template.workflow,nodeStates:{mine:{status:'paused'}},logs:[]});
window.mount('session');
`;
const server = await createServer({ root, cacheDir, configFile: false, server: { host: '127.0.0.1', port: 0 },
  optimizeDeps: { include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client', '@xyflow/react', 'use-sync-external-store/shim/with-selector.js'], noDiscovery: true },
  plugins: [{ name: 'session-race-fixture',
    resolveId(id) { if (id === '/__session.js') return id; },
    load(id) { if (id === '/__session.js') return harness; },
    configureServer(vite) { vite.middlewares.use((req,res,next) => {
      if (req.url !== '/__session') return next();
      res.setHeader('Content-Type','text/html');
      res.end('<div id="root"></div><script type="module" src="/__session.js"></script>');
    }); }
  }] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = `http://127.0.0.1:${server.httpServer.address().port}/__session`;
  const fresh = async () => {
    await page.goto(url);
    await page.waitForFunction(() => window.api && window.state.nodes.length === 3, null, { timeout: 10000 }).catch(async error => {
      console.error({ errors, state: await page.evaluate(() => window.state), html: await page.locator('body').innerText() });
      throw error;
    });
  };
  for (const ok of [true, false]) {
    await fresh();
    await page.evaluate(() => { window.start('A','loadHistoryRun','A'); window.start('B','loadHistoryRun','B'); });
    await page.evaluate(async () => { window.reply(1,window.record('B')); await window.operations.B; });
    await page.waitForFunction(() => window.state.runId === 'B' && window.state.status === 'paused');
    await page.evaluate(async ok => { window.reply(0,window.record('A'),ok); await window.operations.A; },ok);
    assert.equal(await page.evaluate(() => window.state.runId),'B');
    assert.equal(await page.evaluate(() => window.state.status),'paused');
  }
  await fresh();
  await page.evaluate(async () => { window.start('A','loadHistoryRun','A'); window.api.reset(); window.reply(0,window.record('A')); await window.operations.A; });
  await page.waitForFunction(() => window.state.runId === null);
  assert.equal(await page.evaluate(() => window.state.status),'idle');
  await fresh();
  await page.evaluate(async () => { window.start('A','loadHistoryRun','A'); window.reply(0,window.record('A')); await window.operations.A; });
  await page.waitForFunction(() => window.state.status === 'paused');
  await page.evaluate(() => { window.start('delete','deleteHistoryRun','A'); window.start('B','loadHistoryRun','B'); });
  await page.evaluate(async () => { window.reply(2,window.record('B')); await window.operations.B; window.reply(1,{}); await window.operations.delete; });
  assert.equal(await page.evaluate(() => window.state.runId),'B');
  await fresh();
  await page.evaluate(() => { window.api.listenToRunEvents('A'); window.sources[0].emit({event:'init',payload:{status:'running',nodeStates:{mine:{status:'running',cooldownRemainingMs:900,blocker:'old'}}}}); });
  await page.waitForFunction(() => window.state.status === 'running');
  await page.evaluate(() => {
    const frame = {event:'progress',payload:{eventId:'1',step:'mine',status:'running',current:0,total:10,cooldownRemainingMs:0,blocker:null,message:'unique'}};
    window.sources[0].emit(frame); window.sources[0].emit(frame);
  });
  await page.waitForFunction(() => window.state.logs.length === 1);
  assert.equal(await page.evaluate(() => window.state.nodes.find(n=>n.id==='mine').data.cooldownRemainingMs),0);
  assert.equal(await page.evaluate(() => window.state.nodes.find(n=>n.id==='mine').data.blocker),null);
  await page.evaluate(() => window.sources[0].emit({event:'progress',payload:{eventId:'2',step:'mine',status:'failed',replay:true,message:'past'}}));
  await page.waitForFunction(() => window.state.logs.length === 2);
  assert.equal(await page.evaluate(() => window.state.nodes.find(n=>n.id==='mine').data.status),'running');
  await page.evaluate(() => {
    window.api.listenToRunEvents('B');
    window.sources[0].emit({event:'init',payload:{status:'failed'}});
    window.sources[1].emit({event:'init',payload:{status:'completed',nodeStates:{end:{status:'completed'}}}});
    window.sources[1].emit({event:'status_change',payload:{status:'completed'}});
  });
  await page.waitForFunction(() => window.state.status === 'completed');
  assert.equal(await page.evaluate(() => window.state.nodes.find(n=>n.id==='end').data.status),'completed');
  assert.ok(await page.evaluate(() => window.sources.every(s=>s.closed)));

  await fresh();
  await page.evaluate(async () => {
    window.start('pending','loadHistoryRun','A');
    window.unmount();
    window.reply(0,{...window.record('A'),status:'running'});
    await window.operations.pending;
  });
  assert.equal(await page.evaluate(() => window.sources.length),0,'unmounted history response must not subscribe');

  await fresh();
  await page.evaluate(() => window.mount('catalog'));
  await page.waitForFunction(() => window.requests.length >= 4);
  await page.evaluate(() => window.requests.forEach((r,i) => window.reply(i,r.url.includes('templates')?[]:[{runId:'A'},{runId:'B'}])));
  await page.waitForFunction(() => window.state.historyRuns.length === 2 && !window.state.historyLoading);
  const offset = await page.evaluate(() => window.requests.length);
  await page.evaluate(() => { window.start('old','refreshHistory'); window.start('new','refreshHistory'); });
  await page.evaluate(async i => { window.reply(i+1,[{runId:'B'}]); await window.operations.new; window.reply(i,[{runId:'A'}]); await window.operations.old; },offset);
  await page.waitForFunction(() => window.state.historyRuns[0].runId === 'B');
  const next = await page.evaluate(() => window.requests.length);
  await page.evaluate(() => { window.start('refresh','refreshHistory'); window.start('delete','removeHistoryRun','B'); });
  await page.evaluate(async i => { window.reply(i+1,{}); await window.operations.delete; window.reply(i,[{runId:'B'}]); await window.operations.refresh; },next);
  await page.waitForFunction(() => window.state.historyRuns.length === 0);
  const failureIndex = await page.evaluate(() => window.requests.length);
  await page.evaluate(() => window.start('failure','refreshHistory'));
  await page.evaluate(async i => { window.reply(i,null,false); await window.operations.failure; },failureIndex);
  await page.waitForFunction(() => window.state.historyError === 'fixture failure');
  assert.equal(await page.evaluate(() => window.state.historyLoading),false);
  const restoreIndex = await page.evaluate(() => window.requests.length);
  await page.evaluate(() => window.start('restore','refreshHistory'));
  await page.evaluate(async i => { window.reply(i,[{runId:'C'},{runId:'D'}]); await window.operations.restore; },restoreIndex);
  await page.waitForFunction(() => window.state.historyRuns.length === 2);
  const deletes = await page.evaluate(() => window.requests.length);
  await page.evaluate(() => { window.start('C','removeHistoryRun','C'); window.start('D','removeHistoryRun','D'); });
  await page.evaluate(async i => { window.reply(i,{}); await window.operations.C; },deletes);
  await page.waitForFunction(() => window.state.historyRuns.length === 1);
  assert.equal(await page.evaluate(() => window.state.deletingRunId),'D');
  await page.evaluate(async i => { window.reply(i+1,{}); await window.operations.D; },deletes);
  await page.waitForFunction(() => window.state.historyRuns.length === 0 && window.state.deletingRunId === '');
  assert.deepEqual(errors, []);
  console.log('PASS: history ordering/reset/delete, SSE replay/dedup/terminal isolation, catalog refresh ordering/delete/error. All HTTP mocked.');
} finally {
  await browser?.close();
  await server.close();
  fs.rmSync(cacheDir, { recursive: true, force: true });
}
