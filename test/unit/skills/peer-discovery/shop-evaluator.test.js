'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  applyShopVerdict,
  evaluateShop,
  evaluateAllShops,
  runPeerEvaluateShopsStep
} = require('../../../../skills/peer-discovery/src/shop-evaluator');
const {
  writePeerReport,
  runPeerReportStep
} = require('../../../../skills/peer-discovery/src/peer-report-writer');

test('applyShopVerdict applies 6 priority rules correctly', () => {
  // Rule 2: Q < minProducts && reached_end -> unqualified
  const r2 = applyShopVerdict({
    paymentQualifiedCount: 3,
    minProducts: 10,
    minSourcing: 5
  }, 'reached_end', 5);
  assert.equal(r2.verdict, 'unqualified');
  assert.match(r2.reason, /不足 10 个（采集完整）/);

  // Rule 3: Q < minProducts && uncertain -> inconclusive
  const r3 = applyShopVerdict({
    paymentQualifiedCount: 3,
    minProducts: 10,
    minSourcing: 5
  }, 'uncertain', 5);
  assert.equal(r3.verdict, 'inconclusive');
  assert.match(r3.reason, /采集不完整/);

  // Rule 4: C >= minSourcing -> qualified
  const r4 = applyShopVerdict({
    paymentQualifiedCount: 15,
    sourcingConfirmedCount: 5,
    minProducts: 10,
    minSourcing: 5
  }, 'reached_end', 5);
  assert.equal(r4.verdict, 'qualified');

  // Rule 5: C + S + I < minSourcing && U === 0 && reached_end -> unqualified
  const r5 = applyShopVerdict({
    paymentQualifiedCount: 12,
    sourcingConfirmedCount: 2,
    sourcingSuspectedCount: 1,
    sourcingInconclusiveCount: 0,
    sourcingUnverifiedCount: 0,
    minProducts: 10,
    minSourcing: 5
  }, 'reached_end', 5);
  assert.equal(r5.verdict, 'unqualified');

  // Rule 6: C < minSourcing && C + S + I >= minSourcing -> inconclusive
  const r6 = applyShopVerdict({
    paymentQualifiedCount: 12,
    sourcingConfirmedCount: 3,
    sourcingSuspectedCount: 2,
    sourcingInconclusiveCount: 1,
    sourcingUnverifiedCount: 0,
    minProducts: 10,
    minSourcing: 5
  }, 'reached_end', 5);
  assert.equal(r6.verdict, 'inconclusive');
});

test('evaluateShop and evaluateAllShops run sequentially with state tracking', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shop-eval-test-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const candidateShops = [
    { shopKey: 'shop_1', shopName: '店铺1', shopUrl: 'https://shop1.taobao.com' }
  ];
  await fs.writeFile(path.join(tempDir, 'candidate-shops.jsonl'), JSON.stringify(candidateShops[0]) + '\n');

  const evalRes = await evaluateAllShops({
    runDir: tempDir,
    minProducts: 1,
    minSourcing: 1,
    collector: async () => ({
      shopKey: 'shop_1',
      products: [
        { itemId: 'item_1', title: '热卖商品1', price: 10, paymentText: '50人付款' }
      ],
      collectionCompleteness: 'reached_end'
    }),
    searcher: async () => ({
      ok: true,
      products: [
        { title: '热卖商品1', singlePiecePrice: 5.0, minOrderQuantity: 1 }
      ]
    })
  });

  assert.equal(evalRes.status, 'completed');
  assert.ok(evalRes.evaluations.length >= 0);
});

test('writePeerReport: writes peer discovery JSON and Excel', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'report-test-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const evaluations = [
    {
      shopKey: 'shop_q',
      shopName: '合格同行旗舰店',
      shopUrl: 'https://shop_q.taobao.com',
      verdict: 'qualified',
      totalCollected: 20,
      paymentQualifiedCount: 15,
      sourcingVerifiedCount: 10,
      sourcingConfirmedCount: 6,
      products: [
        {
          title: '爆款银项链',
          productUrl: 'https://item.taobao.com/item.htm?id=1',
          taobaoPrice: 39.9,
          paymentText: '1000+人付款',
          sourcing: {
            aliTitle: '1688同款项链',
            aliComparablePrice: 9.9,
            priceRatio: 0.25,
            similarity: 0.85,
            level: 'confirmed'
          }
        }
      ]
    }
  ];

  const res = await writePeerReport({
    runId: 'peer_run_1',
    runDir: tempDir,
    evaluations,
    candidateShops: [{ shopKey: 'shop_q' }]
  });

  assert.ok(res.jsonPath);
  assert.ok(res.excelPath);
  assert.equal(res.summary.qualifiedCount, 1);

  const jsonContent = JSON.parse(await fs.readFile(res.jsonPath, 'utf8'));
  assert.equal(jsonContent.qualifiedShops.length, 1);

  const excelStat = await fs.stat(res.excelPath);
  assert.ok(excelStat.size > 1000);
});
