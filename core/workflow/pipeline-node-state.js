'use strict';

const readRuntimeState = require('../../skills/pipeline-flow/runtime/store').readRuntimeState;
const { WORKFLOW_NODE_IDS, NODE_ORDER } = require('./pipeline-definition-common');
const { outputForNode } = require('./pipeline-node-output');
const { summaryInterventionForNode } = require('./pipeline-node-diagnostics');

function nodeState(id, type, status, output = null, summary = {}) {
  const timestamp = summary.updatedAt || summary.startedAt || null;
  const runNodeState = summary.runtime?.nodeStates?.[id] || {};
  return {
    id,
    type,
    status,
    input: null,
    output: output || runNodeState.output || null,
    error: runNodeState.error || null,
    startedAt: status === 'idle' ? null : (runNodeState.startedAt || summary.startedAt || timestamp),
    completedAt: status === 'completed' || status === 'failed' ? (runNodeState.completedAt || timestamp) : null,
    progress: runNodeState.progress && typeof runNodeState.progress === 'object'
      ? runNodeState.progress
      : normalizeNodeProgress({
          status,
          percent: status === 'completed' ? 100 : 0,
          message: status === 'completed' ? '执行完成' : ''
        }),
    blocker: runNodeState.blocker || null,
    actionHint: runNodeState.actionHint || null,
    platform: runNodeState.platform || null,
    platformStatus: runNodeState.platformStatus || null,
    manualAction: runNodeState.manualAction || null,
    durationMs: runNodeState.durationMs || null,
    outputSummary: runNodeState.outputSummary || null
  };
}

/**
 * @param {object} summary 业务运行摘要。
 * @param {string} dataDir 运行数据目录。
 * @returns {object|null} 已持久化的运行时状态。
 */
function readRuntimeForSummary(summary, dataDir) {
  if (!summary || !summary.runId) return null;
  try {
    return readRuntimeState({ dataDir, runId: summary.runId });
  } catch (_error) {
    return null;
  }
}

function normalizeNodeProgress(progress = {}) {
  return {
    status: progress.status || 'running',
    current: Number.isFinite(Number(progress.current)) ? Number(progress.current) : 0,
    total: Number.isFinite(Number(progress.total)) ? Number(progress.total) : 0,
    percent: Number.isFinite(Number(progress.percent)) ? Number(progress.percent) : 0,
    message: progress.message || ''
  };
}

function nodeStatusFromRuntimeProgress(progress) {
  const status = progress && progress.status ? String(progress.status) : '';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'failed') return 'failed';
  if (status === 'blocked') return 'blocked';
  if (status === 'waiting_manual') return 'waiting_manual';
  if (status === 'retryable') return 'retryable';
  if (status === 'paused') return 'paused';
  if (status === 'resuming' || status === 'retrying') return 'running';
  if (status === 'needs_review') return 'needs_review';
  if (status === 'waiting_confirmation') return 'waiting_confirmation';
  if (status === 'awaiting_product_review') return 'waiting_confirmation';
  if (status === 'completed') return 'completed';
  if (status === 'running') return 'running';
  return '';
}

function completeBefore(states, nodeId) {
  const stopIndex = NODE_ORDER.indexOf(nodeId);
  NODE_ORDER.forEach((id, index) => {
    if (index < stopIndex) states[id] = 'completed';
  });
}

function completeThrough(states, nodeId) {
  const stopIndex = NODE_ORDER.indexOf(nodeId);
  NODE_ORDER.forEach((id, index) => {
    if (index <= stopIndex) states[id] = 'completed';
  });
}

