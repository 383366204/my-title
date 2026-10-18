'use strict';

const { setTimeout: delay } = require('node:timers/promises');
const { CdpClient } = require('../../alibaba1688/src/search-web-1688');
const { runWithPlatformGuard, PlatformAccessError } = require('../../../core/platform-access-guard');
const { imagePageBlocker } = require('./image-search-provider');
const { readSourceDetailEvidence, normalizeSourceDetailEvidence } = require('./source-detail-evidence');

/**
 * Collect visible SKU evidence in a dedicated tab without placing an order.
 * @param {string} offerId Explicit 1688 offer identity.
 * @param {object} options Chrome port, cancellation signal, progress and guard policy.
 * @returns {Promise<object>} Timestamped detail evidence; unknown layouts throw retryable errors.
 */
async function collectSourceDetail(offerId, options = {}) {
  if (typeof offerId !== 'string' || !/^\d+$/.test(offerId)) throw new Error('货源商品ID无效');
  const port = options.port ?? 9222;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Chrome端口无效');
  const checkStop = () => {
    if (options.signal?.aborted) throw Object.assign(new Error('商品详情采集已中断'), { code: 'PLATFORM_ACCESS_INTERRUPTED' });
  };
  checkStop();
  return runWithPlatformGuard('1688', {
    ...options.guardOptions, cache: false, shouldStop: () => options.signal?.aborted,
    onCooldown: options.onCooldown, lockTimeoutMs: 300000, staleLockMs: 300000
  }, async () => {
    checkStop();
    let client;
    let target;
    let success = false;
    const base = `http://127.0.0.1:${port}`;
    try {
      const url = `https://detail.1688.com/offer/${offerId}.html`;
      const response = await fetch(`${base}/json/new?${encodeURIComponent(url)}`, { method: 'PUT', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`Chrome创建标签页失败：${response.status}`);
      target = await response.json();
      client = new CdpClient(target.webSocketDebuggerUrl);
      const deadline = Date.now() + 30000;
      options.onProgress?.({ offerId, message: '读取货源规格、标价与起订量' });
      do {
        checkStop();
        const raw = await client.evaluate(`(${readSourceDetailEvidence.toString()})()`);
        const status = imagePageBlocker({ url: raw.url, text: raw.statusText, challengeVisible: raw.challengeVisible });
        if (status) throw new PlatformAccessError('货源详情需要处理登录或安全验证，请处理后重试', { platform: '1688', status });
        if (raw.title && raw.rows.length) {
          const result = normalizeSourceDetailEvidence(raw, { offerId, maxAgeMs: options.evidenceMaxAgeMs ?? 86400000 });
          checkStop();
          success = true;
          return result;
        }
        await delay(500);
      } while (Date.now() < deadline);
      throw Object.assign(new Error('没有识别到货源规格表，请核对详情页面；不能用列表最低价代替'), { code: 'SOURCE_DETAIL_UNRECOGNIZED', platform: '1688', offerId });
    } finally {
      client?.close();
      if (success && target?.id) await fetch(`${base}/json/close/${encodeURIComponent(target.id)}`, { signal: AbortSignal.timeout(5000) }).catch(() => {});
    }
  });
}

module.exports = { collectSourceDetail };
