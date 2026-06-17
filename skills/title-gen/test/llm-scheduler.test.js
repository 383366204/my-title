const test = require('node:test');
const assert = require('node:assert/strict');

const { runLimited, retryWithBackoff, isRateLimitError } = require('../src/llm-scheduler');

test('runLimited never exceeds configured concurrency', async () => {
  let active = 0;
  let maxActive = 0;
  const items = Array.from({ length: 5 }, (_, index) => index);

  const result = await runLimited(items, async item => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 20));
    active -= 1;
    return item * 2;
  }, { concurrency: 2 });

  assert.equal(maxActive, 2);
  assert.deepEqual(result, [0, 2, 4, 6, 8]);
});

test('retryWithBackoff retries rate-limit errors', async () => {
  let attempts = 0;
  const result = await retryWithBackoff(async () => {
    attempts += 1;
    if (attempts < 3) {
      const error = new Error('rate limit');
      error.name = 'RateLimitError';
      throw error;
    }
    return 'ok';
  }, { retries: 3, baseDelayMs: 1 });

  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});

test('isRateLimitError detects common rate-limit shapes', () => {
  assert.equal(isRateLimitError(Object.assign(new Error('429 too many requests'), { status: 429 })), true);
  assert.equal(isRateLimitError(Object.assign(new Error('quota exceeded'), { code: 'rate_limit_exceeded' })), true);
  assert.equal(isRateLimitError(new Error('plain failure')), false);
});
