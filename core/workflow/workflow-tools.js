/**
 * @file workflow-tools.js
 * @description 5 个 Workflow 组合工具定义 (workflow.start, workflow.status, workflow.submit_review, workflow.resume, workflow.cancel)
 * 符合 ADR v1.0 (D4, D6, D8)
 */

'use strict';

const { z } = require('zod');
const {
  readRuntimeState,
  requestRuntimeCancel
} = require('../../skills/pipeline-flow/runtime/store');
const { summarizePipelineRun } = require('../pipeline-run-summary');
const {
  saveReviewDraft,
  confirmReviewDraft,
  getReviewDraft,
  isReviewConfirmed
} = require('./review-service');
const { createWorkflowControlService } = require('./control-service');
const { createWorkbenchCoordinator } = require('../server/workbench-coordinator');

let defaultControlService = null;

function getDefaultControlService(options = {}) {
  if (options.controlService) return options.controlService;
  if (options.dataDir) {
    const workbench = createWorkbenchCoordinator();
    return createWorkflowControlService({
      workbench,
      dataDir: options.dataDir
    });
  }
  if (!defaultControlService || options.forceNew) {
    const workbench = createWorkbenchCoordinator();
    defaultControlService = createWorkflowControlService({
      workbench
    });
  }
  return defaultControlService;
}

// 1. workflow.start (workflow_start)
const workflowStartSchema = z.object({
  mode: z.enum(['daily', 'keyword', 'root-keyword', 'order-sheet', 'peer-discovery']).optional().default('daily').describe('工作流运行模式'),
  keyword: z.string().optional().describe('选品主词或词根（keyword/root-keyword 模式必填）'),
  count: z.number().int().positive().optional().default(3).describe('期望生成的标题或选品数量'),
  stopAfterStep: z.string().optional().describe('局部执行检查点：运行到指定步骤后自动暂停（如 mine, keywordReview, verify, select, generate, export）'),
  params: z.record(z.string(), z.any()).optional().default({}).describe('附加运行参数')
});

/** @type {import('../runtime/contracts').ToolDefinition} */
const workflowStartTool = {
  id: 'workflow.start',
  mcpName: 'workflow_start',
  version: '1.0.0',
  description: '启动固定选品工作流（支持 daily、keyword、root-keyword、peer-discovery 模式，支持 stopAfterStep 局部阶段运行）。',
  inputSchema: workflowStartSchema,
  policy: {
    risk: 'high',
    approval: 'never',
    sideEffect: 'write',
    resourceKeys: ['workbench'],
    platforms: ['sycm', 'taobao', '1688']
  },
  execute: async (input, ctx) => {
    const controlService = ctx?.controlService || getDefaultControlService({ dataDir: ctx?.dataDir });
    const mode = input.mode || 'daily';
    const params = {
      ...(input.params || {}),
      keyword: input.keyword || input.params?.keyword || '',
      roots: input.params?.roots || (input.keyword ? [input.keyword] : []),
      count: input.count || input.params?.count || 3,
      productsPerKeyword: input.count || 3
    };

    const res = await controlService.startRun({
      mode,
      params,
      stopAfterStep: input.stopAfterStep || null,
      source: 'workflow'
    });

    if (res.httpStatus >= 400) {
      const err = new Error(res.body?.error || '工作流启动失败');
      err.status = res.httpStatus;
      err.code = res.body?.code || 'WORKFLOW_START_FAILED';
      throw err;
    }

    return res.body?.data || res.body;
  }
};

// 2. workflow.status (workflow_status)
const workflowStatusSchema = z.object({
  runId: z.string().min(1, 'runId 不能为空').describe('工作流运行 ID')
});

/** @type {import('../runtime/contracts').ToolDefinition} */
const workflowStatusTool = {
  id: 'workflow.status',
  mcpName: 'workflow_status',
  version: '1.0.0',
  description: '查询工作流当前运行状态、活动步骤、阻塞/人工复核提示及节点产物预览。',
  inputSchema: workflowStatusSchema,
  policy: {
    risk: 'low',
    approval: 'never',
    sideEffect: 'read',
    resourceKeys: [],
    platforms: []
  },
  execute: async (input, ctx) => {
    const { runId } = input;
    const dataDir = ctx?.dataDir;
    const runtime = readRuntimeState({ dataDir, runId, autoRecover: true });
    if (!runtime) {
      const err = new Error(`未找到工作流运行记录: ${runId}`);
      err.status = 404;
      err.code = 'WORKFLOW_RUN_NOT_FOUND';
      throw err;
    }

    const summary = summarizePipelineRun({ dataDir, runId });
    const currentStep = runtime.activeStep || 'mine';
    const draft = getReviewDraft({ dataDir, runId, stepId: currentStep });
    const confirmed = isReviewConfirmed({ dataDir, runId, stepId: currentStep });

    return {
      ok: true,
      runId,
      status: runtime.status,
      activeStep: runtime.activeStep,
      mode: runtime.mode,
      revision: runtime.revision,
      attempt: runtime.attempt,
      stopAfterStep: runtime.stopAfterStep,
      blocker: runtime.blocker,
      manualAction: runtime.manualAction,
      actionHint: runtime.actionHint,
      progress: runtime.progress,
      reviewDraft: draft,
      isReviewConfirmed: confirmed,
      summary: summary || {}
    };
  }
};

