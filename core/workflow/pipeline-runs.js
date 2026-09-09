'use strict';

const summarizePipelineRun = require('../pipeline-run-summary').summarizePipelineRun;
const listPipelineRuns = require('../pipeline-run-summary').listPipelineRuns;
const { readWorkflowDefinition, readWorkflowEvents } = require('./pipeline-storage');
const { templateForSummary } = require('./pipeline-templates');
const { readRuntimeForSummary, buildNodeStates } = require('./pipeline-node-state');

/**
 * 将 pipeline summary 转为画布 workflow run 结构。
 * @param {object} summary pipeline-run-summary 输出。
 * @param {object} [options] 映射选项。
 * @param {string} [options.dataDir] pipeline 数据目录。
 * @returns {object|null} workflow run。
 */
function pipelineSummaryToWorkflowRun(summary, options = {}) {
  if (!summary) return null;
  const runtime = summary.runtime || readRuntimeForSummary(summary, options.dataDir);
  const summaryWithRuntime = {
    ...summary,
    runtime
  };
  const workflowTemplate = templateForSummary(summary);
  const workflowSnapshot = readWorkflowDefinition({ dataDir: options.dataDir, runId: summary.runId });
  const workflow = workflowSnapshot || (workflowTemplate
    ? { id: workflowTemplate.id, mode: workflowTemplate.mode, ...workflowTemplate.workflow }
    : null);
  return {
    runId: summary.runId,
    status: runtime?.status || summary.status || 'unknown',
    workflow,
    nodeStates: buildNodeStates(summaryWithRuntime),
    runtime,
    startedAt: summary.startedAt || '',
    updatedAt: runtime?.updatedAt || summary.updatedAt || summary.startedAt || '',
    error: summary.error || null,
    logs: [],
    stage: summary.stage,
    counts: summary.counts || {},
    policy: summary.policy || {},
    funnel: summary.funnel || {},
    failureReasons: summary.failureReasons || {},
    diversity: summary.diversity || {},
    files: summary.files || {},
    batchFile: summary.batchFile || '',
    reviewFile: summary.reviewFile || '',
    batchCount: summary.batchCount || 0,
    requiresUserAction: !!summary.requiresUserAction,
    blockers: Array.isArray(summary.blockers) ? summary.blockers : [],
    nextActionCode: summary.nextActionCode || '',
    nextCommand: summary.nextCommand || '',
    allowedCommands: Array.isArray(summary.allowedCommands) ? summary.allowedCommands : [],
    userMessage: summary.userMessage || '',
    previews: summary.previews || {}
  };
}

/**
 * 列出真实 pipeline run，并映射为 workflow run。
 * @param {object} options 查询参数。
 * @param {string} [options.dataDir] pipeline 数据目录。
 * @param {number} [options.limit] 最大数量。
 * @returns {{runs:Array<object>, latest:object|null}} workflow run 列表。
 */
function listWorkflowRuns(options = {}) {
  const result = listPipelineRuns(options);
  const runs = result.runs.map(summary => pipelineSummaryToWorkflowRun(summary, { dataDir: options.dataDir }));
  return {
    runs,
    latest: runs[0] || null
  };
}

/**
 * 获取单个真实 pipeline run 的 workflow 映射。
 * @param {string} runId pipeline runId。
 * @param {object} options 查询参数。
 * @param {string} [options.dataDir] pipeline 数据目录。
 * @returns {object|null} workflow run。
 */
function normalizeRunOptions(runIdOrOptions, maybeOptions = {}) {
  if (runIdOrOptions && typeof runIdOrOptions === 'object') {
    return { ...runIdOrOptions };
  }
  return { ...maybeOptions, runId: runIdOrOptions };
}

/**
 * @param {string|object} runIdOrOptions 运行 ID 或含 runId 的选项。
 * @param {object} [options] 运行数据目录等读取选项。
 * @returns {object|null} 供 Web 使用的工作流运行详情。
 */
function getWorkflowRun(runIdOrOptions, options = {}) {
  const normalized = normalizeRunOptions(runIdOrOptions, options);
  const run = pipelineSummaryToWorkflowRun(summarizePipelineRun(normalized), { dataDir: normalized.dataDir });
  if (!run) return null;
  return {
    ...run,
    workflowEvents: readWorkflowEvents({ dataDir: normalized.dataDir, runId: normalized.runId || run.runId })
  };
}

module.exports = { pipelineSummaryToWorkflowRun, listWorkflowRuns, getWorkflowRun };
