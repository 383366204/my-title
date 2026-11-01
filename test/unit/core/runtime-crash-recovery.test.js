'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const { createWorkbenchLeaseManager } = require('../../../core/runtime/workbench-lease');
const { initRun, appendJsonl } = require('../../../skills/pipeline-flow/src/run-store');
const {
  initRuntimeState,
  readRuntimeState,
  updateRuntimeState,
  writeJsonAtomic,
  isPidAlive,
  recoverRuntimeState,
  verifyEventConsistency,
  appendRuntimeEvent,
  readRuntimeEvents
} = require('../../../skills/pipeline-flow/runtime/store');
const { runPipelineRuntime } = require('../../../skills/pipeline-flow/runtime/runner');
const { createWorkflowControlService } = require('../../../core/workflow/control-service');
const { buildNodeStates } = require('../../../core/workflow/pipeline-node-state');
const { summarizePipelineRun } = require('../../../core/pipeline-run-summary');

function createTempDir(prefix = 'runtime-crash-recovery-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createMockWorkbench() {
  let current = null;
  return {
    get current() {
      return current;
    },
    tryAcquire(state = {}) {
      if (current) return null;
      current = { ...state };
      return current;
    },
    release(state) {
      if (current && (!state || current === state || current.runId === state.runId)) {
        current = null;
      }
    },
    async run(state, fn) {
      current = state;
      try {
        return await fn();
      } finally {
        current = null;
      }
    },
    async runReserved(state, fn) {
      current = state;
      try {
        return await fn();
      } finally {
        current = null;
      }
    }
  };
}

