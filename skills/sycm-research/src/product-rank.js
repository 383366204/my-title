'use strict';

const http = require('http');
const WebSocket = require('ws');

const PRODUCT_RANK_URL = 'https://sycm.taobao.com/cc/item_rank';
const DEFAULT_PORT = 9222;
const DATE_MODES = Object.freeze({
  latest_day: '日',
  last_7_days: '7天',
  last_30_days: '30天',
  custom: '自定义'
});
const SORT_METRICS = Object.freeze({
  payAmt: { label: '支付金额', field: 'paymentAmount' },
  sucRefundAmt: { label: '成功退款金额', field: 'refundAmount' },
  payItmCnt: { label: '支付件数', field: 'paidItemCount' },
  itemCartCnt: { label: '商品加购件数', field: 'cartItemCount' },
  itmUv: { label: '商品访客数', field: 'visitorCount' }
});

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpGetJson(url, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (_error) {
          reject(new Error('Chrome 返回了无效数据'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('连接 Chrome 调试端口超时')));
  });
}

function createManualActionError(status, message, extra = {}) {
  const error = new Error(message);
  error.code = status === 'chrome_unavailable' ? 'SYCM_CHROME_REQUIRED' : 'SYCM_MANUAL_ACTION_REQUIRED';
  error.status = status;
  error.manualAction = {
    platform: 'sycm',
    status,
    userMessage: message,
    url: PRODUCT_RANK_URL,
    ...extra
  };
  return error;
}

function createCdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 1;
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('连接 Chrome 页面超时')), 8000);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });

  ws.on('message', raw => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (_error) {
      return;
    }
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message || 'CDP 请求失败'));
    else request.resolve(message.result || {});
  });
  ws.on('close', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('Chrome 页面连接已关闭'));
    }
    pending.clear();
  });

  async function send(method, params = {}, timeout = 15000) {
    await ready;
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP 请求超时: ${method}`));
      }, timeout);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression, timeout) {
    const response = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    }, timeout);
    if (response.exceptionDetails) {
      const detail = response.exceptionDetails.exception?.description || response.exceptionDetails.text;
      throw new Error(detail || '页面脚本执行失败');
    }
    return response.result ? response.result.value : undefined;
  }

  return {
    ready,
    send,
    evaluate,
    close() {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    }
  };
}

async function connectProductRankPage(port) {
  let tabs;
  try {
    tabs = await httpGetJson(`http://127.0.0.1:${port}/json/list`);
  } catch (error) {
    throw createManualActionError(
      'chrome_unavailable',
      `Chrome 调试连接不可用（端口 ${port}）。请先启动 Chrome 并登录生意参谋。`,
      { originalError: error.message }
    );
  }
  const pages = Array.isArray(tabs) ? tabs.filter(tab => tab.type === 'page') : [];
  let tab = pages.find(item => String(item.url || '').includes('/cc/item_rank'));
  if (!tab) tab = pages.find(item => String(item.url || '').includes('sycm.taobao.com'));
  if (!tab || !tab.webSocketDebuggerUrl) {
    throw createManualActionError('chrome_unavailable', `端口 ${port} 没有可用的生意参谋页面。请点击“启动 Chrome”并完成登录。`);
  }
  const cdp = createCdpClient(tab.webSocketDebuggerUrl);
  await cdp.ready;
  if (!String(tab.url || '').includes('/cc/item_rank')) {
    await cdp.send('Page.navigate', { url: PRODUCT_RANK_URL }, 10000);
  }
  return cdp;
}

async function waitForPage(cdp, predicate, timeout = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const state = await cdp.evaluate(`(() => ({
      ready: document.readyState,
      url: location.href,
      text: String(document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 3000),
      hasTable: Boolean(document.querySelector('table.ant-table-fixed')),
      loading: Boolean(document.querySelector('.ant-spin-spinning,.el-loading-mask'))
    }))()`);
    if (predicate(state || {})) return state;
    await wait(500);
  }
  throw new Error('等待生意参谋商品排行加载超时');
}

