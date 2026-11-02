'use strict';

/**
 * @file execution-approval.js
 * @description 高危副作用执行授权服务 (ExecutionApproval)
 * 专门管理铺货发布等外部写操作的授权单据，基于输入摘要 inputDigest 与 Run revision 双重防篡改防脱节绑定。
 * 严禁模型通过任何工具自行审批，任何输入篡改或版本递增自动导致旧授权 expired。
 * 符合 ADR v1.0 (D8)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  resolveDataDir,
  writeJsonAtomic,
  assertRuntimeRunId,
  readRuntimeState
} = require('../../skills/pipeline-flow/runtime/store');
const { isAgentIdentity } = require('./human-context');

class ApprovalForbiddenError extends Error {
  constructor(message, code = 'APPROVAL_SELF_GRANT_FORBIDDEN') {
    super(message);
    this.name = 'ApprovalForbiddenError';
    this.code = code;
    this.status = 403;
  }
}

class ApprovalConflictError extends Error {
  constructor(message, code = 'APPROVAL_CONFLICT') {
    super(message);
    this.name = 'ApprovalConflictError';
    this.code = code;
    this.status = 409;
  }
}

/**
 * 递归键排序规范化序列化，确保即使对象字段顺序不同也产生完全一致的 JSON 字符串
 * @param {*} value
 * @returns {string}
 */
function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalStringify).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalStringify(value[k])).join(',') + '}';
}

/**
 * 计算输入载荷的确定性 SHA-256 摘要
 * @param {*} inputPayload
 * @returns {string} 64位十六进制哈希
 */
