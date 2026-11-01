'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  WORKFLOW_NODE_IDS,
  CANONICAL_WORKFLOW_STEPS,
  getCanonicalSteps,
  isValidStepForMode
} = require('../../../core/workflow/pipeline-definition-common');
const {
  workflowNodes,
  workflowEdges,
  listProductionWorkflowVariants
} = require('../../../core/workflow/pipeline-templates');
const { runPipelineRuntime } = require('../../../skills/pipeline-flow/runtime/runner');
const { readRuntimeState } = require('../../../skills/pipeline-flow/runtime/store');
const { createWorkflowControlService } = require('../../../core/workflow/control-service');
const { buildNodeStates } = require('../../../core/workflow/pipeline-node-state');
const { pipelineSummaryToWorkflowRun } = require('../../../core/workflow/pipeline-runs');
const { summarizePipelineRun, listPipelineRuns } = require('../../../core/pipeline-run-summary');

function createTempDir(prefix = 'workflow-convergence-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createMockWorkbench() {
  let current = null;
  return {
    get current() {
      return current;
    },
    tryAcquire(state = {}) {
      if (current) return null;
      current = { ...state };
      return current;
    },
    release(state) {
      if (current && (!state || current === state || current.runId === state.runId)) {
        current = null;
      }
    },
    async run(state, fn) {
      current = state;
      try {
        return await fn();
      } finally {
        current = null;
      }
    },
    async runReserved(state, fn) {
      current = state;
      try {
        return await fn();
      } finally {
        current = null;
      }
    }
  };
}

