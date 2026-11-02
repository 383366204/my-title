'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  ReviewConflictError,
  ReviewForbiddenError,
  getReviewDraft,
  saveReviewDraft,
  confirmReviewDraft,
  isReviewConfirmed,
  resetReviewDraft,
  listReviewDrafts
} = require('../../../core/workflow/review-service');

const {
  ApprovalForbiddenError,
  ApprovalConflictError,
  canonicalStringify,
  computeInputDigest,
  requestExecutionApproval,
  grantExecutionApproval,
  rejectExecutionApproval,
  verifyExecutionApproval,
  consumeExecutionApproval,
  getExecutionApproval,
  listExecutionApprovals
} = require('../../../core/workflow/execution-approval');

const {
  computeBatchFingerprint,
  getSubmissionLedger,
  recordSubmissionAttempt,
  recordSubmissionSuccess,
  recordSubmissionFailure,
  isBatchSubmitted
} = require('../../../core/workflow/submission-ledger');

const { createWorkflowControlService } = require('../../../core/workflow/control-service');
const {
  initRuntimeState,
  updateRuntimeState,
  readRuntimeState
} = require('../../../skills/pipeline-flow/runtime/store');
const { initRun } = require('../../../skills/pipeline-flow/src/run-store');

function createTempDir(prefix = 'review-approval-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('PR-06 ReviewService & ExecutionApproval Suite', () => {

  describe('ReviewService (ReviewDraft Lifecycle & Optimistic Locking)', () => {
    it('saves initial review draft from agent and supports optimistic updates', () => {
      const dataDir = createTempDir();
      const runId = 'review_draft_01';
      initRun({ dataDir, runId });

      // 1. Agent submits initial draft
      const draft1 = saveReviewDraft({
        dataDir,
        runId,
        stepId: 'keywordReview',
        decisions: { approvedKeywords: ['纯银项链', '小吊坠'] },
        updatedBy: 'agent_draft'
      });
      assert.equal(draft1.version, 1);
      assert.equal(draft1.status, 'draft');
      assert.equal(draft1.updatedBy, 'agent_draft');
      assert.deepEqual(draft1.decisions.approvedKeywords, ['纯银项链', '小吊坠']);

      // 2. User updates the draft with version 1
      const draft2 = saveReviewDraft({
        dataDir,
        runId,
        stepId: 'keywordReview',
        decisions: { approvedKeywords: ['纯银项链', '锁骨链'], rejectedKeywords: ['小吊坠'] },
        expectedVersion: 1,
        updatedBy: 'user'
      });
      assert.equal(draft2.version, 2);
      assert.equal(draft2.status, 'draft');
      assert.equal(draft2.updatedBy, 'user');
      assert.deepEqual(draft2.decisions.rejectedKeywords, ['小吊坠']);

      // 3. Reject stale update with mismatched version
      assert.throws(() => {
        saveReviewDraft({
          dataDir,
          runId,
          stepId: 'keywordReview',
          decisions: { approvedKeywords: ['过期的修改'] },
          expectedVersion: 1, // stale! current is 2
          updatedBy: 'user'
        });
      }, ReviewConflictError);
    });

    it('confirms review draft by human user and prohibits agent confirmation or overwriting', () => {
      const dataDir = createTempDir();
      const runId = 'review_confirm_01';
      initRun({ dataDir, runId });

      saveReviewDraft({
        dataDir,
        runId,
        stepId: 'select',
        decisions: { approvedProductIds: ['offer_123', 'offer_456'] },
        updatedBy: 'agent_draft'
      });

      // Agent is strictly forbidden from confirming
      assert.throws(() => {
        confirmReviewDraft({
          dataDir,
          runId,
          stepId: 'select',
          confirmedBy: 'agent'
        });
      }, ReviewForbiddenError);

      assert.throws(() => {
        confirmReviewDraft({
          dataDir,
          runId,
          stepId: 'select',
          confirmedBy: 'agent_draft'
        });
      }, ReviewForbiddenError);

      // Human confirms successfully
      const confirmed = confirmReviewDraft({
        dataDir,
        runId,
        stepId: 'select',
        decisions: { approvedProductIds: ['offer_123'] },
        expectedVersion: 1,
        confirmedBy: 'operator_alice'
      });
      assert.equal(confirmed.version, 2);
      assert.equal(confirmed.status, 'confirmed');
      assert.equal(confirmed.confirmedBy, 'operator_alice');
      assert.ok(confirmed.confirmedAt);
      assert.equal(isReviewConfirmed({ dataDir, runId, stepId: 'select' }), true);

      // Agent cannot overwrite an already confirmed review draft
      assert.throws(() => {
        saveReviewDraft({
          dataDir,
          runId,
          stepId: 'select',
          decisions: { approvedProductIds: ['offer_hijack'] },
          updatedBy: 'agent_draft'
        });
      }, ReviewConflictError);

      // Resetting review draft reverts it to pending
      const reset = resetReviewDraft({ dataDir, runId, stepId: 'select', expectedVersion: 2 });
      assert.equal(reset.version, 3);
      assert.equal(reset.status, 'pending');
      assert.equal(isReviewConfirmed({ dataDir, runId, stepId: 'select' }), false);
    });

    it('lists all review drafts under the run directory', () => {
      const dataDir = createTempDir();
      const runId = 'review_list_01';
      initRun({ dataDir, runId });

      saveReviewDraft({ dataDir, runId, stepId: 'keywordReview', decisions: {} });
      saveReviewDraft({ dataDir, runId, stepId: 'select', decisions: {} });

      const list = listReviewDrafts({ dataDir, runId });
      assert.equal(list.length, 2);
      assert.equal(list[0].stepId, 'keywordReview');
      assert.equal(list[1].stepId, 'select');
    });
  });

  describe('ExecutionApproval (Input Digest & Revision-bound Tamper Protection)', () => {
    it('computes deterministic input digests regardless of JSON key ordering', () => {
      const payloadA = {
        shopIds: ['shop_a', 'shop_b'],
        distributionMode: 'sequential-average',
        items: [{ offerId: '100', title: '纯银项链', price: '29.9' }]
      };
      const payloadB = {
        items: [{ price: '29.9', offerId: '100', title: '纯银项链' }],
        distributionMode: 'sequential-average',
        shopIds: ['shop_a', 'shop_b']
      };

      const digestA = computeInputDigest(payloadA);
      const digestB = computeInputDigest(payloadB);
      assert.equal(digestA, digestB, 'Key order should not alter deterministic input digest');

      // Modifying price or shop creates a distinct digest
      const payloadModified = { ...payloadA, items: [{ ...payloadA.items[0], price: '39.9' }] };
      const digestModified = computeInputDigest(payloadModified);
      assert.notEqual(digestA, digestModified, 'Different price must yield different digest');
    });

    it('handles approval request, human granting and rejects model self-approval', () => {
      const dataDir = createTempDir();
      const runId = 'exec_appr_grant_01';
      initRun({ dataDir, runId });
      initRuntimeState({ dataDir, runId, steps: ['mine', 'generate', 'export'] });

      const payload = {
        items: [{ offerId: 'offer_1', title: '标题A' }],
        shopIds: ['shop_1']
      };

      const approval = requestExecutionApproval({
        dataDir,
        runId,
        actionType: 'distribution.publish',
        inputPayload: payload,
        runRevision: 1
      });
      assert.equal(approval.status, 'pending');
      assert.ok(approval.inputDigest);
      assert.equal(approval.runRevision, 1);

      // Model cannot self-approve
      assert.throws(() => {
        grantExecutionApproval({
          dataDir,
          runId,
          approvalId: approval.id,
          approvedBy: 'agent'
        });
      }, ApprovalForbiddenError);

      assert.throws(() => {
        grantExecutionApproval({
          dataDir,
          runId,
          approvalId: approval.id,
          approvedBy: 'agent:llm_model'
        });
      }, ApprovalForbiddenError);

      // Human operator grants successfully
      const granted = grantExecutionApproval({
        dataDir,
        runId,
        approvalId: approval.id,
        approvedBy: 'operator_bob'
      });
      assert.equal(granted.status, 'approved');
      assert.equal(granted.approvedBy, 'operator_bob');

      // Verify passes when payload matches
      const verifyResult = verifyExecutionApproval({
        dataDir,
        runId,
        actionType: 'distribution.publish',
        inputPayload: payload,
        currentRunRevision: 1
      });
      assert.equal(verifyResult.ok, true);
      assert.equal(verifyResult.approval.id, approval.id);
    });

    it('automatically invalidates (expires) approval if input is tampered or run revision advances', () => {
      const dataDir = createTempDir();
      const runId = 'exec_appr_tamper_01';
      initRun({ dataDir, runId });
      initRuntimeState({ dataDir, runId, steps: ['mine', 'export'] });

      const originalPayload = {
        items: [{ offerId: 'item_1', title: '正品项链', price: 99 }],
        shopIds: ['shop_flagship']
      };

      const approval = requestExecutionApproval({
        dataDir,
        runId,
        actionType: 'distribution.publish',
        inputPayload: originalPayload,
        runRevision: 1
      });
      grantExecutionApproval({
        dataDir,
        runId,
        approvalId: approval.id,
        approvedBy: 'operator'
      });

      // Case 1: Tampered input (price changed to 10)
      const tamperedPayload = {
        ...originalPayload,
        items: [{ offerId: 'item_1', title: '正品项链', price: 10 }]
      };
      const tamperVerify = verifyExecutionApproval({
        dataDir,
        runId,
        actionType: 'distribution.publish',
        inputPayload: tamperedPayload,
        currentRunRevision: 1
      });
      assert.equal(tamperVerify.ok, false);
      assert.equal(tamperVerify.code, 'APPROVAL_INPUT_MISMATCH');
      assert.equal(tamperVerify.status, 'expired');

      // Approval on disk should now be expired
      const diskApproval = getExecutionApproval({ dataDir, runId, approvalId: approval.id });
      assert.equal(diskApproval.status, 'expired');
      assert.match(diskApproval.expireReason, /与授权时不一致/);

      // Re-request and grant for new payload
      const approval2 = requestExecutionApproval({
        dataDir,
        runId,
        actionType: 'distribution.publish',
        inputPayload: originalPayload,
        runRevision: 1
      });
      grantExecutionApproval({ dataDir, runId, approvalId: approval2.id, approvedBy: 'operator' });

      // Case 2: Workflow revision advanced (upstream step was re-executed)
      const revisionVerify = verifyExecutionApproval({
        dataDir,
        runId,
        actionType: 'distribution.publish',
        inputPayload: originalPayload,
        currentRunRevision: 2 // changed from 1 to 2!
      });
      assert.equal(revisionVerify.ok, false);
      assert.equal(revisionVerify.code, 'APPROVAL_REVISION_MISMATCH');
      assert.equal(revisionVerify.status, 'expired');
    });

    it('enforces single-use consumption and rejects re-verification of consumed approvals', () => {
      const dataDir = createTempDir();
      const runId = 'exec_appr_consume_01';
      initRun({ dataDir, runId });
      initRuntimeState({ dataDir, runId, steps: ['export'] });

      const payload = { items: [{ offerId: '1' }] };
      const approval = requestExecutionApproval({
        dataDir,
        runId,
        actionType: 'distribution.publish',
        inputPayload: payload,
        runRevision: 1
      });
      grantExecutionApproval({ dataDir, runId, approvalId: approval.id, approvedBy: 'admin' });

      // Consume approval
      const consumed = consumeExecutionApproval({ dataDir, runId, approvalId: approval.id });
      assert.equal(consumed.status, 'consumed');
      assert.ok(consumed.consumedAt);

      // Verify should reject consumed approval
      const verifyResult = verifyExecutionApproval({
        dataDir,
        runId,
        actionType: 'distribution.publish',
        inputPayload: payload,
        currentRunRevision: 1
      });
      assert.equal(verifyResult.ok, false);
      assert.equal(verifyResult.code, 'APPROVAL_ALREADY_CONSUMED');
    });

    it('handles human rejection of execution approval', () => {
      const dataDir = createTempDir();
      const runId = 'exec_appr_reject_01';
      initRun({ dataDir, runId });
      initRuntimeState({ dataDir, runId });

      const approval = requestExecutionApproval({
        dataDir,
        runId,
        actionType: 'distribution.publish',
        inputPayload: { foo: 'bar' },
        runRevision: 1
      });

      const rejected = rejectExecutionApproval({
        dataDir,
        runId,
        approvalId: approval.id,
        rejectedBy: 'reviewer',
        reason: '商品质量不达标'
      });
      assert.equal(rejected.status, 'rejected');
      assert.equal(rejected.rejectionReason, '商品质量不达标');

      const verifyResult = verifyExecutionApproval({
        dataDir,
        runId,
        actionType: 'distribution.publish',
        inputPayload: { foo: 'bar' },
        currentRunRevision: 1
      });
      assert.equal(verifyResult.ok, false);
      assert.equal(verifyResult.code, 'APPROVAL_REJECTED');
    });
  });

  describe('SubmissionLedger (Idempotent Batch Submissions)', () => {
    it('records batch submission attempt and prevents duplicate submission upon retry', () => {
      const dataDir = createTempDir();
      const runId = 'ledger_01';
      initRun({ dataDir, runId });

      const batchItems = [{ offerId: '1688_1', url: 'https://1688.com/1', title: '优质发饰' }];
      const fingerprint = computeBatchFingerprint(batchItems, 'shop_taobao_1', 'sequential-average');

      // 1. Initial attempt
      const attempt1 = recordSubmissionAttempt({
        dataDir,
        runId,
        batchId: 'batch_0',
        fingerprint,
        metadata: { itemCount: 1 }
      });
      assert.equal(attempt1.duplicate, false);
      assert.equal(attempt1.record.status, 'submitting');
      assert.equal(attempt1.record.attempt, 1);

      // 2. Mark submission success
      recordSubmissionSuccess({
        dataDir,
        runId,
        batchId: 'batch_0',
        externalTaskId: 'ext_task_998877',
        result: { publishedCount: 1 }
      });
      assert.equal(isBatchSubmitted({ dataDir, runId, batchId: 'batch_0', fingerprint }), true);

      // 3. Duplicate attempt (e.g. process crashed and restarted, re-submitting batch_0)
      const attempt2 = recordSubmissionAttempt({
        dataDir,
        runId,
        batchId: 'batch_0',
        fingerprint
      });
      assert.equal(attempt2.duplicate, true, 'Already submitted batch must be identified as duplicate');
      assert.equal(attempt2.record.externalTaskId, 'ext_task_998877');

      // 4. Ledger tracks all entries
      const ledger = getSubmissionLedger({ dataDir, runId });
      assert.equal(ledger.entries.batch_0.status, 'submitted');
    });

    it('records failure and allows retry after a failed submission attempt', () => {
      const dataDir = createTempDir();
      const runId = 'ledger_fail_retry_01';
      initRun({ dataDir, runId });

      const fingerprint = computeBatchFingerprint([{ offerId: '10' }], 'shop_1');
      recordSubmissionAttempt({ dataDir, runId, batchId: 'batch_fail', fingerprint });

      // Mark failure
      recordSubmissionFailure({
        dataDir,
        runId,
        batchId: 'batch_fail',
        error: new Error('Network timeout during publish')
      });

      const ledger1 = getSubmissionLedger({ dataDir, runId });
      assert.equal(ledger1.entries.batch_fail.status, 'failed');
      assert.match(ledger1.entries.batch_fail.error, /Network timeout/);

      // Re-attempt after failure is NOT blocked as duplicate
      const retryAttempt = recordSubmissionAttempt({
        dataDir,
        runId,
        batchId: 'batch_fail',
        fingerprint
      });
      assert.equal(retryAttempt.duplicate, false);
      assert.equal(retryAttempt.record.attempt, 2);
    });
  });

  describe('WorkflowControlService Human Gate Integration', () => {
    it('rejects resumeRun when active step review is unconfirmed', async () => {
      const dataDir = createTempDir();
      const runId = 'control_gate_review_unconfirmed';
      initRun({ dataDir, runId });
      initRuntimeState({
        dataDir,
        runId,
        steps: ['mine', 'keywordReview', 'select'],
        mode: 'daily'
      });
      updateRuntimeState({
        dataDir,
        runId,
        patch: { status: 'needs_review', activeStep: 'keywordReview' }
      });

      const workbench = { current: null, run: () => Promise.resolve() };
      const controlService = createWorkflowControlService({
        dataDir,
        workbench,
        readRuntimeState: (opts) => readRuntimeState({ dataDir, ...opts })
      });

      // Attempt to resume unconfirmed review step -> 409 Conflict
      const res = await controlService.resumeRun({ runId });
      assert.equal(res.httpStatus, 409);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.code, 'REVIEW_NOT_CONFIRMED');
      assert.match(res.body.error, /尚未完成人工复核确认/);

      // Confirm review draft
      confirmReviewDraft({
        dataDir,
        runId,
        stepId: 'keywordReview',
        decisions: { approvedKeywords: ['项链'] },
        confirmedBy: 'user'
      });

      // Resume now proceeds past the review gate!
      const res2 = await controlService.resumeRun({ runId });
      assert.equal(res2.httpStatus, 200);
      assert.equal(res2.body.ok, true);
    });

    it('rejects resumeRun on export step when execution approval is missing or expired', async () => {
      const dataDir = createTempDir();
      const runId = 'control_gate_export_unapproved';
      initRun({ dataDir, runId });
      initRuntimeState({
        dataDir,
        runId,
        steps: ['generate', 'export'],
        mode: 'daily'
      });
      updateRuntimeState({
        dataDir,
        runId,
        patch: {
          status: 'ready_to_distribute',
          activeStep: 'export',
          params: { exportPayload: { items: [{ offerId: 'item_1' }] } }
        }
      });

      const workbench = { current: null, run: () => Promise.resolve() };
      const controlService = createWorkflowControlService({
        dataDir,
        workbench,
        readRuntimeState: (opts) => readRuntimeState({ dataDir, ...opts })
      });

      // 1. Resume without approval -> 409
      const res1 = await controlService.resumeRun({ runId });
      assert.equal(res1.httpStatus, 409);
      assert.equal(res1.body.code, 'APPROVAL_REQUIRED');

      // 2. Request and grant approval matching current runtime revision
      const currentRuntime = readRuntimeState({ dataDir, runId });
      const approval = requestExecutionApproval({
        dataDir,
        runId,
        actionType: 'distribution.publish',
        inputPayload: { items: [{ offerId: 'item_1' }] },
        runRevision: currentRuntime.revision
      });
      grantExecutionApproval({ dataDir, runId, approvalId: approval.id, approvedBy: 'user' });

      // 3. Resume with valid approval succeeds
      const res2 = await controlService.resumeRun({ runId });
      assert.equal(res2.httpStatus, 200);
      assert.equal(res2.body.ok, true);
    });

    it('retrying a review step resets review confirmation', async () => {
      const dataDir = createTempDir();
      const runId = 'control_gate_retry_reset_draft';
      initRun({ dataDir, runId });
      initRuntimeState({
        dataDir,
        runId,
        steps: ['mine', 'keywordReview', 'select'],
        mode: 'daily'
      });

      confirmReviewDraft({
        dataDir,
        runId,
        stepId: 'keywordReview',
        decisions: { approved: ['foo'] }
      });
      assert.equal(isReviewConfirmed({ dataDir, runId, stepId: 'keywordReview' }), true);

      const workbench = { current: null, run: () => Promise.resolve() };
      const controlService = createWorkflowControlService({
        dataDir,
        workbench,
        readRuntimeState: (opts) => readRuntimeState({ dataDir, ...opts })
      });

      await controlService.retryStep({ runId, stepId: 'keywordReview', source: 'pipeline' });

      // Retrying keywordReview reset the draft!
      assert.equal(isReviewConfirmed({ dataDir, runId, stepId: 'keywordReview' }), false);
    });
  });

  describe('Human Context & Server Integration Boundary (Codex Review Fixes)', () => {
    const { resolveTrustedHumanContext, isAgentIdentity } = require('../../../core/workflow/human-context');
    const { registerDistributionRoutes } = require('../../../core/server/distribution-routes');
    const { registerSelectionReviewRoutes } = require('../../../core/server/selection-review-routes');
    const express = require('express');

    it('detects agent identities and rejects agent self-approval in trusted human context', () => {
      assert.equal(isAgentIdentity('agent'), true);
      assert.equal(isAgentIdentity('agent_draft'), true);
      assert.equal(isAgentIdentity('agent:planner'), true);
      assert.equal(isAgentIdentity('bot_review'), true);
      assert.equal(isAgentIdentity('llm'), true);
      assert.equal(isAgentIdentity('user'), false);
      assert.equal(isAgentIdentity('operator-alice'), false);

      // Rejects agent role header
      const res1 = resolveTrustedHumanContext({ headers: { 'x-actor-role': 'agent' }, body: {} });
      assert.equal(res1.ok, false);
      assert.equal(res1.code, 'APPROVAL_SELF_GRANT_FORBIDDEN');

      // Rejects agent ID header
      const res2 = resolveTrustedHumanContext({ headers: { 'x-agent-id': 'subagent-1' }, body: {} });
      assert.equal(res2.ok, false);

      // Rejects callerSource: agent in body
      const res3 = resolveTrustedHumanContext({ headers: {}, body: { callerSource: 'agent', approvedBy: 'user' } });
      assert.equal(res3.ok, false);

      // Rejects missing human context when no headers or credentials supplied
      const res4 = resolveTrustedHumanContext({ headers: {}, body: {} });
      assert.equal(res4.ok, false);
      assert.equal(res4.code, 'HUMAN_CONFIRMATION_REQUIRED');

      // Accepts valid human confirmation header
      const res5 = resolveTrustedHumanContext({
        headers: { 'x-human-confirmation': 'true', 'x-operator-id': 'operator-42' },
        body: {}
      });
      assert.equal(res5.ok, true);
      assert.equal(res5.identity, 'operator-42');
    });

    it('enforces execution approval at distribution submission boundary independently of caller flags', async () => {
      const dataDir = createTempDir();
      const runId = 'dist_approval_boundary_test';
      initRun({ dataDir, runId });
      initRuntimeState({ dataDir, runId, steps: ['export'], mode: 'daily' });

      const { createDistributionShopStore } = require('../../../core/distribution-shops');
      const shopStore = createDistributionShopStore(path.join(dataDir, 'distribution-shops.json'));
      const shopA = shopStore.save({ name: 'ShopA', platformShopName: 'PSA', port: 9222, enabled: true, isDefault: true });

      // Create an approval and reject it
      const appr = requestExecutionApproval({
        dataDir,
        runId,
        actionType: 'distribution.publish',
        inputPayload: { input: 'item1', shopIds: [shopA.id], distributionMode: 'random' },
        runRevision: 0
      });
      rejectExecutionApproval({ dataDir, runId, approvalId: appr.id, reason: '风险过高' });

      const app = express();
      app.use(express.json());
      const mockJobs = {
        activeDistributionJobs: new Map(),
        readDistributionJob: () => null,
        writeDistributionJob: (j) => j
      };
      registerDistributionRoutes(app, {
        jobs: mockJobs,
        shops: shopStore,
        dataDir,
        validateDistributionCategories: () => {},
        parseItems: () => [{ offerId: '1', title: 't', category: 'c' }],
        checkDistributionReadiness: async () => ({ canSubmit: true }),
        distributeProducts: async () => ({ ok: true }),
        parsePositiveNumber: (v, f) => Number(v) || f,
        createRunId: () => runId,
        summarizePipelineRun: () => ({}),
        originalError: () => {}
      });

      const server = await new Promise(r => { const l = app.listen(0, '127.0.0.1', () => r(l)); });
      try {
        // Caller tries to submit WITHOUT checkApproval / approvalRequired flags
        const res = await fetch(`http://127.0.0.1:${server.address().port}/api/distribution/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            runId,
            confirm: true,
            input: 'item1',
            shopIds: [shopA.id],
            distributionMode: 'random'
            // Notice: checkApproval and approvalRequired are omitted!
          })
        });
        // Must still be blocked with 409 because approval is rejected!
        assert.equal(res.status, 409);
        const data = await res.json();
        assert.equal(data.code, 'APPROVAL_REJECTED');
      } finally {
        await new Promise(r => server.close(r));
      }
    });

    it('persists review confirmation under default server configuration and only after acceptance', async () => {
      const dataDir = createTempDir();
      const runId = 'review_default_config_test';
      initRun({ dataDir, runId });
      initRuntimeState({ dataDir, runId, steps: ['select', 'generate'], mode: 'manual' });

      const app = express();
      app.use(express.json());

      let flowCallCount = 0;
      registerSelectionReviewRoutes(app, {
        dataDir,
        isValidWorkflowRunIdParam: () => true,
        flowReviewCandidates: () => ({ status: 'keywords_reviewed', approved: ['k1'], rejected: [] }),
        flowReviewProducts: (opts) => {
          flowCallCount++;
          if (opts.approvedProductIds?.includes('invalid_id')) {
            throw new Error('未选中有效货源');
          }
          if (!opts.approvedProductIds?.length && !opts.approveAll) {
            return { ok: true, status: 'awaiting_product_review', products: [] };
          }
          return { ok: true, status: 'products_selected', selected: [{ id: 'p1' }] };
        },
        readRuntimeState: () => ({ status: 'paused', steps: ['select', 'generate'] }),
        updateRuntimeState: () => {},
        withPipelineRuntimeFields: (v) => v,
        summarizePipelineRun: () => ({})
      });

      const server = await new Promise(r => { const l = app.listen(0, '127.0.0.1', () => r(l)); });
      try {
        const url = `http://127.0.0.1:${server.address().port}/api/workflows/runs/${runId}/product-review`;

        // 1. Invalid product selection throws -> draft MUST NOT be confirmed!
        const res1 = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Human-Confirmation': 'true' },
          body: JSON.stringify({ approvedProductIds: ['invalid_id'] })
        });
        assert.equal(res1.status, 500);
        assert.equal(isReviewConfirmed({ dataDir, runId, stepId: 'select' }), false);

        // 2. Empty selection returns awaiting_product_review -> draft MUST NOT be confirmed!
        const res2 = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Human-Confirmation': 'true' },
          body: JSON.stringify({ approvedProductIds: [] })
        });
        assert.equal(res2.status, 200);
        assert.equal(isReviewConfirmed({ dataDir, runId, stepId: 'select' }), false);

        // 3. Successful selection -> draft IS persisted as confirmed!
        const res3 = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Human-Confirmation': 'true' },
          body: JSON.stringify({ approvedProductIds: ['p1'] })
        });
        assert.equal(res3.status, 200);
        assert.equal(isReviewConfirmed({ dataDir, runId, stepId: 'select' }), true);
      } finally {
        await new Promise(r => server.close(r));
      }
    });

    it('rejects agent attempt to grant approval or confirm review draft', async () => {
      const dataDir = createTempDir();
      const runId = 'agent_grant_reject_test';
      initRun({ dataDir, runId });

      const app = express();
      app.use(express.json());
      registerDistributionRoutes(app, {
        dataDir,
        jobs: { activeDistributionJobs: new Map(), readDistributionJob: () => null }
      });
      registerSelectionReviewRoutes(app, {
        dataDir,
        isValidWorkflowRunIdParam: () => true
      });

      const server = await new Promise(r => { const l = app.listen(0, '127.0.0.1', () => r(l)); });
      try {
        // Agent calls grant endpoint with X-Actor-Role: agent
        const res1 = await fetch(`http://127.0.0.1:${server.address().port}/api/distribution/approval/grant`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Actor-Role': 'agent' },
          body: JSON.stringify({ runId, approvalId: 'any', approvedBy: 'user' })
        });
        assert.equal(res1.status, 403);

        // Agent calls review draft confirm with body callerSource: agent
        const res2 = await fetch(`http://127.0.0.1:${server.address().port}/api/workflows/runs/${runId}/review-drafts/keywordReview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'confirm', callerSource: 'agent' })
        });
        assert.equal(res2.status, 403);
      } finally {
        await new Promise(r => server.close(r));
      }
    });
  });
});
