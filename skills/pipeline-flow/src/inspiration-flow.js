'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { discoverInspirationRoots } = require('../../keyword-mining/src/inspiration-engine');
const { inspirationModelConfig } = require('../../keyword-mining/src/inspiration-productizer');
const { buildRootQueryPlan } = require('../../keyword-mining/src/root-query-plan');
const { initRun, writeRun } = require('./run-store');

/**
 * 只生成并保存待验证词根，不访问生意参谋；相同配置复用已完成快照。
 * @param {object} options 运行参数及进度回调。
 * @returns {Promise<object>} 独立灵感节点结果。
 */
async function flowDiscoverInspirations(options = {}) {
  const { runDir, run } = initRun({ dataDir: options.dataDir, runId: options.runId, keywordFilter: options.keywordFilter, options: { mode: 'daily' } });
  const config = {
    modelIdentity: inspirationModelConfig(options.llmClient).identity,
    materialBudget: Number(process.env.INSPIRATION_MATERIAL_BUDGET || 48),
    customInputs: options.customInputs, enabledDimensions: options.enabledDimensions,
    rootLimit: options.rootLimit || 8, rootCooldownDays: options.rootCooldownDays ?? 30,
    familyCooldownDays: options.familyCooldownDays ?? 0, useLLM: options.inspirationUseLLM !== false,
    date: options.date || run.startedAt.slice(0, 10), runAttempt: options.runAttempt || run.runId,
    newsFeedUrls: options.newsFeedUrls, newsItems: options.newsItems,
    dictionaryWords: options.dictionaryWords, trendItems: options.trendItems
  };
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');
  const snapshotFile = path.join(runDir, `inspiration-${fingerprint}.json`);
  let snapshot;
  if (fs.existsSync(snapshotFile)) snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
  else {
    try { snapshot = await discoverInspirationRoots({ ...config, llmClient: options.llmClient,
      dataDir: options.keywordDataDir || path.join(process.cwd(), 'data', 'keyword-mining'),
      onProgress: options.onProgress, shouldStop: options.shouldStop,
      onPartial: partial => {
        const file = run.files.inspirationRoots || path.join(runDir, 'inspiration-roots.jsonl');
        fs.writeFileSync(`${file}.tmp`, partial.selectedRoots.map(row => JSON.stringify(row)).join('\n'));
        fs.renameSync(`${file}.tmp`, file);
      },
      batchCacheDir: path.join(runDir, `inspiration-batches-${fingerprint}`)
    }); } catch (error) {
      if (options.shouldStop?.()) return { status: options.shouldStop() === 'cancel' ? 'cancelled' : 'paused', stepIncomplete: true };
      throw error;
    }
    fs.writeFileSync(`${snapshotFile}.tmp`, JSON.stringify(snapshot));
    fs.renameSync(`${snapshotFile}.tmp`, snapshotFile);
  }
  const queryPlan = buildRootQueryPlan(snapshot.selectedRoots);
  run.files.inspirationRoots = path.join(runDir, 'inspiration-roots.jsonl');
  fs.writeFileSync(run.files.inspirationRoots, snapshot.selectedRoots.map(row => JSON.stringify({ ...row,
    keyword: row.rootKeyword, queryVariants: [...new Set(queryPlan.filter(task => task.querySources.some(source => source.originalKeyword === row.rootKeyword)).map(task => task.root))]
  })).join('\n'));
  run.counts.selectedRoots = snapshot.selectedRoots.length;
  run.counts.inspirations = snapshot.inspirations.length;
  run.inspiration = { fingerprint, snapshotFile, queryCount: queryPlan.length };
  run.status = snapshot.selectedRoots.length ? 'inspired' : 'manual_action_required';
  const emptyMessage = '没有生成可用词根，请调整选词方向后重新运行';
  writeRun(runDir, run);
  const shortfall = snapshot.stats?.targetReached === false ? `；未达到目标 ${config.rootLimit} 个，${snapshot.stats.stopReason === 'material_budget_reached' ? '已达到素材处理预算' : '可用素材已处理完'}` : '';
  options.onProgress?.({ current: snapshot.selectedRoots.length, total: config.rootLimit,
    message: snapshot.selectedRoots.length ? `已保存 ${snapshot.selectedRoots.length} 个待验证词根，共 ${queryPlan.length} 个拓词任务${shortfall}` : emptyMessage });
  return { ok: snapshot.selectedRoots.length > 0, runId: run.runId, status: snapshot.selectedRoots.length ? 'inspired' : 'manual_action_required',
    stepIncomplete: !snapshot.selectedRoots.length, blockers: snapshot.selectedRoots.length ? [] : [emptyMessage], roots: snapshot.selectedRoots };
}

module.exports = { flowDiscoverInspirations };
