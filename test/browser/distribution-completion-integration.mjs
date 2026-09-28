/**
 * Distribution completion integration test.
 *
 * Part 1: Mounts the REAL useDistributionJob hook — verifies polling,
 * status transitions, and terminal cessation.
 *
 * Part 2: Mounts the REAL useDistributionCompletion hook — verifies the
 * full Studio-level chain: export node update → overlay close → log append
 * → reloadRun call → fetchHistoryRuns call → dedup prevention.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ECOM_PLAYWRIGHT_MODULE || 'playwright');

// Harness mounts BOTH real hooks to test the full chain
const harness = `
import React, { useState, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { useDistributionJob } from '/src/features/workflow/hooks/use-distribution-job.js';
import { useDistributionCompletion } from '/src/features/workflow/hooks/use-distribution-completion.js';

function App() {
  // --- Tracking state for useDistributionCompletion side effects ---
  const [exportNodeData, setExportNodeData] = useState(null);
  const [overlayOpen, setOverlayOpen] = useState(true);
  const [logs, setLogs] = useState([]);
  const reloadRunCalls = useRef([]);
  const fetchHistoryCalls = useRef(0);

  // Mock setNodes: captures distributionJob updates on export node
  const setNodes = useCallback((updater) => {
    if (typeof updater === 'function') {
      // Simulate: updater maps nodes, we only care about export node
      const fakeNodes = [{ id: 'export', data: { distributionJob: exportNodeData } }];
      const result = updater(fakeNodes);
      const exportNode = result.find(n => n.id === 'export');
      if (exportNode) setExportNodeData(exportNode.data.distributionJob);
    }
  }, [exportNodeData]);

  const closeOverlay = useCallback(() => setOverlayOpen(false), []);
  const setLogsFn = useCallback((updater) => {
    setLogs(prev => typeof updater === 'function' ? updater(prev) : updater);
  }, []);
  const reloadRun = useCallback((...args) => {
    reloadRunCalls.current.push(args);
  }, []);
  const fetchHistoryRuns = useCallback(() => {
    fetchHistoryCalls.current++;
  }, []);

  // --- REAL useDistributionCompletion hook ---
  const { updateDistributionNodeJob } = useDistributionCompletion({
    setNodes, currentRunId: 'run-123', closeOverlay, setLogs: setLogsFn,
    reloadRun, fetchHistoryRuns
  });

  // --- REAL useDistributionJob hook ---
  const changeLog = useRef([]);
  const handleJobChange = useCallback((job) => {
    changeLog.current.push({ status: job?.status, jobId: job?.jobId });
    // Wire into the completion handler
    updateDistributionNodeJob(job);
  }, [updateDistributionNodeJob]);

  const { job } = useDistributionJob({
    initialJobId: 'completion-test',
    onJobChange: handleJobChange
  });

  // Expose for assertions
  window.state = {
    jobStatus: job?.status || 'none',
    exportJob: exportNodeData,
    overlayOpen,
    logCount: logs.length,
    lastLogMessage: logs.length > 0 ? logs[logs.length - 1].message : '',
    reloadRunCalls: reloadRunCalls.current.slice(),
    fetchHistoryCalls: fetchHistoryCalls.current,
    changeLogLength: changeLog.current.length
  };

  // Also expose direct trigger for manual testing
  window.triggerCompletion = (jobData) => updateDistributionNodeJob(jobData);

  return React.createElement('div', null,
    React.createElement('div', { 'data-testid': 'job-status' }, job?.status || 'none'),
    React.createElement('div', { 'data-testid': 'overlay' }, overlayOpen ? 'OPEN' : 'CLOSED'),
    React.createElement('div', { 'data-testid': 'log-count' }, String(logs.length)),
    React.createElement('div', { 'data-testid': 'reload-calls' }, String(reloadRunCalls.current.length)),
    React.createElement('div', { 'data-testid': 'fetch-calls' }, String(fetchHistoryCalls.current))
  );
}

createRoot(document.getElementById('root')).render(React.createElement(App));
`;

const server = await createServer({
  root: fileURLToPath(new URL('../../apps/web', import.meta.url)),
  server: { host: '127.0.0.1', port: 0, proxy: {} },
  plugins: [{
    name: 'completion-fixture',
    resolveId(id) { if (id === '/__completion.js') return id; },
    load(id) { if (id === '/__completion.js') return harness; },
    configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        if (req.url !== '/__completion') return next();
        res.setHeader('Content-Type', 'text/html');
        vite.transformIndexHtml('/__completion', '<html><body><div id="root"></div><script type="module" src="/__completion.js"></script></body></html>')
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

  // Mock distribution API
  let pollCount = 0;
  await page.route('**/api/distribution/runs/**', async route => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ json: { ok: true, data: { jobId: 'completion-test', status: 'completed' } } });
    }
    pollCount++;
    const status = pollCount <= 2 ? 'completed_with_issues' : 'completed';
    return route.fulfill({ json: { ok: true, data: { jobId: 'completion-test', status } } });
  });

  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__completion`);
  await page.locator('[data-testid="job-status"]').waitFor();

  // === Part 1: useDistributionJob polling behavior ===

  // Wait for completed status
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="job-status"]');
    return el && el.textContent === 'completed';
  }, { timeout: 15000 });

  assert.equal(await page.locator('[data-testid="job-status"]').textContent(), 'completed');

  // Polling stops after completed
  const pollsAtCompletion = pollCount;
  await page.waitForTimeout(3500);
  assert.equal(pollCount, pollsAtCompletion, 'completed jobs should stop polling');

  // === Part 2: useDistributionCompletion full chain ===
  // The real hooks are wired together, so completion triggers the chain automatically.
  // But we need to wait for the microtask (Promise.resolve().then) to execute.
  await page.waitForTimeout(200);

  // Test: Export node updated with job data
  const exportJob = await page.evaluate(() => window.state.exportJob);
  assert.ok(exportJob, 'export node should have distributionJob data');
  assert.equal(exportJob.status, 'completed', 'export node job status should be completed');

  // Test: Overlay closed
  assert.equal(await page.locator('[data-testid="overlay"]').textContent(), 'CLOSED',
    'overlay should close on completion');

  // Test: Log appended
  const logCount = parseInt(await page.locator('[data-testid="log-count"]').textContent());
  assert.ok(logCount > 0, 'should have appended a log entry');
  const lastLog = await page.evaluate(() => window.state.lastLogMessage);
  assert.ok(lastLog.includes('铺货') || lastLog.includes('完成'),
    `log message should mention completion, got: ${lastLog}`);

  // Test: reloadRun called with correct args
  const reloadCalls = parseInt(await page.locator('[data-testid="reload-calls"]').textContent());
  assert.ok(reloadCalls > 0, 'reloadRun should have been called');
  const reloadArgs = await page.evaluate(() => window.state.reloadRunCalls);
  assert.equal(reloadArgs[0][0], 'run-123', 'reloadRun should receive workflowRunId');
  assert.deepEqual(reloadArgs[0][1], { preserveLogs: true }, 'reloadRun should preserve logs');

  // Test: fetchHistoryRuns called
  const fetchCalls = parseInt(await page.locator('[data-testid="fetch-calls"]').textContent());
  assert.ok(fetchCalls > 0, 'fetchHistoryRuns should have been called');

  // === Part 3: Dedup — triggering same jobId again should NOT repeat side effects ===
  const logCountBefore = logCount;
  const reloadCallsBefore = reloadCalls;
  const fetchCallsBefore = fetchCalls;

  await page.evaluate(() => {
    window.triggerCompletion({ jobId: 'completion-test', status: 'completed', workflowRunId: 'run-123' });
  });
  await page.waitForTimeout(200);

  const logCountAfter = parseInt(await page.locator('[data-testid="log-count"]').textContent());
  const reloadCallsAfter = parseInt(await page.locator('[data-testid="reload-calls"]').textContent());
  const fetchCallsAfter = parseInt(await page.locator('[data-testid="fetch-calls"]').textContent());

  assert.equal(logCountAfter, logCountBefore, 'duplicate completion should not add another log');
  assert.equal(reloadCallsAfter, reloadCallsBefore, 'duplicate completion should not call reloadRun again');
  assert.equal(fetchCallsAfter, fetchCallsBefore, 'duplicate completion should not call fetchHistoryRuns again');

  console.log('Distribution completion full-chain integration test passed');
} finally {
  await browser?.close();
  await server.close();
}
