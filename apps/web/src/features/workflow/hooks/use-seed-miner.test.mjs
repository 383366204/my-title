import assert from 'node:assert/strict';
import test from 'node:test';

import { useSeedPool, useRootMiner, useSeedMiner } from './use-seed-miner.js';

test('use-seed-miner exports useSeedPool, useRootMiner, and useSeedMiner as functions', () => {
  assert.equal(typeof useSeedPool, 'function');
  assert.equal(typeof useRootMiner, 'function');
  assert.equal(typeof useSeedMiner, 'function');
});
