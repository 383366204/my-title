const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSycmMetric, normalizeSycmMetrics, compareMetricThreshold } = require('../../../../skills/sycm-research/src/metric-parser');
const { scoreSycmRows } = require('../../../../skills/pipeline-flow/src/sycm-verifier');
const { evaluateMarketMetrics } = require('../../../../skills/keyword-mining/src/candidate-gate');

test('counts preserve endpoint units and separated trends', () => {
  const row = parseSycmMetric('8万 ~ 12万 15%', { unit: 'count' });
  assert.equal(row.lower, 80000);
  assert.equal(row.upper, 120000);
  assert.equal(row.trend, 0.15);
  assert.equal(row.status, 'range');
  const joined = parseSycmMetric('1200 ~ 2500-10%', { unit: 'count' });
  assert.equal(joined.upper, 2500);
  assert.equal(joined.trend, -0.1);
});

test('ratios preserve range and values above 100 percent', () => {
  const row = parseSycmMetric('30% ~ 35% 155%', { unit: 'ratio' });
  assert.equal(row.lower, 0.3);
  assert.equal(row.upper, 0.35);
  assert.equal(row.trend, 1.55);
  assert.equal(parseSycmMetric('120%', { unit: 'ratio' }).value, 1.2);
  assert.equal(parseSycmMetric(20, { unit: 'ratio' }).value, 0.2);
});

test('ambiguous mixed units, reversed intervals, and invalid inputs never become zero', () => {
  for (const raw of ['10 ~ 500%', '20% ~ 30', '200 ~ 100', {}, NaN, Infinity]) {
    const metric = parseSycmMetric(raw, { unit: 'count' });
    assert.equal(metric.status, 'ambiguous', String(raw));
    assert.equal(metric.value, null);
  }
  assert.equal(parseSycmMetric(0).status, 'exact');
  assert.equal(parseSycmMetric(null).status, 'missing');
  assert.equal(parseSycmMetric('--').value, null);
});

test('normalization preserves zero and is idempotent without double dividing percentages', () => {
  const row = normalizeSycmMetrics({ conversionRate: 0, payConversionRate: '30%', clickRate: '20%' });
  assert.equal(row.conversionRate, 0);
  assert.equal(row.clickRate, 0.2);
  assert.deepEqual(normalizeSycmMetrics(row), row);
});

test('threshold crossings and missing evidence require review', () => {
  assert.equal(compareMetricThreshold(parseSycmMetric('10 ~ 100'), 50), 'review');
  assert.equal(compareMetricThreshold(parseSycmMetric(null), 50), 'review');
  assert.equal(compareMetricThreshold(parseSycmMetric('100 ~ 200'), 50), 'passed');
  assert.equal(compareMetricThreshold(parseSycmMetric(0), 50), 'weak');
});

test('mining and verification use the same evidence and do not score a trend as demand', () => {
  const row = { searchPopularity: '8万 ~ 12万 15%', demandSupplyRatio: '0.1 500%', clickRate: '120%', conversionRate: '30% ~ 35% 155%' };
  const gate = evaluateMarketMetrics(row);
  const verification = scoreSycmRows([row]);
  assert.deepEqual(gate.metrics, verification.metrics);
  assert.equal(verification.passed, false);
  assert.equal(verification.metrics.demandSupplyRatio.value, 0.1);
  assert.equal(gate.searchPopularity, 80000);
});

test('verification refuses missing, ambiguous and straddling required data', () => {
  for (const searchPopularity of [undefined, '10 ~ 500%']) {
    const row = { searchPopularity, demandSupplyRatio: 10, clickRate: '30%' };
    assert.equal(scoreSycmRows([row]).needsReview, true);
    assert.equal(scoreSycmRows([row]).passed, false);
  }
  assert.equal(scoreSycmRows([{ searchPopularity: 100, demandSupplyRatio: '0.1 ~ 2' }]).needsReview, true);
  assert.equal(scoreSycmRows([{ searchPopularity: 0, clickRate: '30%' }], { mode: 'hot' }).passed, false);
  assert.equal(scoreSycmRows([null]).passed, false);
  assert.equal(normalizeSycmMetrics(null).searchPopularity, null);
});