function statusPlanForSummary(summary) {
  const status = summary.status || 'unknown';
  const states = NODE_ORDER.reduce((memo, nodeId) => {
    memo[nodeId] = 'idle';
    return memo;
  }, {});
  const mode = summary.runtime?.mode || summary.options?.mode || '';
  if (mode === 'competitor-analysis') {
    states[WORKFLOW_NODE_IDS.start] = 'completed';
    const steps = [
      WORKFLOW_NODE_IDS.resolveShops,
      WORKFLOW_NODE_IDS.collectCompetitors,
      WORKFLOW_NODE_IDS.enrichCompetitors,
      WORKFLOW_NODE_IDS.analyzeCompetitors,
      WORKFLOW_NODE_IDS.competitorReport
    ];
    const activeStep = summary.runtime?.activeStep;
    for (const step of steps) {
      const progressStatus = nodeStatusFromRuntimeProgress(summary.runtime?.progress?.[step]);
      if (progressStatus) states[step] = progressStatus;
    }
    if (summary.status === 'workflow_complete') {
      for (const step of steps) states[step] = 'completed';
      states[WORKFLOW_NODE_IDS.end] = 'completed';
    } else if (activeStep && states[activeStep] === 'idle') {
      states[activeStep] = summary.runtime?.status === 'failed' ? 'failed' : summary.runtime?.status === 'blocked' ? 'blocked' : 'running';
    }
    return states;
  }
  if (mode === 'order-sheet') {
    states[WORKFLOW_NODE_IDS.start] = 'completed';
    if (status === 'workflow_complete') {
      states[WORKFLOW_NODE_IDS.collectRank] = 'completed';
      states[WORKFLOW_NODE_IDS.confirmProducts] = 'completed';
      states[WORKFLOW_NODE_IDS.generateSheet] = 'completed';
      states[WORKFLOW_NODE_IDS.end] = 'completed';
    } else if (status === 'products_confirmed') {
      states[WORKFLOW_NODE_IDS.collectRank] = 'completed';
      states[WORKFLOW_NODE_IDS.confirmProducts] = 'completed';
      states[WORKFLOW_NODE_IDS.generateSheet] = 'running';
    } else if (status === 'needs_review' || status === 'awaiting_product_confirmation') {
      states[WORKFLOW_NODE_IDS.collectRank] = 'completed';
      states[WORKFLOW_NODE_IDS.confirmProducts] = 'needs_review';
    } else if (status === 'product_rank_collected') {
      states[WORKFLOW_NODE_IDS.collectRank] = 'completed';
      states[WORKFLOW_NODE_IDS.confirmProducts] = 'running';
    } else if (status === 'manual_action_required') {
      states[WORKFLOW_NODE_IDS.collectRank] = 'blocked';
    } else {
      states[WORKFLOW_NODE_IDS.collectRank] = 'running';
    }
    return states;
  }
  if (mode === 'review-sheet') {
    states[WORKFLOW_NODE_IDS.start] = 'completed';
    if (status === 'workflow_complete') {
      states[WORKFLOW_NODE_IDS.importSheet] = 'completed';
      states[WORKFLOW_NODE_IDS.generateReviews] = 'completed';
      states[WORKFLOW_NODE_IDS.generateSheet] = 'completed';
      states[WORKFLOW_NODE_IDS.end] = 'completed';
    } else if (status === 'review_approved') {
      states[WORKFLOW_NODE_IDS.importSheet] = 'completed';
      states[WORKFLOW_NODE_IDS.generateReviews] = 'completed';
      states[WORKFLOW_NODE_IDS.generateSheet] = 'running';
    } else if (status === 'needs_review') {
      states[WORKFLOW_NODE_IDS.importSheet] = 'completed';
      states[WORKFLOW_NODE_IDS.generateReviews] = 'needs_review';
    } else if (status === 'review_source_imported') {
      states[WORKFLOW_NODE_IDS.importSheet] = 'completed';
      states[WORKFLOW_NODE_IDS.generateReviews] = 'running';
    } else {
      states[WORKFLOW_NODE_IDS.importSheet] = 'running';
    }
    return states;
  }
  if (mode === 'manual' && Number(summary.options?.workflowVersion || 1) >= 3) {
    states[WORKFLOW_NODE_IDS.start] = 'completed';
    if (status === 'workflow_complete') {
      for (const nodeId of [WORKFLOW_NODE_IDS.select, WORKFLOW_NODE_IDS.verify, WORKFLOW_NODE_IDS.generate, WORKFLOW_NODE_IDS.export, WORKFLOW_NODE_IDS.end]) {
        states[nodeId] = 'completed';
      }
    } else if (['manual_action_required', 'verified_partial_manual_required', 'verified_empty', 'verified_no_generation_eligible'].includes(status)) {
      states[WORKFLOW_NODE_IDS.select] = 'completed';
      states[WORKFLOW_NODE_IDS.verify] = 'blocked';
    } else if (status === 'select_failed') {
      states[WORKFLOW_NODE_IDS.select] = 'failed';
    } else if (status === 'products_selected') {
      states[WORKFLOW_NODE_IDS.select] = 'completed';
      states[WORKFLOW_NODE_IDS.verify] = 'running';
    } else if (status === 'verified') {
      states[WORKFLOW_NODE_IDS.select] = 'completed';
      states[WORKFLOW_NODE_IDS.verify] = 'completed';
      states[WORKFLOW_NODE_IDS.generate] = 'running';
    } else if (status === 'generate_failed') {
      states[WORKFLOW_NODE_IDS.select] = 'completed';
      states[WORKFLOW_NODE_IDS.verify] = 'completed';
      states[WORKFLOW_NODE_IDS.generate] = 'failed';
    } else if (status === 'generated') {
      states[WORKFLOW_NODE_IDS.select] = 'completed';
      states[WORKFLOW_NODE_IDS.verify] = 'completed';
      states[WORKFLOW_NODE_IDS.generate] = 'completed';
      states[WORKFLOW_NODE_IDS.export] = 'running';
    } else if (status === 'needs_review') {
      states[WORKFLOW_NODE_IDS.select] = 'completed';
      states[WORKFLOW_NODE_IDS.verify] = 'completed';
      states[WORKFLOW_NODE_IDS.generate] = 'completed';
      states[WORKFLOW_NODE_IDS.export] = 'needs_review';
    } else if (['ready_to_distribute', 'awaiting_user_confirmation'].includes(status)) {
      states[WORKFLOW_NODE_IDS.select] = 'completed';
      states[WORKFLOW_NODE_IDS.verify] = 'completed';
      states[WORKFLOW_NODE_IDS.generate] = 'completed';
      states[WORKFLOW_NODE_IDS.export] = 'waiting_confirmation';
    } else if (status === 'export_empty') {
      states[WORKFLOW_NODE_IDS.select] = 'completed';
      states[WORKFLOW_NODE_IDS.verify] = 'completed';
      states[WORKFLOW_NODE_IDS.generate] = 'completed';
      states[WORKFLOW_NODE_IDS.export] = 'failed';
    } else if (status === 'manual_products_received') {
      states[WORKFLOW_NODE_IDS.select] = 'running';
    } else {
      states[WORKFLOW_NODE_IDS.select] = 'running';
    }
    return states;
  }

  if (status === 'workflow_complete') {
    completeThrough(states, WORKFLOW_NODE_IDS.end);
    return states;
  }

  if (status === 'mining_manual_action_required' || status === 'mining_empty') {
    completeBefore(states, WORKFLOW_NODE_IDS.mine);
    states[WORKFLOW_NODE_IDS.mine] = 'blocked';
    return states;
  }

  if (status === 'manual_action_required' || status === 'verified_partial_manual_required' || status === 'verified_empty' || status === 'verified_no_generation_eligible') {
    completeBefore(states, WORKFLOW_NODE_IDS.verify);
    states[WORKFLOW_NODE_IDS.verify] = 'blocked';
    return states;
  }

  if (status === 'generate_failed') {
    completeBefore(states, WORKFLOW_NODE_IDS.generate);
    states[WORKFLOW_NODE_IDS.generate] = 'failed';
    return states;
  }

  if (status === 'select_failed') {
    completeBefore(states, WORKFLOW_NODE_IDS.select);
    states[WORKFLOW_NODE_IDS.select] = 'failed';
    return states;
  }

  if (status === 'needs_review') {
    completeBefore(states, WORKFLOW_NODE_IDS.export);
    states[WORKFLOW_NODE_IDS.export] = 'needs_review';
    return states;
  }

  if (status === 'ready_to_distribute' || status === 'awaiting_user_confirmation') {
    completeBefore(states, WORKFLOW_NODE_IDS.export);
    states[WORKFLOW_NODE_IDS.export] = 'waiting_confirmation';
    return states;
  }

  if (status === 'created') {
    completeThrough(states, WORKFLOW_NODE_IDS.start);
    states[WORKFLOW_NODE_IDS.mine] = 'running';
    return states;
  }

  if (status === 'mined') {
    completeThrough(states, WORKFLOW_NODE_IDS.mine);
    states[WORKFLOW_NODE_IDS.keywordReview] = 'running';
    return states;
  }

  if (status === 'awaiting_keyword_review' || status === 'keyword_review_empty') {
    completeThrough(states, WORKFLOW_NODE_IDS.mine);
    states[WORKFLOW_NODE_IDS.keywordReview] = 'blocked';
    return states;
  }

  if (status === 'keywords_reviewed') {
    completeThrough(states, WORKFLOW_NODE_IDS.keywordReview);
    states[WORKFLOW_NODE_IDS.verify] = 'running';
    return states;
  }

  if (status === 'verified') {
    completeThrough(states, WORKFLOW_NODE_IDS.verify);
    states[WORKFLOW_NODE_IDS.select] = 'running';
    return states;
  }

  if (status === 'products_selected') {
    completeThrough(states, WORKFLOW_NODE_IDS.select);
    states[WORKFLOW_NODE_IDS.generate] = 'running';
    return states;
  }

  if (status === 'manual_products_received') {
    completeThrough(states, WORKFLOW_NODE_IDS.start);
    states[WORKFLOW_NODE_IDS.select] = 'running';
    return states;
  }

  if (status === 'generated') {
    completeThrough(states, WORKFLOW_NODE_IDS.generate);
    states[WORKFLOW_NODE_IDS.export] = 'running';
    return states;
  }

  if (status === 'export_empty') {
    completeBefore(states, WORKFLOW_NODE_IDS.export);
    states[WORKFLOW_NODE_IDS.export] = 'failed';
    return states;
  }

  // 未知状态只展示已创建 run，避免误把后续生产步骤标为完成。
  completeThrough(states, WORKFLOW_NODE_IDS.start);
  states[WORKFLOW_NODE_IDS.mine] = 'running';
  return states;
}

