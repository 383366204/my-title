'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * 持锁失效下游权威状态，成功提交后顺序清理派生文件。
 * @param {object} store 同行状态存储。
 * @param {string} runDir 运行目录。
 * @param {object} details 节点状态及原因，未指定状态时默认阻塞。
 * @param {string} step 发起失效的节点。
 * @returns {Promise<object>} 提交后的权威状态。
 */
async function invalidateDownstreamState(store, runDir, details = {}, step = 'verifyImageSources') {
  return store.withLock(async () => {
    const current = await store.read();
    const updated = await store.transact(current.revision, draft => {
      draft.bundle = null;
      delete draft.allocationPlan;
      draft.checkpoints[step] = { status: 'blocked', ...details };
      if (step === 'verifyImageSources') delete draft.checkpoints.prepareListingDrafts;
    });
    // 持锁清理，避免删掉并发复核刚发布的新视图。
    await fs.rm(path.join(runDir, 'peer-allocation-plan.json'), { force: true });
    await fs.rm(path.join(runDir, 'peer-listing-drafts.jsonl'), { force: true });
    return updated;
  });
}

module.exports = { invalidateDownstreamState };