describe('PR-04 Workflow Convergence & StopAfterStep Suite', () => {
  describe('Canonical Workflow Definitions', () => {
    it('defines consistent canonical steps for all production workflow modes', () => {
      const modes = [
        'daily',
        'root-keyword',
        'keyword',
        'manual',
        'order-sheet',
        'review-sheet',
        'competitor-analysis',
        'watermark-removal'
      ];

      for (const mode of modes) {
        const steps = getCanonicalSteps(mode);
        assert.ok(Array.isArray(steps), `Mode ${mode} steps should be an array`);
        assert.ok(steps.length > 0, `Mode ${mode} should have at least one step`);
        for (const step of steps) {
          assert.equal(typeof step, 'string');
          assert.ok(isValidStepForMode(mode, step), `Step ${step} should be valid for mode ${mode}`);
        }
      }

      // peer-discovery branches
      const analysisSteps = getCanonicalSteps('peer-discovery', { discoveryBranch: 'peer-analysis' });
      assert.deepEqual(analysisSteps, [
        WORKFLOW_NODE_IDS.extractSources,
        WORKFLOW_NODE_IDS.findSimilarProducts,
        WORKFLOW_NODE_IDS.evaluateShops,
        WORKFLOW_NODE_IDS.peerReport
      ]);

      const selectionSteps = getCanonicalSteps('peer-discovery', { discoveryBranch: 'image-selection' });
      assert.deepEqual(selectionSteps, [
        WORKFLOW_NODE_IDS.extractSources,
        WORKFLOW_NODE_IDS.findSimilarProducts,
        WORKFLOW_NODE_IDS.collectPeerProducts,
        WORKFLOW_NODE_IDS.verifyImageSources,
        WORKFLOW_NODE_IDS.prepareListingDrafts,
        WORKFLOW_NODE_IDS.reviewPeerListings,
        WORKFLOW_NODE_IDS.peerProductReport
      ]);
    });

    it('aligns workflowNodes and workflowEdges with canonical steps', () => {
      const templates = listProductionWorkflowVariants();
      assert.ok(templates.length >= 7, 'Should have standard templates');

      for (const tpl of templates) {
        const mode = tpl.mode;
        const options = tpl.id.includes('selection') ? { discoveryBranch: 'image-selection' } : {};
        const expectedMiddle = getCanonicalSteps(mode, { ...options, excludeStart: true });
        const nodes = workflowNodes(mode, options);
        const nodeIds = nodes.map(n => n.id);

        assert.equal(nodeIds[0], WORKFLOW_NODE_IDS.start, `Template ${tpl.id} must start with start node`);
        assert.equal(nodeIds[nodeIds.length - 1], WORKFLOW_NODE_IDS.end, `Template ${tpl.id} must end with end node`);
        assert.deepEqual(nodeIds.slice(1, -1), expectedMiddle, `Template ${tpl.id} nodes must match canonical steps`);

        // Check edges
        const edges = workflowEdges(mode, options);
        assert.equal(edges.length, nodes.length - 1, `Template ${tpl.id} edges should connect nodes sequentially`);
        for (let i = 0; i < edges.length; i++) {
          assert.equal(edges[i].source, nodeIds[i]);
          assert.equal(edges[i].target, nodeIds[i + 1]);
        }
      }
    });

    it('correctly validates valid and invalid steps per mode', () => {
      assert.ok(isValidStepForMode('daily', 'mine'));
      assert.ok(isValidStepForMode('daily', 'keywordReview'));
      assert.ok(isValidStepForMode('daily', 'end'));
      assert.ok(!isValidStepForMode('daily', 'nonexistent_step'));
      assert.ok(!isValidStepForMode('daily', 'extractSources'));

      assert.ok(isValidStepForMode('keyword', 'select'));
      assert.ok(isValidStepForMode('keyword', 'generate'));
      assert.ok(!isValidStepForMode('keyword', 'mine'));

      assert.ok(isValidStepForMode('peer-discovery', 'evaluateShops', { discoveryBranch: 'peer-analysis' }));
      assert.ok(!isValidStepForMode('peer-discovery', 'evaluateShops', { discoveryBranch: 'image-selection' }));
      assert.ok(isValidStepForMode('peer-discovery', 'collectPeerProducts', { discoveryBranch: 'image-selection' }));

      // MODES_WITH_START_STEP validation (Codex review finding)
      assert.ok(isValidStepForMode('daily', 'start'), 'daily supports browser start step');
      assert.ok(isValidStepForMode('keyword', 'start'), 'keyword supports browser start step');
      assert.ok(isValidStepForMode('root-keyword', 'start'), 'root-keyword supports browser start step');
      assert.ok(isValidStepForMode('manual', 'start'), 'manual supports browser start step');
      assert.ok(!isValidStepForMode('peer-discovery', 'start'), 'peer-discovery does not have runner start step');
      assert.ok(!isValidStepForMode('order-sheet', 'start'), 'order-sheet does not have runner start step');
      assert.ok(!isValidStepForMode('review-sheet', 'start'), 'review-sheet does not have runner start step');
      assert.ok(!isValidStepForMode('competitor-analysis', 'start'), 'competitor-analysis does not have runner start step');
    });
  });

  describe('Partial Execution via stopAfterStep in Runner', () => {
    it('stops daily mode after keywordReview and retains intermediate state', async () => {
      const dataDir = createTempDir();
      const runId = 'run_daily_stop_after_review';
      const executedSteps = [];

      const stepFns = {
        start: async () => {
          executedSteps.push('start');
          return { status: 'browser_ready' };
        },
        inspire: async () => {
          executedSteps.push('inspire');
          return { status: 'completed' };
        },
        mine: async () => {
          executedSteps.push('mine');
          return { status: 'completed' };
        },
        keywordReview: async () => {
          executedSteps.push('keywordReview');
          return { status: 'completed' };
        },
        select: async () => {
          executedSteps.push('select');
          return { status: 'completed' };
        },
        generate: async () => {
          executedSteps.push('generate');
          return { status: 'completed' };
        },
        export: async () => {
          executedSteps.push('export');
          return { status: 'completed' };
        }
      };

      const result = await runPipelineRuntime({
        dataDir,
        runId,
        mode: 'daily',
        stopAfterStep: 'keywordReview',
        stepFns
      });

      assert.equal(result.runtimeStatus, 'completed');
      assert.equal(result.stoppedAfterStep, 'keywordReview');
      assert.deepEqual(executedSteps, ['inspire', 'mine', 'keywordReview']);

      const runtime = readRuntimeState({ dataDir, runId });
      assert.equal(runtime.status, 'completed');
      assert.equal(runtime.stoppedAfterStep, 'keywordReview');
      assert.equal(runtime.activeStep, 'select'); // advanced to next step for resume
      assert.equal(runtime.progress.inspire.status, 'completed');
      assert.equal(runtime.progress.mine.status, 'completed');
      assert.equal(runtime.progress.keywordReview.status, 'completed');
      assert.equal(runtime.progress.select.status, 'idle');
      assert.equal(runtime.progress.generate.status, 'idle');
      assert.equal(runtime.progress.export.status, 'idle');

      // Now resume from activeStep without stopAfterStep to finish the rest
      const resumeResult = await runPipelineRuntime({
        dataDir,
        runId,
        mode: 'daily',
        preserveRuntime: true,
        resumeFromStep: runtime.activeStep,
        stepFns
      });

      assert.equal(resumeResult.runtimeStatus, 'completed');
      assert.equal(resumeResult.stoppedAfterStep, undefined);
      assert.deepEqual(executedSteps, [
        'inspire', 'mine', 'keywordReview', // first run
        'select', 'generate', 'export' // resumed run
      ]);

      const finishedRuntime = readRuntimeState({ dataDir, runId });
      assert.equal(finishedRuntime.progress.select.status, 'completed');
      assert.equal(finishedRuntime.progress.generate.status, 'completed');
      assert.equal(finishedRuntime.progress.export.status, 'completed');
    });

    it('stops root-keyword mode after mine', async () => {
      const dataDir = createTempDir();
      const runId = 'run_root_keyword_stop_mine';
      const executedSteps = [];

      const stepFns = {
        mine: async () => {
          executedSteps.push('mine');
          return { status: 'completed' };
        },
        keywordReview: async () => {
          executedSteps.push('keywordReview');
          return { status: 'completed' };
        },
        select: async () => {
          executedSteps.push('select');
          return { status: 'completed' };
        },
        generate: async () => {
          executedSteps.push('generate');
          return { status: 'completed' };
        },
        export: async () => {
          executedSteps.push('export');
          return { status: 'completed' };
        }
      };

      const result = await runPipelineRuntime({
        dataDir,
        runId,
        mode: 'root-keyword',
        stopAfterStep: 'mine',
        stepFns
      });

      assert.equal(result.runtimeStatus, 'completed');
      assert.equal(result.stoppedAfterStep, 'mine');
      assert.deepEqual(executedSteps, ['mine']);

      const runtime = readRuntimeState({ dataDir, runId });
      assert.equal(runtime.activeStep, 'keywordReview');
      assert.equal(runtime.progress.mine.status, 'completed');
      assert.equal(runtime.progress.keywordReview.status, 'idle');
    });

    it('stops peer-discovery image-selection after findSimilarProducts', async () => {
      const dataDir = createTempDir();
      const runId = 'run_peer_image_stop';
      const executedSteps = [];

      const stepFns = {
        extractSources: async () => {
          executedSteps.push('extractSources');
          return { status: 'completed' };
        },
        findSimilarProducts: async () => {
          executedSteps.push('findSimilarProducts');
          return { status: 'completed' };
        },
        collectPeerProducts: async () => {
          executedSteps.push('collectPeerProducts');
          return { status: 'completed' };
        },
        verifyImageSources: async () => {
          executedSteps.push('verifyImageSources');
          return { status: 'completed' };
        },
        prepareListingDrafts: async () => {
          executedSteps.push('prepareListingDrafts');
          return { status: 'completed' };
        },
        reviewPeerListings: async () => {
          executedSteps.push('reviewPeerListings');
          return { status: 'completed' };
        },
        peerProductReport: async () => {
          executedSteps.push('peerProductReport');
          return { status: 'completed' };
        }
      };

      const result = await runPipelineRuntime({
        dataDir,
        runId,
        mode: 'peer-discovery',
        params: { discoveryBranch: 'image-selection' },
        stopAfterStep: 'findSimilarProducts',
        stepFns
      });

      assert.equal(result.runtimeStatus, 'completed');
      assert.equal(result.stoppedAfterStep, 'findSimilarProducts');
      assert.deepEqual(executedSteps, ['extractSources', 'findSimilarProducts']);

      const runtime = readRuntimeState({ dataDir, runId });
      assert.equal(runtime.activeStep, 'collectPeerProducts');
      assert.equal(runtime.progress.findSimilarProducts.status, 'completed');
      assert.equal(runtime.progress.collectPeerProducts.status, 'idle');
    });

    it('throws error when stopAfterStep does not exist in mode steps', async () => {
      const dataDir = createTempDir();
      await assert.rejects(
        () => runPipelineRuntime({
          dataDir,
          runId: 'run_invalid_stop',
          mode: 'keyword',
          stopAfterStep: 'mine' // keyword mode has no 'mine' step
        }),
        /当前模式不包含指定停止步骤 mine/
      );
    });

    it('throws error when stopAfterStep is before requested start step', async () => {
      const dataDir = createTempDir();
      await assert.rejects(
        () => runPipelineRuntime({
          dataDir,
          runId: 'run_before_start',
          mode: 'root-keyword',
          resumeFromStep: 'select',
          stopAfterStep: 'mine'
        }),
        /指定的停止步骤 mine 已在当前起始步骤 select 之前/
      );
    });

    it('clears persisted stopAfterStep on resume so execution continues to end without boundary conflict', async () => {
      const dataDir = createTempDir();
      const runId = 'run_resume_clears_stop_boundary';
      const executedSteps = [];

      const stepFns = {
        mine: async () => {
          executedSteps.push('mine');
          return { status: 'completed' };
        },
        keywordReview: async () => {
          executedSteps.push('keywordReview');
          return { status: 'completed' };
        },
        select: async () => {
          executedSteps.push('select');
          return { status: 'completed' };
        },
        generate: async () => {
          executedSteps.push('generate');
          return { status: 'completed' };
        },
        export: async () => {
          executedSteps.push('export');
          return { status: 'completed' };
        }
      };

      // 1. Initial run stops after mine
      const firstRun = await runPipelineRuntime({
        dataDir,
        runId,
        mode: 'root-keyword',
        params: { stopAfterStep: 'mine' },
        stopAfterStep: 'mine',
        stepFns
      });
      assert.equal(firstRun.runtimeStatus, 'completed');
      assert.equal(firstRun.stoppedAfterStep, 'mine');
      assert.deepEqual(executedSteps, ['mine']);

      // 2. Resume run without specifying stopAfterStep: should NOT throw "指定的停止步骤 mine 已在当前起始步骤 keywordReview 之前"
      const resumeRun = await runPipelineRuntime({
        dataDir,
        runId,
        mode: 'root-keyword',
        preserveRuntime: true,
        resumeFromStep: 'keywordReview',
        stepFns
      });
      assert.equal(resumeRun.runtimeStatus, 'completed');
      assert.equal(resumeRun.stoppedAfterStep, undefined);
      assert.deepEqual(executedSteps, ['mine', 'keywordReview', 'select', 'generate', 'export']);

      const finalState = readRuntimeState({ dataDir, runId });
      assert.equal(finalState.params.stopAfterStep, undefined, 'params.stopAfterStep should be cleared on resume');
    });

    it('persists a discoverable run when stopping after start in daily mode', async () => {
      const dataDir = createTempDir();
      const runId = 'run_daily_stop_start';

      const result = await runPipelineRuntime({
        dataDir,
        runId,
        mode: 'daily',
        stopAfterStep: 'start',
        prepareBrowser: async () => ({ status: 'browser_ready' })
      });

      assert.equal(result.runtimeStatus, 'completed');
      assert.equal(result.stoppedAfterStep, 'start');

      const summary = summarizePipelineRun({ dataDir, runId });
      assert.ok(summary, 'Run should have a valid summary after stopping at start');
      assert.equal(summary.runId, runId);

      const history = listPipelineRuns({ dataDir });
      assert.equal(history.runs.length, 1);
      assert.equal(history.runs[0].runId, runId);
    });
  });

  describe('ControlService Validation & stopAfterStep Handling', () => {
    it('validates and rejects invalid stopAfterStep with HTTP 400', async () => {
      const workbench = createMockWorkbench();
      const service = createWorkflowControlService({
        workbench,
        resolveProductionWorkflowLaunch: () => ({ mode: 'daily', params: {} }),
        sanitizeWorkflowParams: (_mode, p) => p,
        resolveProductionWorkflowDefinition: () => ({ id: 'daily-tpl' }),
        writeWorkflowDefinition: () => {},
        createRunId: () => 'test-run',
        getPipelineRuntimeRunner: () => async () => ({ status: 'completed' })
      });

      const response = await service.startRun({
        mode: 'daily',
        stopAfterStep: 'bogus_step'
      });

      assert.equal(response.httpStatus, 400);
      assert.equal(response.body.ok, false);
      assert.match(response.body.error, /指定的 stopAfterStep 'bogus_step' 不是 daily 模式的有效步骤/);
      assert.equal(workbench.current, null, 'Workbench lock should be released');
    });

    it('passes valid stopAfterStep through startRun to the runner', async () => {
      const workbench = createMockWorkbench();
      let runnerArgs = null;

      const service = createWorkflowControlService({
        workbench,
        resolveProductionWorkflowLaunch: (body) => ({
          mode: body.mode || 'daily',
          params: { stopAfterStep: body.stopAfterStep }
        }),
        sanitizeWorkflowParams: (_mode, p) => p,
        resolveProductionWorkflowDefinition: () => ({ id: 'daily-tpl' }),
        writeWorkflowDefinition: () => {},
        createRunId: () => 'test-run-stop',
        getPipelineRuntimeRunner: () => async (args) => {
          runnerArgs = args;
          return { runId: args.runId, status: 'completed' };
        }
      });

      const response = await service.startRun({
        mode: 'daily',
        stopAfterStep: 'keywordReview'
      });

      assert.equal(response.httpStatus, 200);
      assert.equal(response.body.ok, true);
      assert.equal(runnerArgs.stopAfterStep, 'keywordReview');
      assert.equal(runnerArgs.params.stopAfterStep, 'keywordReview');
    });

    it('validates and rejects invalid stopAfterStep on resumeRun with HTTP 400', async () => {
      const workbench = createMockWorkbench();
      const mockRuntime = {
        runId: 'test-resume-run',
        mode: 'daily',
        activeStep: 'keywordReview',
        steps: ['inspire', 'mine', 'keywordReview', 'select', 'generate', 'export']
      };

      const service = createWorkflowControlService({
        workbench,
        readRuntimeState: () => mockRuntime,
        requestRuntimeResume: () => ({ status: 'resuming' }),
        getPipelineRuntimeRunner: () => async () => ({ status: 'completed' })
      });

      const response = await service.resumeRun({
        runId: 'test-resume-run',
        stopAfterStep: 'invalid_step'
      });

      assert.equal(response.httpStatus, 400);
      assert.equal(response.body.ok, false);
      assert.match(response.body.error, /指定的 stopAfterStep 'invalid_step' 不是 daily 模式的有效步骤/);
    });

    it('passes valid stopAfterStep through resumeRun to runner', async () => {
      const workbench = createMockWorkbench();
      let runnerArgs = null;
      const mockRuntime = {
        runId: 'test-resume-run-valid',
        mode: 'daily',
        activeStep: 'select',
        steps: ['inspire', 'mine', 'keywordReview', 'select', 'generate', 'export'],
        params: {}
      };

      const service = createWorkflowControlService({
        workbench,
        readRuntimeState: () => mockRuntime,
        requestRuntimeResume: () => ({ status: 'resuming' }),
        pipelineRunResponse: (id, extra) => ({ runId: id, ...extra }),
        getPipelineRuntimeRunner: () => async (args) => {
          runnerArgs = args;
          return { runId: args.runId, status: 'completed' };
        }
      });

      const response = await service.resumeRun({
        runId: 'test-resume-run-valid',
        stopAfterStep: 'generate'
      });

      assert.equal(response.httpStatus, 200);
      assert.equal(response.body.ok, true);
      assert.equal(runnerArgs.stopAfterStep, 'generate');
    });

    it('rejects resume stopAfterStep preceding activeStep with HTTP 400 synchronously', async () => {
      const workbench = createMockWorkbench();
      let runnerCalled = false;
      const mockRuntime = {
        runId: 'test-resume-preceding',
        mode: 'daily',
        activeStep: 'select',
        steps: ['inspire', 'mine', 'keywordReview', 'select', 'generate', 'export'],
        params: {}
      };

      const service = createWorkflowControlService({
        workbench,
        readRuntimeState: () => mockRuntime,
        requestRuntimeResume: () => ({ status: 'resuming' }),
        getPipelineRuntimeRunner: () => async () => {
          runnerCalled = true;
          return { status: 'completed' };
        }
      });

      const response = await service.resumeRun({
        runId: 'test-resume-preceding',
        stopAfterStep: 'mine'
      });

      assert.equal(response.httpStatus, 400);
      assert.equal(response.body.ok, false);
      assert.equal(response.body.error, '指定的停止步骤 mine 已在当前起始步骤 select 之前。');
      assert.equal(runnerCalled, false, 'Runner should not be called when validation fails');
    });
  });

  describe('Canvas Read-Only Projection for Partially Executed Runs', () => {
    it('projects completed steps accurately and keeps subsequent steps and end node idle', () => {
      const summary = {
        runId: 'proj_run_1',
        status: 'completed',
        options: { mode: 'daily' },
        startedAt: '2026-11-01T12:00:00Z',
        updatedAt: '2026-11-01T12:05:00Z',
        runtime: {
          mode: 'daily',
          status: 'completed',
          activeStep: 'select',
          stoppedAfterStep: 'keywordReview',
          steps: ['inspire', 'mine', 'keywordReview', 'select', 'generate', 'export'],
          progress: {
            inspire: { status: 'completed', percent: 100, message: '完成' },
            mine: { status: 'completed', percent: 100, message: '完成' },
            keywordReview: { status: 'completed', percent: 100, message: '完成' },
            select: { status: 'idle', percent: 0, message: '' },
            generate: { status: 'idle', percent: 0, message: '' },
            export: { status: 'idle', percent: 0, message: '' }
          }
        }
      };

      const nodeStates = buildNodeStates(summary);

      assert.equal(nodeStates.start.status, 'completed');
      assert.equal(nodeStates.inspire.status, 'completed');
      assert.equal(nodeStates.mine.status, 'completed');
      assert.equal(nodeStates.keywordReview.status, 'completed');
      assert.equal(nodeStates.select.status, 'idle');
      assert.equal(nodeStates.generate.status, 'idle');
      assert.equal(nodeStates.export.status, 'idle');
      assert.equal(nodeStates.end.status, 'idle', 'End node must remain idle when stopped early');

      const workflowRun = pipelineSummaryToWorkflowRun(summary);
      assert.equal(workflowRun.status, 'completed');
      assert.equal(workflowRun.nodeStates.keywordReview.status, 'completed');
      assert.equal(workflowRun.nodeStates.select.status, 'idle');
      assert.equal(workflowRun.nodeStates.end.status, 'idle');
    });

    it('projects peer-discovery partial run without falsely completing subsequent nodes', () => {
      const summary = {
        runId: 'proj_peer_1',
        status: 'completed',
        options: { mode: 'peer-discovery', discoveryBranch: 'peer-analysis' },
        runtime: {
          mode: 'peer-discovery',
          status: 'completed',
          activeStep: 'evaluateShops',
          stoppedAfterStep: 'findSimilarProducts',
          params: { discoveryBranch: 'peer-analysis' },
          steps: ['extractSources', 'findSimilarProducts', 'evaluateShops', 'peerReport'],
          progress: {
            extractSources: { status: 'completed', percent: 100, message: '完成' },
            findSimilarProducts: { status: 'completed', percent: 100, message: '完成' },
            evaluateShops: { status: 'idle', percent: 0, message: '' },
            peerReport: { status: 'idle', percent: 0, message: '' }
          }
        }
      };

      const nodeStates = buildNodeStates(summary);

      assert.equal(nodeStates.start.status, 'completed');
      assert.equal(nodeStates.extractSources.status, 'completed');
      assert.equal(nodeStates.findSimilarProducts.status, 'completed');
      assert.equal(nodeStates.evaluateShops.status, 'idle');
      assert.equal(nodeStates.peerReport.status, 'idle');
      assert.equal(nodeStates.end.status, 'idle', 'Peer discovery end node must be idle');
    });

    it('projects unexecuted nodes as idle across order-sheet, review-sheet and manual modes', () => {
      // 1. order-sheet stopping after collectRank
      const orderSummary = {
        runId: 'proj_order_1',
        status: 'product_rank_collected',
        options: { mode: 'order-sheet' },
        runtime: {
          mode: 'order-sheet',
          status: 'completed',
          activeStep: 'confirmProducts',
          stoppedAfterStep: 'collectRank',
          steps: ['collectRank', 'confirmProducts', 'generateSheet'],
          progress: {
            collectRank: { status: 'completed', percent: 100, message: '完成' },
            confirmProducts: { status: 'idle', percent: 0, message: '' },
            generateSheet: { status: 'idle', percent: 0, message: '' }
          }
        }
      };
      const orderNodes = buildNodeStates(orderSummary);
      assert.equal(orderNodes.start.status, 'completed');
      assert.equal(orderNodes.collectRank.status, 'completed');
      assert.equal(orderNodes.confirmProducts.status, 'idle', 'confirmProducts must be idle');
      assert.equal(orderNodes.generateSheet.status, 'idle', 'generateSheet must be idle');
      assert.equal(orderNodes.end.status, 'idle', 'end must be idle');

      // 2. review-sheet stopping after importSheet
      const reviewSummary = {
        runId: 'proj_review_1',
        status: 'review_source_imported',
        options: { mode: 'review-sheet' },
        runtime: {
          mode: 'review-sheet',
          status: 'completed',
          activeStep: 'generateReviews',
          stoppedAfterStep: 'importSheet',
          steps: ['importSheet', 'generateReviews', 'generateSheet'],
          progress: {
            importSheet: { status: 'completed', percent: 100, message: '完成' },
            generateReviews: { status: 'idle', percent: 0, message: '' },
            generateSheet: { status: 'idle', percent: 0, message: '' }
          }
        }
      };
      const reviewNodes = buildNodeStates(reviewSummary);
      assert.equal(reviewNodes.start.status, 'completed');
      assert.equal(reviewNodes.importSheet.status, 'completed');
      assert.equal(reviewNodes.generateReviews.status, 'idle', 'generateReviews must be idle');
      assert.equal(reviewNodes.generateSheet.status, 'idle', 'generateSheet must be idle');
      assert.equal(reviewNodes.end.status, 'idle', 'end must be idle');

      // 3. manual mode stopping after start
      const manualSummary = {
        runId: 'proj_manual_1',
        status: 'browser_ready',
        options: { mode: 'manual', workflowVersion: 3 },
        runtime: {
          mode: 'manual',
          status: 'completed',
          activeStep: 'select',
          stoppedAfterStep: 'start',
          steps: ['start', 'select', 'verify', 'generate', 'export'],
          progress: {
            start: { status: 'completed', percent: 100, message: '完成' },
            select: { status: 'idle', percent: 0, message: '' },
            verify: { status: 'idle', percent: 0, message: '' },
            generate: { status: 'idle', percent: 0, message: '' },
            export: { status: 'idle', percent: 0, message: '' }
          }
        }
      };
      const manualNodes = buildNodeStates(manualSummary);
      assert.equal(manualNodes.start.status, 'completed');
      assert.equal(manualNodes.select.status, 'idle', 'select must be idle');
      assert.equal(manualNodes.verify.status, 'idle', 'verify must be idle');
      assert.equal(manualNodes.generate.status, 'idle', 'generate must be idle');
      assert.equal(manualNodes.export.status, 'idle', 'export must be idle');
      assert.equal(manualNodes.end.status, 'idle', 'end must be idle');
    });
  });
});
