'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RUN_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const DEFAULT_RUNTIME_DATA_DIR = path.join(process.cwd(), 'data', 'pipeline');

/**
 * Assert that a runtime run id is safe for file-backed storage.
 * @param {string} runId Runtime run id.
 * @returns {void}
 */
function assertRuntimeRunId(runId) {
  if (!RUN_ID_PATTERN.test(String(runId || ''))) {
    throw new Error('Invalid runtime run id');
  }
}

function resolveDataDir(dataDir) {
  return dataDir || DEFAULT_RUNTIME_DATA_DIR;
}

function runDir(dataDir, runId) {
  assertRuntimeRunId(runId);
  return path.join(resolveDataDir(dataDir), 'runs', runId);
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

/**
 * Write JSON atomically using temp file + rename to prevent half-written corruption.
 * @param {string} file Target destination file.
 * @param {*} value Data payload.
 */
function writeJsonAtomic(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmpFile = `${file}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(value, null, 2) + '\n', 'utf8');
    try {
      fs.renameSync(tmpFile, file);
    } catch (renameErr) {
      if (renameErr.code === 'EEXIST' || renameErr.code === 'EPERM') {
        fs.unlinkSync(file);
        fs.renameSync(tmpFile, file);
      } else {
        throw renameErr;
      }
    }
  } catch (err) {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch (_unlinkErr) {}
    throw err;
  }
}

function runtimeFile(dataDir, runId) {
  return path.join(runDir(dataDir, runId), 'runtime.json');
}

function controlFile(dataDir, runId) {
  return path.join(runDir(dataDir, runId), 'runtime-control.json');
}

function eventsFile(dataDir, runId) {
  return path.join(runDir(dataDir, runId), 'workflow-events.jsonl');
}

function createProgress(steps = []) {
  return Object.fromEntries(steps.map(step => [
    step,
    { status: 'idle', current: 0, total: 0, percent: 0, message: '' }
  ]));
}

/**
 * Initialize runtime state files for a workflow run with atomic snapshot and revision tracking.
 * @param {object} options Runtime options.
 * @param {string} [options.dataDir] Pipeline data directory.
 * @param {string} options.runId Runtime run id.
 * @param {string[]} options.steps Ordered runtime steps.
 * @param {string} [options.mode] Runtime mode.
 * @param {object} [options.params] Runtime step parameters.
 * @param {number} [options.attempt=1] Execution attempt counter.
 * @returns {object} Runtime state.
 */
function initRuntimeState({ dataDir, runId, steps = [], mode = '', params = {}, attempt = 1 }) {
  assertRuntimeRunId(runId);
  const now = new Date().toISOString();
  const runtime = {
    revision: 1,
    attempt: Number.isInteger(attempt) && attempt > 0 ? attempt : 1,
    pid: process.pid,
    status: 'running',
    activeStep: steps[0] || '',
    requestedAction: null,
    mode,
    params: params && typeof params === 'object' ? { ...params } : {},
    steps,
    progress: createProgress(steps),
    startedAt: now,
    updatedAt: now
  };

  writeJsonAtomic(runtimeFile(dataDir, runId), runtime);
  writeJsonAtomic(controlFile(dataDir, runId), { revision: 1, requestedAction: null, updatedAt: now });
  return runtime;
}

/**
 * Read runtime state for a workflow run.
 * @param {object} options Runtime options.
 * @param {string} [options.dataDir] Pipeline data directory.
 * @param {string} options.runId Runtime run id.
 * @param {boolean} [options.autoRecover=true] Auto-recover if process terminated unexpectedly.
 * @param {function} [options.isAliveFn=isPidAlive] Process liveness tester.
 * @returns {object|null} Runtime state when present.
 */
function readRuntimeState({ dataDir, runId, autoRecover = true, isAliveFn = isPidAlive } = {}) {
  if (autoRecover) {
    const recoveryResult = recoverRuntimeState({ dataDir, runId, isAliveFn });
    if (recoveryResult.recovered) {
      return recoveryResult.runtime;
    }
  }
  return readJson(runtimeFile(dataDir, runId), null);
}

/**
 * Merge a runtime state patch into the current runtime state atomically with revision increment.
 * @param {object} options Runtime options.
 * @param {string} [options.dataDir] Pipeline data directory.
 * @param {string} options.runId Runtime run id.
 * @param {object} options.patch Runtime state patch.
 * @param {number} [options.expectedRevision] Expected revision for optimistic locking.
 * @returns {object} Updated runtime state.
 */
function updateRuntimeState({ dataDir, runId, patch = {}, expectedRevision }) {
  assertRuntimeRunId(runId);
  const current = readRuntimeState({ dataDir, runId, autoRecover: false }) || {};
  const curRev = Number.isInteger(current.revision) ? current.revision : 0;
  if (expectedRevision !== undefined && curRev !== expectedRevision) {
    const err = new Error(`Runtime revision conflict for run ${runId}: expected revision ${expectedRevision}, found ${curRev}`);
    err.code = 'REVISION_CONFLICT';
    err.expectedRevision = expectedRevision;
    err.actualRevision = curRev;
    throw err;
  }

  const nextRevision = curRev + 1;
  const nextAttempt = patch.attempt !== undefined
    ? patch.attempt
    : (patch.incrementAttempt ? (current.attempt || 1) + 1 : (current.attempt || 1));

  const next = {
    ...current,
    pid: process.pid,
    ...patch,
    revision: nextRevision,
    attempt: nextAttempt,
    progress: {
      ...(current.progress || {}),
      ...(patch.progress || {})
    },
    updatedAt: new Date().toISOString()
  };
  delete next.incrementAttempt;

  writeJsonAtomic(runtimeFile(dataDir, runId), next);
  return next;
}

/**
 * Persist a runtime cancellation request.
 * @param {object} options Runtime options.
 * @param {string} [options.dataDir] Pipeline data directory.
 * @param {string} options.runId Runtime run id.
 * @param {string} [options.reason] Cancel reason.
 * @returns {object} Runtime control state.
 */
function requestRuntimeCancel({ dataDir, runId, reason = 'user_cancelled' }) {
  return writeRuntimeControl({
    dataDir,
    runId,
    control: { requestedAction: 'cancel', reason }
  });
}

function writeRuntimeControl({ dataDir, runId, control = {} }) {
  assertRuntimeRunId(runId);
  const current = readRuntimeControl({ dataDir, runId }) || {};
  const curRev = Number.isInteger(current.revision) ? current.revision : 0;
  const next = {
    revision: curRev + 1,
    requestedAction: control.requestedAction || null,
    updatedAt: new Date().toISOString()
  };
  if (control.reason) next.reason = control.reason;
  if (control.step) next.step = control.step;
  writeJsonAtomic(controlFile(dataDir, runId), next);
  return next;
}

function requestRuntimePause({ dataDir, runId, reason = 'user_paused' }) {
  return writeRuntimeControl({
    dataDir,
    runId,
    control: { requestedAction: 'pause', reason }
  });
}

function requestRuntimeResume({ dataDir, runId, reason = 'user_resumed' }) {
  return writeRuntimeControl({
    dataDir,
    runId,
    control: { requestedAction: 'resume', reason }
  });
}

function requestRuntimeRetryStep({ dataDir, runId, step, reason = 'user_retry_step' }) {
  if (!step) throw new Error('retry step is required');
  return writeRuntimeControl({
    dataDir,
    runId,
    control: { requestedAction: 'retry-step', step, reason }
  });
}

function clearRuntimeControl({ dataDir, runId }) {
  return writeRuntimeControl({
    dataDir,
    runId,
    control: { requestedAction: null }
  });
}

/**
 * Read runtime control state.
 * @param {object} options Runtime options.
 * @param {string} [options.dataDir] Pipeline data directory.
 * @param {string} options.runId Runtime run id.
 * @returns {object} Runtime control state.
 */
function readRuntimeControl({ dataDir, runId }) {
  return readJson(controlFile(dataDir, runId), { requestedAction: null });
}

/**
 * Append a workflow event to the runtime JSONL event log.
 * @param {object} options Runtime options.
 * @param {string} [options.dataDir] Pipeline data directory.
 * @param {string} options.runId Runtime run id.
 * @param {object} options.event Event payload.
 * @returns {object} Event payload with runtime metadata.
 */
function appendRuntimeEvent({ dataDir, runId, event = {} }) {
  assertRuntimeRunId(runId);
  const current = readRuntimeState({ dataDir, runId, autoRecover: false });
  const file = eventsFile(dataDir, runId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = {
    eventId: event.eventId || `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    timestamp: event.timestamp || new Date().toISOString(),
    runId,
    revision: event.revision !== undefined ? event.revision : (current?.revision ?? null),
    attempt: event.attempt !== undefined ? event.attempt : (current?.attempt ?? null),
    ...event
  };

  fs.appendFileSync(file, JSON.stringify(payload) + '\n', 'utf8');
  return payload;
}

