const test = require('node:test');
const assert = require('node:assert/strict');
const { recentSevenDayRange, verifySevenDayPeriod, SEARCH_PERIOD_VERSION } = require('../../../../skills/sycm-research/src/search-period');
const { PERIOD_URL_MAP } = require('../../../../skills/sycm-research/src/sycm-cdp-extractor');

test('seven days uses the observed recent7 parameter', () => {
  assert.equal(PERIOD_URL_MAP['7d'].dateType, 'recent7');
});

test('seven complete Shanghai dates end yesterday across calendar boundaries', () => {
  for (const [now, expected] of [
    ['2026-10-08T04:00:00Z', '2026-10-01|2026-10-07'],
    ['2026-10-07T16:00:00Z', '2026-10-01|2026-10-07'],
    ['2026-10-07T15:59:59Z', '2026-09-30|2026-10-06'],
    ['2026-01-01T04:00:00Z', '2025-12-25|2025-12-31'],
    ['2024-03-01T04:00:00Z', '2024-02-23|2024-02-29']
  ]) {
    const range = recentSevenDayRange(new Date(now));
    assert.equal(range, expected);
    const [start, end] = range.split('|').map(Date.parse);
    assert.equal((end - start) / 86400000 + 1, 7);
  }
});

test('observed seven-day URL produces verified evidence', () => {
  const range = '2026-10-01|2026-10-07';
  const url = `https://sycm.taobao.com/mc/free/search_analysis?dateType=recent7&dateRange=${encodeURIComponent(range)}`;
  assert.deepEqual(verifySevenDayPeriod(url, range), {
    timePeriod: '7d', dateType: 'recent7', dateRange: range, verified: true, periodVersion: SEARCH_PERIOD_VERSION
  });
});

test('daily fallback, stale dates and invalid pages cannot be labeled seven days', () => {
  for (const url of [
    'https://sycm.taobao.com/mc/free/search_analysis?dateType=day&dateRange=2026-10-01%7C2026-10-07',
    'https://sycm.taobao.com/mc/free/search_analysis?dateType=recent7&dateRange=2026-10-01%7C2026-10-08',
    'https://sycm.taobao.com/',
    'https://example.com/?dateType=recent7&dateRange=2026-10-01%7C2026-10-07',
    'invalid'
  ]) assert.throws(() => verifySevenDayPeriod(url, '2026-10-01|2026-10-07'), { code: 'SYCM_PERIOD_MISMATCH' });
});
