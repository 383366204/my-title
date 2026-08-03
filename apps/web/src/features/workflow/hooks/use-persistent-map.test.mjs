import assert from 'node:assert/strict';
import test from 'node:test';

import { readPersistentMap, writePersistentMap } from './use-persistent-map.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    value: (key) => values.get(key)
  };
}

test('persistent map helpers keep values isolated by workflow run key', () => {
  const storage = memoryStorage({
    'run.old': JSON.stringify({ oldProduct: true }),
    'run.new': JSON.stringify({ newProduct: true })
  });

  assert.deepEqual(readPersistentMap('run.old', storage), { oldProduct: true });
  assert.deepEqual(readPersistentMap('run.new', storage), { newProduct: true });
  assert.equal(writePersistentMap('run.new', { newProduct: false }, storage), true);
  assert.deepEqual(readPersistentMap('run.old', storage), { oldProduct: true });
  assert.deepEqual(readPersistentMap('run.new', storage), { newProduct: false });
});

test('persistent map helpers tolerate malformed and unavailable storage', () => {
  const storage = memoryStorage({ broken: '{not-json' });

  assert.deepEqual(readPersistentMap('broken', storage), {});
  assert.deepEqual(readPersistentMap('missing', null), {});
  assert.equal(writePersistentMap('missing', {}, null), false);
});
