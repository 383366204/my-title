'use strict';

/**
 * @file review-service.js
 * @description 业务复核服务 (ReviewService)
 * 统一管理灵感词根、关键词筛选、选品决策等中间状态复核草稿 (ReviewDraft)，
 * 支持基于 version 的乐观并发控制、Agent 提草案与用户人工终审分离。
 * 符合 ADR v1.0 (D8)
 */

const fs = require('fs');
const path = require('path');
const {
  resolveDataDir,
  writeJsonAtomic,
  assertRuntimeRunId
} = require('../../skills/pipeline-flow/runtime/store');

class ReviewConflictError extends Error {
  constructor(message, code = 'REVIEW_VERSION_CONFLICT') {
    super(message);
    this.name = 'ReviewConflictError';
    this.code = code;
    this.status = 409;
  }
}

class ReviewForbiddenError extends Error {
  constructor(message, code = 'REVIEW_CONFIRM_FORBIDDEN') {
    super(message);
    this.name = 'ReviewForbiddenError';
    this.code = code;
    this.status = 403;
  }
}

function getReviewDraftsPath(dataDir, runId) {
  assertRuntimeRunId(runId);
  return path.join(resolveDataDir(dataDir), 'runs', runId, 'review-drafts');
}

function getReviewDraftPath(dataDir, runId, stepId) {
  const safeStepId = String(stepId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getReviewDraftsPath(dataDir, runId), `${safeStepId}.json`);
}

function readJsonFile(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (_) {
    return fallback;
  }
}

/**
 * 读取指定步骤的复核草稿
 * @param {object} options
 * @param {string} [options.dataDir]
 * @param {string} options.runId
 * @param {string} options.stepId
 * @returns {object|null}
 */
function getReviewDraft({ dataDir, runId, stepId }) {
  const filePath = getReviewDraftPath(dataDir, runId, stepId);
  return readJsonFile(filePath, null);
}

/**
 * 保存复核草稿（支持 Agent 提建议草稿 updatedBy='agent_draft' 或人工保存 updatedBy='user'）
 * 严格校验 expectedVersion 乐观锁；若该步骤已被人工确认，禁止 Agent 草案覆盖。
 * @param {object} options
 * @param {string} [options.dataDir]
 * @param {string} options.runId
 * @param {string} options.stepId
 * @param {object} options.decisions 决策映射或修改载荷
 * @param {number} [options.expectedVersion] 预期版本号
 * @param {'user'|'agent_draft'} [options.updatedBy='user'] 更新人类型
 * @returns {object} 更新后的 ReviewDraft
 */
function saveReviewDraft({
  dataDir,
  runId,
  stepId,
  decisions = {},
  expectedVersion,
  updatedBy = 'user'
}) {
  const current = getReviewDraft({ dataDir, runId, stepId });
  const currentVersion = current ? Number(current.version || 0) : 0;

  if (expectedVersion !== undefined && Number(expectedVersion) !== currentVersion) {
    throw new ReviewConflictError(
      `复核草稿版本冲突：当前版本为 ${currentVersion}，传入预期版本为 ${expectedVersion}，请刷新后再提交`,
      'REVIEW_VERSION_CONFLICT'
    );
  }

  if (current && current.status === 'confirmed' && updatedBy === 'agent_draft') {
    throw new ReviewConflictError(
      `步骤 [${stepId}] 已经由人工最终确认，Agent 无法覆盖已确认的决策结果`,
      'REVIEW_ALREADY_CONFIRMED'
    );
  }

  const nextVersion = currentVersion + 1;
  const draftRecord = {
    runId,
    stepId,
    version: nextVersion,
    status: current?.status === 'confirmed' && updatedBy === 'user' ? 'confirmed' : 'draft',
    decisions: decisions || current?.decisions || {},
    updatedBy,
    updatedAt: new Date().toISOString(),
    confirmedBy: current?.status === 'confirmed' && updatedBy === 'user' ? current.confirmedBy : null,
    confirmedAt: current?.status === 'confirmed' && updatedBy === 'user' ? current.confirmedAt : null
  };

  const filePath = getReviewDraftPath(dataDir, runId, stepId);
  writeJsonAtomic(filePath, draftRecord);
  return draftRecord;
}