/**
 * @param {object} summary 含可选 runtime 的运行摘要。
 * @returns {object} 按节点 ID 索引的画布状态。
 */
function buildNodeStates(summary) {
  const plannedStates = statusPlanForSummary(summary);
  const runtime = summary.runtime || null;
  const runtimeProgress = runtime && runtime.progress && typeof runtime.progress === 'object' ? runtime.progress : {};
  const states = NODE_ORDER.reduce((memo, nodeId, index) => {
    const nodeStatus = plannedStates[nodeId] || 'idle';
    const intervention = summaryInterventionForNode(summary, nodeId);
    const initialState = nodeState(nodeId, `pipeline-${nodeId}`, nodeStatus, nodeStatus === 'idle' ? null : outputForNode(nodeId, summary), summary);
    memo[nodeId] = {
      ...initialState,
      blocker: intervention?.blocker || initialState.blocker || null,
      actionHint: intervention?.actionHint || initialState.actionHint || null,
      nextRecommendedAction: intervention?.nextRecommendedAction || initialState.nextRecommendedAction || null,
      platform: intervention?.platform || initialState.platform || null,
      platformStatus: intervention?.platformStatus || initialState.platformStatus || null,
      manualAction: intervention?.manualAction || initialState.manualAction || null
    };
    return memo;
  }, {});
  Object.entries(runtimeProgress).forEach(([nodeId, progress]) => {
    const manualMode = summary.options?.mode === 'manual';
    const legacyManualMode = manualMode && Number(summary.options?.workflowVersion || 1) < 2;
    const effectiveNodeId = nodeId === WORKFLOW_NODE_IDS.review
      ? WORKFLOW_NODE_IDS.export
      : legacyManualMode && nodeId === WORKFLOW_NODE_IDS.select
        ? WORKFLOW_NODE_IDS.keywordReview
        : nodeId;
    if (!states[effectiveNodeId]) return;
    const progressDetails = progress && typeof progress === 'object' ? progress : {};
    const normalizedProgress = normalizeNodeProgress(progressDetails);
    const runtimeStatus = nodeStatusFromRuntimeProgress(normalizedProgress);
    states[effectiveNodeId] = {
      ...states[effectiveNodeId],
      status: runtimeStatus || states[effectiveNodeId].status,
      output: states[effectiveNodeId].output || outputForNode(effectiveNodeId, summary),
      progress: normalizedProgress,
      blocker: progressDetails.blocker || states[effectiveNodeId].blocker || null,
      actionHint: progressDetails.actionHint || states[effectiveNodeId].actionHint || null,
      nextRecommendedAction: progressDetails.nextRecommendedAction || states[effectiveNodeId].nextRecommendedAction || null,
      platform: progressDetails.platform || states[effectiveNodeId].platform || null,
      platformStatus: progressDetails.platformStatus || states[effectiveNodeId].platformStatus || null,
      manualAction: progressDetails.manualAction || states[effectiveNodeId].manualAction || null,
      durationMs: progressDetails.durationMs || states[effectiveNodeId].durationMs || null,
      outputSummary: progressDetails.outputSummary || states[effectiveNodeId].outputSummary || null
    };
  });
  const legacyManualMode = summary.options?.mode === 'manual' && Number(summary.options?.workflowVersion || 1) < 2;
  const activeStep = runtime?.activeStep === WORKFLOW_NODE_IDS.review
    ? WORKFLOW_NODE_IDS.export
    : legacyManualMode && runtime?.activeStep === WORKFLOW_NODE_IDS.select
      ? WORKFLOW_NODE_IDS.keywordReview
      : runtime?.activeStep;
  if (runtime && activeStep && states[activeStep]) {
    const runtimeStatus = nodeStatusFromRuntimeProgress({ status: runtime.status }) || 'running';
    const runtimeFailed = runtimeStatus === 'failed';
    const currentState = states[activeStep];
    const activeProgress = currentState.progress || {};
    states[activeStep] = {
      ...currentState,
      status: runtimeStatus,
      output: currentState.output || outputForNode(activeStep, summary),
      progress: normalizeNodeProgress({
        ...activeProgress,
        status: runtimeStatus,
        message: activeProgress.message || (runtimeStatus === 'paused' ? '已暂停' : '')
      }),
      error: runtime.error || currentState.error || null,
      blocker: runtime.blocker || currentState.blocker || null,
      actionHint: runtimeFailed
        ? currentState.actionHint || runtime.error || '当前节点执行失败，请查看节点结果和运行日志后重试。'
        : runtime.actionHint || currentState.actionHint || null,
      nextRecommendedAction: runtimeFailed
        ? currentState.nextRecommendedAction || { action: 'retry-node', label: activeStep === WORKFLOW_NODE_IDS.collectRank ? '重试采集' : '重试节点', description: '保留当前运行参数并重新执行该节点。' }
        : runtime.nextRecommendedAction || currentState.nextRecommendedAction || null,
      platform: runtime.platform || currentState.platform || null,
      platformStatus: runtime.platformStatus || currentState.platformStatus || null,
      manualAction: runtime.manualAction || currentState.manualAction || null,
      durationMs: runtime.durationMs || currentState.durationMs || null,
      outputSummary: runtime.outputSummary || currentState.outputSummary || null
    };
  }
  if (summary.options?.mode === 'competitor-analysis') {
    const collectionState = states[WORKFLOW_NODE_IDS.collectCompetitors];
    if (collectionState?.status === 'blocked' && [
      'TAOBAO_NATIVE_ACCESS_RESTRICTED',
      'TAOBAO_NATIVE_NOT_READY'
    ].includes(collectionState.platformStatus) && collectionState.actionHint) {
      collectionState.progress = normalizeNodeProgress({
        ...(collectionState.progress || {}),
        status: 'blocked',
        message: collectionState.actionHint
      });
    }
  }
  return states;
}

module.exports = { readRuntimeForSummary, buildNodeStates };
