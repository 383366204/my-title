'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  runPeerExtractStep,
  runPeerSimilarStep,
  runPeerCollectionStep
} = require('../../../../skills/peer-discovery/src/collection-runtime-step');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  runPipelineRuntime,
  getPeerSteps,
  PEER_DISCOVERY_STEPS,
  PEER_IMAGE_SELECTION_STEPS
} = require('../../../../skills/pipeline-flow/runtime/runner');
const { readRuntimeState } = require('../../../../skills/pipeline-flow/runtime/store');

test('partial collection is an existing runtime blocking status', async () => {
  const result = await runPeerCollectionStep({ collect: async () => ({ status: 'needs_attention', products: [1] }) });
  assert.equal(result.status, 'manual_action_required');
  assert.equal(result.stepIncomplete, true);
  assert.deepEqual(result.products, [1]);
});

test('pause before work avoids collection and pause during work preserves incomplete state', async () => {
  let calls = 0;
  assert.equal((await runPeerCollectionStep({ shouldStop: () => 'pause', collect: async () => calls++ })).status, 'paused');
  assert.equal(calls, 0);
  let action = null;
  const result = await runPeerCollectionStep({ shouldStop: () => action, collect: async () => { action = 'pause'; return { status: 'completed' }; } });
  assert.equal(result.status, 'paused');
  assert.equal(result.stepIncomplete, true);
});

test('platform blockers remain actionable, unexpected errors are not swallowed', async () => {
  for (const error of [
    Object.assign(new Error('请登录淘宝'), { code: 'PLATFORM_ACCESS_BLOCKED', status: 'login_required' }),
    Object.assign(new Error('客户端不支持图搜'), { code: 'capability_unavailable', status: 'capability_unavailable' }),
    Object.assign(new Error('会话排队超时'), { code: 'PLATFORM_ACCESS_LOCK_TIMEOUT', status: 'rate_limited' }),
    Object.assign(new Error('需要滑块验证'), { name: 'PlatformAccessError', status: 'captcha_required' }),
  ]) {
    const result = await runPeerCollectionStep({ collect: async () => { throw error; } });
    assert.equal(result.status, 'manual_action_required');
    assert.equal(result.platformStatus, error.status);
    assert.equal(result.manualAction.userMessage, error.message);
  }
  await assert.rejects(() => runPeerCollectionStep({ collect: async () => { throw new Error('disk failure'); } }), /disk failure/);
});

test('registered collection node executes through the real runtime without platform requests for an empty candidate set', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-runtime-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const result = await runPipelineRuntime({ dataDir, runId: 'peer_test', mode: 'peer-discovery',
    steps: ['collectPeerProducts'], params: { peerShops: [], resolvedTaobaoChannel: 'web', discoveryBranch: 'image-selection' } });
  assert.equal(result.status, 'completed');
  assert.equal(result.eligibleCount, 0);
  assert.equal(readRuntimeState({ dataDir, runId: 'peer_test' }).progress.collectPeerProducts.status, 'completed');
});

test('runPeerExtractStep adapts extraction and maps platform blockers', async () => {
  const normal = await runPeerExtractStep({
    extract: async () => ({ ok: true, sourceProducts: [{ itemId: '101' }], total: 1, validCount: 1, errors: [] })
  });
  assert.equal(normal.status, 'completed');
  assert.equal(normal.sourceProducts.length, 1);

  // pause
  const paused = await runPeerExtractStep({
    shouldStop: () => 'pause',
    extract: async () => ({ ok: true })
  });
  assert.equal(paused.status, 'paused');
  assert.equal(paused.stepIncomplete, true);

  // platform blocker
  const blocked = await runPeerExtractStep({
    extract: async () => {
      throw Object.assign(new Error('滑块拦截'), { code: 'PLATFORM_ACCESS_BLOCKED', status: 'captcha_required' });
    }
  });
  assert.equal(blocked.status, 'manual_action_required');
  assert.equal(blocked.platformStatus, 'captcha_required');
});

test('extraction uses the real products contract and stops failed extraction', async () => {
  const success = await runPeerExtractStep({ extract: async () => ({ ok: true, products: [{ itemId: '101' }], totalValid: 1 }) });
  assert.equal(success.validCount, 1);
  assert.equal(success.sourceProducts[0].itemId, '101');
  const failed = await runPeerExtractStep({ extract: async () => ({ ok: false, products: [], errors: [{ message: '无法从链接中识别商品ID' }] }) });
  assert.equal(failed.status, 'manual_action_required');
  assert.equal(failed.stepIncomplete, true);
  assert.match(failed.manualAction.userMessage, /商品ID/);
  const missing = await runPeerSimilarStep({ find: async () => ({ ok: false, errors: [{ message: '缺少源商品数据' }] }) });
  assert.equal(missing.status, 'manual_action_required');
});

test('runPeerSimilarStep adapts findSimilar and maps platform blockers', async () => {
  const normal = await runPeerSimilarStep({
    find: async () => ({ ok: true, candidates: [{ shopKey: 'shop_a' }], similarProducts: [{}], errors: [] })
  });
  assert.equal(normal.status, 'completed');
  assert.equal(normal.candidates.length, 1);
  assert.equal(normal.candidateCount, 1);

  // cancel
  const cancelled = await runPeerSimilarStep({
    shouldStop: () => 'cancel',
    find: async () => ({ ok: true })
  });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.stepIncomplete, true);

  // platform error
  const blocked = await runPeerSimilarStep({
    find: async () => {
      throw Object.assign(new Error('登录过期'), { code: 'PLATFORM_ACCESS_BLOCKED', status: 'login_required' });
    }
  });
  assert.equal(blocked.status, 'manual_action_required');
  assert.equal(blocked.platformStatus, 'login_required');
});

test('runPeerCollectionStep reads candidate-shops.jsonl from runDir when shops option is omitted', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-col-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  await fs.writeFile(path.join(tempDir, 'candidate-shops.jsonl'), JSON.stringify({ shopKey: 's1', shopUrl: 'https://shop.taobao.com' }) + '\n');
  let receivedShops = null;
  const result = await runPeerCollectionStep({
    runDir: tempDir,
    params: { resolvedTaobaoChannel: 'web' },
    collect: async (opts) => {
      receivedShops = opts.shops;
      return { status: 'completed' };
    }
  });
  assert.equal(result.status, 'completed');
  assert.deepEqual(receivedShops, [{ shopKey: 's1', shopUrl: 'https://shop.taobao.com' }]);
});

test('getPeerSteps returns appropriate steps for each discoveryBranch', () => {
  assert.deepEqual(getPeerSteps({ discoveryBranch: 'peer-analysis' }), PEER_DISCOVERY_STEPS);
  assert.deepEqual(getPeerSteps({}), PEER_DISCOVERY_STEPS);
  assert.deepEqual(getPeerSteps({ discoveryBranch: 'image-selection' }), PEER_IMAGE_SELECTION_STEPS);
});