/**
 * Read ordered workflow runtime events.
 * @param {object} options Runtime options.
 * @param {string} [options.dataDir] Pipeline data directory.
 * @param {string} options.runId Runtime run id.
 * @returns {object[]} Runtime events.
 */
function readRuntimeEvents({ dataDir, runId }) {
  const file = eventsFile(dataDir, runId);
  if (!fs.existsSync(file)) return [];
  const events = [];
  fs.readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(Boolean)
    .forEach(line => {
      try {
        events.push(JSON.parse(line));
      } catch (_error) {
        // workflow-events.jsonl can be tailed while written; skip malformed rows.
      }
    });
  return events;
}

/**
 * Test whether a process ID is currently running on the host.
 * @param {number} pid Process ID.
 * @returns {boolean} True if process exists.
 */
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/**
 * Safely recover runtime state if the recording execution process terminated unexpectedly.
 * @param {object} options Recovery options.
 * @param {string} [options.dataDir] Pipeline data directory.
 * @param {string} options.runId Runtime run id.
 * @param {function} [options.isAliveFn=isPidAlive] Process liveness tester.
 * @param {function} [options.now] Timestamp provider.
 * @returns {{ recovered: boolean, runtime: object|null, reason: string }} Recovery result.
 */
function recoverRuntimeState({
  dataDir,
  runId,
  isAliveFn = isPidAlive,
  now = () => new Date().toISOString()
} = {}) {
  assertRuntimeRunId(runId);
  const current = readRuntimeState({ dataDir, runId, autoRecover: false });
  if (!current) return { recovered: false, runtime: null, reason: 'not_found' };

  const activeStatuses = ['running', 'resuming', 'retrying'];
  if (!activeStatuses.includes(current.status)) {
    return { recovered: false, runtime: current, reason: 'not_active' };
  }

  const recordedPid = current.pid;
  if (!Number.isInteger(recordedPid) || recordedPid <= 0) {
    return { recovered: false, runtime: current, reason: 'no_pid' };
  }
  const alive = isAliveFn(recordedPid);
  if (alive) {
    return { recovered: false, runtime: current, reason: 'process_alive' };
  }

  // Process is dead, perform crash recovery transition
  const activeStep = current.activeStep || (current.steps && current.steps[0]) || '';
  const updatedProgress = { ...(current.progress || {}) };
  if (activeStep && updatedProgress[activeStep]) {
    updatedProgress[activeStep] = {
      ...updatedProgress[activeStep],
      status: 'interrupted',
      message: '执行进程异常中断'
    };
  }

  const recoveredTime = now();
  const nextRevision = (Number.isInteger(current.revision) ? current.revision : 0) + 1;
  const recoveredRuntime = {
    ...current,
    status: 'interrupted',
    interruptedAt: recoveredTime,
    interruptedReason: 'process_terminated_unexpectedly',
    error: current.error || '流程执行进程异常退出，状态已安全恢复，可手动点击恢复继续执行。',
    progress: updatedProgress,
    revision: nextRevision,
    updatedAt: recoveredTime
  };

  writeJsonAtomic(runtimeFile(dataDir, runId), recoveredRuntime);

  appendRuntimeEvent({
    dataDir,
    runId,
    event: {
      event: 'interrupted',
      step: activeStep,
      previousStatus: current.status,
      reason: 'process_terminated_unexpectedly',
      deadPid: recordedPid,
      revision: nextRevision,
      attempt: current.attempt || 1,
      timestamp: recoveredTime
    }
  });

  return { recovered: true, runtime: recoveredRuntime, reason: 'recovered_from_crash' };
}