function throwIfBlocked(pageState) {
  const url = String(pageState?.url || '');
  const text = String(pageState?.text || '');
  if (/login|custom\/login/.test(url) || /扫码登录|密码登录|请登录/.test(text)) {
    throw createManualActionError('login_required', '生意参谋登录态已失效，请在当前 Chrome 中登录后重试。');
  }
  if (/滑块|安全验证|人机验证|验证码/.test(text) || /punish|captcha/.test(url)) {
    throw createManualActionError('slider_required', '生意参谋触发安全验证，请在当前 Chrome 中处理后重试。');
  }
}

/**
 * Parse a number displayed by the SYCM table.
 * @param {unknown} value Display value.
 * @returns {number} Parsed numeric value.
 */
function parseNumber(value) {
  const normalized = String(value == null ? '' : value).replace(/,/g, '').trim();
  if (!normalized || normalized === '-') return 0;
  const matched = normalized.match(/-?\d+(?:\.\d+)?/);
  return matched ? Number(matched[0]) : 0;
}

/**
 * Check whether rows are descending by a configured metric.
 * @param {object[]} rows Product rows.
 * @param {string} [sortMetric] SYCM metric key.
 * @returns {boolean} Whether the rows are descending.
 */
function isDescendingBy(rows, sortMetric = 'itmUv') {
  const field = SORT_METRICS[sortMetric]?.field || SORT_METRICS.itmUv.field;
  if (!Array.isArray(rows) || rows.length < 2) return true;
  return rows.every((row, index) => index === 0 || Number(rows[index - 1][field] || 0) >= Number(row[field] || 0));
}

/**
 * Check whether rows are descending by visitor count.
 * @param {object[]} rows Product rows.
 * @returns {boolean} Whether the rows are descending.
 */
function isDescending(rows) {
  return isDescendingBy(rows, 'itmUv');
}

