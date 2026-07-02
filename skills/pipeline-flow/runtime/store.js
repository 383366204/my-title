'use strict';

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

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
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
 * Initialize runtime state files for a workflow run.
 * @param {object} options Runtime options.
 * @param {string} [options.dataDir] Pipeline data directory.
 * @param {string} options.runId Runtime run id.
 * @param {string[]} options.steps Ordered runtime steps.
 * @returns {object} Runtime state.
 */
function initRuntimeState({ dataDir, runId, steps = [] }) {
  const now = new Date().toISOString();
  const runtime = {
    status: 'running',
    activeStep: steps[0] || '',
    requestedAction: null,
    steps,
    progress: createProgress(steps),
    startedAt: now,
    updatedAt: now
  };

  writeJson(runtimeFile(dataDir, runId), runtime);
  writeJson(controlFile(dataDir, runId), { requestedAction: null, updatedAt: now });
  return runtime;
}

/**
 * Read runtime state for a workflow run.
 * @param {object} options Runtime options.
 * @param {string} [options.dataDir] Pipeline data directory.
 * @param {string} options.runId Runtime run id.
 * @returns {object|null} Runtime state when present.
 */
function readRuntimeState({ dataDir, runId }) {
  return readJson(runtimeFile(dataDir, runId), null);
}

/**
 * Merge a runtime state patch into the current runtime state.
 * @param {object} options Runtime options.
 * @param {string} [options.dataDir] Pipeline data directory.
 * @param {string} options.runId Runtime run id.
 * @param {object} options.patch Runtime state patch.
 * @returns {object} Updated runtime state.
 */
function updateRuntimeState({ dataDir, runId, patch = {} }) {
  const current = readRuntimeState({ dataDir, runId }) || {};
  const next = {
    ...current,
    ...patch,
    progress: {
      ...(current.progress || {}),
      ...(patch.progress || {})
    },
    updatedAt: new Date().toISOString()
  };

  writeJson(runtimeFile(dataDir, runId), next);
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
  const control = {
    requestedAction: 'cancel',
    reason,
    updatedAt: new Date().toISOString()
  };

  writeJson(controlFile(dataDir, runId), control);
  return control;
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
  const file = eventsFile(dataDir, runId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = {
    ...event,
    timestamp: event.timestamp || new Date().toISOString(),
    runId
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

module.exports = {
  initRuntimeState,
  readRuntimeState,
  updateRuntimeState,
  requestRuntimeCancel,
  readRuntimeControl,
  appendRuntimeEvent,
  readRuntimeEvents,
  assertRuntimeRunId
};
