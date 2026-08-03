'use strict';

const fs = require('fs');
const { exactKeywordCandidate } = require('./candidate-helpers');
const { DEFAULT_PRODUCTS_PER_KEYWORD } = require('./flow-constants');
const { buildFlowCommand, flowResponse } = require('./flow-context');
const { flowExport } = require('./export-flow');
const { flowMine } = require('./keyword-mining-flow');
const { flowReviewCandidates } = require('./keyword-review-flow');
const { flowVerify } = require('./keyword-verification-flow');
const { flowSelectProducts } = require('./product-selection-flow');
const { appendJsonl, getRun, initRun, writeRun } = require('./run-store');
const { flowGenerate } = require('./title-generation-flow');

/**
 * Prepare a run for one exact keyword without mining or rewriting.
 * @param {object} [options] Flow options.
 * @returns {Promise<object>} Prepared run result.
 */
async function flowKeywordStart(options = {}) {
  const keyword = String(options.keyword || '').trim();
  if (!keyword) throw new Error('keyword is required');
  const { runDir, run } = initRun({
    ...options,
    options: {
      ...(options.options || {}),
      exactKeyword: keyword,
      mode: 'keyword'
    }
  });
  const candidate = exactKeywordCandidate(keyword);
  fs.writeFileSync(run.files.candidates, '', 'utf8');
  appendJsonl(run.files.candidates, [candidate]);
  run.status = 'mined';
  run.counts.candidates = 1;
  writeRun(runDir, run);
  return flowResponse({
    ok: true,
    runId: run.runId,
    runDir,
    exactKeyword: keyword,
    status: run.status,
    candidates: [candidate],
    blockers: [],
    allowedCommands: [buildFlowCommand('verify', run.runId, { limit: 1 })],
    nextCommand: buildFlowCommand('verify', run.runId, { limit: 1 })
  });
}

/**
 * Run the flow for one user-provided keyword without mining or rewriting.
 * @param {object} [options] Flow options.
 * @returns {Promise<object>} Exact keyword flow result.
 */
async function flowKeyword(options = {}) {
  const keyword = String(options.keyword || '').trim();
  if (!keyword) throw new Error('keyword is required');
  const prepared = await flowKeywordStart(options);
  const runDir = prepared.runDir;
  const runId = prepared.runId;

  const verify = await flowVerify({ ...options, runId, limit: 1 });
  if (verify.verified.length === 0 || verify.blockers.includes('sycm_manual_action_required')) {
    const latest = getRun({ dataDir: options.dataDir, runId });
    return flowResponse({
      ok: true,
      runId,
      runDir,
      exactKeyword: keyword,
      counts: latest.run.counts,
      status: latest.run.status,
      files: latest.run.files,
      blockers: verify.blockers.length ? verify.blockers : ['no_verified_keywords'],
      allowedCommands: [verify.nextCommand],
      nextCommand: verify.nextCommand,
      steps: {
        mined: 1,
        verified: 0,
        rejected: verify.rejected.length,
        generated: 0,
        exported: 0
      }
    });
  }

  const select = await flowSelectProducts({
    ...options,
    runId,
    limit: 1,
    productsPerKeyword: options.productsPerKeyword || DEFAULT_PRODUCTS_PER_KEYWORD
  });
  const selectedCount = select.selected.filter(row => row.status === 'selected').length;
  if (selectedCount === 0) {
    const latest = getRun({ dataDir: options.dataDir, runId });
    return flowResponse({
      ok: true,
      runId,
      runDir,
      exactKeyword: keyword,
      counts: latest.run.counts,
      status: latest.run.status,
      files: latest.run.files,
      blockers: ['no_selected_products'],
      allowedCommands: [select.nextCommand],
      nextCommand: select.nextCommand,
      steps: {
        mined: 1,
        verified: verify.verified.length,
        selected: 0,
        rejected: verify.rejected.length,
        generated: 0,
        exported: 0
      }
    });
  }

  const generate = await flowGenerate({
    ...options,
    runId,
    limit: 1,
    productsPerKeyword: options.productsPerKeyword || DEFAULT_PRODUCTS_PER_KEYWORD
  });
  const generatedCount = generate.generated.filter(row => row.status === 'generated').length;
  if (generatedCount === 0) {
    const latest = getRun({ dataDir: options.dataDir, runId });
    return flowResponse({
      ok: true,
      runId,
      runDir,
      exactKeyword: keyword,
      counts: latest.run.counts,
      status: latest.run.status,
      files: latest.run.files,
      blockers: ['no_generated_products'],
      allowedCommands: [generate.nextCommand],
      nextCommand: generate.nextCommand,
      steps: {
        mined: 1,
        verified: verify.verified.length,
        selected: selectedCount,
        rejected: verify.rejected.length,
        generated: 0,
        exported: 0
      }
    });
  }

  const exported = await flowExport({ ...options, runId, limit: options.export || 20 });
  const latest = getRun({ dataDir: options.dataDir, runId });
  return flowResponse({
    ok: true,
    runId,
    runDir,
    exactKeyword: keyword,
    counts: latest.run.counts,
    status: latest.run.status,
    files: latest.run.files,
    canSubmit: exported.canSubmit,
    mustReview: exported.mustReview,
    blockers: exported.blockers,
    allowedCommands: exported.allowedCommands,
    nextCommand: exported.nextCommand,
    steps: {
      mined: 1,
      verified: verify.verified.length,
      selected: selectedCount,
      rejected: verify.rejected.length,
      generated: generatedCount,
      exported: exported.count
    }
  });
}

