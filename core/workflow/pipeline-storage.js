'use strict';

const fs = require('fs');
const path = require('path');
const DEFAULT_PIPELINE_DIR = require('../pipeline-run-summary').DEFAULT_PIPELINE_DIR;
const { WORKFLOW_RUN_ID_PATTERN } = require('./pipeline-definition-common');

function assertSafeWorkflowRunId(runId) {
  if (!WORKFLOW_RUN_ID_PATTERN.test(String(runId || ''))) {
    throw new Error('Invalid workflow run id');
  }
}

function workflowRunDir(dataDir, runId) {
  assertSafeWorkflowRunId(runId);
  return path.join(dataDir || DEFAULT_PIPELINE_DIR, 'runs', runId);
}

/**
 * 写入 workflow 画布定义快照。
 * @param {object} options 写入参数。
 * @param {string} [options.dataDir] pipeline 数据目录。
 * @param {string} options.runId pipeline runId。
 * @param {object} options.definition workflow 定义。
 * @returns {string} 写入的文件路径。
 */
function writeWorkflowDefinition({ dataDir = DEFAULT_PIPELINE_DIR, runId, definition } = {}) {
  const file = path.join(workflowRunDir(dataDir, runId), 'workflow-definition.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(definition, null, 2), 'utf8');
  return file;
}

/**
 * 读取 workflow 画布定义快照。
 * @param {object} options 读取参数。
 * @param {string} [options.dataDir] pipeline 数据目录。
 * @param {string} options.runId pipeline runId。
 * @returns {object|null} workflow 定义，不存在时返回 null。
 */
function readWorkflowDefinition({ dataDir = DEFAULT_PIPELINE_DIR, runId } = {}) {
  const file = path.join(workflowRunDir(dataDir, runId), 'workflow-definition.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * 追加 workflow 画布事件。
 * @param {object} options 写入参数。
 * @param {string} [options.dataDir] pipeline 数据目录。
 * @param {string} options.runId pipeline runId。
 * @param {object} options.event workflow 事件。
 * @returns {string} 写入的文件路径。
 */
function appendWorkflowEvent({ dataDir = DEFAULT_PIPELINE_DIR, runId, event } = {}) {
  const file = path.join(workflowRunDir(dataDir, runId), 'workflow-events.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8');
  return file;
}

/**
 * 读取 workflow 画布事件。
 * @param {object} options 读取参数。
 * @param {string} [options.dataDir] pipeline 数据目录。
 * @param {string} options.runId pipeline runId。
 * @returns {Array<object>} workflow 事件列表。
 */
function readWorkflowEvents({ dataDir = DEFAULT_PIPELINE_DIR, runId } = {}) {
  const file = path.join(workflowRunDir(dataDir, runId), 'workflow-events.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

/**
 * 删除真实 pipeline workflow run 目录，并在必要时清理 latest 指针。
 * @param {object} options 删除参数。
 * @param {string} [options.dataDir] pipeline 数据目录。
 * @param {string} options.runId pipeline runId。
 * @returns {{ok:boolean,runId:string,deleted:object}} 删除结果。
 */
function deleteWorkflowRun({ dataDir = DEFAULT_PIPELINE_DIR, runId } = {}) {
  assertSafeWorkflowRunId(runId);
  const baseDir = path.resolve(dataDir || DEFAULT_PIPELINE_DIR);
  const runDir = path.resolve(workflowRunDir(baseDir, runId));
  const runsDir = path.resolve(baseDir, 'runs');
  const relative = path.relative(runsDir, runDir);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid workflow run path');
  }

  const existed = fs.existsSync(runDir);
  if (existed) {
    fs.rmSync(runDir, { recursive: true, force: true });
  }

  const latestFile = path.join(baseDir, 'latest.json');
  let latestCleared = false;
  if (fs.existsSync(latestFile)) {
    try {
      const latest = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
      if (latest && latest.runId === runId) {
        fs.rmSync(latestFile, { force: true });
        latestCleared = true;
      }
    } catch (_) {
      // Keep malformed latest.json untouched unless it clearly points to this run.
    }
  }

  return {
    ok: existed,
    runId,
    deleted: {
      pipelineRun: existed,
      latestPointer: latestCleared
    }
  };
}

module.exports = { writeWorkflowDefinition, readWorkflowDefinition, appendWorkflowEvent, readWorkflowEvents, deleteWorkflowRun };
