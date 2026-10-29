'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { WORKFLOW_NODE_IDS } = require('../../../../core/workflow/pipeline-definition-common');
const {
  listProductionWorkflowTemplates,
  templateForSummary,
  workflowNodes,
  workflowEdges
} = require('../../../../core/workflow/pipeline-templates');
const { buildNodeStates } = require('../../../../core/workflow/pipeline-node-state');
const { outputForNode } = require('../../../../core/workflow/pipeline-node-output');
const {
  initializePeerTask,
  enqueuePeerTask,
  requirePublishedPeerTask,
  readPeerTaskStatus,
  requestPeerTaskCancel
} = require('../../../../skills/peer-discovery/src/peer-task-coordinator');

describe('peer-discovery workflow and template integration', () => {
  it('generates peer-analysis branch canvas nodes and edges', () => {
    const nodes = workflowNodes('peer-discovery', { discoveryBranch: 'peer-analysis' });
    const edges = workflowEdges('peer-discovery', { discoveryBranch: 'peer-analysis' });

    const nodeIds = nodes.map(n => n.id);
    assert.deepEqual(nodeIds, [
      WORKFLOW_NODE_IDS.start,
      WORKFLOW_NODE_IDS.extractSources,
      WORKFLOW_NODE_IDS.findSimilarProducts,
      WORKFLOW_NODE_IDS.evaluateShops,
      WORKFLOW_NODE_IDS.peerReport,
      WORKFLOW_NODE_IDS.end
    ]);
    assert.equal(edges.length, 5);
    assert.equal(edges[0].source, 'start');
    assert.equal(edges[0].target, 'extractSources');
    assert.equal(edges[4].source, 'peerReport');
    assert.equal(edges[4].target, 'end');
  });

  it('generates image-selection branch canvas nodes and edges', () => {
    const nodes = workflowNodes('peer-discovery', { discoveryBranch: 'image-selection' });
    const edges = workflowEdges('peer-discovery', { discoveryBranch: 'image-selection' });

    const nodeIds = nodes.map(n => n.id);
    assert.deepEqual(nodeIds, [
      WORKFLOW_NODE_IDS.start,
      WORKFLOW_NODE_IDS.extractSources,
      WORKFLOW_NODE_IDS.findSimilarProducts,
      WORKFLOW_NODE_IDS.collectPeerProducts,
      WORKFLOW_NODE_IDS.verifyImageSources,
      WORKFLOW_NODE_IDS.prepareListingDrafts,
      WORKFLOW_NODE_IDS.reviewPeerListings,
      WORKFLOW_NODE_IDS.peerProductReport,
      WORKFLOW_NODE_IDS.end
    ]);
    assert.equal(edges.length, 8);
    assert.equal(edges[0].source, 'start');
    assert.equal(edges[0].target, 'extractSources');
    assert.equal(edges[7].source, 'peerProductReport');
    assert.equal(edges[7].target, 'end');
  });

  it('resolves templateForSummary for both peer discovery branches', () => {
    const analysisSummary = {
      options: { mode: 'peer-discovery', discoveryBranch: 'peer-analysis' }
    };
    const tAnalysis = templateForSummary(analysisSummary);
    assert.ok(tAnalysis);
    assert.equal(tAnalysis.id, 'peer-discovery-v1');

    const imageSummary = {
      options: { mode: 'peer-discovery', discoveryBranch: 'image-selection' }
    };
    const tImage = templateForSummary(imageSummary);
    assert.ok(tImage);
    assert.equal(tImage.workflow.nodes.length, 9);
    assert.ok(tImage.workflow.nodes.some(n => n.id === WORKFLOW_NODE_IDS.collectPeerProducts));
  });

  it('builds node states for peer-discovery pipeline execution', () => {
    const summary = {
      runId: 'peer_test_run_1',
      options: { mode: 'peer-discovery', discoveryBranch: 'peer-analysis' },
      status: 'running',
      runtime: {
        mode: 'peer-discovery',
        status: 'running',
        activeStep: 'findSimilarProducts',
        progress: {
          extractSources: { status: 'completed', percent: 100 },
          findSimilarProducts: { status: 'running', percent: 50, message: '图搜进行中' }
        }
      }
    };

    const states = buildNodeStates(summary);
    assert.equal(states[WORKFLOW_NODE_IDS.start].status, 'completed');
    assert.equal(states[WORKFLOW_NODE_IDS.extractSources].status, 'completed');
    assert.equal(states[WORKFLOW_NODE_IDS.findSimilarProducts].status, 'running');
    assert.equal(states[WORKFLOW_NODE_IDS.findSimilarProducts].progress.percent, 50);
    assert.equal(states[WORKFLOW_NODE_IDS.evaluateShops].status, 'idle');
    assert.equal(states[WORKFLOW_NODE_IDS.end].status, 'idle');
  });

  it('summarizes node output for peer discovery nodes in outputForNode', () => {
    const summary = {
      runId: 'peer_test_output',
      counts: {
        sourceProducts: 3,
        candidateShops: 12,
        similarProducts: 25,
        shopEvaluations: 8,
        qualifiedShops: 2,
        peerProducts: 15,
        imageSourcingResults: 15,
        peerListingDrafts: 10,
        peerSubmissions: 5
      },
      files: {
        sourceProducts: '/tmp/source-products.jsonl',
        candidateShops: '/tmp/candidate-shops.jsonl',
        shopEvaluations: '/tmp/shop-evaluations.jsonl',
        peerReport: '/tmp/同行发现报告.xlsx',
        peerProducts: '/tmp/peer-products.jsonl',
        imageSourcingResults: '/tmp/image-sourcing-results.jsonl',
        peerListingDrafts: '/tmp/peer-listing-drafts.jsonl',
        peerSubmissionLedger: '/tmp/peer-submissions.jsonl',
        peerProductReport: '/tmp/图搜选货铺货报告.xlsx'
      }
    };

    const outSources = outputForNode(WORKFLOW_NODE_IDS.extractSources, summary);
    assert.equal(outSources.count, 3);
    assert.equal(outSources.file, '/tmp/source-products.jsonl');

    const outSimilar = outputForNode(WORKFLOW_NODE_IDS.findSimilarProducts, summary);
    assert.equal(outSimilar.count, 12);
    assert.equal(outSimilar.similarProductsCount, 25);

    const outShops = outputForNode(WORKFLOW_NODE_IDS.evaluateShops, summary);
    assert.equal(outShops.count, 8);
    assert.equal(outShops.qualifiedCount, 2);

    const outReport = outputForNode(WORKFLOW_NODE_IDS.peerReport, summary);
    assert.equal(outReport.file, '/tmp/同行发现报告.xlsx');

    const outProductReport = outputForNode(WORKFLOW_NODE_IDS.peerProductReport, summary);
    assert.equal(outProductReport.file, '/tmp/图搜选货铺货报告.xlsx');
  });
});

