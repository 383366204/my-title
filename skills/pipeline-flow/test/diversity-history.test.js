const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildPipelineDiversityHistory } = require('../src/diversity-history');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value) + '\n', 'utf8');
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n', 'utf8');
}

describe('pipeline diversity history', () => {
  test('indexes keyword families, products, and suppliers across recent runs', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diversity-history-'));
    const runDir = path.join(dataDir, 'runs', 'run-1');
    writeJson(path.join(runDir, 'run.json'), {
      status: 'workflow_complete',
      updatedAt: '2026-07-30T00:00:00.000Z',
      distribution: { status: 'completed', total: 1, confirmed: 1 }
    });
    writeJsonl(path.join(runDir, 'candidates.jsonl'), [{
      keyword: '学生宿舍遮光床帘',
      signature: '床帘|学生|遮光',
      coreProduct: '床帘',
      familyKey: '床帘'
    }]);
    writeJsonl(path.join(runDir, 'generated-products.jsonl'), [{
      keyword: '学生宿舍遮光床帘',
      familyKey: '床帘',
      url: 'https://detail.1688.com/offer/612111949602.html',
      product: {
        '链接原标题': '宿舍学生遮光床帘',
        shopName: '义乌家居厂'
      }
    }]);
    fs.writeFileSync(
      path.join(runDir, 'distribution-batch.txt'),
      'https://detail.1688.com/offer/612111949602.html$$标题$$类目\n',
      'utf8'
    );

    const history = buildPipelineDiversityHistory({
      dataDir,
      now: '2026-07-31T00:00:00.000Z'
    });

    assert.strictEqual(history.stats.runsScanned, 1);
    assert.strictEqual(history.families['family:床帘'].runCount, 1);
    assert.strictEqual(history.offers['offer:612111949602'].status, 'distributed');
    assert.ok(history.suppliers['supplier:义乌家居厂']);
    assert.ok(history.titles['title:宿舍学生遮光床帘']);
  });

  test('does not mark generated-only offers as distributed when absent from the batch', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diversity-history-'));
    const runDir = path.join(dataDir, 'runs', 'run-1');
    writeJson(path.join(runDir, 'run.json'), {
      status: 'workflow_complete',
      updatedAt: '2026-07-30T00:00:00.000Z'
    });
    writeJsonl(path.join(runDir, 'generated-products.jsonl'), [{
      url: 'https://detail.1688.com/offer/612111949602.html',
      product: { '链接原标题': '宿舍学生遮光床帘' }
    }]);
    fs.writeFileSync(path.join(runDir, 'distribution-batch.txt'), '', 'utf8');

    const history = buildPipelineDiversityHistory({ dataDir, now: '2026-07-31T00:00:00.000Z' });
    assert.strictEqual(history.offers['offer:612111949602'].status, 'generated');
  });

  test('uses the completed distribution job items instead of the broader export batch', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diversity-history-'));
    const runId = 'run-1';
    const runDir = path.join(dataDir, 'runs', runId);
    writeJson(path.join(runDir, 'run.json'), {
      status: 'workflow_complete',
      updatedAt: '2026-07-30T00:00:00.000Z'
    });
    writeJsonl(path.join(runDir, 'generated-products.jsonl'), [
      { url: 'https://detail.1688.com/offer/100001.html' },
      { url: 'https://detail.1688.com/offer/100002.html' }
    ]);
    fs.writeFileSync(path.join(runDir, 'distribution-batch.txt'), [
      'https://detail.1688.com/offer/100001.html$$标题一$$类目',
      'https://detail.1688.com/offer/100002.html$$标题二$$类目'
    ].join('\n') + '\n');
    writeJson(path.join(dataDir, 'distribution-runs', `${runId}-distribution.json`), {
      status: 'completed',
      items: [{ url: 'https://detail.1688.com/offer/100001.html' }]
    });

    const history = buildPipelineDiversityHistory({ dataDir, now: '2026-07-31T00:00:00.000Z' });
    assert.strictEqual(history.offers['offer:100001'].status, 'distributed');
    assert.strictEqual(history.offers['offer:100002'].status, 'generated');
  });

  test('counts one entity once per run while retaining observations', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diversity-history-'));
    const runDir = path.join(dataDir, 'runs', 'run-1');
    writeJson(path.join(runDir, 'run.json'), {
      status: 'needs_review',
      updatedAt: '2026-07-30T00:00:00.000Z'
    });
    writeJsonl(path.join(runDir, 'candidates.jsonl'), [
      { keyword: '大学宿舍床帘', coreProduct: '床帘' },
      { keyword: '学生遮光床帘', coreProduct: '床帘' }
    ]);

    const history = buildPipelineDiversityHistory({ dataDir, now: '2026-07-31T00:00:00.000Z' });
    assert.strictEqual(history.families['family:床帘'].runCount, 1);
    assert.strictEqual(history.families['family:床帘'].seenCount, 2);
  });

  test('indexes selected inspiration roots for root and family cooldown', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diversity-history-'));
    const runDir = path.join(dataDir, 'runs', 'run-1');
    writeJson(path.join(runDir, 'run.json'), {
      status: 'mined',
      updatedAt: '2026-07-30T00:00:00.000Z'
    });
    writeJsonl(path.join(runDir, 'root-candidates.jsonl'), [
      { rootKeyword: '收纳盒', coreProduct: '收纳盒', familyKey: '收纳', status: 'selected' },
      { rootKeyword: '桌面摆件', coreProduct: '摆件', familyKey: '摆件', status: 'not_selected' }
    ]);

    const history = buildPipelineDiversityHistory({ dataDir, now: '2026-07-31T00:00:00.000Z' });
    assert.ok(history.keywords['kw:收纳盒']);
    assert.ok(history.families['family:收纳']);
    assert.equal(history.keywords['kw:桌面摆件'], undefined);
  });
});
