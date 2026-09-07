'use strict';

const TRUSTED_HOST_SUFFIXES = ['taobao.com', 'tmall.com', 'tmall.hk', 'tb.cn'];
const URL_PATTERN = /https?:\/\/[^\s<>{}\[\]"'，；]+/gi;

function isTrustedTaobaoHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  return TRUSTED_HOST_SUFFIXES.some(suffix => host === suffix || host.endsWith(`.${suffix}`));
}

function trimSharedUrl(value) {
  return String(value || '')
    .trim()
    .replace(/[)）\]】>,，。；;]+$/g, '');
}

/**
 * Extract trusted Taobao/Tmall URLs from pasted share messages.
 * @param {string|string[]} input Raw share text or text list.
 * @param {object} [options] Parser options.
 * @param {number} [options.limit] Maximum unique links.
 * @returns {{links:Array<object>,invalid:Array<string>,duplicateCount:number,truncatedCount:number}} Parsed links.
 */
function parseCompetitorInputs(input, options = {}) {
  const limit = Math.max(1, Math.min(20, Number.parseInt(options.limit, 10) || 10));
  const values = Array.isArray(input) ? input : [input];
  const matches = values.flatMap(value => String(value || '').match(URL_PATTERN) || []);
  const seen = new Set();
  const links = [];
  const invalid = [];
  let duplicateCount = 0;
  let truncatedCount = 0;

  for (const match of matches) {
    const rawUrl = trimSharedUrl(match);
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch (_error) {
      invalid.push(rawUrl);
      continue;
    }
    const unsafeAuthority = Boolean(parsed.username || parsed.password || (parsed.port && !['80', '443'].includes(parsed.port)));
    if (!['http:', 'https:'].includes(parsed.protocol) || unsafeAuthority || !isTrustedTaobaoHost(parsed.hostname)) {
      invalid.push(rawUrl);
      continue;
    }
    parsed.hash = '';
    const normalizedUrl = parsed.href;
    if (seen.has(normalizedUrl)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(normalizedUrl);
    if (links.length >= limit) {
      truncatedCount += 1;
      continue;
    }
    links.push({
      inputUrl: normalizedUrl,
      hostname: parsed.hostname.toLowerCase(),
      kind: /(?:^|\.)m\.tb\.cn$|(?:^|\.)tb\.cn$/.test(parsed.hostname.toLowerCase())
        ? 'short'
        : /(?:item\.taobao\.com|detail\.tmall\.)/.test(parsed.hostname.toLowerCase())
          ? 'product'
          : 'shop'
    });
  }

  return { links, invalid, duplicateCount, truncatedCount };
}

module.exports = {
  isTrustedTaobaoHost,
  parseCompetitorInputs,
  trimSharedUrl
};
