'use strict';

// 保留既有公共入口，具体职责由同目录模块实现。
const { DEFAULT_PIPELINE_DIR } = require('../pipeline-run-summary');
const { WORKFLOW_NODE_IDS } = require('./pipeline-definition-common');
const { sanitizeWorkflowParams, buildPipelineCliArgs, validateProductionWorkflow, resolveProductionWorkflowLaunch, resolveProductionWorkflowDefinition } = require('./pipeline-params');
const { writeWorkflowDefinition, readWorkflowDefinition, appendWorkflowEvent, readWorkflowEvents, deleteWorkflowRun } = require('./pipeline-storage');
const { listProductionWorkflowTemplates } = require('./pipeline-templates');
const { pipelineSummaryToWorkflowRun, listWorkflowRuns, getWorkflowRun } = require('./pipeline-runs');
const { readWorkflowNodeArtifact } = require('./pipeline-artifacts');

module.exports = {
  DEFAULT_PIPELINE_DIR,
  WORKFLOW_NODE_IDS,
  listProductionWorkflowTemplates,
  sanitizeWorkflowParams,
  buildPipelineCliArgs,
  validateProductionWorkflow,
  resolveProductionWorkflowLaunch,
  resolveProductionWorkflowDefinition,
  writeWorkflowDefinition,
  readWorkflowDefinition,
  appendWorkflowEvent,
  readWorkflowEvents,
  pipelineSummaryToWorkflowRun,
  listWorkflowRuns,
  getWorkflowRun,
  readWorkflowNodeArtifact,
  deleteWorkflowRun
};
