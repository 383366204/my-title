/**
 * Phase 0.2: Artifact isolation under run switching.
 *
 * Coverage: mounts the REAL useNodeArtifact hook with a mocked artifact
 * API. Verifies that out-of-order responses (old run returning after
 * new run) cannot overwrite current state — the hook's cancellation
 * logic discards stale responses.
 *
 * Not covered: draft autosave cross-run isolation (requires mounting
 * the full draft component with persistent storage; deferred to Phase 3
 * when Studio is decomposed and draft logic is independently testable).
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ECOM_PLAYWRIGHT_MODULE || 'playwright');

// Harness mounts the REAL useNodeArtifact hook + real selectVerifiedRows
const harness = `
import React, { useState, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { useNodeArtifact } from '/src/features/workflow/hooks/use-node-artifact.js';
import { selectVerifiedRows } from '/src/features/workflow/select-verified-rows.js';
import { artifactItems } from '/src/features/workflow/workflow-data.js';

function ArtifactTest() {
  const [runId, setRunId] = useState('run-A');
  const nodeId = 'verify';

  // REAL hook — calls getWorkflowArtifact API (mocked by route handler)
  const [artifactState, setArtifactState, refreshArtifact] = useNodeArtifact({
    runId, nodeId, limit: undefined
  });

  // REAL selectVerifiedRows with the hook's artifactState
  const verifiedRows = useMemo(() => selectVerifiedRows({
    nodes: [], verifiedArtifactRows: [], artifactState, artifactItems
  }), [artifactState]);

  window.switchRun = (id) => setRunId(id);
  window.artifactState = artifactState;
  window.verifiedRows = verifiedRows;

  return React.createElement('div', null,
    React.createElement('div', { 'data-testid': 'run-id' }, runId),
    React.createElement('div', { 'data-testid': 'artifact-status' }, artifactState.status),
    React.createElement('div', { 'data-testid': 'artifact-run-id' }, artifactState.artifact?.runId || 'none'),
    React.createElement('div', { 'data-testid': 'rows-count' }, String(verifiedRows.length)),
    React.createElement('div', { 'data-testid': 'first-keyword' }, verifiedRows[0]?.keyword || 'none')
  );
}

createRoot(document.getElementById('root')).render(React.createElement(ArtifactTest));
`;

const server = await createServer({
  root: fileURLToPath(new URL('../../apps/web', import.meta.url)),
  server: { host: '127.0.0.1', port: 0, proxy: {} },
  plugins: [{
    name: 'isolation-fixture',
    resolveId(id) { if (id === '/__isolation.js') return id; },
    load(id) { if (id === '/__isolation.js') return harness; },
    configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        if (req.url !== '/__isolation') return next();
        res.setHeader('Content-Type', 'text/html');
        vite.transformIndexHtml('/__isolation', '<html><body><div id="root"></div><script type="module" src="/__isolation.js"></script></body></html>')
          .then(html => res.end(html)).catch(next);
      });
    }
  }]
});

let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();

  // Mock the artifact API with controllable delays per runId.
  let delayMap = {};
  let requestLog = []; // track which requests were made and when they resolved
  await page.route('**/api/workflows/runs/*/artifacts/*', async route => {
    const url = new URL(route.request().url());
    const pathParts = url.pathname.split('/');
    const requestRunId = pathParts[4];
    const delay = delayMap[requestRunId] || 20;
    requestLog.push({ runId: requestRunId, phase: 'start', ts: Date.now() });
    const response = {
      ok: true,
      data: {
        runId: requestRunId,
        nodeId: 'verify',
        items: [{ keyword: `kw-${requestRunId}` }]
      }
    };
    if (delay > 0) await new Promise(r => setTimeout(r, delay));
    requestLog.push({ runId: requestRunId, phase: 'end', ts: Date.now() });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });

  await page.exposeFunction('setApiDelay', (runId, ms) => { delayMap[runId] = ms; });
  await page.exposeFunction('getRequestLog', () => requestLog);
  await page.exposeFunction('clearRequestLog', () => { requestLog = []; });

  // --- Test 1: Normal initial load (fast) ---
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__isolation`);
  await page.locator('[data-testid="artifact-status"]').waitFor();
  await page.waitForTimeout(200);

  const initialStatus = await page.locator('[data-testid="artifact-status"]').textContent();
  assert.equal(initialStatus, 'ready', 'initial artifact should be ready');
  assert.equal(await page.locator('[data-testid="first-keyword"]').textContent(), 'kw-run-A');

  // --- Test 2: True out-of-order — switch while old request is in flight ---
  // Strategy: set run-A to slow BEFORE triggering a new A request, then
  // switch to fast run-B while A is still in flight.
  // Step 1: Set delays
  await page.evaluate(async () => {
    await window.clearRequestLog();
    await window.setApiDelay('run-A', 800);  // slow
    await window.setApiDelay('run-B', 30);   // fast
  });
  // Step 2: Trigger a fresh run-A request by switching away and back
  // (this starts a slow A request that we'll interrupt)
  await page.evaluate(() => window.switchRun('run-B'));
  await page.waitForTimeout(200); // let B finish
  // Now switch back to A — this starts the slow A request
  await page.evaluate(() => window.switchRun('run-A'));
  // Step 3: Immediately switch to B again while A is in flight (800ms delay)
  await page.waitForTimeout(10); // tiny wait to ensure A request has been sent
  await page.evaluate(() => window.switchRun('run-B'));

  // Wait for run-B to resolve (30ms + margin)
  await page.waitForTimeout(150);
  assert.equal(
    await page.locator('[data-testid="first-keyword"]').textContent(),
    'kw-run-B', 'run-B should display after its fast response'
  );
  assert.equal(
    await page.locator('[data-testid="artifact-run-id"]').textContent(),
    'run-B', 'artifact runId should be run-B'
  );

  // Now wait for run-A's stale response to arrive (800ms total)
  await page.waitForTimeout(900);

  // Critical assertion: stale run-A must NOT have overwritten run-B
  assert.equal(
    await page.locator('[data-testid="first-keyword"]').textContent(),
    'kw-run-B', 'stale run-A response must NOT overwrite run-B'
  );
  assert.equal(
    await page.locator('[data-testid="artifact-run-id"]').textContent(),
    'run-B', 'artifact runId must remain run-B after stale response'
  );

  // Verify both requests actually happened (A was in flight when B started)
  const log = await page.evaluate(() => window.getRequestLog());
  const aStarts = log.filter(e => e.runId === 'run-A' && e.phase === 'start');
  const bStarts = log.filter(e => e.runId === 'run-B' && e.phase === 'start');
  const aEnds = log.filter(e => e.runId === 'run-A' && e.phase === 'end');
  const bEnds = log.filter(e => e.runId === 'run-B' && e.phase === 'end');
  assert.ok(aStarts.length >= 1, 'run-A request should have been made');
  assert.ok(bStarts.length >= 1, 'run-B request should have been made');
  assert.ok(aEnds.length >= 1, 'run-A response should have arrived (stale)');
  assert.ok(bEnds.length >= 1, 'run-B response should have arrived');
  // B ended before A ended — true out-of-order
  assert.ok(bEnds[0].ts < aEnds[aEnds.length - 1].ts,
    'run-B must resolve before run-A to constitute a true out-of-order test');

  // --- Test 3: Normal switching still works after out-of-order ---
  await page.evaluate(async () => {
    await window.setApiDelay('run-A', 20);
    await window.setApiDelay('run-B', 20);
  });
  await page.evaluate(() => window.switchRun('run-A'));
  await page.waitForTimeout(200);
  assert.equal(
    await page.locator('[data-testid="first-keyword"]').textContent(),
    'kw-run-A', 'normal switch back should work after out-of-order test'
  );

  console.log('Run-switch isolation test passed (real useNodeArtifact hook)');
} finally {
  await browser?.close();
  await server.close();
}
