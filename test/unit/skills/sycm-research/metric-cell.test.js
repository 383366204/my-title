const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readMetricCell } = require('../../../../skills/sycm-research/src/metric-cell');
const { normalizeSycmMetrics } = require('../../../../skills/sycm-research/src/metric-parser');

test('cell separates ranges from trends and reads red/up green/down', t => {
  globalThis.getComputedStyle = el => ({ color: el.color });
  t.after(() => { delete globalThis.getComputedStyle; });
  for (const [color, direction] of [['rgb(255, 0, 0)', 'up'], ['rgb(0, 160, 90)', 'down']]) {
    const leaf = { textContent: '35%', children: [], color };
    const result = readMetricCell({ innerText: '20～50\n35%', querySelectorAll: () => [leaf] });
    assert.equal(result.value, '20～50');
    assert.equal(result.direction, direction);
    const metric = normalizeSycmMetrics({ searchPopularity: result.value, searchPopularity_trend: result.trendRaw, searchPopularity_trendDirection: direction }).metrics.searchPopularity;
    assert.equal(metric.lower, 20);
    assert.equal(metric.upper, 50);
    assert.equal(metric.trend, direction === 'up' ? 0.35 : -0.35);
  }
});

test('a percentage range without a trend remains intact', () => {
  const cell = { innerText: '40% ～ 45%', querySelectorAll: () => [{ textContent: '45%', children: [] }] };
  assert.equal(readMetricCell(cell).value, '40% ～ 45%');
  assert.equal(readMetricCell(cell).trendRaw, null);
});
