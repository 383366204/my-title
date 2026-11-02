'use strict';

/**
 * @file scheduler.js
 * @description [Deprecated] Legacy DAG 工作流调度器已退役。
 * 遵循 ADR v1.0 (D6, 阶段 5 / PR-07)，工作流执行调度已统一收敛至 skills/pipeline-flow。
 * 本模块调度执行逻辑已彻底停用，历史数据仅保留 core/workflow/run-store.js 只读查询兼容。
 */

function createRetiredSchedulerError() {
  const err = new Error('Legacy DAG scheduler has been retired per ADR v1.0 (D6). Use pipeline-flow runtime instead.');
  err.code = 'SCHEDULER_RETIRED';
  return err;
}

async function startWorkflow() {
  throw createRetiredSchedulerError();
}

async function resumeWorkflow() {
  throw createRetiredSchedulerError();
}

async function retryWorkflowNode() {
  throw createRetiredSchedulerError();
}

function cancelWorkflow() {
  throw createRetiredSchedulerError();
}

module.exports = {
  startWorkflow,
  resumeWorkflow,
  retryWorkflowNode,
  cancelWorkflow
};
