'use strict';

const { DEFAULT_PRODUCTS_PER_KEYWORD } = require('./flow-constants');
const { flowResponse } = require('./flow-context');
const { flowKeyword } = require('./flow-orchestrator');

/**
 * Create the high-level workflow runner with injectable business stages.
 * @param {object} [deps] Stage dependencies.
 * @returns {{run: function(object): Promise<object>}} Workflow runner.
 */
function createWorkflowRunner(deps = {}) {
  return {
    async run(input = {}) {
      const sycm = deps.sycm || (async payload => {
        const result = await flowKeyword({
          ...payload,
          keyword: payload.keyword,
          productsPerKeyword: payload.productsPerKeyword || DEFAULT_PRODUCTS_PER_KEYWORD,
          export: payload.export || 20
        });
        return {
          ok: result.ok !== false,
          status: result.status,
          runId: result.runId,
          runDir: result.runDir,
          files: result.files,
          canSubmit: result.canSubmit,
          mustReview: result.mustReview,
          blockers: result.blockers || [],
          data: result
        };
      });
      const selectProducts = deps.selectProducts || (async payload => {
        const data = payload.sycm && payload.sycm.data ? payload.sycm.data : payload.sycm;
        return {
          ok: data && data.ok !== false,
          status: data && data.status,
          products: data && data.files && data.files.distributionBatch ? [{ file: data.files.distributionBatch }] : [],
          data
        };
      });
      const prepareDistribution = deps.prepareDistribution || (async payload => {
        const data = payload.sycm && payload.sycm.data ? payload.sycm.data : payload.sycm;
        return {
          ok: data && data.ok !== false && data.canSubmit === true,
          status: data && data.status,
          canSubmit: data && data.canSubmit === true,
          file: data && data.files && data.files.distributionBatch,
          runId: data && data.runId,
          runDir: data && data.runDir,
          blockers: data && Array.isArray(data.blockers) ? data.blockers : [],
          data
        };
      });

      const sycmResult = await sycm(input);
      if (!sycmResult || sycmResult.ok === false) {
        return flowResponse({
          ok: false,
          status: sycmResult && sycmResult.status ? sycmResult.status : 'sycm_failed',
          blockers: sycmResult && Array.isArray(sycmResult.blockers) ? sycmResult.blockers : ['sycm_failed'],
          data: sycmResult
        });
      }

      const selectionResult = await selectProducts({ ...input, sycm: sycmResult });
      if (!selectionResult || selectionResult.ok === false) {
        return flowResponse({
          ok: false,
          status: selectionResult && selectionResult.status ? selectionResult.status : 'product_selection_failed',
          blockers: selectionResult && Array.isArray(selectionResult.blockers) ? selectionResult.blockers : ['product_selection_failed'],
          data: { sycm: sycmResult, selection: selectionResult }
        });
      }

      const distributionResult = await prepareDistribution({
        ...input,
        sycm: sycmResult,
        products: selectionResult.products || []
      });
      if (!distributionResult || distributionResult.ok === false || distributionResult.canSubmit !== true) {
        return flowResponse({
          ok: false,
          status: distributionResult && distributionResult.status ? distributionResult.status : 'distribution_not_ready',
          blockers: distributionResult && Array.isArray(distributionResult.blockers) && distributionResult.blockers.length
            ? distributionResult.blockers
            : ['distribution_not_ready'],
          data: { sycm: sycmResult, selection: selectionResult, distribution: distributionResult }
        });
      }

      return flowResponse({
        ok: true,
        status: 'awaiting_user_confirmation',
        requiresUserAction: true,
        nextActionCode: 'confirm_before_submit',
        keyword: input.keyword,
        runId: distributionResult.runId || sycmResult.runId || '',
        runDir: distributionResult.runDir || sycmResult.runDir || '',
        file: distributionResult.file || '',
        data: {
          sycm: sycmResult,
          selection: selectionResult,
          distribution: distributionResult
        },
        allowedCommands: ['node bin/cli.js workflow resume --confirm-submit --json'],
        nextCommand: 'node bin/cli.js workflow resume --confirm-submit --json',
        userMessage: '选品和铺货清单已准备好。请人工确认商品和店铺后，才允许继续提交。'
      });
    }
  };
}

module.exports = {
  createWorkflowRunner
};
