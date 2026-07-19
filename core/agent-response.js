function defaultNextActionCode(payload) {
  if (payload.nextActionCode) return payload.nextActionCode;
  if (payload.mustReview || payload.status === 'needs_review') return 'review_required';
  if (isManualActionPayload(payload)) return 'manual_action_required';
  if (payload.ok === false || (payload.blockers && payload.blockers.length > 0) || payload.status === 'blocked') return 'fix_blockers';
  if (payload.status) return payload.status;
  return payload.ok ? 'ok' : 'unknown';
}

const MANUAL_ACTION_STATUSES = new Set([
  'login_required',
  'slider_required',
  'captcha_required',
  'authorization_required',
  'manual_action_required',
  'verified_no_generation_eligible',
  'verified_partial_manual_required'
]);

function isManualActionPayload(payload) {
  if (MANUAL_ACTION_STATUSES.has(payload.status)) return true;
  const blockers = Array.isArray(payload.blockers) ? payload.blockers : [];
  return blockers.some((blocker) => /login|slider|captcha|auth|manual/i.test(String(blocker)));
}

function defaultRequiresUserAction(payload) {
  if (typeof payload.requiresUserAction === 'boolean') return payload.requiresUserAction;
  if (payload.mustReview) return true;
  if (isManualActionPayload(payload)) return true;
  if (payload.ok === false) return true;
  if (Array.isArray(payload.blockers) && payload.blockers.length > 0) return true;
  return ['blocked', 'needs_review'].includes(payload.status);
}

function defaultUserMessage(payload) {
  if (payload.userMessage) return payload.userMessage;
  if (payload.requiresUserAction) {
    if (payload.blockers && payload.blockers.length) return `Blocked: ${payload.blockers.join(', ')}`;
    if (payload.mustReview) return 'Review is required before continuing.';
    return 'User action is required before continuing.';
  }
  if (payload.nextCommand) return `Next: ${payload.nextCommand}`;
  return 'Ready.';
}

function withAgentResponseFields(payload = {}) {
  const blockers = Array.isArray(payload.blockers) ? payload.blockers : [];
  const nextCommand = payload.nextCommand || '';
  const allowedCommands = Array.isArray(payload.allowedCommands)
    ? payload.allowedCommands
    : nextCommand
      ? [nextCommand]
      : [];
  const nextActionCode = defaultNextActionCode({ ...payload, blockers });
  const requiresUserAction = defaultRequiresUserAction({ ...payload, blockers });
  const result = {
    ...payload,
    status: payload.status || (payload.ok ? 'ready' : 'blocked'),
    nextActionCode,
    requiresUserAction,
    blockers,
    allowedCommands,
    nextCommand
  };
  result.userMessage = defaultUserMessage(result);
  return result;
}

module.exports = {
  withAgentResponseFields
};
