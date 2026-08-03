'use strict';

const path = require('path');
const { withAgentResponseFields } = require('../../../core/agent-response');
const { DEFAULT_FLOW_DIR } = require('./run-store');

/**
 * Add the shared agent response fields used by every pipeline stage.
 * @param {object} payload Stage response.
 * @returns {object} Agent-compatible response.
 */
function flowResponse(payload) {
  return withAgentResponseFields(payload);
}

/**
 * Resolve the opportunity storage directory for a pipeline invocation.
 * @param {object} [options] Pipeline options.
 * @returns {string} Opportunity directory.
 */
function resolveOpportunityDir(options = {}) {
  return options.opportunityDir || path.join(options.dataDir || DEFAULT_FLOW_DIR, 'opportunities');
}

/**
 * Determine whether a verified keyword can proceed to title generation.
 * @param {object} [row] Verified keyword row.
 * @returns {boolean} Whether generation is allowed.
 */
function isGenerationEligibleKeyword(row = {}) {
  const decision = row.keywordOpportunity && row.keywordOpportunity.decision;
  return !decision || decision === 'continue' || row.autoFallbackEligible === true;
}

/**
 * Build the CLI command for the next pipeline stage.
 * @param {string} step Pipeline stage.
 * @param {string} runId Run identifier.
 * @param {object} [options] Command options.
 * @returns {string} CLI command.
 */
function buildFlowCommand(step, runId, options = {}) {
  const runPart = runId ? ` --run ${runId}` : '';
  if (step === 'review') return `node bin/cli.js flow review${runPart}${options.approveAll ? ' --approve-all' : ''}`;
  if (step === 'verify') return `node bin/cli.js flow verify${runPart} --limit ${options.limit || 20}`;
  if (step === 'select') return `node bin/cli.js flow select${runPart} --limit ${options.limit || 10}`;
  if (step === 'generate') return `node bin/cli.js flow generate${runPart} --limit ${options.limit || 10}`;
  if (step === 'export') return `node bin/cli.js flow export${runPart} --limit ${options.limit || 20}`;
  if (step === 'inspect') return `node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync('data/pipeline/runs/${runId}/run.json','utf8'));console.log(JSON.stringify(r,null,2))"`;
  return '';
}

module.exports = {
  buildFlowCommand,
  flowResponse,
  isGenerationEligibleKeyword,
  resolveOpportunityDir
};
