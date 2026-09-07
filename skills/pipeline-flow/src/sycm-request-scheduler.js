'use strict';

/**
 * Wait in short slices so pause and cancel requests are observed promptly.
 * @param {number} ms Total wait duration.
 * @param {object} [options] Wait hooks.
 * @returns {Promise<{interrupted:boolean,requestedAction:string|null,remainingMs:number}>} Wait result.
 */
async function waitInterruptibly(ms, options = {}) {
  const sleep = options.sleep || (delay => new Promise(resolve => setTimeout(resolve, delay)));
  const shouldStop = options.shouldStop || (() => null);
  const onWait = options.onWait || (() => {});
  let remaining = Math.max(0, Number(ms) || 0);
  while (remaining > 0) {
    const requestedAction = shouldStop();
    if (requestedAction) return { interrupted: true, requestedAction, remainingMs: remaining };
    onWait(remaining);
    const chunk = Math.min(remaining, 1000);
    await sleep(chunk);
    remaining = Math.max(0, remaining - chunk);
  }
  return { interrupted: false, requestedAction: null, remainingMs: 0 };
}

module.exports = {
  waitInterruptibly
};
