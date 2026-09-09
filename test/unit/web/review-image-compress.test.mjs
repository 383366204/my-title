import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPRESSION_STEPS,
  canAutoCompress,
  compressionSize,
  compressedFileName
} from '../../../apps/web/src/features/workflow/review-image-compress.js';

test('only jpeg and png can be auto compressed', () => {
  assert.equal(canAutoCompress({ type: 'image/jpeg' }), true);
  assert.equal(canAutoCompress({ type: 'image/png' }), true);
  assert.equal(canAutoCompress({ type: 'image/gif' }), false);
  assert.equal(canAutoCompress({ type: 'image/webp' }), false);
  assert.equal(canAutoCompress(null), false);
});

test('compression size keeps small images unchanged and shrinks the longest edge', () => {
  assert.deepEqual(compressionSize(800, 600, 1600), { width: 800, height: 600 });
  assert.deepEqual(compressionSize(4000, 3000, 2000), { width: 2000, height: 1500 });
  assert.deepEqual(compressionSize(3000, 4000, 2000), { width: 1500, height: 2000 });
});

test('compression steps tighten quality and resolution together', () => {
  const qualities = COMPRESSION_STEPS.map((step) => step.quality);
  const edges = COMPRESSION_STEPS.map((step) => step.maxEdge);
  assert.deepEqual([...qualities].sort((a, b) => b - a), qualities);
  assert.deepEqual([...edges].sort((a, b) => b - a), edges);
});

test('compressed file name swaps the suffix to jpg', () => {
  assert.equal(compressedFileName('凭证.png'), '凭证.jpg');
  assert.equal(compressedFileName('photo.jpeg'), 'photo.jpg');
  assert.equal(compressedFileName('无后缀'), '无后缀.jpg');
});