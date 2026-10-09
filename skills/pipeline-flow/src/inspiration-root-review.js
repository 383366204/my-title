'use strict';

const fs = require('fs');
const { createHash } = require('crypto');
const { getRun, readJsonl, writeRun } = require('./run-store');
const { readRuntimeState } = require('../runtime/store');
const { normalizeRootKeywords } = require('../../../core/root-keywords');

/**
 * @param {object} options 运行标识与数据目录。
 * @returns {object} 可编辑状态与乐观锁版本。
 */
function inspirationReviewState(options) {
  const { run } = getRun(options);
  const runtime = readRuntimeState(options);
  const file = run.files.inspirationRoots;
  const text = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  return {
    editable: Boolean(file && runtime?.status === 'paused' && runtime.activeStep === 'mine'
      && runtime.progress?.inspire?.status === 'completed'
      && runtime.progress?.mine?.status === 'idle'
      && !(run.files.rootQueryQueue && fs.existsSync(run.files.rootQueryQueue))),
    revision: createHash('sha256').update(text).digest('hex')
  };
}

/**
 * @param {object} options 运行标识、词根文本和读取版本。
 * @returns {object} 保存后的词根和版本。
 */
function saveInspirationRoots(options) {
  const state = inspirationReviewState(options);
  if (!state.editable) throw new Error('只能在首次生意参谋拓词前暂停修改词根');
  if (options.revision !== state.revision) throw new Error('词根已更新，请重新打开后修改');
  const { roots } = normalizeRootKeywords(options.rootsText);
  if (!roots.length) throw new Error('请至少保留一个词根');
  const { run, runDir } = getRun(options);
  const previous = new Map(readJsonl(run.files.inspirationRoots).map(row => [row.rootKeyword, row]));
  const rows = roots.map(root => previous.get(root) || {
    rootKeyword: root, keyword: root, queryVariants: [root], source: 'manual',
    relationReason: '人工补充词根，尚未验证'
  });
  const temporary = `${run.files.inspirationRoots}.tmp`;
  fs.writeFileSync(temporary, rows.map(row => JSON.stringify(row)).join('\n'));
  fs.renameSync(temporary, run.files.inspirationRoots);
  run.counts.selectedRoots = rows.length;
  run.inspiration = { ...run.inspiration, editedAt: new Date().toISOString() };
  writeRun(runDir, run);
  return { rows, ...inspirationReviewState(options) };
}

module.exports = { inspirationReviewState, saveInspirationRoots };