describe('PR-05 Runtime Crash Recovery & Atomic Snapshot Suite', () => {
  describe('Atomic Snapshot Writes (writeJsonAtomic)', () => {
    it('writes JSON atomically and cleans up temporary files', () => {
      const dataDir = createTempDir();
      const targetFile = path.join(dataDir, 'test-atomic.json');
      const data = { hello: 'world', version: 1 };

      writeJsonAtomic(targetFile, data);

      assert.ok(fs.existsSync(targetFile));
      const parsed = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
      assert.deepEqual(parsed, data);

      // Verify no dangling .tmp files in dataDir
      const files = fs.readdirSync(dataDir);
      assert.equal(files.length, 1);
      assert.equal(files[0], 'test-atomic.json');
    });

    it('atomically overwrites existing file without leaving temp residues', () => {
      const dataDir = createTempDir();
      const targetFile = path.join(dataDir, 'overwrite.json');

      writeJsonAtomic(targetFile, { step: 1 });
      assert.equal(JSON.parse(fs.readFileSync(targetFile, 'utf8')).step, 1);

      writeJsonAtomic(targetFile, { step: 2 });
      assert.equal(JSON.parse(fs.readFileSync(targetFile, 'utf8')).step, 2);

      const files = fs.readdirSync(dataDir);
      assert.deepEqual(files, ['overwrite.json']);
    });
  });

  describe('Revision Tracking & Optimistic Concurrency Control', () => {
    it('initializes runtime with revision 1, attempt 1 and current pid', () => {
      const dataDir = createTempDir();
      const runId = 'run_rev_init';
      const runtime = initRuntimeState({
        dataDir,
        runId,
        steps: ['mine', 'select'],
        mode: 'daily'
      });

      assert.equal(runtime.revision, 1);
      assert.equal(runtime.attempt, 1);
      assert.equal(runtime.pid, process.pid);
      assert.equal(runtime.status, 'running');

      const persisted = readRuntimeState({ dataDir, runId });
      assert.equal(persisted.revision, 1);
      assert.equal(persisted.attempt, 1);
      assert.equal(persisted.pid, process.pid);
    });

    it('monotonically increments revision across successive updates', () => {
      const dataDir = createTempDir();
      const runId = 'run_rev_inc';
      initRuntimeState({ dataDir, runId, steps: ['mine', 'select'] });

      const u1 = updateRuntimeState({ dataDir, runId, patch: { activeStep: 'mine' } });
      assert.equal(u1.revision, 2);

      const u2 = updateRuntimeState({ dataDir, runId, patch: { activeStep: 'select' } });
      assert.equal(u2.revision, 3);

      const u3 = updateRuntimeState({ dataDir, runId, patch: { status: 'completed' } });
      assert.equal(u3.revision, 4);

      const finalState = readRuntimeState({ dataDir, runId });
      assert.equal(finalState.revision, 4);
    });

    it('enforces expectedRevision optimistic locking and rejects conflicts', () => {
      const dataDir = createTempDir();
      const runId = 'run_rev_conflict';
      initRuntimeState({ dataDir, runId, steps: ['mine'] }); // revision = 1

      // Matching expectedRevision succeeds
      const u1 = updateRuntimeState({
        dataDir,
        runId,
        patch: { activeStep: 'mine' },
        expectedRevision: 1
      });
      assert.equal(u1.revision, 2);

      // Stale expectedRevision throws REVISION_CONFLICT
      assert.throws(
        () => updateRuntimeState({
          dataDir,
          runId,
          patch: { status: 'completed' },
          expectedRevision: 1 // current is 2, conflict!
        }),
        (err) => {
          assert.equal(err.code, 'REVISION_CONFLICT');
          assert.match(err.message, /Runtime revision conflict/);
          return true;
        }
      );

      // State on disk remains at revision 2 without corrupted partial writes
      const persisted = readRuntimeState({ dataDir, runId });
      assert.equal(persisted.revision, 2);
      assert.equal(persisted.status, 'running');
    });

    it('tracks attempt counter increments on retries and resumptions', () => {
      const dataDir = createTempDir();
      const runId = 'run_attempt_track';
      initRuntimeState({ dataDir, runId, steps: ['mine', 'select'] }); // attempt = 1

      const u1 = updateRuntimeState({
        dataDir,
        runId,
        patch: {
          incrementAttempt: true,
          status: 'resuming'
        }
      });
      assert.equal(u1.attempt, 2);
      assert.equal(u1.revision, 2);

      const u2 = updateRuntimeState({
        dataDir,
        runId,
        patch: {
          incrementAttempt: true,
          status: 'retrying'
        }
      });
      assert.equal(u2.attempt, 3);
      assert.equal(u2.revision, 3);
    });

    it('throws RUNTIME_LOCK_TIMEOUT when lock cannot be acquired within retry limit', () => {
      const dataDir = createTempDir();
      const runId = 'run_lock_timeout';
      initRuntimeState({ dataDir, runId, steps: ['mine'] });

      // Simulate external alive process holding the lock file
      const lockFile = path.join(dataDir, 'runs', runId, 'runtime.json.lock');
      fs.writeFileSync(lockFile, JSON.stringify({
        pid: process.pid,
        ownerToken: 'other_owner',
        createdAt: Date.now()
      }), 'utf8');

      assert.throws(
        () => updateRuntimeState({ dataDir, runId, patch: { status: 'paused' } }),
        (err) => err.code === 'RUNTIME_LOCK_TIMEOUT'
      );

      try { fs.unlinkSync(lockFile); } catch {}
    });
  });

  describe('Process Liveness Tester (isPidAlive)', () => {
    it('detects current process as alive and non-existent pid as dead', () => {
      assert.equal(isPidAlive(process.pid), true);
      assert.equal(isPidAlive(0), false);
      assert.equal(isPidAlive(-1), false);
      assert.equal(isPidAlive(null), false);
      assert.equal(isPidAlive(99999999), false);
    });
  });

  describe('Crash Recovery (recoverRuntimeState)', () => {
    it('does not alter non-active run states (completed, paused, cancelled)', () => {
      const dataDir = createTempDir();
      const runId = 'run_recover_completed';
      initRuntimeState({ dataDir, runId, steps: ['mine'] });
      updateRuntimeState({ dataDir, runId, patch: { status: 'completed' } });

      const res = recoverRuntimeState({
        dataDir,
        runId,
        isAliveFn: () => false
      });
      assert.equal(res.recovered, false);
      assert.equal(res.reason, 'not_active');
      assert.equal(res.runtime.status, 'completed');
    });

    it('does not alter active run if process is still alive', () => {
      const dataDir = createTempDir();
      const runId = 'run_recover_alive';
      initRuntimeState({ dataDir, runId, steps: ['mine'] });

      const res = recoverRuntimeState({
        dataDir,
        runId,
        isAliveFn: () => true // Process still alive
      });
      assert.equal(res.recovered, false);
      assert.equal(res.reason, 'process_alive');
      assert.equal(res.runtime.status, 'running');
    });

    it('heals crashed active run to interrupted state when process is dead', () => {
      const dataDir = createTempDir();
      const runId = 'run_crashed_active';
      initRuntimeState({ dataDir, runId, steps: ['mine', 'select'] });
      updateRuntimeState({
        dataDir,
        runId,
        patch: {
          activeStep: 'mine',
          progress: {
            mine: { status: 'running', percent: 45, message: '正在挖掘' }
          }
        }
      });

      const res = recoverRuntimeState({
        dataDir,
        runId,
        isAliveFn: () => false, // Dead process
        now: () => '2026-11-02T10:00:00.000Z'
      });

      assert.equal(res.recovered, true);
      assert.equal(res.reason, 'recovered_from_crash');
      assert.equal(res.runtime.status, 'interrupted');
      assert.equal(res.runtime.interruptedAt, '2026-11-02T10:00:00.000Z');
      assert.equal(res.runtime.interruptedReason, 'process_terminated_unexpectedly');
      assert.equal(res.runtime.progress.mine.status, 'interrupted');

      // Verify audit event appended to workflow-events.jsonl
      const events = readRuntimeEvents({ dataDir, runId });
      const lastEvent = events[events.length - 1];
      assert.equal(lastEvent.event, 'interrupted');
      assert.equal(lastEvent.step, 'mine');
      assert.equal(lastEvent.reason, 'process_terminated_unexpectedly');
      assert.equal(lastEvent.timestamp, '2026-11-02T10:00:00.000Z');

      // Verify autoRecover in readRuntimeState
      const autoState = readRuntimeState({ dataDir, runId, autoRecover: true });
      assert.equal(autoState.status, 'interrupted');
    });

    it('triggers recovery during normal readRuntimeState and summarizePipelineRun when PID is dead', () => {
      const dataDir = createTempDir();
      const runId = 'run_auto_heal_on_read';
      initRuntimeState({ dataDir, runId, steps: ['mine', 'select'] });
      // Set an invalid dead PID (e.g. 99999999)
      updateRuntimeState({
        dataDir,
        runId,
        patch: {
          pid: 99999999,
          activeStep: 'mine',
          status: 'running'
        }
      });

      // Normal user-facing load without explicit recovery call
      const loaded = readRuntimeState({ dataDir, runId });
      assert.equal(loaded.status, 'interrupted', 'readRuntimeState should auto-recover crashed run');
      assert.equal(loaded.interruptedReason, 'process_terminated_unexpectedly');

      // Normal summary load also reflects interrupted status and blocker
      const summary = summarizePipelineRun({ dataDir, runId });
      assert.ok(summary);
      assert.equal(summary.status, 'interrupted');
      assert.ok(summary.blockers.includes('process_interrupted'));
      assert.match(summary.nextCommand, /workflow resume --run run_auto_heal_on_read --json/);
    });

    it('overrides stale persisted run.nextCommand when run is interrupted', () => {
      const dataDir = createTempDir();
      const runId = 'interrupted_verify_stale_cmd';
      const { run } = initRun({ dataDir, runId });
      const runFile = path.join(dataDir, 'runs', runId, 'run.json');
      fs.writeFileSync(runFile, JSON.stringify({
        ...run,
        status: 'mined',
        nextCommand: `node bin/cli.js flow review --run ${runId} --json`
      }));
      initRuntimeState({ dataDir, runId, steps: ['mine', 'verify'] });
      updateRuntimeState({ dataDir, runId, patch: { activeStep: 'verify', pid: 99999999 } });

      const summary = summarizePipelineRun({ dataDir, runId });
      assert.equal(summary.status, 'interrupted');
      assert.equal(summary.nextCommand, `node bin/cli.js workflow resume --run ${runId} --json`);
    });

    it('projects interrupted run onto summary and canvas cleanly', () => {
      const summary = {
        runId: 'run_interrupted_proj',
        status: 'interrupted',
        options: { mode: 'daily' },
        runtime: {
          mode: 'daily',
          status: 'interrupted',
          activeStep: 'mine',
          steps: ['inspire', 'mine', 'keywordReview', 'select', 'generate', 'export'],
          progress: {
            inspire: { status: 'completed', percent: 100, message: '完成' },
            mine: { status: 'interrupted', percent: 50, message: '进程异常中断' },
            keywordReview: { status: 'idle', percent: 0, message: '' },
            select: { status: 'idle', percent: 0, message: '' },
            generate: { status: 'idle', percent: 0, message: '' },
            export: { status: 'idle', percent: 0, message: '' }
          }
        }
      };

      const nodeStates = buildNodeStates(summary);
      assert.equal(nodeStates.inspire.status, 'completed');
      assert.equal(nodeStates.mine.status, 'blocked');
      assert.equal(nodeStates.keywordReview.status, 'idle');
      assert.equal(nodeStates.select.status, 'idle');
      assert.equal(nodeStates.end.status, 'idle');
      assert.match(nodeStates.mine.actionHint, /流程执行进程异常中断/);
      assert.equal(nodeStates.mine.nextRecommendedAction.action, 'resume');
    });

    it('preserves summary fallback and displays artifacts when runtime.json is malformed', () => {
      const dataDir = createTempDir();
      const runId = 'run_malformed_runtime_fallback';
      const { run, runDir } = initRun({ dataDir, runId });
      // Write corrupted truncated JSON left by an un-atomic write crash
      fs.writeFileSync(path.join(runDir, 'runtime.json'), '{"status": "running", "steps": [broken...', 'utf8');

      // Summary should not throw; should gracefully fall back to run.json
      const summary = summarizePipelineRun({ dataDir, runId });
      assert.ok(summary);
      assert.equal(summary.runId, runId);
      assert.equal(summary.status, 'created');
    });

    it('aborts crash recovery without overwriting when run was concurrently resumed', () => {
      const dataDir = createTempDir();
      const runId = 'run_concurrent_resume_race';
      initRuntimeState({ dataDir, runId, steps: ['mine'] });
      updateRuntimeState({ dataDir, runId, patch: { pid: 99999999 } });

      const recovery = recoverRuntimeState({
        dataDir,
        runId,
        isAliveFn: () => {
          // Concurrently update/resume the run in another process
          updateRuntimeState({
            dataDir,
            runId,
            patch: { status: 'running', activeStep: 'select', pid: 12345 }
          });
          return false;
        }
      });

      assert.equal(recovery.recovered, false);
      assert.equal(recovery.reason, 'concurrent_modification');

      const fresh = readRuntimeState({ dataDir, runId, autoRecover: false });
      assert.equal(fresh.status, 'running');
      assert.equal(fresh.activeStep, 'select');
      assert.equal(fresh.pid, 12345);
    });
  });

  describe('Resuming an Interrupted Run (Runner & ControlService)', () => {
    it('resumes an interrupted run from activeStep to completion', async () => {
      const dataDir = createTempDir();
      const runId = 'run_resume_interrupted';
      const executedSteps = [];

      const stepFns = {
        inspire: async () => {
          executedSteps.push('inspire');
          return { status: 'completed' };
        },
        mine: async () => {
          executedSteps.push('mine');
          return { status: 'completed' };
        },
        keywordReview: async () => {
          executedSteps.push('keywordReview');
          return { status: 'completed' };
        },
        select: async () => {
          executedSteps.push('select');
          return { status: 'completed' };
        },
        generate: async () => {
          executedSteps.push('generate');
          return { status: 'completed' };
        },
        export: async () => {
          executedSteps.push('export');
          return { status: 'completed' };
        }
      };

      // 1. Partial run stops after inspire
      await runPipelineRuntime({
        dataDir,
        runId,
        mode: 'daily',
        stopAfterStep: 'inspire',
        stepFns
      });
      assert.deepEqual(executedSteps, ['inspire']);

      // 2. Simulate process crash while in mine step
      updateRuntimeState({
        dataDir,
        runId,
        patch: {
          activeStep: 'mine',
          status: 'running',
          progress: {
            mine: { status: 'running', percent: 50, message: '正在挖掘' }
          }
        }
      });

      // 3. Auto recover when read with autoRecover: true
      const healedState = readRuntimeState({
        dataDir,
        runId,
        autoRecover: true
      });
      // The test process is alive, so let's call recoverRuntimeState with simulated dead pid
      const recovery = recoverRuntimeState({
        dataDir,
        runId,
        isAliveFn: () => false
      });
      assert.equal(recovery.recovered, true);
      assert.equal(recovery.runtime.status, 'interrupted');

      // 4. Resume from interrupted step using runPipelineRuntime
      const resumed = await runPipelineRuntime({
        dataDir,
        runId,
        mode: 'daily',
        preserveRuntime: true,
        resumeFromStep: recovery.runtime.activeStep,
        stepFns
      });

      assert.equal(resumed.runtimeStatus, 'completed');
      assert.deepEqual(executedSteps, [
        'inspire', // initial run
        'mine', 'keywordReview', 'select', 'generate', 'export' // resumed from mine
      ]);

      const finalRuntime = readRuntimeState({ dataDir, runId });
      assert.equal(finalRuntime.status, 'completed');
      assert.equal(finalRuntime.attempt, 2, 'Attempt should be bumped to 2 on resumption');
      assert.ok(finalRuntime.revision > 5, 'Revision should increase monotonically');
    });
  });

  describe('CLI Workflow Resume Command Integration', () => {
    it('returns error JSON when resuming a non-existent runId', () => {
      const cliPath = path.join(__dirname, '../../../bin/cli.js');
      try {
        execFileSync(process.execPath, [cliPath, 'workflow', 'resume', '--run', 'missing_run_xyz', '--json'], {
          encoding: 'utf8'
        });
        assert.fail('Expected CLI to exit with non-zero code');
      } catch (err) {
        assert.equal(err.status, 1);
        const stdout = JSON.parse(err.stdout);
        assert.equal(stdout.ok, false);
        assert.equal(stdout.runId, 'missing_run_xyz');
        assert.equal(stdout.status, 'workflow_resume_failed');
        assert.match(stdout.error, /未找到运行记录/);
      }
    });

    it('successfully resumes interrupted run from active step via CLI command', () => {
      const dataDir = createTempDir();
      const runId = 'cli_resume_export_run';
      const cliPath = path.join(__dirname, '../../../bin/cli.js');

      // Initialize run and runtime state stopped at export
      const { run } = initRun({ dataDir, runId });
      initRuntimeState({ dataDir, runId, steps: ['export'] });
      updateRuntimeState({
        dataDir,
        runId,
        patch: {
          activeStep: 'export',
          pid: 99999999, // dead pid
          status: 'running'
        }
      });

      appendJsonl(run.files.generatedProducts, [{
        status: 'generated',
        keyword: '纯银项链',
        sycmCategoryEvidence: {
          source: 'sycm',
          queryWord: '纯银项链',
          recommended: '饰品 > 项链',
          candidates: [{ category: '饰品 > 项链', clickRatio: 0.8 }]
        },
        url: 'https://detail.1688.com/offer/1234567890.html',
        title: '纯银项链女锁骨链高级感百搭小众设计吊坠时尚轻奢气质颈链送女友生日礼物',
        product: { categoryName: '饰品 > 项链' }
      }]);

      const output = execFileSync(
        process.execPath,
        [cliPath, 'workflow', 'resume', '--run', runId, '--data-dir', dataDir, '--json'],
        { encoding: 'utf8' }
      );

      const parsed = JSON.parse(output);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.runId, runId);
      assert.equal(parsed.status, 'needs_review');

      const resumedRuntime = readRuntimeState({ dataDir, runId });
      assert.equal(resumedRuntime.status, 'needs_review');
      assert.equal(resumedRuntime.progress.export.status, 'completed');
    });

    it('rejects CLI workflow resume when target run is actively running in alive process', () => {
      const dataDir = createTempDir();
      const runId = 'cli_resume_active_conflict';
      const cliPath = path.join(__dirname, '../../../bin/cli.js');

      initRun({ dataDir, runId });
      initRuntimeState({ dataDir, runId, steps: ['mine'] });
      updateRuntimeState({
        dataDir,
        runId,
        patch: {
          pid: process.pid, // currently alive process
          status: 'running',
          activeStep: 'mine'
        }
      });

      try {
        execFileSync(
          process.execPath,
          [cliPath, 'workflow', 'resume', '--run', runId, '--data-dir', dataDir, '--json'],
          { encoding: 'utf8' }
        );
        assert.fail('Expected active run resume to be rejected');
      } catch (err) {
        assert.equal(err.status, 1);
        const stdout = JSON.parse(err.stdout);
        assert.equal(stdout.ok, false);
        assert.equal(stdout.runId, runId);
        assert.equal(stdout.status, 'workflow_resume_failed');
        assert.match(stdout.error, /仍在执行中/);
      }
    });

    it('rejects concurrent CLI workflow resume when execution lease is held', async () => {
      const dataDir = createTempDir();
      const runId = 'cli_resume_lease_conflict';
      const cliPath = path.join(__dirname, '../../../bin/cli.js');

      initRun({ dataDir, runId });
      initRuntimeState({ dataDir, runId, steps: ['mine'] });

      const leaseManager = createWorkbenchLeaseManager({ runtimeDir: path.join(dataDir, 'leases') });
      const lease = await leaseManager.acquire(`run:${runId}`, { timeoutMs: 0 });

      try {
        execFileSync(
          process.execPath,
          [cliPath, 'workflow', 'resume', '--run', runId, '--data-dir', dataDir, '--json'],
          { encoding: 'utf8' }
        );
        assert.fail('Expected concurrent resume to fail due to lease');
      } catch (err) {
        assert.equal(err.status, 1);
        const stdout = JSON.parse(err.stdout);
        assert.equal(stdout.ok, false);
        assert.equal(stdout.runId, runId);
        assert.equal(stdout.status, 'workflow_resume_failed');
        assert.match(stdout.error, /占用中/);
      } finally {
        lease.release();
      }
    });

    it('successfully resumes even if previous crashed process left a zombie lease file', () => {
      const dataDir = createTempDir();
      const runId = 'cli_resume_zombie_lease';
      const cliPath = path.join(__dirname, '../../../bin/cli.js');

      const { run } = initRun({ dataDir, runId });
      initRuntimeState({ dataDir, runId, steps: ['export'] });
      updateRuntimeState({
        dataDir,
        runId,
        patch: {
          activeStep: 'export',
          pid: 99999999, // dead pid
          status: 'running'
        }
      });

      appendJsonl(run.files.generatedProducts, [{
        status: 'generated',
        keyword: '纯银项链',
        sycmCategoryEvidence: {
          source: 'sycm',
          queryWord: '纯银项链',
          recommended: '饰品 > 项链',
          candidates: [{ category: '饰品 > 项链', clickRatio: 0.8 }]
        },
        url: 'https://detail.1688.com/offer/1234567890.html',
        title: '纯银项链女锁骨链高级感百搭小众设计吊坠时尚轻奢气质颈链送女友生日礼物',
        product: { categoryName: '饰品 > 项链' }
      }]);

      // Manually leave a stale/zombie lease file from a crashed process
      const leaseManager = createWorkbenchLeaseManager({ runtimeDir: path.join(dataDir, 'leases') });
      const leaseFile = leaseManager.getLeasePath(`run:${runId}`);
      fs.mkdirSync(path.dirname(leaseFile), { recursive: true });
      fs.writeFileSync(leaseFile, JSON.stringify({ pid: 99999999, ownerToken: 'dead_token_crashed' }));

      const output = execFileSync(
        process.execPath,
        [cliPath, 'workflow', 'resume', '--run', runId, '--data-dir', dataDir, '--json'],
        { encoding: 'utf8' }
      );

      const parsed = JSON.parse(output);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.runId, runId);
      assert.equal(parsed.status, 'needs_review');
    });
  });

  describe('Event Consistency Verification (verifyEventConsistency)', () => {
    it('validates intact chronological event streams', () => {
      const dataDir = createTempDir();
      const runId = 'run_event_valid';
      initRuntimeState({ dataDir, runId, steps: ['mine'] });

      appendRuntimeEvent({
        dataDir,
        runId,
        event: { event: 'status', status: 'running', step: 'mine', timestamp: '2026-11-02T10:00:00.000Z' }
      });
      appendRuntimeEvent({
        dataDir,
        runId,
        event: { event: 'progress', step: 'mine', percent: 50, timestamp: '2026-11-02T10:01:00.000Z' }
      });
      appendRuntimeEvent({
        dataDir,
        runId,
        event: { event: 'status', status: 'completed', step: 'mine', timestamp: '2026-11-02T10:02:00.000Z' }
      });

      const report = verifyEventConsistency({ dataDir, runId });
      assert.equal(report.ok, true);
      assert.equal(report.eventCount, 3);
      assert.equal(report.issues.length, 0);
    });

    it('detects mismatched runId and timestamp regression', () => {
      const dataDir = createTempDir();
      const runId = 'run_event_invalid';
      initRuntimeState({ dataDir, runId, steps: ['mine'] });

      appendRuntimeEvent({
        dataDir,
        runId,
        event: { event: 'status', status: 'running', timestamp: '2026-11-02T10:05:00.000Z' }
      });
      // Event with regressed timestamp (older by 10 minutes)
      appendRuntimeEvent({
        dataDir,
        runId,
        event: { event: 'progress', percent: 50, timestamp: '2026-11-02T09:55:00.000Z' }
      });
      // Event with foreign runId
      appendRuntimeEvent({
        dataDir,
        runId,
        event: { runId: 'foreign_run', event: 'progress', percent: 100, timestamp: '2026-11-02T10:06:00.000Z' }
      });

      const report = verifyEventConsistency({ dataDir, runId });
      assert.equal(report.ok, false);
      assert.equal(report.eventCount, 3);
      assert.ok(report.issues.some(i => i.includes('Event timestamp regression')));
      assert.ok(report.issues.some(i => i.includes('mismatched runId')));
    });
  });
});
