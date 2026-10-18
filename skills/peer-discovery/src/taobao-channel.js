'use strict';

const OPERATIONS = ['productDetail', 'imageSearch', 'shopSales'];

/**
 * Validate the persisted selection independently of platform readiness.
 * @param {string} value Requested transport.
 * @returns {string} auto, native or web.
 */
function normalizeTaobaoChannel(value = 'auto') {
  if (!['auto', 'native', 'web'].includes(value)) throw new Error('淘宝采集方式必须为自动、客户端或网页端');
  return value;
}

function readiness(channel, probes, operations) {
  const probe = probes[channel];
  if (!probe || probe.status !== 'ready') return { channel, status: probe?.status || 'unverified', missing: [] };
  const missing = operations.filter(operation => probe.operations?.[operation] !== true);
  return { channel, status: missing.length ? 'unsupported' : 'ready', missing };
}

/**
 * Select a verified transport without bypassing login, risk controls or run pinning.
 * @param {object} options Requested/active channel, capability probes and required operations.
 * @returns {object} ready, blocked or switch_confirmation_required decision.
 */
function resolveTaobaoChannel({ requested = 'auto', activeChannel = null, probes = {}, requiredOperations = OPERATIONS } = {}) {
  normalizeTaobaoChannel(requested);
  if (activeChannel !== null && !['native', 'web'].includes(activeChannel)) throw new Error('活动淘宝通道无效');
  if (!Array.isArray(requiredOperations) || !requiredOperations.length || requiredOperations.some(op => !OPERATIONS.includes(op))) throw new Error('淘宝能力检查范围无效');
  if (activeChannel && requested !== 'auto' && requested !== activeChannel) {
    return { status: 'switch_confirmation_required', channel: activeChannel, suggestedChannel: requested, reason: 'run_channel_pinned', invalidateEvidence: true };
  }
  const preferred = activeChannel || (requested === 'auto' ? 'native' : requested);
  const current = readiness(preferred, probes, requiredOperations);
  if (current.status === 'ready') return { ...current, status: 'ready' };
  // 平台限制与未验证能力不能通过另一条通道规避，也不能静默混用旧证据。
  if (requested !== 'auto' || activeChannel || !['unavailable', 'unsupported'].includes(current.status)) {
    return { ...current, status: 'blocked', reason: current.status };
  }
  const alternate = readiness(preferred === 'native' ? 'web' : 'native', probes, requiredOperations);
  if (alternate.status !== 'ready') return { ...current, status: 'blocked', reason: current.status, alternateStatus: alternate.status };
  return { status: 'switch_confirmation_required', channel: preferred, suggestedChannel: alternate.channel, reason: current.status, invalidateEvidence: true };
}

module.exports = { normalizeTaobaoChannel, resolveTaobaoChannel };
