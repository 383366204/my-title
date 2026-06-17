'use strict';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRateLimitError(error) {
  const message = String((error && error.message) || '').toLowerCase();
  const code = String((error && error.code) || '').toLowerCase();
  return !!error && (
    error.name === 'RateLimitError' ||
    error.status === 429 ||
    code.includes('rate') ||
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('quota')
  );
}

async function retryWithBackoff(fn, options = {}) {
  const retries = Number(options.retries ?? 2);
  const baseDelayMs = Number(options.baseDelayMs ?? 800);
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!isRateLimitError(error) || attempt === retries) throw error;
      await sleep(baseDelayMs * Math.pow(2, attempt));
    }
  }
  throw new Error('unreachable retry state');
}

async function runLimited(items, handler, options = {}) {
  const concurrency = Math.max(1, Number(options.concurrency || 1));
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await handler(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

module.exports = { runLimited, retryWithBackoff, isRateLimitError };
