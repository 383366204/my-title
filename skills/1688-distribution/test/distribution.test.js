const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseItems,
  splitBatches,
  normalizeItemsForInput,
  createBatchHash,
  appendRunRecord,
  findRecentDuplicate,
  checkDistributionReadiness,
  confirmCopyRecords,
  classifyCopyRecordText,
  distributeProducts
} = require('../index');
const { syncSkill } = require('../../../scripts/sync-hermes-skills');

describe('1688 distribution input handling', () => {
  it('parses URL and URL-title rows', () => {
    const items = parseItems([
      'https://detail.1688.com/offer/640322388000.html$$宠物玩具飞盘',
      'https://detail.1688.com/offer/657358172481.html'
    ]);
    assert.equal(items.length, 2);
    assert.equal(items[0].offerId, '640322388000');
    assert.equal(items[0].title, '宠物玩具飞盘');
    assert.equal(items[1].url, 'https://detail.1688.com/offer/657358172481.html');
  });

  it('parses shell-safe title delimiters', () => {
    const items = parseItems([
      'https://detail.1688.com/offer/640322388000.html\t宠物玩具飞盘',
      'https://detail.1688.com/offer/657358172481.html || 毛绒发声玩具',
      'https://detail.1688.com/offer/627246273154.html --title 猫咪铃铛球',
      'https://detail.1688.com/offer/1045606207020.html 标题=狗狗刺球'
    ]);

    assert.equal(items[0].title, '宠物玩具飞盘');
    assert.equal(items[1].title, '毛绒发声玩具');
    assert.equal(items[2].title, '猫咪铃铛球');
    assert.equal(items[3].title, '狗狗刺球');
    assert.equal(normalizeItemsForInput(items).split('\n')[0], 'https://detail.1688.com/offer/640322388000.html$$宠物玩具飞盘');
  });

  it('parses optional category from three-part distribution rows', () => {
    const items = parseItems([
      'https://detail.1688.com/offer/640322388000.html$$宠物玩具飞盘$$宠物用品 > 狗狗玩具',
      'https://detail.1688.com/offer/657358172481.html\t毛绒发声玩具\t宠物用品 > 狗狗玩具',
      'https://detail.1688.com/offer/627246273154.html || 猫咪铃铛球 || 宠物用品 > 猫玩具',
      'https://detail.1688.com/offer/1045606207020.html --title 狗狗刺球 --category 宠物用品 > 狗狗玩具'
    ]);

    assert.equal(items[0].title, '宠物玩具飞盘');
    assert.equal(items[0].category, '宠物用品 > 狗狗玩具');
    assert.equal(items[1].category, '宠物用品 > 狗狗玩具');
    assert.equal(items[2].category, '宠物用品 > 猫玩具');
    assert.equal(items[3].category, '宠物用品 > 狗狗玩具');
    assert.equal(normalizeItemsForInput([items[0]]), 'https://detail.1688.com/offer/640322388000.html$$宠物玩具飞盘$$宠物用品 > 狗狗玩具');
  });

  it('rejects invalid rows before browser automation', () => {
    assert.throws(() => parseItems('https://example.com/item/1'), /Invalid 1688 item/);
  });

  it('splits batches and preserves distribution input format', () => {
    const items = parseItems([
      'https://detail.1688.com/offer/1.html$$A',
      'https://detail.1688.com/offer/2.html$$B',
      'https://detail.1688.com/offer/3.html$$C'
    ]);
    const batches = splitBatches(items, 2);
    assert.equal(batches.length, 2);
    assert.equal(normalizeItemsForInput(batches[0]), 'https://detail.1688.com/offer/1.html$$A\nhttps://detail.1688.com/offer/2.html$$B');
  });

  it('creates stable duplicate hashes', () => {
    const items = parseItems('https://detail.1688.com/offer/640322388000.html$$宠物玩具飞盘');
    assert.equal(createBatchHash(items), createBatchHash(items));
  });

  it('includes category in duplicate hashes', () => {
    const a = parseItems('https://detail.1688.com/offer/640322388000.html$$宠物玩具飞盘$$宠物用品 > 狗狗玩具');
    const b = parseItems('https://detail.1688.com/offer/640322388000.html$$宠物玩具飞盘$$玩具 > 宠物玩具');
    assert.notEqual(createBatchHash(a), createBatchHash(b));
  });

  it('detects recently submitted duplicate batches', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-runs-'));
    const stateFile = path.join(dir, 'runs.jsonl');
    appendRunRecord({
      batchHash: 'abc',
      submittedAt: new Date().toISOString(),
      status: 'submitted'
    }, stateFile);
    assert.equal(findRecentDuplicate('abc', stateFile).batchHash, 'abc');
    assert.equal(findRecentDuplicate('missing', stateFile), undefined);
  });

  it('supports dry-run without connecting to Chrome', async () => {
    const result = await distributeProducts({
      input: 'https://detail.1688.com/offer/640322388000.html$$宠物玩具飞盘',
      dryRun: true
    });
    assert.equal(result.ok, true);
    assert.equal(result.total, 1);
    assert.equal(result.batches[0].dryRun, true);
    assert.equal(result.nextActionCode, 'review_dry_run');
    assert.ok(result.nextAction.includes('--submit'));
  });

  it('requires all offer ids to confirm copy records', async () => {
    const client = {
      async evaluate(expression) {
        if (String(expression).includes('window.__ecom1688.readState')) {
          return { url: 'https://item.jnesoft.com/ali_view/ali_batchLog', body: '复制日志' };
        }
        if (String(expression).includes('const offerIds')) {
          return {
            ok: false,
            status: 'partial_confirmed',
            foundOfferIds: ['640322388000'],
            missingOfferIds: ['657358172481'],
            statusCounts: { copying: 1, success: 0, failed: 0, skipped: 0 },
            preview: '640322388000 复制中',
            url: 'https://item.jnesoft.com/ali_view/ali_batchLog'
          };
        }
        return true;
      }
    };

    const result = await confirmCopyRecords(client, ['640322388000', '657358172481']);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'partial_confirmed');
    assert.deepEqual(result.missingOfferIds, ['657358172481']);
  });

  it('classifies merged batch and single-offer copy-log text', () => {
    const result = classifyCopyRecordText(
      ['640322388000', '657358172481'],
      '全部(2)\n640322388000 复制中\n--- SINGLE SEARCH 657358172481 ---\n657358172481 复制成功',
      { perOfferId: { '640322388000': { source: 'batch' }, '657358172481': { source: 'single' } } }
    );
    assert.equal(result.ok, true);
    assert.equal(result.status, 'confirmed');
    assert.deepEqual(result.missingOfferIds, []);
    assert.equal(result.perOfferId['657358172481'].source, 'single');
  });

  it('checks readiness without browser when requested', async () => {
    const result = await checkDistributionReadiness({
      input: 'https://detail.1688.com/offer/640322388000.html$$宠物玩具飞盘',
      skipBrowser: true
    });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.blockers, []);
    assert.deepEqual(result.allowedCommands, ['rerun_with_submit']);
    assert.ok(result.nextAction.includes('--submit'));
  });

  it('blocks readiness on recent duplicates', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-ready-'));
    const stateFile = path.join(dir, 'runs.jsonl');
    const input = 'https://detail.1688.com/offer/640322388000.html$$宠物玩具飞盘';
    const items = parseItems(input);
    const batchHash = createBatchHash(items);
    appendRunRecord({
      batchHash,
      submittedAt: new Date().toISOString(),
      status: 'submitted'
    }, stateFile);
    const result = await checkDistributionReadiness({ input, stateFile, skipBrowser: true });
    assert.equal(result.ok, false);
    assert.ok(result.blockers.includes('recent_duplicate_batch'));
  });
});

describe('Hermes skill sync', () => {
  it('plans copying real files into Hermes directory without symlink', () => {
    const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-skills-'));
    const plan = syncSkill('1688-distribution', { targetRoot, dryRun: true });
    assert.equal(plan.skillName, '1688-distribution');
    assert.equal(plan.action, 'create');
    assert.ok(plan.source.endsWith(path.join('skills', '1688-distribution')));
    assert.ok(plan.target.startsWith(targetRoot));
  });

  it('writes wrapper skill that points at the live project checkout', () => {
    const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-wrapper-'));
    const plan = syncSkill('keyword-mining', {
      targetRoot,
      dryRun: false,
      mode: 'wrapper',
      projectRoot: '/mnt/d/project/my-title'
    });
    const skillFile = path.join(targetRoot, 'keyword-mining', 'SKILL.md');
    const body = fs.readFileSync(skillFile, 'utf8');

    assert.equal(plan.mode, 'wrapper');
    assert.equal(plan.isSymlink, false);
    assert.ok(body.includes('cd /mnt/d/project/my-title'));
    assert.ok(body.includes('node bin/cli.js mine-keywords'));
    assert.ok(!fs.existsSync(path.join(targetRoot, 'keyword-mining', 'src')));
  });
});