// 3. workflow.submit_review (workflow_submit_review)
const workflowSubmitReviewSchema = z.object({
  runId: z.string().min(1, 'runId 不能为空').describe('工作流运行 ID'),
  stepId: z.string().min(1, 'stepId 不能为空').describe('复核步骤 ID，如 keywordReview、select、peer-review'),
  decisions: z.record(z.string(), z.any()).describe('复核决策数据（如勾选的词或商品）'),
  action: z.enum(['draft', 'confirm', 'reject']).optional().default('confirm').describe('动作类型：draft(Agent草稿)、confirm(确认通过)、reject(拒绝打回)'),
  version: z.number().int().nonnegative().optional().describe('预期版本号（乐观锁）')
});

/** @type {import('../runtime/contracts').ToolDefinition} */
const workflowSubmitReviewTool = {
  id: 'workflow.submit_review',
  mcpName: 'workflow_submit_review',
  version: '1.0.0',
  description: '提交业务复核（选词/选品/同行复核），支持 Agent 辅助提出草稿 (action=draft) 或人工确认 (action=confirm)。',
  inputSchema: workflowSubmitReviewSchema,
  policy: {
    risk: 'medium',
    approval: 'never',
    sideEffect: 'write',
    resourceKeys: [],
    platforms: []
  },
  execute: async (input, ctx) => {
    const { runId, stepId, decisions, action = 'confirm', version } = input;
    const dataDir = ctx?.dataDir;

    if (action === 'draft') {
      const draft = saveReviewDraft({
        dataDir,
        runId,
        stepId,
        decisions,
        expectedVersion: version,
        updatedBy: 'agent_draft'
      });
      return { ok: true, action: 'draft', draft };
    }

    if (action === 'reject') {
      const draft = saveReviewDraft({
        dataDir,
        runId,
        stepId,
        decisions: { ...(decisions || {}), rejected: true },
        expectedVersion: version,
        updatedBy: 'user'
      });
      return { ok: true, action: 'reject', draft };
    }

    // confirm
    const confirmed = confirmReviewDraft({
      dataDir,
      runId,
      stepId,
      decisions,
      expectedVersion: version,
      confirmedBy: ctx?.caller || 'user'
    });
    return { ok: true, action: 'confirm', draft: confirmed };
  }
};

// 4. workflow.resume (workflow_resume)
const workflowResumeSchema = z.object({
  runId: z.string().min(1, 'runId 不能为空').describe('工作流运行 ID'),
  stopAfterStep: z.string().optional().describe('指定恢复运行至何步骤再次暂停')
});

/** @type {import('../runtime/contracts').ToolDefinition} */
const workflowResumeTool = {
  id: 'workflow.resume',
  mcpName: 'workflow_resume',
  version: '1.0.0',
  description: '恢复处于暂停或待复核状态的工作流继续执行（可选指定 stopAfterStep 继续运行到下一阶段）。',
  inputSchema: workflowResumeSchema,
  policy: {
    risk: 'high',
    approval: 'never',
    sideEffect: 'write',
    resourceKeys: ['workbench'],
    platforms: ['sycm', 'taobao', '1688']
  },
  execute: async (input, ctx) => {
    const controlService = ctx?.controlService || getDefaultControlService({ dataDir: ctx?.dataDir });
    const res = await controlService.resumeRun({
      runId: input.runId,
      stopAfterStep: input.stopAfterStep || null,
      source: 'workflow'
    });

    if (res.httpStatus >= 400) {
      const err = new Error(res.body?.error || '工作流恢复失败');
      err.status = res.httpStatus;
      err.code = res.body?.code || 'WORKFLOW_RESUME_FAILED';
      throw err;
    }

    return res.body?.data || res.body;
  }
};

// 5. workflow.cancel (workflow_cancel)
const workflowCancelSchema = z.object({
  runId: z.string().min(1, 'runId 不能为空').describe('工作流运行 ID'),
  reason: z.string().optional().default('user_cancelled').describe('取消原因')
});

/** @type {import('../runtime/contracts').ToolDefinition} */
const workflowCancelTool = {
  id: 'workflow.cancel',
  mcpName: 'workflow_cancel',
  version: '1.0.0',
  description: '在安全步骤边界请求取消运行中的工作流并释放占用资源。',
  inputSchema: workflowCancelSchema,
  policy: {
    risk: 'medium',
    approval: 'never',
    sideEffect: 'write',
    resourceKeys: [],
    platforms: []
  },
  execute: async (input, ctx) => {
    const controlService = ctx?.controlService || getDefaultControlService({ dataDir: ctx?.dataDir });
    const res = controlService.cancelRun({
      runId: input.runId,
      reason: input.reason || 'user_cancelled'
    });

    if (res.httpStatus >= 400) {
      const err = new Error(res.body?.error || '工作流取消失败');
      err.status = res.httpStatus;
      err.code = res.body?.code || 'WORKFLOW_CANCEL_FAILED';
      throw err;
    }

    return res.body?.data || res.body;
  }
};

module.exports = {
  workflowStartTool,
  workflowStatusTool,
  workflowSubmitReviewTool,
  workflowResumeTool,
  workflowCancelTool,
  getDefaultControlService
};