function parseIsoDate(value) {
  const matched = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

/**
 * Validate a custom SYCM date range.
 * @param {string} startDate Start date in YYYY-MM-DD format.
 * @param {string} endDate End date in YYYY-MM-DD format.
 * @returns {{startDate:string,endDate:string,days:number}} Validated range.
 */
function validateCustomDateRange(startDate, endDate) {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (!start || !end) throw new Error('自定义日期范围必须填写有效的开始日期和结束日期');
  const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  if (days < 1) throw new Error('开始日期不能晚于结束日期');
  if (days > 31) throw new Error('生意参谋自定义日期范围最多选择 31 天');
  return { startDate: String(startDate), endDate: String(endDate), days };
}

/**
 * Normalize collection date, page, and sort options.
 * @param {object} [options] Raw collection options.
 * @returns {object} Normalized collection options.
 */
function normalizeCollectionOptions(options = {}) {
  const dateMode = Object.hasOwn(DATE_MODES, options.dateMode) ? options.dateMode : 'latest_day';
  const sortMetric = Object.hasOwn(SORT_METRICS, options.sortMetric) ? options.sortMetric : 'itmUv';
  const pages = Math.max(1, Math.min(5, Number.parseInt(options.pages, 10) || 1));
  const dateRange = dateMode === 'custom'
    ? validateCustomDateRange(options.startDate, options.endDate)
    : { startDate: '', endDate: '', days: dateMode === 'last_30_days' ? 30 : dateMode === 'last_7_days' ? 7 : 1 };
  return { dateMode, sortMetric, pages, ...dateRange };
}

async function clickElement(cdp, expression) {
  return cdp.evaluate(`(() => {
    const element = ${expression};
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    element.click();
    return true;
  })()`);
}

async function readProductRankRows(cdp) {
  return cdp.evaluate(`(() => {
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const valueOf = (row, className) => clean(row.querySelector('.' + className + ' .alife-dt-card-common-table-sortable-value')?.innerText);
    const ratioOf = (row, className) => clean(row.querySelector('.' + className + ' .alife-dt-card-common-table-sortable-cycleCrc')?.innerText);
    const table = document.querySelector('table.ant-table-fixed');
    if (!table) return { rows: [], meta: { error: '未找到商品排行表格' } };
    const rows = [...table.querySelectorAll('tbody tr')].map((row, index) => {
      const productCell = row.querySelector('td');
      const titleLink = productCell?.querySelector('.singleGoodsName a[title]') || productCell?.querySelector('a[title]');
      const itemIdText = clean(productCell?.querySelector('.goods-subIndex-text')?.innerText);
      const itemId = (itemIdText.match(/ID[:：]?\\s*(\\d+)/i) || [])[1] || '';
      const rawHref = titleLink?.href || '';
      return {
        rank: index + 1,
        itemId,
        title: clean(titleLink?.getAttribute('title') || titleLink?.innerText),
        productUrl: rawHref || (itemId ? 'https://item.taobao.com/item.htm?id=' + itemId : ''),
        imageUrl: productCell?.querySelector('img')?.src || '',
        paymentAmount: valueOf(row, 'alife-dt-card-common-table-payAmt'),
        refundAmount: valueOf(row, 'alife-dt-card-common-table-sucRefundAmt'),
        paidItemCount: valueOf(row, 'alife-dt-card-common-table-payItmCnt'),
        cartItemCount: valueOf(row, 'alife-dt-card-common-table-itemCartCnt'),
        visitorCount: valueOf(row, 'alife-dt-card-common-table-itmUv'),
        visitorChange: ratioOf(row, 'alife-dt-card-common-table-itmUv')
      };
    }).filter(row => row.itemId || row.title);
    const bodyText = clean(document.body?.innerText);
    const storeName = (bodyText.match(/^生意参谋\\s+(.+?)\\s+主店(?:\\s|$)/) || [])[1] || '';
    const dateText = clean(document.querySelector('.oui-date-picker-current-date')?.innerText);
    const statDates = [...dateText.matchAll(/\\d{4}-\\d{2}-\\d{2}/g)].map(match => match[0]);
    const selectedPeriod = [...document.querySelectorAll('.oui-date-picker-particle-button button')]
      .find(item => item.classList.contains('ant-btn-primary'));
    return {
      rows,
      meta: {
        storeName,
        statDate: statDates.length > 1 ? statDates[0] + ' ~ ' + statDates[1] : statDates[0] || '',
        startDate: statDates[0] || '',
        endDate: statDates[1] || statDates[0] || '',
        dateLabel: dateText,
        period: clean(selectedPeriod?.innerText),
        activePage: Number(document.querySelector('.ant-pagination-item-active')?.getAttribute('title') || 1),
        pageUrl: location.href
      }
    };
  })()`);
}

function normalizeRows(rows, pageNumber, sortMetric) {
  const metric = SORT_METRICS[sortMetric];
  return (rows || []).map((row, index) => {
    const normalized = {
      ...row,
      rank: (pageNumber - 1) * 10 + index + 1,
      sourcePage: pageNumber,
      paymentAmount: parseNumber(row.paymentAmount),
      refundAmount: parseNumber(row.refundAmount),
      paidItemCount: parseNumber(row.paidItemCount),
      cartItemCount: parseNumber(row.cartItemCount),
      visitorCount: parseNumber(row.visitorCount),
      sortMetric,
      sortLabel: metric.label
    };
    normalized.sortValue = Number(normalized[metric.field] || 0);
    return normalized;
  });
}

async function selectPeriodButton(cdp, label) {
  const quoted = JSON.stringify(label);
  const selected = await cdp.evaluate(`(() => {
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const button = [...document.querySelectorAll('.oui-date-picker-particle-button button')]
      .find(item => clean(item.innerText) === ${quoted});
    return Boolean(button?.classList.contains('ant-btn-primary'));
  })()`);
  if (selected) return;
  const expression = `[...document.querySelectorAll('.oui-date-picker-particle-button button')].find(item => String(item.innerText || '').replace(/\\s+/g, ' ').trim() === ${quoted})`;
  if (!await clickElement(cdp, expression)) throw new Error(`未找到“${label}”日期范围按钮`);
  await wait(900);
  await waitForPage(cdp, state => state.hasTable && !state.loading, 20000);
}

async function calendarMonth(cdp, panelSelector) {
  return cdp.evaluate(`(() => {
    const panel = document.querySelector(${JSON.stringify(panelSelector)});
    const year = Number(String(panel?.querySelector('[data-role=current-year]')?.innerText || '').match(/\\d+/)?.[0]);
    const month = Number(String(panel?.querySelector('[data-role=current-month]')?.innerText || '').match(/\\d+/)?.[0]);
    return year && month ? { year, month } : null;
  })()`);
}

async function moveCalendarToMonth(cdp, panelSelector, isoDate) {
  const target = parseIsoDate(isoDate);
  if (!target) throw new Error(`无效日期：${isoDate}`);
  const targetIndex = target.getUTCFullYear() * 12 + target.getUTCMonth();
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const current = await calendarMonth(cdp, panelSelector);
    if (!current) throw new Error('无法读取生意参谋日期面板');
    const currentIndex = current.year * 12 + current.month - 1;
    if (currentIndex === targetIndex) return;
    const role = currentIndex > targetIndex ? 'prev-month' : 'next-month';
    const selector = `${panelSelector} [data-role=${role}]`;
    const disabled = await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.classList.contains('disabled')`);
    if (disabled) throw new Error(`日期 ${isoDate} 在当前生意参谋账号中不可选`);
    if (!await clickElement(cdp, `document.querySelector(${JSON.stringify(selector)})`)) {
      throw new Error('无法切换生意参谋日期月份');
    }
    await wait(120);
  }
  throw new Error(`日期 ${isoDate} 超出生意参谋可选择范围`);
}

async function selectCustomDateRange(cdp, startDate, endDate) {
  await selectPeriodButton(cdp, '日');
  let open = await cdp.evaluate(`Boolean(document.querySelector('.oui-date-picker-menu.open .rangeLeft'))`);
  if (!open) {
    const customExpression = `[...document.querySelectorAll('.oui-date-picker-particle-button button')].find(item => String(item.innerText || '').trim() === '自定义')`;
    if (!await clickElement(cdp, customExpression)) throw new Error('未找到生意参谋自定义日期按钮');
    for (let attempt = 0; attempt < 6 && !open; attempt += 1) {
      await wait(250);
      open = await cdp.evaluate(`Boolean(document.querySelector('.oui-date-picker-menu.open .rangeLeft'))`);
    }
  }
  if (!open) {
    throw new Error('生意参谋自定义日期面板未打开');
  }
  await moveCalendarToMonth(cdp, '.oui-date-picker-menu.open .rangeLeft', startDate);
  await moveCalendarToMonth(cdp, '.oui-date-picker-menu.open .rangeRight', endDate);
  const startSelector = `.oui-date-picker-menu.open .rangeLeft td[data-value=${JSON.stringify(startDate)}]:not(.disabled-element)`;
  const endSelector = `.oui-date-picker-menu.open .rangeRight td[data-value=${JSON.stringify(endDate)}]:not(.disabled-element)`;
  if (!await clickElement(cdp, `document.querySelector(${JSON.stringify(startSelector)})`)) throw new Error(`开始日期 ${startDate} 不可选`);
  await wait(120);
  if (!await clickElement(cdp, `document.querySelector(${JSON.stringify(endSelector)})`)) throw new Error(`结束日期 ${endDate} 不可选`);
  await wait(120);
  const confirmExpression = `[...document.querySelectorAll('.oui-date-picker-menu.open button')].find(item => String(item.innerText || '').replace(/\\s/g, '') === '确定' && !item.disabled)`;
  if (!await clickElement(cdp, confirmExpression)) throw new Error('自定义日期范围未通过生意参谋校验');
  await wait(900);
  await waitForPage(cdp, state => state.hasTable && !state.loading, 20000);
  const selected = await cdp.evaluate(`String(document.querySelector('.oui-date-picker-current-date')?.innerText || '')`);
  if (!selected.includes(startDate) || !selected.includes(endDate)) throw new Error('生意参谋没有应用所选日期范围');
}

async function applyDateRange(cdp, options) {
  if (options.dateMode === 'custom') {
    await selectCustomDateRange(cdp, options.startDate, options.endDate);
    return;
  }
  await selectPeriodButton(cdp, DATE_MODES[options.dateMode]);
}

async function ensureSortMetric(cdp, sortMetric) {
  const metric = SORT_METRICS[sortMetric];
  if (await cdp.evaluate(`Boolean(document.querySelector('.alife-dt-card-common-table-${sortMetric}'))`)) return;
  if (!await clickElement(cdp, `document.querySelector('.low-common-index-picker-control')`)) {
    throw new Error('无法打开生意参谋指标选择器');
  }
  await wait(150);
  const quotedLabel = JSON.stringify(metric.label);
  const expression = `[...document.querySelectorAll('.oui-index-picker-item')].find(item => String(item.innerText || '').replace(/\\s+/g, ' ').trim() === ${quotedLabel})`;
  if (!await clickElement(cdp, expression)) throw new Error(`未找到“${metric.label}”指标`);
  await wait(600);
  await waitForPage(cdp, state => state.hasTable && !state.loading, 20000);
}

async function goToPage(cdp, pageNumber) {
  const active = await cdp.evaluate(`Number(document.querySelector('.ant-pagination-item-active')?.getAttribute('title') || 1)`);
  if (active === pageNumber) return;
  const fingerprintExpression = `(() => {
    const table = document.querySelector('table.ant-table-fixed');
    return [...(table?.querySelectorAll('tbody .goods-subIndex-text') || [])]
      .map(item => String(item.innerText || '').trim()).join('|');
  })()`;
  const previousFingerprint = await cdp.evaluate(fingerprintExpression);
  const selector = `.ant-pagination-item[title=${JSON.stringify(String(pageNumber))}]`;
  const clicked = await cdp.evaluate(`(() => {
    const item = document.querySelector(${JSON.stringify(selector)});
    if (!item) return false;
    item.click();
    return true;
  })()`);
  if (!clicked) {
    throw new Error(`商品排行没有第 ${pageNumber} 页，请减少采集页数`);
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await wait(250);
    const selected = await cdp.evaluate(`Number(document.querySelector('.ant-pagination-item-active')?.getAttribute('title') || 0)`);
    const loading = await cdp.evaluate(`Boolean(document.querySelector('.ant-spin-spinning,.el-loading-mask'))`);
    const fingerprint = await cdp.evaluate(fingerprintExpression);
    if (selected === pageNumber && !loading && fingerprint && fingerprint !== previousFingerprint) return;
  }
  throw new Error(`未能切换到商品排行第 ${pageNumber} 页`);
}

async function sortByMetricDescending(cdp, sortMetric) {
  const metric = SORT_METRICS[sortMetric];
  await goToPage(cdp, 1);
  const active = await cdp.evaluate(`Boolean(document.querySelector('.alife-dt-card-common-table-${sortMetric} .alife-dt-card-common-table-sortable-down-icon.active'))`);
  if (!active) {
    const selector = `.alife-dt-card-common-table-${sortMetric} .alife-dt-card-common-table-sortable-down-icon`;
    if (!await clickElement(cdp, `document.querySelector(${JSON.stringify(selector)})`)) {
      throw new Error(`未找到${metric.label}降序按钮`);
    }
    await wait(1200);
    await waitForPage(cdp, state => state.hasTable && !state.loading, 20000);
  }
  const snapshot = await readProductRankRows(cdp);
  const rows = normalizeRows(snapshot.rows, 1, sortMetric);
  if (!rows.length || !isDescendingBy(rows, sortMetric)) {
    throw new Error(`${metric.label}未能切换为降序，请在生意参谋页面确认后重试。`);
  }
  return { ...snapshot, rows, sort: `${sortMetric}_desc`, sortMetric, sortLabel: metric.label, sortVerified: true };
}

/**
 * 按所选日期、排序指标和页数读取生意参谋商品排行。
 * @param {object} [options] 采集选项。
 * @param {number} [options.port=9222] Chrome 调试端口。
 * @param {string} [options.dateMode=latest_day] 日期模式。
 * @param {string} [options.startDate] 自定义开始日期。
 * @param {string} [options.endDate] 自定义结束日期。
 * @param {number} [options.pages=1] 采集页数，最多 5 页。
 * @param {string} [options.sortMetric=itmUv] 排序指标。
 * @param {Function} [options.onProgress] 进度回调。
 * @returns {Promise<{rows: object[], meta: object, sort: string, sortVerified: boolean}>} 商品排行数据。
 */
async function collectProductRankPage(options = {}) {
  const port = Number(options.port || DEFAULT_PORT);
  const collection = normalizeCollectionOptions(options);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const progressTotal = collection.pages + 2;
  let cdp;
  try {
    onProgress({ current: 0, total: progressTotal, message: '连接 Chrome 和生意参谋' });
    cdp = await connectProductRankPage(port);
    const pageState = await waitForPage(cdp, state => (
      /sycm\.taobao\.com/.test(state.url) && (state.hasTable || /商品排行|扫码登录|安全验证/.test(state.text))
    ));
    throwIfBlocked(pageState);
    onProgress({ current: 1, total: progressTotal, message: `设置日期范围：${DATE_MODES[collection.dateMode]}` });
    await applyDateRange(cdp, collection);
    onProgress({ current: 2, total: progressTotal, message: `按${SORT_METRICS[collection.sortMetric].label}降序排列` });
    await ensureSortMetric(cdp, collection.sortMetric);
    const firstPage = await sortByMetricDescending(cdp, collection.sortMetric);
    const rows = [];
    let meta = firstPage.meta;
    for (let pageNumber = 1; pageNumber <= collection.pages; pageNumber += 1) {
      let snapshot = firstPage;
      if (pageNumber > 1) {
        await goToPage(cdp, pageNumber);
        snapshot = await readProductRankRows(cdp);
      }
      const pageRows = pageNumber === 1 ? firstPage.rows : normalizeRows(snapshot.rows, pageNumber, collection.sortMetric);
      if (!pageRows.length) throw new Error(`商品排行第 ${pageNumber} 页没有可用数据`);
      rows.push(...pageRows);
      meta = { ...meta, ...snapshot.meta };
      onProgress({ current: pageNumber + 2, total: progressTotal, message: `已采集第 ${pageNumber}/${collection.pages} 页，共 ${rows.length} 条商品` });
    }
    if (!isDescendingBy(rows, collection.sortMetric)) {
      const field = SORT_METRICS[collection.sortMetric].field;
      const inversionIndex = rows.findIndex((row, index) => index > 0 && Number(rows[index - 1][field] || 0) < Number(row[field] || 0));
      const previous = rows[inversionIndex - 1];
      const current = rows[inversionIndex];
      throw new Error(`${SORT_METRICS[collection.sortMetric].label}跨页顺序校验未通过：第 ${previous?.rank || '?'} 名 ${previous?.[field] ?? '?'}，第 ${current?.rank || '?'} 名 ${current?.[field] ?? '?'}`);
    }
    return {
      rows,
      meta: {
        ...meta,
        dateMode: collection.dateMode,
        requestedStartDate: collection.startDate,
        requestedEndDate: collection.endDate,
        pagesRequested: collection.pages,
        pagesCollected: collection.pages
      },
      sort: firstPage.sort,
      sortMetric: collection.sortMetric,
      sortLabel: firstPage.sortLabel,
      sortVerified: true
    };
  } finally {
    if (cdp) cdp.close();
  }
}

module.exports = {
  DATE_MODES,
  PRODUCT_RANK_URL,
  SORT_METRICS,
  collectProductRankPage,
  isDescending,
  isDescendingBy,
  normalizeCollectionOptions,
  parseNumber,
  validateCustomDateRange
};
