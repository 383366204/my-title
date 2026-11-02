/**
 * @file mcp-workflow-tools.test.js
 * @description 统一 ToolRegistry 装配 (17 工具) 与 5 个 Workflow 组合工具执行测试 (PR-07)
 * 符合 ADR v1.0 (D2, D3, D4, D5, D6, D8, D10)
 */

'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { createDefaultToolRegistry, createDefaultToolExecutor } = require('../../../core/runtime/bootstrap');
const {
  workflowStartTool,
  workflowStatusTool,
  workflowSubmitReviewTool,
  workflowResumeTool,
  workflowCancelTool
} = require('../../../core/workflow/workflow-tools');
const { createWorkflowControlService } = require('../../../core/workflow/control-service');
const { createWorkbenchCoordinator } = require('../../../core/server/workbench-coordinator');
const {
  initRuntimeState,
  readRuntimeState,
  updateRuntimeState
} = require('../../../skills/pipeline-flow/runtime/store');
const { createClientForwarder } = require('../../../core/runtime/server-forwarder');

describe('PR-07: 统一 ToolRegistry 与 Workflow MCP 工具', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-workflow-tools-test-'));
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('1. ToolRegistry 全量 17 个工具装配与双索引校验', () => {
    it('应当包含 12 个领域原子工具与 5 个工作流工具，共 17 个唯一工具', () => {
      const registry = createDefaultToolRegistry();
      const list = registry.list();
      assert.equal(list.length, 17, `预期 17 个工具，实际得到 ${list.length}`);

      // 12 个原子工具及别名校验
      const expectedDomainTools = [
        ['sycm.query', 'sycm_query'],
        ['keyword.suggest', 'suggest_keywords'],
        ['title.generate', 'generate_title'],
        ['title.batch_generate', 'batch_generate_titles'],
        ['taobao_opc.list_tools', 'taobao_opc_list_tools'],
        ['taobao_opc.call', 'taobao_opc_call'],
        ['alibaba.opportunities', 'opportunities'],
        ['alibaba.trend', 'trend'],
        ['sycm.status', 'sycm_status'],
        ['peer.discover', 'discover_peers'],
        ['peer.status', 'get_peer_discovery_status'],
        ['peer.cancel', 'cancel_peer_discovery']
      ];

      for (const [id, mcpName] of expectedDomainTools) {
        assert.ok(registry.has(id), `缺少原子工具 ID: ${id}`);
        assert.ok(registry.has(mcpName), `缺少原子工具 MCP 别名: ${mcpName}`);
        assert.strictEqual(registry.get(id), registry.get(mcpName));
      }

      // 5 个工作流工具及别名校验
      const expectedWorkflowTools = [
        ['workflow.start', 'workflow_start'],
        ['workflow.status', 'workflow_status'],
        ['workflow.submit_review', 'workflow_submit_review'],
        ['workflow.resume', 'workflow_resume'],
        ['workflow.cancel', 'workflow_cancel']
      ];

      for (const [id, mcpName] of expectedWorkflowTools) {
        assert.ok(registry.has(id), `缺少工作流工具 ID: ${id}`);
        assert.ok(registry.has(mcpName), `缺少工作流工具 MCP 别名: ${mcpName}`);
        assert.strictEqual(registry.get(id), registry.get(mcpName));
      }
    });

    it('工作流工具的安全策略声明必须符合 ADR 规范 (D4, D7)', () => {
      const registry = createDefaultToolRegistry();

      const startPolicy = registry.get('workflow.start').policy;
      assert.equal(startPolicy.risk, 'high');
      assert.equal(startPolicy.sideEffect, 'write');
      assert.deepEqual(startPolicy.resourceKeys, ['workbench']);

      const resumePolicy = registry.get('workflow.resume').policy;
      assert.equal(resumePolicy.risk, 'high');
      assert.equal(resumePolicy.sideEffect, 'write');
      assert.deepEqual(resumePolicy.resourceKeys, ['workbench']);

      const statusPolicy = registry.get('workflow.status').policy;
      assert.equal(statusPolicy.risk, 'low');
      assert.equal(statusPolicy.sideEffect, 'read');
      assert.deepEqual(statusPolicy.resourceKeys, []);

      const reviewPolicy = registry.get('workflow.submit_review').policy;
      assert.equal(reviewPolicy.risk, 'medium');
      assert.equal(reviewPolicy.sideEffect, 'write');

      const cancelPolicy = registry.get('workflow.cancel').policy;
      assert.equal(cancelPolicy.risk, 'medium');
      assert.equal(cancelPolicy.sideEffect, 'write');
    });
  });

  describe('2. Workflow 工具执行闭环 (start -> status -> review -> resume -> cancel)', () => {
    function setupTestEnvironment() {
      const workbench = createWorkbenchCoordinator();
      // 创建 mock runner，立即根据 stopAfterStep 进入暂停/待复核状态
      const controlService = createWorkflowControlService({
        workbench,
        dataDir: tmpDir,
        getPipelineRuntimeRunner: () => async (options) => {
          const runId = options.runId;
          const stopAfterStep = options.stopAfterStep || 'mine';
          initRuntimeState({
            dataDir: options.dataDir || tmpDir,
            runId,
            mode: options.mode || 'root-keyword',
            steps: ['mine', 'keywordReview', 'select', 'generate', 'export'],
            params: options.params || {}
          });
          updateRuntimeState({
            dataDir: options.dataDir || tmpDir,
            runId,
            patch: {
              status: 'needs_review',
              activeStep: stopAfterStep,
              stopAfterStep,
              blocker: null,
              manualAction: 'keyword_review',
              actionHint: '请复核候选关键词'
            }
          });
          return { ok: true, runId, status: 'needs_review' };
        }
      });

      const ctx = {
        controlService,
        dataDir: tmpDir,
        caller: 'user'
      };

      return { controlService, ctx, workbench };
    }

    it('workflow.start 应当成功启动工作流并支持 stopAfterStep 局部暂停', async () => {
      const { ctx } = setupTestEnvironment();

      const res = await workflowStartTool.execute({
        mode: 'root-keyword',
        keyword: '纯银项链',
        count: 5,
        stopAfterStep: 'keywordReview'
      }, ctx);

      assert.ok(res);
      assert.ok(res.runId, '应当返回 runId');
      assert.equal(res.status, 'started');
      assert.equal(res.mode, 'root-keyword');

      // 验证落盘的 runtime 状态
      const runtime = readRuntimeState({ dataDir: tmpDir, runId: res.runId });
      assert.ok(runtime);
      assert.equal(runtime.mode, 'root-keyword');
      assert.equal(runtime.stopAfterStep, 'keywordReview');
    });

    it('workflow.status 应当准确返回当前活动步骤、复核草稿与确认状态', async () => {
      const { ctx } = setupTestEnvironment();

      const runId = 'test_status_run';
      initRuntimeState({
        dataDir: tmpDir,
        runId,
        mode: 'keyword',
        steps: ['mine', 'keywordReview', 'verify', 'select', 'generate', 'export'],
        params: { keyword: '纯银项链' }
      });
      updateRuntimeState({
        dataDir: tmpDir,
        runId,
        patch: {
          status: 'needs_review',
          activeStep: 'keywordReview',
          manualAction: 'keyword_review',
          actionHint: '等待人工复核'
        }
      });

      const statusRes = await workflowStatusTool.execute({ runId }, ctx);
      assert.equal(statusRes.ok, true);
      assert.equal(statusRes.runId, runId);
      assert.equal(statusRes.status, 'needs_review');
      assert.equal(statusRes.activeStep, 'keywordReview');
      assert.equal(statusRes.manualAction, 'keyword_review');
      assert.equal(statusRes.isReviewConfirmed, false);
      assert.equal(statusRes.reviewDraft, null);
    });

    it('workflow.submit_review 应当支持 Agent 保存草稿 (action=draft) 并自增版本号', async () => {
      const { ctx } = setupTestEnvironment();
      const runId = 'test_review_draft_run';

      initRuntimeState({
        dataDir: tmpDir,
        runId,
        mode: 'keyword',
        steps: ['mine', 'keywordReview', 'verify'],
        params: {}
      });

      // 1. Agent 提交初版草稿
      const draftRes1 = await workflowSubmitReviewTool.execute({
        runId,
        stepId: 'keywordReview',
        decisions: { selectedKeywords: ['纯银锁骨链', '925纯银'] },
        action: 'draft'
      }, { ...ctx, caller: 'agent_draft' });

      assert.equal(draftRes1.ok, true);
      assert.equal(draftRes1.action, 'draft');
      assert.equal(draftRes1.draft.version, 1);
      assert.equal(draftRes1.draft.updatedBy, 'agent_draft');
      assert.equal(draftRes1.draft.status, 'draft');

      // 2. Agent 再次修订草稿，版本号自增到 2
      const draftRes2 = await workflowSubmitReviewTool.execute({
        runId,
        stepId: 'keywordReview',
        decisions: { selectedKeywords: ['纯银锁骨链', '925纯银女'] },
        action: 'draft',
        version: 1
      }, { ...ctx, caller: 'agent_draft' });

      assert.equal(draftRes2.draft.version, 2);
    });

    it('workflow.submit_review 严禁自动化 Agent 自行 confirm (D8 防线)', async () => {
      const { ctx } = setupTestEnvironment();
      const runId = 'test_review_forbidden_run';

      initRuntimeState({
        dataDir: tmpDir,
        runId,
        mode: 'keyword',
        steps: ['mine', 'keywordReview'],
        params: {}
      });

      // 先存草稿
      await workflowSubmitReviewTool.execute({
        runId,
        stepId: 'keywordReview',
        decisions: { selectedKeywords: ['纯银锁骨链'] },
        action: 'draft'
      }, ctx);

      // 尝试用 agent / model 身份 confirm，必须抛出 403 / REVIEW_CONFIRM_FORBIDDEN
      await assert.rejects(
        async () => {
          await workflowSubmitReviewTool.execute({
            runId,
            stepId: 'keywordReview',
            decisions: { selectedKeywords: ['纯银锁骨链'] },
            action: 'confirm',
            version: 1
          }, { ...ctx, caller: 'agent' });
        },
        (err) => {
          assert.equal(err.code, 'REVIEW_CONFIRM_FORBIDDEN');
          assert.equal(err.status, 403);
          return true;
        }
      );
    });

    it('workflow.submit_review 确认时若版本号冲突应当抛出 409 (乐观锁)', async () => {
      const { ctx } = setupTestEnvironment();
      const runId = 'test_review_conflict_run';

      initRuntimeState({
        dataDir: tmpDir,
        runId,
        mode: 'keyword',
        steps: ['mine', 'keywordReview'],
        params: {}
      });

      await workflowSubmitReviewTool.execute({
        runId,
        stepId: 'keywordReview',
        decisions: { selectedKeywords: ['词1'] },
        action: 'draft'
      }, ctx);

      // 传入过期的 expectedVersion: 0 (当前版本已是 1)
      await assert.rejects(
        async () => {
          await workflowSubmitReviewTool.execute({
            runId,
            stepId: 'keywordReview',
            decisions: { selectedKeywords: ['词1'] },
            action: 'confirm',
            version: 0
          }, { ...ctx, caller: 'user' });
        },
        (err) => {
          assert.equal(err.code, 'REVIEW_VERSION_CONFLICT');
          assert.equal(err.status, 409);
          return true;
        }
      );
    });

    it('workflow.submit_review 由人类操作员正确 confirm 并推进', async () => {
      const { ctx } = setupTestEnvironment();
      const runId = 'test_review_confirm_run';

      initRuntimeState({
        dataDir: tmpDir,
        runId,
        mode: 'keyword',
        steps: ['mine', 'keywordReview'],
        params: {}
      });

      await workflowSubmitReviewTool.execute({
        runId,
        stepId: 'keywordReview',
        decisions: { selectedKeywords: ['最终核准词'] },
        action: 'draft'
      }, ctx);

      const confirmRes = await workflowSubmitReviewTool.execute({
        runId,
        stepId: 'keywordReview',
        decisions: { selectedKeywords: ['最终核准词'] },
        action: 'confirm',
        version: 1
      }, { ...ctx, caller: 'user' });

      assert.equal(confirmRes.ok, true);
      assert.equal(confirmRes.action, 'confirm');
      assert.equal(confirmRes.draft.status, 'confirmed');
      assert.equal(confirmRes.draft.confirmedBy, 'user');
    });

    it('workflow.resume 应当正确恢复待复核或暂停的工作流', async () => {
      const { ctx } = setupTestEnvironment();
      const runId = 'test_resume_run';

      initRuntimeState({
        dataDir: tmpDir,
        runId,
        mode: 'keyword',
        steps: ['mine', 'keywordReview', 'select'],
        params: {}
      });
      updateRuntimeState({
        dataDir: tmpDir,
        runId,
        patch: {
          status: 'paused',
          activeStep: 'keywordReview'
        }
      });

      const resumeRes = await workflowResumeTool.execute({
        runId,
        stopAfterStep: 'select'
      }, ctx);

      assert.ok(resumeRes);
      assert.equal(resumeRes.runId, runId);
      assert.ok(resumeRes.control);
      assert.equal(resumeRes.control.requestedAction, 'resume');
    });

    it('workflow.cancel 应当在安全边界标记取消并落盘', async () => {
      const { ctx } = setupTestEnvironment();
      const runId = 'test_cancel_run';

      initRuntimeState({
        dataDir: tmpDir,
        runId,
        mode: 'keyword',
        steps: ['mine', 'keywordReview'],
        params: {}
      });
      updateRuntimeState({
        dataDir: tmpDir,
        runId,
        patch: {
          status: 'running',
          activeStep: 'mine'
        }
      });

      const cancelRes = await workflowCancelTool.execute({
        runId,
        reason: '测试用户取消'
      }, ctx);

      assert.ok(cancelRes);
      assert.equal(cancelRes.status, 'cancel_requested');
      assert.ok(cancelRes.control);
      assert.equal(cancelRes.control.requestedAction, 'cancel');
    });
  });

  describe('3. ToolExecutor 与 ClientForwarder 集成调用', () => {
    it('通过 ToolExecutor 可以按 canonical ID (workflow.status) 与 MCP alias (workflow_status) 执行', async () => {
      const executor = createDefaultToolExecutor();
      const runId = 'executor_test_run';

      initRuntimeState({
        dataDir: tmpDir,
        runId,
        mode: 'keyword',
        steps: ['mine'],
        params: {}
      });

      // 1. canonical id 执行 (附带 dataDir 上下文)
      const resById = await executor.execute('workflow.status', { runId }, { dataDir: tmpDir });
      assert.equal(resById.ok, true);
      assert.equal(resById.runId, runId);

      // 2. mcpName 别名执行
      const resByName = await executor.execute('workflow_status', { runId }, { dataDir: tmpDir });
      assert.equal(resByName.ok, true);
      assert.equal(resByName.runId, runId);
    });

    it('通过 createClientForwarder 在离线状态下透明调用 workflow_status', async () => {
      const forwarder = createClientForwarder({ projectRoot: path.resolve(__dirname, '../../../') });
      const runId = 'forwarder_test_run';

      initRuntimeState({
        dataDir: tmpDir,
        runId,
        mode: 'daily',
        steps: ['mine'],
        params: {}
      });

      const res = await forwarder.execute('workflow_status', { runId }, { dataDir: tmpDir, caller: 'mcp' });
      assert.equal(res.ok, true);
      assert.equal(res.runId, runId);
    });
  });
});
