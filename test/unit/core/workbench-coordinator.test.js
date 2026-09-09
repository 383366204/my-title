const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkbenchCoordinator } = require('../../../core/server/workbench-coordinator');

test('a preparation reservation blocks every other entry and only its owner can release it', () => {
  const coordinator = createWorkbenchCoordinator();
  const preparing = coordinator.tryAcquire({ mode: 'preparing' });
  assert.ok(preparing);
  assert.equal(coordinator.tryAcquire({ mode: 'cli' }), null);
  assert.throws(() => coordinator.run({}, () => assert.fail('must not execute')), { code: 'WORKFLOW_BUSY' });
  assert.equal(coordinator.release({}), false);
  assert.equal(coordinator.current, preparing);
  coordinator.release(preparing);
  const next = coordinator.tryAcquire({ mode: 'next' });
  assert.equal(coordinator.release(preparing), false);
  assert.equal(coordinator.current, next);
});

test('successful, rejected and synchronously throwing runners release their reservation', async () => {
  const coordinator = createWorkbenchCoordinator();
  assert.equal(await coordinator.run({}, () => 42), 42);
  assert.equal(coordinator.current, null);
  await assert.rejects(coordinator.run({}, () => Promise.reject(new Error('rejected'))), /rejected/);
  assert.equal(coordinator.current, null);
  assert.throws(() => coordinator.run({}, () => { throw new Error('sync'); }), /sync/);
  assert.equal(coordinator.current, null);
});

test('requesting cancellation must not release a runner before it actually settles', async () => {
  const coordinator = createWorkbenchCoordinator();
  const task = { runId: 'A' };
  let finish;
  const promise = coordinator.run(task, () => new Promise(resolve => { finish = resolve; }));
  task.cancelRequested = true;
  assert.equal(coordinator.tryAcquire({ runId: 'B' }), null);
  finish({ status: 'cancelled' });
  await promise;
  assert.equal(coordinator.current, null);
});
