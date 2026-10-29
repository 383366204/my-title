'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  initializePeerTask,
  requirePublishedPeerTask,
  readPeerTaskStatus,
  requestPeerTaskCancel
} = require('../../../../skills/peer-discovery/src/peer-task-coordinator');
const { updateRuntimeState } = require('../../../../skills/pipeline-flow/runtime/store');

test('peer-task-coordinator: lifecycle initialization, query and cancellation', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coord-test-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  // 1. Non-existent taskId throws 404
  await assert.rejects(
    () => requirePublishedPeerTask('non_existent', { dataDir: tempDir }),
    (err) => err.code === 'TASK_NOT_FOUND' && err.status === 404
  );

  // 2. Initialize task
  const task = await initializePeerTask({
    links: 'https://item.taobao.com/item.htm?id=123',
    discoveryBranch: 'image-selection'
  }, { dataDir: tempDir });

  assert.ok(task.taskId);
  assert.equal(task.params.discoveryBranch, 'image-selection');

  // 3. Status is queued
  const statusQueued = await readPeerTaskStatus(task.taskId, { dataDir: tempDir });
  assert.equal(statusQueued.status, 'queued');
  assert.equal(statusQueued.discoveryBranch, 'image-selection');
  assert.ok(statusQueued.steps.includes('collectPeerProducts'));

  // 4. Cancel queued task transitions directly to cancelled
  const cancelQueued = await requestPeerTaskCancel(task.taskId, { dataDir: tempDir });
  assert.equal(cancelQueued.status, 'cancelled');

  // 5. Subsequent cancel on terminal task preserves terminal state
  const cancelAgain = await requestPeerTaskCancel(task.taskId, { dataDir: tempDir });
  assert.equal(cancelAgain.status, 'cancelled');

  // 6. Running task cancellation returns cancelling
  const taskRunning = await initializePeerTask({
    links: 'https://item.taobao.com/item.htm?id=456',
    discoveryBranch: 'peer-analysis'
  }, { dataDir: tempDir });

  updateRuntimeState({
    dataDir: tempDir,
    runId: taskRunning.taskId,
    patch: { status: 'running', activeStep: 'extractSources' }
  });

  const cancelRunning = await requestPeerTaskCancel(taskRunning.taskId, { dataDir: tempDir });
  assert.equal(cancelRunning.status, 'cancelling');
});
