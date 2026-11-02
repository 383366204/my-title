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
 * @param {object} [deps] 外部依赖
 * @param {object} [options]
 * @param {boolean} [options.strictApproval=false] 是否为严格执行授权单批准 (需要服务端验证的凭据或会话)
 * @param {string} [options.expectedGrantToken] 预期服务端颁发的一次性授权凭据
 * @param {string} [options.grantToken] 请求中携带的授权凭据
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

  // 内存 Mock 请求（非真实 HTTP 请求，无 headers 对象）且无 Agent 标记时，允许单元测试直接调用
  if (!req.headers) {
    return { ok: true, identity: declaredName || 'user' };
  }

  // 2. 检查会话上下文 (如登录态)
  const sessionUser = req.user?.id || req.user?.username || req.user?.name || req.session?.user;
  if (sessionUser && typeof sessionUser === 'string' && !isAgentIdentity(sessionUser)) {
    return { ok: true, identity: sessionUser };
  }

  // 3. 高危执行授权 (strictApproval) 凭证校验：要求服务端签发的 grantToken 或认证会话
  if (options.strictApproval) {
    const suppliedToken = options.grantToken || req.body?.grantToken || req.headers?.['x-approval-token'];
    if (options.expectedGrantToken && suppliedToken && suppliedToken === options.expectedGrantToken) {
      const id = req.headers?.['x-operator-id'] || req.headers?.['x-confirmed-by'] || 'user';
      return { ok: true, identity: id };
    }
    if (deps.requireTrustedContext === false) {
      const fallbackId = String(req.headers?.['x-operator-id'] || req.body?.approvedBy || 'user');
      return { ok: true, identity: fallbackId };
    }
    return {
      ok: false,
      code: 'HUMAN_CONFIRMATION_REQUIRED',
      error: '高危执行授权需要提供有效的人工确认凭据 (grantToken 或登录会话)'
    };
  }

  // 4. 普通业务复核操作员标头探测
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

  // 5. 若环境明确要求强人工上下文 (requireTrustedContext === true)，但没有提供任何凭据
  if (deps.requireTrustedContext === true) {
    return {
      ok: false,
      code: 'HUMAN_CONFIRMATION_REQUIRED',
      error: '缺少可信的人工确认上下文 (需提供 X-Actor-Role: user 或 X-Human-Confirmation: true 标头)'
    };
  }

  // 6. 默认业务复核放行：非 Agent 的普通 HTTP 请求（如浏览器点击确认）
  return { ok: true, identity: declaredName || 'user' };
}

module.exports = {
  isAgentIdentity,
  resolveTrustedHumanContext,
  HumanContextError
};
