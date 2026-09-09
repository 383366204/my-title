'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const { flowExpandRootKeywords } = require('../../../../skills/pipeline-flow/src/root-keyword-expansion-flow');
const { canReuseCandidateSycmEvidence } = require('../../../../skills/pipeline-flow/src/keyword-verification-flow');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'root-keyword-expansion-'));
}

test('root expansion persists every root and merges candidate source roots', async () => {
  const dataDir = tempDataDir();
  const calls = [];
  const result = await flowExpandRootKeywords({
    dataDir,
    runId: 'root_expand',
    rootsText: '杯垫\n胡桃木\n杯垫',
    sycmExtractor: async root => {
      calls.push(root);
      return {
        data: [{ keyword: '胡桃木杯垫', searchPopularity: 1200, demandSupplyRatio: 2.4, conversionRate: '3%' }],
        categoryAnalysis: { recommendation: { recommended: { category: '家居用品 > 杯垫' } } }
      };
    }
  });

  assert.deepEqual(calls, ['杯垫', '胡桃木']);
  assert.equal(result.status, 'mined');
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].sourceRoots, ['杯垫', '胡桃木']);
  const runDir = path.join(dataDir, 'runs', 'root_expand');
  const queue = JSON.parse(fs.readFileSync(path.join(runDir, 'root-query-queue.json'), 'utf8'));
  assert.deepEqual(queue.items.map(item => item.status), ['completed', 'completed']);
});

test('root expansion resumes after a platform blocker without repeating completed roots', async () => {
  const dataDir = tempDataDir();
  const firstCalls = [];
  const first = await flowExpandRootKeywords({
    dataDir,
    runId: 'root_resume',
    roots: ['收纳', '露营'],
    sycmExtractor: async root => {
      firstCalls.push(root);
      if (root === '露营') {
        const error = new Error('生意参谋登录态已失效');
        error.status = 'login_required';
        error.details = { status: 'login_required', userMessage: '请登录' };
        throw error;
      }
      return { data: [{ keyword: '桌面收纳盒', searchPopularity: 800, demandSupplyRatio: 2 }] };
    }
  });
  assert.equal(first.status, 'mining_manual_action_required');
  assert.deepEqual(firstCalls, ['收纳', '露营']);

  const secondCalls = [];
  const second = await flowExpandRootKeywords({
    dataDir,
    runId: 'root_resume',
    roots: ['收纳', '露营'],
    sycmExtractor: async root => {
      secondCalls.push(root);
      return { data: [{ keyword: '户外露营灯', searchPopularity: 900, demandSupplyRatio: 1.8 }] };
    }
  });

  assert.equal(second.status, 'mined');
  assert.deepEqual(secondCalls, ['露营']);
  assert.equal(second.candidates.length, 2);
});

test('root expansion evidence is reusable only while fresh and keyword-matched', () => {
  const candidate = {
    keyword: '胡桃木杯垫',
    source: 'sycm_root_expansion',
    sycmData: { searchPopularity: 1000 },
    sycmEvidence: { keyword: '胡桃木杯垫', collectedAt: new Date().toISOString() }
  };
  assert.equal(canReuseCandidateSycmEvidence(candidate), true);
  assert.equal(canReuseCandidateSycmEvidence({ ...candidate, sycmEvidence: { ...candidate.sycmEvidence, keyword: '别的词' } }), false);
  assert.equal(canReuseCandidateSycmEvidence({ ...candidate, sycmEvidence: { ...candidate.sycmEvidence, collectedAt: '2020-01-01T00:00:00.000Z' } }), false);
});
