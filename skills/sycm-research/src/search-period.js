const SEARCH_PERIOD_VERSION = 'sycm-search-period-v2';

/**
 * 生意参谋近七天：北京时间昨天结束的七个完整日期。
 * @param {Date} [now] 当前时间。
 * @returns {string} 起止日期。
 */
function recentSevenDayRange(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).map(part => [part.type, part.value]));
  const today = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  const date = offset => new Date(today - offset * 86400000).toISOString().slice(0, 10);
  return `${date(7)}|${date(1)}`;
}

/**
 * 验证导航后的真实 URL，避免平台回落到日统计却记成七天。
 * @param {string} actualUrl 页面实际地址。
 * @param {string} expectedRange 本次请求日期范围。
 * @returns {object} 已验证周期证据。
 */
function verifySevenDayPeriod(actualUrl, expectedRange) {
  let url;
  try { url = new URL(actualUrl); } catch { /* 统一返回周期错误。 */ }
  if (url?.hostname !== 'sycm.taobao.com' || url.searchParams.get('dateType') !== 'recent7'
    || url.searchParams.get('dateRange') !== expectedRange) {
    const error = new Error('生意参谋未切换到近7天统计，已停止采集。请确认右上角“7天”及日期范围后重试。');
    error.code = 'SYCM_PERIOD_MISMATCH';
    error.status = 'transient_failure';
    throw error;
  }
  return { timePeriod: '7d', dateType: 'recent7', dateRange: expectedRange, verified: true, periodVersion: SEARCH_PERIOD_VERSION };
}

module.exports = { SEARCH_PERIOD_VERSION, recentSevenDayRange, verifySevenDayPeriod };