function computeInputDigest(inputPayload) {
  const canonical = canonicalStringify(inputPayload ?? {});
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function getApprovalsDir(dataDir, runId) {
  assertRuntimeRunId(runId);
  return path.join(resolveDataDir(dataDir), 'runs', runId, 'approvals');
}

function getApprovalPath(dataDir, runId, approvalId) {
  const safeId = String(approvalId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getApprovalsDir(dataDir, runId), `${safeId}.json`);
}

function getLatestApprovalPath(dataDir, runId, actionType = 'distribution.publish') {
  const safeAction = String(actionType).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getApprovalsDir(dataDir, runId), `latest-${safeAction}.json`);
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
 * 发起高危副作用执行授权申请（状态为 pending）
 * @param {object} options
 * @param {string} [options.dataDir]
 * @param {string} options.runId
 * @param {string} [options.actionType='distribution.publish'] 动作类型
 * @param {*} options.inputPayload 待授权的完整参数载荷（如商品列表、目标店铺、价格等）
 * @param {number} [options.runRevision] 当前工作流修订号
 * @param {string} [options.requestedBy='system'] 发起方
 * @returns {object} ExecutionApproval 实体
 */
function requestExecutionApproval({
  dataDir,
  runId,
  actionType = 'distribution.publish',
  inputPayload,
  runRevision,
  requestedBy = 'system'
}) {
  assertRuntimeRunId(runId);
  const runtime = readRuntimeState({ dataDir, runId, autoRecover: false });
  const revision = runRevision !== undefined ? Number(runRevision) : (Number(runtime?.revision) || 0);
  const inputDigest = computeInputDigest(inputPayload);
  const approvalId = `appr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  const approval = {
    id: approvalId,
    runId,
    actionType,
    inputDigest,
    runRevision: revision,
    status: 'pending',
    requestedBy,
    requestedAt: new Date().toISOString(),
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    consumedAt: null,
    expireReason: null
  };

  const dir = getApprovalsDir(dataDir, runId);
  fs.mkdirSync(dir, { recursive: true });
  writeJsonAtomic(getApprovalPath(dataDir, runId, approvalId), approval);
  writeJsonAtomic(getLatestApprovalPath(dataDir, runId, actionType), approval);
  return approval;
}

/**
 * 批准执行授权（严禁模型自批，必须由可信用户人工签署）
 * 批准时自动校验输入摘要与工作流版本号；如已发生上游修改，直接拒绝并标记失效。
 * @param {object} options
 * @param {string} [options.dataDir]
 * @param {string} options.runId
 * @param {string} [options.approvalId] 授权单 ID（缺省时自动查找 actionType 的最新单据）
 * @param {string} [options.actionType='distribution.publish']
 * @param {string} options.approvedBy 审批人（严禁 agent/agent_draft）
 * @param {string} [options.expectedInputDigest] 预期输入摘要
 * @returns {object} 批准后的 ExecutionApproval
 */
function grantExecutionApproval({
  dataDir,
  runId,
  approvalId,
  actionType = 'distribution.publish',
  approvedBy,
  expectedInputDigest
}) {
  if (!approvedBy || typeof approvedBy !== 'string' || isAgentIdentity(approvedBy)) {
    throw new ApprovalForbiddenError(
      '高危副作用执行授权必须由可信人工用户签署，严禁自动化 Agent 自行批准',
      'APPROVAL_SELF_GRANT_FORBIDDEN'
    );
  }

  const approvalPath = approvalId
    ? getApprovalPath(dataDir, runId, approvalId)
    : getLatestApprovalPath(dataDir, runId, actionType);

  const approval = readJsonFile(approvalPath, null);
  if (!approval) {
    throw new ApprovalConflictError(`未找到对应的执行授权申请 (${approvalId || actionType})`, 'APPROVAL_NOT_FOUND');
  }

  if (approval.status === 'consumed') {
    throw new ApprovalConflictError('该执行授权已经被消费执行过，无法重复批准', 'APPROVAL_ALREADY_CONSUMED');
  }
  if (approval.status === 'rejected') {
    throw new ApprovalConflictError('该执行授权已被拒绝，如需执行请重新发起申请', 'APPROVAL_ALREADY_REJECTED');
  }

  // 1. 核验输入指纹
  if (expectedInputDigest && expectedInputDigest !== approval.inputDigest) {
    approval.status = 'expired';
    approval.expireReason = '待审批数据与生成时指纹不符';
    writeJsonAtomic(getApprovalPath(dataDir, runId, approval.id), approval);
    writeJsonAtomic(getLatestApprovalPath(dataDir, runId, approval.actionType), approval);
    throw new ApprovalConflictError('待审批内容已被篡改或修改，授权单已自动失效', 'APPROVAL_INPUT_MISMATCH');
  }

  // 2. 核验 Run Revision
  const runtime = readRuntimeState({ dataDir, runId, autoRecover: false });
  if (runtime && Number(runtime.revision) !== approval.runRevision) {
    approval.status = 'expired';
    approval.expireReason = `工作流版本已从 r${approval.runRevision} 变更至 r${runtime.revision}`;
    writeJsonAtomic(getApprovalPath(dataDir, runId, approval.id), approval);
    writeJsonAtomic(getLatestApprovalPath(dataDir, runId, approval.actionType), approval);
    throw new ApprovalConflictError('工作流已产生新的步骤变更，旧授权已自动失效，请重新发起审批', 'APPROVAL_REVISION_MISMATCH');
  }

  approval.status = 'approved';
  approval.approvedBy = approvedBy;
  approval.approvedAt = new Date().toISOString();
  approval.expireReason = null;

  writeJsonAtomic(getApprovalPath(dataDir, runId, approval.id), approval);
  writeJsonAtomic(getLatestApprovalPath(dataDir, runId, approval.actionType), approval);
  return approval;
}

/**
 * 拒绝执行授权
 * @param {object} options
 * @param {string} [options.dataDir]
 * @param {string} options.runId
 * @param {string} [options.approvalId]
 * @param {string} [options.actionType='distribution.publish']
 * @param {string} [options.rejectedBy='user']
 * @param {string} [options.reason]
 * @returns {object}
 */
function rejectExecutionApproval({
  dataDir,
  runId,
  approvalId,
  actionType = 'distribution.publish',
  rejectedBy = 'user',
  reason = '人工拒绝'
}) {
  const approvalPath = approvalId
    ? getApprovalPath(dataDir, runId, approvalId)
    : getLatestApprovalPath(dataDir, runId, actionType);

  const approval = readJsonFile(approvalPath, null);
  if (!approval) {
    throw new ApprovalConflictError(`未找到对应的执行授权申请 (${approvalId || actionType})`, 'APPROVAL_NOT_FOUND');
  }

  approval.status = 'rejected';
  approval.rejectedBy = rejectedBy;
  approval.rejectedAt = new Date().toISOString();
  approval.rejectionReason = reason;

  writeJsonAtomic(getApprovalPath(dataDir, runId, approval.id), approval);
  writeJsonAtomic(getLatestApprovalPath(dataDir, runId, approval.actionType), approval);
  return approval;
}

/**
 * 校验高危副作用执行授权是否有效（门禁守卫核心逻辑）
 * 执行前必须调用此函数；若发生输入篡改或版本递增，自动将状态持久化置为 expired。
 * @param {object} options
 * @param {string} [options.dataDir]
 * @param {string} options.runId
 * @param {string} [options.actionType='distribution.publish']
 * @param {*} options.inputPayload 实际将要发给外部接口的参数载荷
 * @param {number} [options.currentRunRevision] 当前 Run 修订号（缺省时自动读取最新）
 * @returns {{ok: boolean, approval?: object, code?: string, error?: string, status?: string}}
 */
function verifyExecutionApproval({
  dataDir,
  runId,
  actionType = 'distribution.publish',
  inputPayload,
  currentRunRevision
}) {
  const latestPath = getLatestApprovalPath(dataDir, runId, actionType);
  const approval = readJsonFile(latestPath, null);

  if (!approval) {
    return {
      ok: false,
      code: 'APPROVAL_REQUIRED',
      error: `操作 [${actionType}] 需要人工执行授权，未找到有效授权单。`
    };
  }

  if (approval.status === 'consumed') {
    return {
      ok: false,
      code: 'APPROVAL_ALREADY_CONSUMED',
      status: 'consumed',
      error: '该授权单已被消费执行过，不可重复执行。'
    };
  }

  if (approval.status === 'expired') {
    return {
      ok: false,
      code: 'APPROVAL_EXPIRED',
      status: 'expired',
      error: `授权单已失效 (${approval.expireReason || '输入已更改或版本更新'})，请重新授权。`
    };
  }

  if (approval.status === 'rejected') {
    return {
      ok: false,
      code: 'APPROVAL_REJECTED',
      status: 'rejected',
      error: `授权单已被拒绝 (${approval.rejectionReason || '人工拒绝'})，无法执行。`
    };
  }

  if (approval.status !== 'approved') {
    return {
      ok: false,
      code: 'APPROVAL_NOT_APPROVED',
      status: approval.status,
      error: `当前授权状态为 ${approval.status}，未获人工批准，无法执行。`
    };
  }

  // 1. 现场重新计算输入 SHA-256 摘要
  const currentDigest = computeInputDigest(inputPayload);
  if (currentDigest !== approval.inputDigest) {
    approval.status = 'expired';
    approval.expireReason = '待执行内容（商品/店铺/价格）与授权时不一致';
    writeJsonAtomic(getApprovalPath(dataDir, runId, approval.id), approval);
    writeJsonAtomic(getLatestApprovalPath(dataDir, runId, approval.actionType), approval);
    return {
      ok: false,
      code: 'APPROVAL_INPUT_MISMATCH',
      status: 'expired',
      error: '执行输入内容已被修改，原授权单已自动失效，请重新确认授权。'
    };
  }

  // 2. 核验工作流修订号
  let revision = currentRunRevision;
  if (revision === undefined) {
    const runtime = readRuntimeState({ dataDir, runId, autoRecover: false });
    revision = runtime ? Number(runtime.revision) : approval.runRevision;
  }
  if (Number(revision) !== approval.runRevision) {
    approval.status = 'expired';
    approval.expireReason = `工作流版本已从 r${approval.runRevision} 变更至 r${revision}`;
    writeJsonAtomic(getApprovalPath(dataDir, runId, approval.id), approval);
    writeJsonAtomic(getLatestApprovalPath(dataDir, runId, approval.actionType), approval);
    return {
      ok: false,
      code: 'APPROVAL_REVISION_MISMATCH',
      status: 'expired',
      error: '工作流已产生新的步骤变更，原授权单已自动失效，请重新确认授权。'
    };
  }

  return { ok: true, approval };
}

/**
 * 标记执行授权已被消费（动作真正触发后调用，防止重放）
 * @param {object} options
 * @param {string} [options.dataDir]
 * @param {string} options.runId
 * @param {string} [options.approvalId]
 * @param {string} [options.actionType='distribution.publish']
 * @returns {object}
 */
function consumeExecutionApproval({
  dataDir,
  runId,
  approvalId,
  actionType = 'distribution.publish'
}) {
  const approvalPath = approvalId
    ? getApprovalPath(dataDir, runId, approvalId)
    : getLatestApprovalPath(dataDir, runId, actionType);

  const approval = readJsonFile(approvalPath, null);
  if (!approval) {
    throw new ApprovalConflictError(`未找到对应的执行授权单 (${approvalId || actionType})`, 'APPROVAL_NOT_FOUND');
  }

  approval.status = 'consumed';
  approval.consumedAt = new Date().toISOString();

  writeJsonAtomic(getApprovalPath(dataDir, runId, approval.id), approval);
  writeJsonAtomic(getLatestApprovalPath(dataDir, runId, approval.actionType), approval);
  return approval;
}

/**
 * 获取指定授权单
 * @param {object} options
 * @param {string} [options.dataDir]
 * @param {string} options.runId
 * @param {string} [options.approvalId]
 * @param {string} [options.actionType='distribution.publish']
 * @returns {object|null}
 */
function getExecutionApproval({ dataDir, runId, approvalId, actionType = 'distribution.publish' }) {
  const approvalPath = approvalId
    ? getApprovalPath(dataDir, runId, approvalId)
    : getLatestApprovalPath(dataDir, runId, actionType);
  return readJsonFile(approvalPath, null);
}

/**
 * 列出当前 Run 下所有执行授权单
 * @param {object} options
 * @param {string} [options.dataDir]
 * @param {string} options.runId
 * @returns {Array<object>}
 */
function listExecutionApprovals({ dataDir, runId }) {
  const dir = getApprovalsDir(dataDir, runId);
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter(file => file.startsWith('appr_') && file.endsWith('.json'))
      .map(file => readJsonFile(path.join(dir, file), null))
      .filter(Boolean)
      .sort((a, b) => String(b.requestedAt || '').localeCompare(String(a.requestedAt || '')));
  } catch (_) {
    return [];
  }
}

module.exports = {
  ApprovalForbiddenError,
  ApprovalConflictError,
  canonicalStringify,
  computeInputDigest,
  requestExecutionApproval,
  grantExecutionApproval,
  rejectExecutionApproval,
  verifyExecutionApproval,
  consumeExecutionApproval,
  getExecutionApproval,
  listExecutionApprovals
};