/**
 * Verify event log consistency against runtime state.
 * @param {object} options Verification options.
 * @param {string} [options.dataDir] Pipeline data directory.
 * @param {string} options.runId Runtime run id.
 * @returns {{ ok: boolean, eventCount: number, issues: string[] }} Consistency report.
 */
function verifyEventConsistency({ dataDir, runId }) {
  assertRuntimeRunId(runId);
  const events = readRuntimeEvents({ dataDir, runId });
  const runtime = readRuntimeState({ dataDir, runId, autoRecover: false });
  const issues = [];

  if (!events.length) {
    if (runtime) issues.push('No events found for existing runtime');
    return { ok: issues.length === 0, eventCount: 0, issues };
  }

  let prevTime = 0;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.runId && ev.runId !== runId) {
      issues.push(`Event at index ${i} has mismatched runId: expected ${runId}, found ${ev.runId}`);
    }
    const timeMs = new Date(ev.timestamp || 0).getTime();
    if (isNaN(timeMs)) {
      issues.push(`Event at index ${i} has invalid timestamp: ${ev.timestamp}`);
    } else if (prevTime > 0 && timeMs < prevTime - 1000) {
      issues.push(`Event timestamp regression at index ${i}: ${ev.timestamp} < previous ${new Date(prevTime).toISOString()}`);
    }
    if (timeMs > prevTime) prevTime = timeMs;
  }

  return {
    ok: issues.length === 0,
    eventCount: events.length,
    issues
  };
}

module.exports = {
  initRuntimeState,
  readRuntimeState,
  updateRuntimeState,
  requestRuntimeCancel,
  requestRuntimePause,
  requestRuntimeResume,
  requestRuntimeRetryStep,
  clearRuntimeControl,
  readRuntimeControl,
  appendRuntimeEvent,
  readRuntimeEvents,
  assertRuntimeRunId,
  writeJsonAtomic,
  isPidAlive,
  recoverRuntimeState,
  verifyEventConsistency
};
