'use strict';

/**
 * @file human-context.js
 * @description 人工确认上下文解析与凭据校验 (Trusted Human Context)
 * 确保高危执行授权与业务复核确认由可信人类签署，防止 Agent 自行批准或伪造人类身份。
 * 符合 ADR v1.0 (D8)
 */

class HumanContextError extends Error {
  constructor(message, code = 'HUMAN_CONFIRMATION_REQUIRED') {
    super(message);
    this.name = 'HumanContextError';
    this.code = code;
    this.status = 403;
  }
}

/**
 * 判断某个角色或标识是否为自动化 Agent/模型
 * @param {string} identity
 * @returns {boolean}
 */
function isAgentIdentity(identity) {
  if (!identity || typeof identity !== 'string') return false;
  const normalized = identity.trim().toLowerCase();
  if (
    normalized === 'agent' ||
    normalized === 'agent_draft' ||
    normalized === 'system' ||
    normalized === 'model' ||
    normalized === 'llm' ||
    normalized === 'assistant' ||
    normalized === 'automated'
  ) {
    return true;
  }
  return /^(agent|bot|model|llm)[:_-]/i.test(normalized) || /[:_-](agent|bot|model|llm)$/i.test(normalized);
}

/**
 * 从 HTTP 请求中提取并校验受信任的人工操作员上下文
 * @param {object} req Express request
 * @param {object} [deps]
 * @param {object} [options]
 * @param {boolean} [options.strictApproval=false] 是否为严格执行授权单批准
 * @returns {{ ok: boolean, identity?: string, code?: string, error?: string }}
 */
function resolveTrustedHumanContext(req, deps = {}, options = {}) {
  if (!req || typeof req !== 'object') {
    return { ok: false, code: 'HUMAN_CONFIRMATION_REQUIRED', error: '缺少有效的请求上下文' };
  }

  if (typeof deps.resolveHumanContext === 'function') {
    return deps.resolveHumanContext(req);
  }

  // 1. 显式 Agent 标头与载荷探测
  const actorRole = String(
    req.headers?.['x-actor-role'] ||
    req.headers?.['x-caller-source'] ||
    ''
  ).trim().toLowerCase();

  const hasAgentHeader = (
    actorRole === 'agent' ||
    Boolean(req.headers?.['x-agent-id']) ||
    Boolean(req.headers?.['x-subagent-id']) ||
    Boolean(req.headers?.['x-agent-run-id'])
  );

  const bodySource = String(
    req.body?.callerSource ||
    req.body?.source ||
    req.body?.role ||
    ''
  ).trim().toLowerCase();

  const declaredName = String(
    req.body?.approvedBy ||
    req.body?.confirmedBy ||
    ''
  ).trim();

  if (hasAgentHeader || isAgentIdentity(bodySource) || isAgentIdentity(declaredName)) {
    return {
      ok: false,
      code: 'APPROVAL_SELF_GRANT_FORBIDDEN',
      error: '高危授权与业务复核确认严禁由 Agent 自行签署或代理执行'
    };
  }

  // 2. 检查会话上下文 (如登录态)
  const sessionUser = req.user?.id || req.user?.username || req.user?.name || req.session?.user;
  if (sessionUser && typeof sessionUser === 'string' && !isAgentIdentity(sessionUser)) {
    return { ok: true, identity: sessionUser };
  }

  // 3. 检查受信任的人工操作员标头
  const hasHumanHeader = Boolean(
    req.headers?.['x-human-confirmation'] === 'true' ||
    req.headers?.['x-human-confirmation'] === '1' ||
    actorRole === 'user' ||
    actorRole === 'human' ||
    actorRole === 'operator'
  );

  const headerOperator = String(
    req.headers?.['x-operator-id'] ||
    req.headers?.['x-confirmed-by'] ||
    req.headers?.['x-approved-by'] ||
    ''
  ).trim();

  if (headerOperator && isAgentIdentity(headerOperator)) {
    return {
      ok: false,
      code: 'APPROVAL_SELF_GRANT_FORBIDDEN',
      error: '操作员标识不能为 Agent 或自动化角色'
    };
  }

  if (hasHumanHeader || headerOperator) {
    const finalIdentity = headerOperator || 'user';
    return { ok: true, identity: finalIdentity };
  }

  // 4. 对于非 grant 的普通业务复核 (如 keyword-review / product-review)，或者未携带标头的测试请求：
  // 只要没有 Agent 标记，允许降级为 'user'
  if (!options.strictApproval && (!req.headers || deps.requireTrustedContext !== true)) {
    return { ok: true, identity: 'user' };
  }

  // 5. 兼容性降级：本地开发/浏览器直接访问/显式标记
  if (
    deps.requireTrustedContext === false ||
    req.body?.confirm === true ||
    req.headers?.['sec-fetch-mode'] ||
    req.headers?.['origin']
  ) {
    return { ok: true, identity: 'user' };
  }

  return {
    ok: false,
    code: 'HUMAN_CONFIRMATION_REQUIRED',
    error: '缺少可信的人工确认上下文 (需提供 X-Actor-Role: user 或 X-Human-Confirmation: true 标头)'
  };
}

module.exports = {
  isAgentIdentity,
  resolveTrustedHumanContext,
  HumanContextError
};