/**
 * Run the daily flow through review, verification, selection, generation and export.
 * @param {object} [options] Flow options.
 * @returns {Promise<object>} Daily flow result.
 */
async function flowDaily(options = {}) {
  const mine = await flowMine({
    ...options,
    limit: options.mine || options.limit || 50,
    excludeSeen: options.excludeSeen !== false,
    recordSeen: options.recordSeen !== false,
    recordSeedFeedback: options.recordSeedFeedback !== false,
    autoReplenishSeeds: options.autoReplenishSeeds !== false
  });
  if (['mining_manual_action_required', 'mining_empty'].includes(mine.status)) {
    const { run } = getRun({ dataDir: options.dataDir, runId: mine.runId });
    return flowResponse({
      ok: false,
      runId: mine.runId,
      runDir: mine.runDir,
      counts: run.counts,
      status: run.status,
      files: run.files,
      blockers: mine.blockers,
      allowedCommands: mine.allowedCommands,
      nextCommand: mine.nextCommand,
      steps: { mined: 0, reviewed: 0, verified: 0, rejected: 0, selected: 0, generated: 0, exported: 0 }
    });
  }
  const keywordReview = flowReviewCandidates({
    ...options,
    runId: mine.runId,
    approveAll: options.reviewMode === 'auto' || options.approveAll === true
  });
  if (keywordReview.status === 'awaiting_keyword_review' || keywordReview.status === 'keyword_review_empty') {
    const { run } = getRun({ dataDir: options.dataDir, runId: mine.runId });
    return flowResponse({
      ok: true,
      runId: mine.runId,
      runDir: mine.runDir,
      counts: run.counts,
      status: run.status,
      files: run.files,
      blockers: keywordReview.blockers,
      allowedCommands: keywordReview.allowedCommands,
      nextCommand: keywordReview.nextCommand,
      steps: {
        mined: mine.candidates.length,
        reviewed: keywordReview.approved ? keywordReview.approved.length : 0,
        verified: 0,
        rejected: 0,
        selected: 0,
        generated: 0,
        exported: 0
      }
    });
  }
  const verify = await flowVerify({ ...options, runId: mine.runId, limit: options.verify || 20 });
  if (verify.verified.length === 0 || verify.blockers.includes('sycm_manual_action_required')) {
    const { run } = getRun({ dataDir: options.dataDir, runId: mine.runId });
    return flowResponse({
      ok: true,
      runId: mine.runId,
      runDir: mine.runDir,
      counts: run.counts,
      status: run.status,
      files: run.files,
      blockers: verify.blockers.length ? verify.blockers : ['no_verified_keywords'],
      allowedCommands: [verify.nextCommand],
      nextCommand: verify.nextCommand,
      steps: {
        mined: mine.candidates.length,
        reviewed: keywordReview.approved.length,
        verified: 0,
        rejected: verify.rejected.length,
        selected: 0,
        generated: 0,
        exported: 0
      }
    });
  }

  const select = await flowSelectProducts({
    ...options,
    runId: mine.runId,
    limit: options.select || options.generate || 10,
    productsPerKeyword: options.productsPerKeyword || DEFAULT_PRODUCTS_PER_KEYWORD
  });
  const selectedCount = select.selected.filter(row => row.status === 'selected').length;
  if (selectedCount === 0) {
    const { run } = getRun({ dataDir: options.dataDir, runId: mine.runId });
    return flowResponse({
      ok: true,
      runId: mine.runId,
      runDir: mine.runDir,
      counts: run.counts,
      status: run.status,
      files: run.files,
      blockers: ['no_selected_products'],
      allowedCommands: [select.nextCommand],
      nextCommand: select.nextCommand,
      steps: {
        mined: mine.candidates.length,
        reviewed: keywordReview.approved.length,
        verified: verify.verified.length,
        selected: 0,
        rejected: verify.rejected.length,
        generated: 0,
        exported: 0
      }
    });
  }

  const generate = await flowGenerate({ ...options, runId: mine.runId, limit: options.generate || 10 });
  const generatedCount = generate.generated.filter(row => row.status === 'generated').length;
  if (generatedCount === 0) {
    const { run } = getRun({ dataDir: options.dataDir, runId: mine.runId });
    return flowResponse({
      ok: true,
      runId: mine.runId,
      runDir: mine.runDir,
      counts: run.counts,
      status: run.status,
      files: run.files,
      blockers: ['no_generated_products'],
      allowedCommands: [generate.nextCommand],
      nextCommand: generate.nextCommand,
      steps: {
        mined: mine.candidates.length,
        reviewed: keywordReview.approved.length,
        verified: verify.verified.length,
        selected: selectedCount,
        rejected: verify.rejected.length,
        generated: 0,
        exported: 0
      }
    });
  }

  const exported = await flowExport({ ...options, runId: mine.runId, limit: options.export || 20 });
  const { run } = getRun({ dataDir: options.dataDir, runId: mine.runId });
  return flowResponse({
    ok: true,
    runId: mine.runId,
    runDir: mine.runDir,
    counts: run.counts,
    status: run.status,
    files: run.files,
    canSubmit: exported.canSubmit,
    mustReview: exported.mustReview,
    blockers: exported.blockers,
    allowedCommands: exported.allowedCommands,
    nextCommand: exported.nextCommand,
    steps: {
      mined: mine.candidates.length,
      reviewed: keywordReview.approved.length,
      verified: verify.verified.length,
      selected: selectedCount,
      rejected: verify.rejected.length,
      generated: generatedCount,
      exported: exported.count
    }
  });
}

module.exports = {
  flowDaily,
  flowKeyword,
  flowKeywordStart
};