/**
 * 确认复核草稿（仅允许人工终审，状态转为 confirmed）
 * @param {object} options
 * @param {string} [options.dataDir]
 * @param {string} options.runId
 * @param {string} options.stepId
 * @param {object} [options.decisions] 最终确认的决策
 * @param {number} [options.expectedVersion] 预期版本号
 * @param {string} [options.confirmedBy='user'] 确认人（严禁 agent/agent_draft）
 * @returns {object} 确认后的 ReviewDraft
 */
function confirmReviewDraft({
  dataDir,
  runId,
  stepId,
  decisions,
  expectedVersion,
  confirmedBy = 'user'
}) {
  if (
    !confirmedBy ||
    confirmedBy === 'agent' ||
    confirmedBy === 'agent_draft' ||
    String(confirmedBy).startsWith('agent:')
  ) {
    throw new ReviewForbiddenError(
      '复核确认必须由可信人工用户完成，严禁自动化 Agent 自行批准',
      'REVIEW_CONFIRM_FORBIDDEN'
    );
  }

  const current = getReviewDraft({ dataDir, runId, stepId });
  const currentVersion = current ? Number(current.version || 0) : 0;

  if (expectedVersion !== undefined && Number(expectedVersion) !== currentVersion) {
    throw new ReviewConflictError(
      `复核确认版本冲突：当前版本为 ${currentVersion}，传入预期版本为 ${expectedVersion}，请刷新后再确认`,
      'REVIEW_VERSION_CONFLICT'
    );
  }

  const nextVersion = currentVersion + 1;
  const confirmedRecord = {
    runId,
    stepId,
    version: nextVersion,
    status: 'confirmed',
    decisions: decisions !== undefined ? decisions : (current?.decisions || {}),
    updatedBy: 'user',
    updatedAt: new Date().toISOString(),
    confirmedBy,
    confirmedAt: new Date().toISOString()
  };

  const filePath = getReviewDraftPath(dataDir, runId, stepId);
  writeJsonAtomic(filePath, confirmedRecord);
  return confirmedRecord;
}

/**
 * 检查指定步骤复核是否已人工确认
 * @param {object} options
 * @param {string} [options.dataDir]
 * @param {string} options.runId
 * @param {string} options.stepId
 * @returns {boolean}
 */
function isReviewConfirmed({ dataDir, runId, stepId }) {
  const current = getReviewDraft({ dataDir, runId, stepId });
  return Boolean(current && current.status === 'confirmed');
}

/**
 * 重置复核草稿为 pending 状态（例如重新执行步骤或手动重开时使用）
 * @param {object} options
 * @param {string} [options.dataDir]
 * @param {string} options.runId
 * @param {string} options.stepId
 * @param {number} [options.expectedVersion]
 * @param {string} [options.resetBy='user']
 * @returns {object}
 */
function resetReviewDraft({ dataDir, runId, stepId, expectedVersion, resetBy = 'user' }) {
  const current = getReviewDraft({ dataDir, runId, stepId });
  const currentVersion = current ? Number(current.version || 0) : 0;

  if (expectedVersion !== undefined && Number(expectedVersion) !== currentVersion) {
    throw new ReviewConflictError(
      `重置复核版本冲突：当前版本为 ${currentVersion}，传入预期版本为 ${expectedVersion}`,
      'REVIEW_VERSION_CONFLICT'
    );
  }

  const nextVersion = currentVersion + 1;
  const resetRecord = {
    runId,
    stepId,
    version: nextVersion,
    status: 'pending',
    decisions: {},
    updatedBy: resetBy,
    updatedAt: new Date().toISOString(),
    confirmedBy: null,
    confirmedAt: null
  };

  const filePath = getReviewDraftPath(dataDir, runId, stepId);
  writeJsonAtomic(filePath, resetRecord);
  return resetRecord;
}

/**
 * 列出当前 Run 下所有复核草稿
 * @param {object} options
 * @param {string} [options.dataDir]
 * @param {string} options.runId
 * @returns {Array<object>}
 */
function listReviewDrafts({ dataDir, runId }) {
  const dir = getReviewDraftsPath(dataDir, runId);
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter(file => file.endsWith('.json'))
      .map(file => readJsonFile(path.join(dir, file), null))
      .filter(Boolean)
      .sort((a, b) => String(a.stepId || '').localeCompare(String(b.stepId || '')));
  } catch (_) {
    return [];
  }
}

module.exports = {
  ReviewConflictError,
  ReviewForbiddenError,
  getReviewDraft,
  saveReviewDraft,
  confirmReviewDraft,
  isReviewConfirmed,
  resetReviewDraft,
  listReviewDrafts
};