describe('peer task coordinator and lifecycle', () => {
  it('initializes, reads status, requests cancel, and validates published tasks', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peer-coordinator-test-'));

    try {
      // 1. 初始化任务
      const task = await initializePeerTask({
        links: 'https://item.taobao.com/item.htm?id=123456789012',
        discoveryBranch: 'peer-analysis'
      }, { dataDir: tmpDir });

      assert.ok(task.taskId);
      assert.equal(task.runtime.status, 'queued');

      // 2. 状态查询：刚初始化且更新为 queued
      const status1 = await readPeerTaskStatus(task.taskId, { dataDir: tmpDir });
      assert.equal(status1.status, 'queued');
      assert.equal(status1.discoveryBranch, 'peer-analysis');

      // 3. queued 任务取消直接变成 cancelled
      const cancelResult = await requestPeerTaskCancel(task.taskId, { dataDir: tmpDir });
      assert.equal(cancelResult.status, 'cancelled');

      // 4. 重复取消已结束的任务直接返回已有终态
      const cancelAgain = await requestPeerTaskCancel(task.taskId, { dataDir: tmpDir });
      assert.equal(cancelAgain.status, 'cancelled');

      // 5. 不存在的 taskId 查询抛出 404 TASK_NOT_FOUND
      await assert.rejects(
        () => requirePublishedPeerTask('peer_non_existent', { dataDir: tmpDir }),
        (err) => err.code === 'TASK_NOT_FOUND'
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
