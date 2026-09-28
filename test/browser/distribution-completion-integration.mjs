/**
 * Distribution completion integration test.
 *
 * Part 1: Mounts the REAL useDistributionJob hook — verifies polling,
 * status transitions, and terminal cessation.
 *
 * Part 2: Mounts REAL useDistributionCompletion + useWorkflowSession +
 * useWorkflowRuntime hooks. Only HTTP responses are mocked. Verifies the
 * full production chain: export node update → overlay close → log append
 * → loadHistoryRun fetches snapshot → real setNodes updates end node →
 * dedup prevention.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ECOM_PLAYWRIGHT_MODULE || 'playwright');

const harness = `
import React, { useState, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { useNodesState } from '@xyflow/react';
import { useDistributionJob } from '/src/features/workflow/hooks/use-distribution-job.js';
import { useDistributionCompletion } from '/src/features/workflow/hooks/use-distribution-completion.js';
import { useWorkflowRuntime } from '/src/features/workflow/hooks/use-workflow-runtime.js';
import { useWorkflowSession } from '/src/features/workflow/hooks/use-workflow-session.js';
import { useWorkflowOverlay } from '/src/features/workflow/hooks/use-workflow-overlay.js';
import { normalizeRunList, normalizeTemplateList } from '/src/features/workflow/workflow-data.js';
import { useWorkflowRunCatalog } from '/src/features/workflow/hooks/use-workflow-run-catalog.js';

const TEMPLATE = {
  id: 'test-tpl', mode: 'daily',
  workflow: {
    id: 'test-tpl', mode: 'daily',
    nodes: [
      { id: 'start', type: 'production-start', position: { x: 0, y: 0 }, data: {} },
      { id: 'export', type: 'pipeline-export', position: { x: 300, y: 0 }, data: {} },
      { id: 'end', type: 'production-end', position: { x: 600, y: 0 }, data: {} }
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'export' },
      { id: 'e2', source: 'export', target: 'end' }
    ]
  }
};

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [activeTemplateId, setActiveTemplateId] = useState('test-tpl');
  const [activeTemplateMode, setActiveTemplateMode] = useState('daily');
  const [overlayOpen, setOverlayOpen] = useState(true);

  const { templates, refreshHistory: fetchHistoryRuns } = useWorkflowRunCatalog({
    normalizeRuns: normalizeRunList, normalizeTemplates: normalizeTemplateList
  });

  const runtime = useWorkflowRuntime({ setNodes, setSelectedNodeId, refreshHistory: fetchHistoryRuns });
  const { closeOverlay } = useWorkflowOverlay();

  // Real session provides loadHistoryRun that fetches + normalizes + setNodes
  const session = useWorkflowSession({
    nodes, edges: [], templates: [TEMPLATE], activeTemplateMode,
    currentRunId: runtime.currentRunId, isRunActive: false,
    setNodes, setEdges: () => {}, setSelectedNodeId,
    setActiveTemplateId, setActiveTemplateMode,
    setCurrentRunId: runtime.setCurrentRunId,
    setRunStatus: runtime.setRunStatus,
    setLogs: runtime.setLogs,
    setArtifactState: () => {},
    disconnectRunEvents: runtime.disconnectRunEvents,
    listenToRunEvents: runtime.listenToRunEvents,
    closeOverlay: () => { setOverlayOpen(false); closeOverlay(); },
    dispatchNodeAction: () => {}, dispatchNodeArtifactView: () => {},
    dispatchNodeUpdate: () => {},
    launchWorkflow: () => {}, removeHistoryRun: () => {}
  });

  const loadHistoryRunRef = useRef(null);
  loadHistoryRunRef.current = session.loadHistoryRun;
  const reloadRun = useCallback((...args) => loadHistoryRunRef.current?.(...args), []);

  const { updateDistributionNodeJob } = useDistributionCompletion({
    setNodes, currentRunId: 'run-123', closeOverlay: () => setOverlayOpen(false),
    setLogs: runtime.setLogs, reloadRun, fetchHistoryRuns
  });

  // Wire job hook
  const handleJobChange = useCallback((job) => {
    updateDistributionNodeJob(job);
  }, [updateDistributionNodeJob]);

  const { job } = useDistributionJob({
    initialJobId: 'completion-test', onJobChange: handleJobChange
  });

  // Derive end node status from actual canvas nodes
  const endNode = nodes.find(n => n.id === 'end');
  const endNodeStatus = endNode?.data?.status || 'not-found';
  const exportNode = nodes.find(n => n.id === 'export');
  const exportJob = exportNode?.data?.distributionJob || null;

  window.state = {
    jobStatus: job?.status || 'none',
    exportJob,
    overlayOpen,
    logCount: runtime.logs.length,
    lastLogMessage: runtime.logs.length > 0 ? runtime.logs[runtime.logs.length - 1].message : '',
    endNodeStatus,
    nodeCount: nodes.length
  };

  window.triggerCompletion = (jobData) => updateDistributionNodeJob(jobData);

  return React.createElement('div', null,
    React.createElement('div', { 'data-testid': 'job-status' }, job?.status || 'none'),
    React.createElement('div', { 'data-testid': 'overlay' }, overlayOpen ? 'OPEN' : 'CLOSED'),
    React.createElement('div', { 'data-testid': 'log-count' }, String(runtime.logs.length)),
    React.createElement('div', { 'data-testid': 'end-status' }, endNodeStatus),
    React.createElement('div', { 'data-testid': 'node-count' }, String(nodes.length))
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

// Template definition for Node.js-side route mocking (mirrors harness TEMPLATE)
const MOCK_TEMPLATE = {
  id: 'test-tpl', mode: 'daily',
  workflow: {
    id: 'test-tpl', mode: 'daily',
    nodes: [
      { id: 'start', type: 'production-start', position: { x: 0, y: 0 }, data: {} },
      { id: 'export', type: 'pipeline-export', position: { x: 300, y: 0 }, data: {} },
      { id: 'end', type: 'production-end', position: { x: 600, y: 0 }, data: {} }
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'export' },
      { id: 'e2', source: 'export', target: 'end' }
    ]
  }
};

let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();

  // Mock ALL HTTP endpoints used by the real hooks

  // Templates API
  await page.route('**/api/workflows/templates', route =>
    route.fulfill({ json: { ok: true, data: [MOCK_TEMPLATE] } })
  );

  // Runs list API
  await page.route('**/api/workflows/runs', route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { ok: true, data: [] } });
    }
    return route.continue();
  });

  // Single run snapshot — returns completed end node
  await page.route('**/api/workflows/runs/run-123', route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: {
        ok: true,
        data: {
          runId: 'run-123', status: 'workflow_complete', mode: 'daily',
          workflow: MOCK_TEMPLATE.workflow,
          nodeStates: {
            start: { status: 'completed' },
            export: { status: 'completed', distributionJob: { jobId: 'completion-test', status: 'completed' } },
            end: { status: 'completed' }
          },
          logs: [{ timestamp: new Date().toISOString(), level: 'info', message: '流水线已完成' }]
        }
      }});
    }
    return route.continue();
  });

  // Seeds API
  await page.route('**/api/seeds*', route =>
    route.fulfill({ json: { ok: true, data: { seeds: [] } } })
  );

  // Platform status
  await page.route('**/api/platform/status', route =>
    route.fulfill({ json: { ok: true, data: {} } })
  );

  // Distribution API
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

  // === Part 1: useDistributionJob polling ===
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="job-status"]');
    return el && el.textContent === 'completed';
  }, { timeout: 15000 });

  assert.equal(await page.locator('[data-testid="job-status"]').textContent(), 'completed');

  const pollsAtCompletion = pollCount;
  await page.waitForTimeout(3500);
  assert.equal(pollCount, pollsAtCompletion, 'completed jobs should stop polling');

  // === Part 2: Full production chain via real Session ===
  // Wait for microtask + async loadHistoryRun (fetch + normalize + setNodes)
  await page.waitForTimeout(1000);

  // Test: Overlay closed
  assert.equal(await page.locator('[data-testid="overlay"]').textContent(), 'CLOSED',
    'overlay should close on completion');

  // Test: Log appended (from both completion handler and snapshot reload)
  const logCount = parseInt(await page.locator('[data-testid="log-count"]').textContent());
  assert.ok(logCount > 0, 'should have appended log entries');

  // Test: End node updated to completed via REAL loadHistoryRun → normalizeWorkflowForCanvas → setNodes
  // This is the critical assertion: the production Session fetches the run snapshot,
  // normalizes it, and applies node states through the real setNodes pipeline.
  const endStatus = await page.evaluate(() => window.state.endNodeStatus);
  assert.equal(endStatus, 'completed',
    'end node must be completed via real Session loadHistoryRun, not simulated setState');

  // Test: Canvas has nodes loaded from snapshot (real Session applied them)
  const nodeCount = parseInt(await page.locator('[data-testid="node-count"]').textContent());
  assert.ok(nodeCount >= 3, `canvas should have at least 3 nodes from snapshot, got ${nodeCount}`);

  // === Part 3: Dedup ===
  const logCountBefore = logCount;

  await page.evaluate(() => {
    window.triggerCompletion({ jobId: 'completion-test', status: 'completed', workflowRunId: 'run-123' });
  });
  await page.waitForTimeout(500);

  const logCountAfter = parseInt(await page.locator('[data-testid="log-count"]').textContent());
  assert.equal(logCountAfter, logCountBefore, 'duplicate completion should not add another log');

  console.log('Distribution completion full-chain integration test passed');
} finally {
  await browser?.close();
  await server.close();
}
