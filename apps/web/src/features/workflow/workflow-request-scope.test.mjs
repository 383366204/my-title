import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowRequestScope } from './workflow-request-scope.js';

test('duplicate commands are blocked but cancellation has an independent channel', () => {
  const scope = createWorkflowRequestScope();
  const command = scope.begin('command');
  assert.equal(scope.begin('command'), null);
  assert.ok(scope.begin('cancel'));
  assert.equal(command.finish(), true);
  const next = scope.begin('command');
  assert.equal(command.finish(), false);
  assert.equal(next.isCurrent(), true);
});

test('late success or failure from an old run cannot release the new run lock', async () => {
  const old = createWorkflowRequestScope();
  const ticket = old.begin('confirm');
  let release;
  const response = new Promise(resolve => { release = resolve; });
  let writes = 0;
  const operation = response.then(() => { if (ticket.isCurrent()) writes++; })
    .finally(() => { if (ticket.finish()) writes++; });
  old.close();
  const current = createWorkflowRequestScope();
  const next = current.begin('confirm');
  release();
  await operation;
  assert.equal(writes, 0);
  assert.equal(next.isCurrent(), true);
  assert.equal(old.begin('confirm'), null);
});

test('effect cleanup invalidates tickets even when the same scope is activated again', () => {
  const scope = createWorkflowRequestScope();
  const old = scope.begin('confirm');
  scope.close();
  scope.activate();
  const current = scope.begin('confirm');
  assert.equal(old.isCurrent(), false);
  assert.equal(old.finish(), false);
  assert.equal(current.isCurrent(), true);
});
