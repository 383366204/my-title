const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { withAgentResponseFields } = require('../../core/agent-response');

const DEFAULT_CDP_PORT = 9222;
const DEFAULT_BASE_URL = 'https://item.jnesoft.com/';
const DEFAULT_MULTI_STORE_URL = 'https://item.jnesoft.com/ali_view/ali_multiStore';
const DEFAULT_BATCH_LOG_URL = 'https://item.jnesoft.com/ali_view/ali_batchLog';
const DEFAULT_STATE_FILE = path.join(process.cwd(), 'data', 'distribution-runs.jsonl');
const RECENT_SUBMIT_WINDOW_MS = 30 * 60 * 1000;
const DISTRIBUTION_AUTO = 'auto';
const DISTRIBUTION_RANDOM_AVERAGE = 'random-average';
const SHOP_SELECTION_AUTO = 'auto';
const SHOP_SELECTION_ALL = 'all';
const SHOP_SELECTION_FIRST = 'first';
const TXT_RANDOM_AVERAGE = '\u968f\u673a\u5e73\u5747\u5206\u914d';
const TXT_SELECT_ALL = '\u5168\u9009';
const TXT_START_BATCH_COPY = '\u5f00\u59cb\u6279\u91cf\u590d\u5236';
const TXT_VIEW_COPY_RECORDS = '\u67e5\u770b\u590d\u5236\u8bb0\u5f55';
const TXT_RELOGIN = '\u91cd\u65b0\u767b\u5f55';
const TXT_REAUTHORIZE = '\u91cd\u65b0\u6388\u6743';
const TXT_CANCEL = '\u53d6\u6d88';
const TXT_AUTHORIZE_AND_LOGIN = '\u6388\u6743\u5e76\u767b\u5f55';
const TXT_COPY_LOG = '\u590d\u5236\u65e5\u5fd7';
const TXT_SEARCH = '\u641c\u7d22';
const TXT_COMMA_OR_SPACE = '\u9017\u53f7\u6216\u7a7a\u683c';
const RE_ALL_SHOPS_SELECTED = new RegExp('\\u5168\\u9009[\\uff1a:]\\u5df2\\u9009\\s*[1-9]\\d*\\s*\\u4e2a\\u5e97\\u94fa');
const RE_COPYING = new RegExp('\\u590d\\u5236\\u4e2d', 'g');
const RE_SUCCESS = new RegExp('\\u590d\\u5236\\u6210\\u529f', 'g');
const RE_FAILED = new RegExp('\\u590d\\u5236\\u5931\\u8d25', 'g');
const RE_SKIPPED = new RegExp('\\u8df3\\u8fc7\\u590d\\u5236', 'g');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readTextFile(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
}

function parseItemLine(line) {
  const rawLine = String(line || '');
  const dollarMatch = rawLine.match(/^(https?:\/\/detail\.1688\.com\/offer\/(\d+)\.html(?:[?#][^\s|]+)?)\$\$(.*)$/);
  if (dollarMatch) {
    const parts = dollarMatch[3].split('$$');
    return {
      line,
      url: `https://detail.1688.com/offer/${dollarMatch[2]}.html`,
      title: (parts.shift() || '').trim(),
      category: parts.join('$$').trim(),
      offerId: dollarMatch[2]
    };
  }

  const match = rawLine.match(/^(https?:\/\/detail\.1688\.com\/offer\/(\d+)\.html(?:[?#][^\s|]+)?)(.*)$/);
  if (!match) return null;
  let rest = String(match[3] || '').trim();
  let title = '';
  let category = '';

  if (rest) {
    const delimiter = [
      /^\|\|(.*)$/s,
      /^--title(?:=|\s+)(.*)$/s,
      /^title(?:=|:|\s+)(.*)$/is,
      /^标题(?:=|:|\s+)(.*)$/s,
      /^(.*)$/s
    ].find(regex => regex.test(rest));
    if (delimiter) {
      title = rest.replace(delimiter, '$1').trim();
    }
    const categoryMatch = title.match(/^(.*?)(?:\t+|\s+\|\|\s+|\s+--category(?:=|\s+)|\s+category(?:=|:|\s+)|\s+类目(?:=|:|\s+))(.+)$/is);
    if (categoryMatch) {
      title = categoryMatch[1].trim();
      category = categoryMatch[2].trim();
    }
  }

  return {
    line,
    url: `https://detail.1688.com/offer/${match[2]}.html`,
    title,
    category,
    offerId: match[2]
  };
}

function parseItems(input) {
  const text = Array.isArray(input) ? input.join('\n') : String(input || '');
  const rows = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  return rows.map((line, index) => {
    const item = parseItemLine(line);
    if (!item) {
      const err = new Error(`Invalid 1688 item at line ${index + 1}: ${line}`);
      err.code = 'INVALID_ITEM';
      throw err;
    }
    return item;
  });
}

function splitBatches(items, batchSize = 20) {
  const size = Math.max(1, parseInt(batchSize, 10) || 20);
  const batches = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function normalizeItemsForInput(items) {
  return items.map(item => {
    if (item.category) return `${item.url}$$${item.title || ''}$$${item.category}`;
    if (item.title) return `${item.url}$$${item.title}`;
    return item.url;
  }).join('\n');
}

function createBatchHash(items, options = {}) {
  const payload = JSON.stringify({
    items: items.map(item => ({ url: item.url, title: item.title || '' })),
    categories: items.map(item => item.category || ''),
    distributionMode: options.distributionMode || DISTRIBUTION_AUTO,
    shops: options.shops || SHOP_SELECTION_AUTO
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function resolveDistributionMode({ itemCount, shopCount, preferredMode = DISTRIBUTION_AUTO } = {}) {
  const preferred = preferredMode || DISTRIBUTION_AUTO;
  if (preferred === DISTRIBUTION_AUTO) {
    return DISTRIBUTION_RANDOM_AVERAGE;
  }
  return preferred;
}

function resolveShopSelectionMode({ itemCount, shopCount, preferredShops = SHOP_SELECTION_AUTO } = {}) {
  const preferred = preferredShops || SHOP_SELECTION_AUTO;
  if (preferred === SHOP_SELECTION_AUTO) {
    return itemCount > 0 && shopCount > 0 && itemCount < shopCount
      ? SHOP_SELECTION_FIRST
      : SHOP_SELECTION_ALL;
  }
  return preferred;
}

function readRunRecords(stateFile = DEFAULT_STATE_FILE) {
  if (!fs.existsSync(stateFile)) return [];
  return readTextFile(stateFile)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch (err) {
        return null;
      }
    })
    .filter(Boolean);
}

function appendRunRecord(record, stateFile = DEFAULT_STATE_FILE) {
  ensureDir(path.dirname(stateFile));
  fs.appendFileSync(stateFile, JSON.stringify(record) + '\n', 'utf8');
}

function findRecentDuplicate(batchHash, stateFile = DEFAULT_STATE_FILE, windowMs = RECENT_SUBMIT_WINDOW_MS) {
  const now = Date.now();
  return readRunRecords(stateFile)
    .filter(row => row.batchHash === batchHash && row.submittedAt)
    .find(row => now - Date.parse(row.submittedAt) <= windowMs);
}

function cdpHttpBase(port = DEFAULT_CDP_PORT) {
  return `http://127.0.0.1:${port}`;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

async function listTargets(port = DEFAULT_CDP_PORT) {
  return fetchJson(`${cdpHttpBase(port)}/json/list`);
}

async function createPageTarget(port = DEFAULT_CDP_PORT, url = DEFAULT_BASE_URL) {
  const response = await fetch(`${cdpHttpBase(port)}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} creating Chrome target`);
  }
  return response.json();
}

function pickBusinessTarget(targets) {
  return targets.find(t => t.type === 'page' && t.url.includes('item.jnesoft.com/ali_view/ali_multiStore'))
    || targets.find(t => t.type === 'page' && t.url.includes('item.jnesoft.com/ali_view/ali_batchLog'))
    || targets.find(t => t.type === 'page' && t.url.includes('item.jnesoft.com'))
    || targets.find(t => t.type === 'page' && (t.url === 'about:blank' || t.url.startsWith('chrome://newtab')))
    || targets.find(t => t.type === 'page');
}

function isJnesoftTarget(target) {
  return Boolean(target && target.type === 'page' && String(target.url || '').includes('item.jnesoft.com'));
}

async function getBusinessTarget(port = DEFAULT_CDP_PORT) {
  const targets = await listTargets(port);
  const target = pickBusinessTarget(targets);
  if (!target) throw new Error('No available Chrome page target found');
  return target;
}

async function inspectBrowser(port = DEFAULT_CDP_PORT, options = {}) {
  try {
    let targets = await listTargets(port);
    let target = pickBusinessTarget(targets);
    if (options.ensureJnesoft && !isJnesoftTarget(target)) {
      await createPageTarget(port, DEFAULT_BASE_URL).catch(async () => {
        if (!target || !target.webSocketDebuggerUrl) return;
        const fallbackClient = await createCdpClientForTarget(target);
        try {
          await navigate(fallbackClient, DEFAULT_BASE_URL);
        } finally {
          await fallbackClient.close();
        }
      });
      targets = await listTargets(port);
      target = pickBusinessTarget(targets);
    }
    const jnesoftTarget = isJnesoftTarget(target);
    let pageState = null;
    let loginExpired = false;
    let loginState = { kind: 'ok', recoverable: false, reason: '' };
    if (target && target.webSocketDebuggerUrl) {
      const client = await createCdpClientForTarget(target);
      try {
        pageState = await client.evaluate(`(() => ({
          url: location.href,
          title: document.title,
          body: document.body ? document.body.innerText.slice(0, 3000) : ''
        }))()`);
        if (options.ensureJnesoft && jnesoftTarget && !String(pageState.url || '').includes('item.jnesoft.com')) {
          await navigate(client, DEFAULT_BASE_URL);
          pageState = await client.evaluate(`(() => ({
            url: location.href,
            title: document.title,
            body: document.body ? document.body.innerText.slice(0, 3000) : ''
          }))()`);
        }
        loginState = classifyLoginState(pageState);
        loginExpired = loginState.kind !== 'ok';
      } finally {
        await client.close();
      }
    }
    const jnesoftPageLoaded = jnesoftTarget && pageState && String(pageState.url || '').includes('item.jnesoft.com');
    const quotaExhausted = isDistributionQuotaExhausted(pageState || {});
    return {
      ok: !!target && jnesoftPageLoaded && !loginExpired && !quotaExhausted,
      port,
      targetCount: targets.length,
      target: target ? {
        id: target.id,
        type: target.type,
        url: target.url,
        title: target.title
      } : null,
      pageState,
      loginExpired,
      loginState,
      quotaExhausted,
      jnesoftTarget,
      jnesoftPageLoaded,
      loginRecoverable: loginState.recoverable === true,
      message: target
        ? (!jnesoftTarget
          ? 'Chrome CDP is available, but no item.jnesoft.com distribution page was found'
          : (!jnesoftPageLoaded
            ? 'Chrome CDP created a jnesoft target, but the page did not finish loading'
            : (loginExpired
            ? `Chrome CDP is available, but the distribution page needs login recovery (${loginState.kind})`
            : (quotaExhausted
              ? '铺货平台剩余额度为 0，请充值或更换可用账号后再提交'
              : 'Chrome CDP is available and a jnesoft distribution page target was found'))))
        : 'Chrome CDP is available but no reusable page target was found'
    };
  } catch (err) {
    return {
      ok: false,
      port,
      error: err.message,
      message: `Chrome CDP is not available on port ${port}`
    };
  }
}

function isLoginExpiredText(text) {
  return /登录信息已过期|重新登录|扫码登录|短信登录|密码登录|授权状态失败|获取授权状态失败|请登录/.test(String(text || ''));
}

function isLoginExpiredTextStable(text) {
  return /\u767b\u5f55\u4fe1\u606f\u5df2\u8fc7\u671f|\u91cd\u65b0\u767b\u5f55|\u626b\u7801\u767b\u5f55|\u77ed\u4fe1\u767b\u5f55|\u5bc6\u7801\u767b\u5f55|\u6388\u6743\u72b6\u6001\u5931\u8d25|\u83b7\u53d6\u6388\u6743\u72b6\u6001\u5931\u8d25|\u8bf7\u767b\u5f55|\u5e94\u7528\u6388\u6743|\u767b\u5f55\u5e76\u6388\u6743|\u70b9\u51fb\u6388\u6743\u5e76\u767b\u5f55|\u6388\u6743\u987b\u77e5/.test(String(text || ''));
}

function isDistributionQuotaExhausted(pageState = {}) {
  const body = String(pageState.body || '');
  return /(?:剩余)?额度\s*[：:]\s*0(?:\D|$)|剩余(?:次数|配额)\s*[：:]\s*0(?:\D|$)/.test(body);
}

isLoginExpiredText = isLoginExpiredTextStable;

function classifyLoginState(pageState = {}) {
  const body = String(pageState.body || '');
  const url = String(pageState.url || '');
  if (/\u626b\u7801\u767b\u5f55|\u77ed\u4fe1\u767b\u5f55|\u5bc6\u7801\u767b\u5f55|\u9a8c\u8bc1\u7801|\u5b89\u5168\u9a8c\u8bc1|\u6ed1\u5757/.test(body)) {
    return {
      kind: 'manual_login_required',
      recoverable: false,
      reason: 'manual_login_required'
    };
  }
  if (
    /oauth\.taobao\.com/.test(url)
    || /\u767b\u5f55\u5e76\u6388\u6743|\u6388\u6743\u5e76\u767b\u5f55|\u70b9\u51fb\u6388\u6743\u5e76\u767b\u5f55|\u6388\u6743\u987b\u77e5|\u5e94\u7528\u6388\u6743/.test(body)
  ) {
    return {
      kind: 'taobao_oauth_authorize',
      recoverable: true,
      reason: 'taobao_authorization'
    };
  }
  if (/\u767b\u5f55\u4fe1\u606f\u5df2\u8fc7\u671f|\u91cd\u65b0\u767b\u5f55|\u6388\u6743\u72b6\u6001\u5931\u8d25|\u83b7\u53d6\u6388\u6743\u72b6\u6001\u5931\u8d25|\u8bf7\u767b\u5f55/.test(body)) {
    return {
      kind: 'expired_modal',
      recoverable: true,
      reason: 'login_expired'
    };
  }
  if (isLoginExpiredText(body)) {
    return {
      kind: 'manual_login_required',
      recoverable: false,
      reason: 'login_required'
    };
  }
  return {
    kind: 'ok',
    recoverable: false,
    reason: ''
  };
}

async function waitForTarget(predicate, { port = DEFAULT_CDP_PORT, timeoutMs = 30000, intervalMs = 500 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const targets = await listTargets(port);
    const target = targets.find(predicate);
    if (target) return target;
    await sleep(intervalMs);
  }
  throw new Error('Timed out waiting for target');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.seq = 1;
    this.pending = new Map();
    this.ws = null;
  }

  async connect() {
    const { WebSocket } = require('ws');
    this.ws = new WebSocket(this.wsUrl);
    this.ws.on('message', data => this.handleMessage(data));
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
  }

  handleMessage(data) {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch (err) {
      return;
    }
    if (!msg.id || !this.pending.has(msg.id)) return;
    const { resolve, reject, timer } = this.pending.get(msg.id);
    this.pending.delete(msg.id);
    clearTimeout(timer);
    if (msg.error) reject(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
    else resolve(msg.result || {});
  }

  send(method, params = {}) {
    const id = this.seq++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 120000); // 2分钟超时（轮询+翻页需要更长时间）
      if (timer.unref) timer.unref();
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  async evaluate(expression, options = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: options.awaitPromise !== false,
      returnByValue: options.returnByValue !== false
    });
    if (result.exceptionDetails) {
      const ex = result.exceptionDetails.exception || {};
      throw new Error(ex.description || ex.value || result.exceptionDetails.text || 'Runtime.evaluate failed');
    }
    return result.result ? result.result.value : undefined;
  }

  async close() {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('CDP client closed'));
      this.pending.delete(id);
    }
    if (!this.ws) return;
    if (this.ws.readyState >= 2) return;
    await new Promise(resolve => {
      this.ws.once('close', resolve);
      this.ws.close();
      setTimeout(resolve, 1000).unref?.();
    });
  }
}

async function createCdpClientForTarget(target) {
  if (!target.webSocketDebuggerUrl) {
    throw new Error('Target has no webSocketDebuggerUrl');
  }
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.send('Page.enable').catch(() => {});
  await client.send('Runtime.enable').catch(() => {});
  return client;
}

function jsString(value) {
  return JSON.stringify(String(value));
}

function escapeHtmlForJs(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function pageHelpersExpression() {
  return `
    (() => {
      window.__ecom1688 = window.__ecom1688 || {};
      window.__ecom1688.visible = el => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      window.__ecom1688.hasExactText = (el, text) => (el.innerText || el.textContent || '')
        .split(/\\s+/)
        .some(part => part.trim() === text);
      window.__ecom1688.rankClickable = el => {
        const r = el.getBoundingClientRect();
        const tag = el.tagName ? el.tagName.toLowerCase() : '';
        const role = el.getAttribute && el.getAttribute('role');
        const clickable = tag === 'button' || tag === 'a' || role === 'button' || el.classList.contains('el-button') || el.classList.contains('el-link');
        return (clickable ? 0 : 100000000) + Math.max(1, r.width * r.height);
      };
      window.__ecom1688.findExactText = (text, selectors = 'button,a,li,span,div,label') =>
        Array.from(document.querySelectorAll(selectors))
          .filter(el => window.__ecom1688.visible(el) && window.__ecom1688.hasExactText(el, text))
          .sort((a, b) => window.__ecom1688.rankClickable(a) - window.__ecom1688.rankClickable(b))[0];
      window.__ecom1688.findTextContains = (text, selectors = 'button,a,li,span,div,label') =>
        Array.from(document.querySelectorAll(selectors))
          .filter(el => window.__ecom1688.visible(el) && (el.innerText || el.textContent || '').includes(text))
          .sort((a, b) => window.__ecom1688.rankClickable(a) - window.__ecom1688.rankClickable(b))[0];
      window.__ecom1688.clickExact = (text, selectors = 'button,a,li,span,div,label') => {
        const el = window.__ecom1688.findExactText(text, selectors);
        if (!el) return { ok: false, reason: text + ' not found', url: location.href, body: document.body.innerText.slice(0, 1000) };
        el.click();
        return { ok: true, text, url: location.href };
      };
      window.__ecom1688.clickContains = (text, selectors = 'button,a,li,span,div,label') => {
        const el = window.__ecom1688.findTextContains(text, selectors);
        if (!el) return { ok: false, reason: text + ' not found', url: location.href, body: document.body.innerText.slice(0, 1000) };
        el.click();
        return { ok: true, text, url: location.href };
      };
      window.__ecom1688.hoverExact = text => {
        const el = window.__ecom1688.findExactText(text);
        if (!el) return { ok: false, reason: text + ' not found', url: location.href, body: document.body.innerText.slice(0, 1000) };
        for (const type of ['mouseenter', 'mouseover', 'mousemove']) {
          el.dispatchEvent(new MouseEvent(type, { bubbles: true, view: window }));
        }
        return { ok: true, text, url: location.href };
      };
      window.__ecom1688.readState = () => ({
        url: location.href,
        title: document.title,
        body: document.body ? document.body.innerText.slice(0, 4000) : ''
      });
      return true;
    })()
  `;
}

async function readBrowserState(client) {
  await client.evaluate(pageHelpersExpression());
  return client.evaluate('window.__ecom1688.readState()');
}

async function clickText(client, text, selectors = 'button,a,span,div,label') {
  await client.evaluate(pageHelpersExpression());
  const forceClickExpression = `
    (() => {
      const text = ${jsString(text)};
      const selectors = ${jsString(selectors)};
      const el = window.__ecom1688.findExactText(text, selectors) || window.__ecom1688.findTextContains(text, selectors);
      if (!el) return { ok: false, reason: text + ' not found for force click', url: location.href };
      const target = el.closest('button,a,[role="button"],.el-button') || el;
      target.scrollIntoView && target.scrollIntoView({ block: 'center', inline: 'center' });
      target.focus && target.focus();
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      }
      target.click && target.click();
      return {
        ok: true,
        text,
        tag: target.tagName,
        className: target.className || '',
        url: location.href
      };
    })()
  `;
  if (client.send) {
    await client.send('Page.bringToFront').catch(() => {});
    await client.evaluate('window.focus && window.focus()').catch(() => {});
    const point = await client.evaluate(`
      (() => {
        const text = ${jsString(text)};
        const selectors = ${jsString(selectors)};
        const exact = window.__ecom1688.findExactText(text, selectors);
        const el = exact || window.__ecom1688.findTextContains(text, selectors);
        if (!el) return { ok: false, reason: text + ' not found', url: location.href, body: document.body.innerText.slice(0, 1000) };
        const r = el.getBoundingClientRect();
        return {
          ok: true,
          text,
          tag: el.tagName,
          x: r.left + r.width / 2,
          y: r.top + r.height / 2,
          width: r.width,
          height: r.height,
          url: location.href
        };
      })()
    `);
    if (point && point.ok && Number.isFinite(point.x) && Number.isFinite(point.y)) {
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' });
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      const domClick = await client.evaluate(forceClickExpression).catch(err => ({ ok: false, reason: err.message }));
      return { ...point, domClick };
    }
  }
  let click = await client.evaluate(forceClickExpression);
  if (click && click.ok) return click;
  click = await client.evaluate(`window.__ecom1688.clickExact(${jsString(text)}, ${jsString(selectors)})`);
  if (!click || !click.ok) {
    click = await client.evaluate(`window.__ecom1688.clickContains(${jsString(text)}, ${jsString(selectors)})`);
  }
  return click;
}

async function createRecoveryFollowupClient({ port = DEFAULT_CDP_PORT, currentWsUrl = '' } = {}) {
  const targets = await listTargets(port);
  const target = targets.find(t => t.type === 'page' && /oauth\.taobao\.com/.test(t.url || ''))
    || targets.find(t => t.type === 'page' && /itemserver\.jnesoft\.com/.test(t.url || ''));
  if (!target || !target.webSocketDebuggerUrl || target.webSocketDebuggerUrl === currentWsUrl) return null;
  const client = await createCdpClientForTarget(target);
  return { client, shouldClose: true, target };
}

async function recoverLoginIfNeeded(client, {
  state = null,
  maxSteps = 4,
  waitMs = 2500,
  port = DEFAULT_CDP_PORT,
  createFollowupClient = createRecoveryFollowupClient
} = {}) {
  let current = state || await readBrowserState(client);
  const steps = [];
  for (let step = 0; step < maxSteps; step += 1) {
    const loginState = classifyLoginState(current);
    if (loginState.kind === 'ok') {
      return {
        ok: true,
        recovered: steps.length > 0,
        steps,
        state: current
      };
    }
    if (!loginState.recoverable) {
      return {
        ok: false,
        recovered: steps.length > 0,
        steps,
        state: current,
        loginState
      };
    }

    let click = null;
    if (loginState.kind === 'expired_modal') {
      click = await clickText(client, TXT_RELOGIN, 'button,a,span,div');
    } else if (loginState.kind === 'taobao_oauth_authorize') {
      click = await clickText(client, TXT_AUTHORIZE_AND_LOGIN, 'button,a,span,div');
    }
    if (!click || !click.ok) {
      return {
        ok: false,
        recovered: steps.length > 0,
        steps,
        state: current,
        loginState,
        reason: click && click.reason ? click.reason : `Failed to click login recovery action for ${loginState.kind}`
      };
    }
    steps.push(loginState.kind);
    if (waitMs > 0) await sleep(waitMs);
    current = await readBrowserState(client);

    const nextState = classifyLoginState(current);
    if (loginState.kind === 'expired_modal' && nextState.kind === 'expired_modal') {
      if (String(current.body || '').includes(TXT_REAUTHORIZE)) {
        await clickText(client, TXT_CANCEL, 'button,a,span,div').catch(() => null);
        if (waitMs > 0) await sleep(600);
        const reauth = await clickText(client, TXT_REAUTHORIZE, 'button,a,span,div').catch(err => ({
          ok: false,
          reason: err.message
        }));
        if (reauth && reauth.ok) {
          steps.push('reauthorize_link');
          if (waitMs > 0) await sleep(waitMs);
          current = await readBrowserState(client);
        }
      }
      const followup = await createFollowupClient({
        port,
        currentWsUrl: client.wsUrl || '',
        loginState,
        state: current
      }).catch(() => null);
      if (followup && followup.client) {
        try {
          const nested = await recoverLoginIfNeeded(followup.client, {
            maxSteps: Math.max(1, maxSteps - step - 1),
            waitMs,
            port,
            createFollowupClient
          });
          steps.push(...(nested.steps || []));
          if (!nested.ok) {
            return {
              ...nested,
              recovered: steps.length > 0,
              steps
            };
          }
        } finally {
          if (followup.shouldClose && typeof followup.client.close === 'function') {
            await followup.client.close().catch(() => {});
          }
        }
        if (client.send) {
          await client.send('Page.navigate', { url: current.url || DEFAULT_BASE_URL }).catch(() => {});
          if (waitMs > 0) await sleep(waitMs);
        }
        current = await readBrowserState(client);
      }
    }
  }

  return {
    ok: false,
    recovered: steps.length > 0,
    steps,
    state: current,
    loginState: classifyLoginState(current),
    reason: 'Login recovery did not complete before timeout'
  };
}

async function recoverBrowserLogin(port = DEFAULT_CDP_PORT) {
  const target = await getBusinessTarget(port);
  const client = await createCdpClientForTarget(target);
  try {
    return await recoverLoginIfNeeded(client);
  } finally {
    await client.close();
  }
}

async function assertOrRecoverLogin(client, state, context) {
  const recovery = await recoverLoginIfNeeded(client, { state });
  if (!recovery.ok) {
    const kind = recovery.loginState && recovery.loginState.kind;
    const reason = recovery.reason || kind || 'login_required';
    throw new Error(`Login recovery failed ${context}: ${reason}; user must complete login manually`);
  }
  return recovery.state;
}

async function navigate(client, url) {
  await client.send('Page.navigate', { url });
  await sleep(2500);
}

async function ensureMultiStorePage(client, { port = DEFAULT_CDP_PORT } = {}) {
  let state = await readBrowserState(client);
  state = await assertOrRecoverLogin(client, state, 'before entering multi-store page');
  if (state.url.includes('ali_batchLog')) {
    await client.evaluate('history.back()');
    await sleep(2500);
    state = await readBrowserState(client);
    state = await assertOrRecoverLogin(client, state, 'after returning from copy log');
  }

  if (!state.url.includes('item.jnesoft.com')) {
    await navigate(client, DEFAULT_BASE_URL);
    state = await readBrowserState(client);
    state = await assertOrRecoverLogin(client, state, 'after opening distribution home');
  }

  if (state.url.includes('ali_multiStore') || state.body.includes('商品分配方式')) {
    return state;
  }

  await client.evaluate(pageHelpersExpression());
  const hover = await client.evaluate(`window.__ecom1688.hoverExact('复制上货')`);
  if (hover && hover.ok) {
    await sleep(800);
    const click = await client.evaluate(`window.__ecom1688.clickExact('多店复制')`);
    if (click && click.ok) {
      await sleep(2500);
      state = await readBrowserState(client);
      state = await assertOrRecoverLogin(client, state, 'after clicking multi-store copy');
      if (state.url.includes('ali_multiStore') || state.body.includes('商品分配方式')) return state;
    }
  }

  await navigate(client, DEFAULT_MULTI_STORE_URL);
  await waitForTarget(t => t.type === 'page' && t.url.includes('item.jnesoft.com'), { port }).catch(() => null);
  state = await readBrowserState(client);
  state = await assertOrRecoverLogin(client, state, 'after direct multi-store navigation');
  if (!state.url.includes('ali_multiStore') && !state.body.includes('商品分配方式')) {
    throw new Error('Failed to enter multi-store distribution page');
  }
  return state;
}

async function fillItems(client, text) {
  const expression = `
    (() => {
      const data = ${jsString(text)};
      const editor = document.querySelector('.ProseMirror[contenteditable="true"], [contenteditable="true"], textarea');
      if (!editor) return { ok: false, reason: 'editor not found', body: document.body.innerText.slice(0, 1000) };
      editor.focus();
      if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
        editor.value = '';
        editor.value = data;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        document.execCommand('insertText', false, data);
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data }));
        if (!(editor.innerText || '').includes(data.split('\\n')[0].slice(0, 24))) {
          editor.innerHTML = data
            .split('\\n')
            .map(line => '<p>' + line.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch])) + '</p>')
            .join('');
          editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data }));
        }
      }
      return { ok: true, text: editor.innerText || editor.value || '' };
    })()
  `;
  const result = await client.evaluate(expression);
  if (!result || !result.ok) throw new Error(result && result.reason ? result.reason : 'Failed to fill items');
  return result;
}

async function selectRandomAverageAndAllShops(client) {
  await client.evaluate(pageHelpersExpression());
  const random = await client.evaluate(`window.__ecom1688.clickExact('随机平均分配', 'label,span,div,button')`);
  if (!random || !random.ok) throw new Error(random && random.reason ? random.reason : 'Failed to select random average distribution');
  await sleep(500);
  let state = await client.evaluate('window.__ecom1688.readState()');
  if (/全选[：:]已选\s*[1-9]\d*\s*个店铺/.test(state.body || '')) {
    return state;
  }
  let selectAll = await client.evaluate(`window.__ecom1688.clickExact('全选', 'label,span,div,button')`);
  if (!selectAll || !selectAll.ok) {
    selectAll = await client.evaluate(`window.__ecom1688.clickContains('全选', 'label,span,div,button')`);
  }
  if (!selectAll || !selectAll.ok) {
    selectAll = await client.evaluate(`
      (() => {
        const labels = Array.from(document.querySelectorAll('.shopItem label.el-checkbox'));
        if (labels.length === 0) return { ok: false, reason: 'shop checkbox labels not found' };
        let clicked = 0;
        for (const label of labels) {
          const input = label.querySelector('input[type="checkbox"]');
          if (!input || input.checked) continue;
          label.click();
          clicked += 1;
        }
        return { ok: true, clicked, total: labels.length };
      })()
    `);
  }
  if (!selectAll || !selectAll.ok) throw new Error(selectAll && selectAll.reason ? selectAll.reason : 'Failed to select all shops');
  await sleep(1000);
  state = await client.evaluate('window.__ecom1688.readState()');
  if (!/全选[：:]已选\s*[1-9]\d*\s*个店铺/.test(state.body || '')) {
    await client.evaluate(`
      (() => {
        const labels = Array.from(document.querySelectorAll('.shopItem label.el-checkbox'));
        for (const label of labels) {
          const input = label.querySelector('input[type="checkbox"]');
          if (!input || input.checked) continue;
          label.dispatchEvent(new MouseEvent('click', { bubbles: true, view: window }));
        }
        return true;
      })()
    `);
    await sleep(1000);
    state = await client.evaluate('window.__ecom1688.readState()');
  }
  if (!/全选[：:]已选\s*[1-9]\d*\s*个店铺/.test(state.body || '')) {
    throw new Error('All shops were not confirmed as selected');
  }
  return state;
}

async function readShopSelectionState(client) {
  return client.evaluate(`
    (() => {
      const labels = Array.from(document.querySelectorAll('.shopItem label.el-checkbox'));
      const boxes = labels
        .map(label => label.querySelector('input[type="checkbox"]'))
        .filter(Boolean);
      const selected = boxes.filter(input => input.checked).length
        || labels.filter(label => label.classList.contains('is-checked')).length;
      const body = document.body ? document.body.innerText : '';
      const textConfirmed = ${RE_ALL_SHOPS_SELECTED}.test(body);
      return {
        ok: textConfirmed || (boxes.length > 0 && selected === boxes.length),
        selected,
        total: boxes.length,
        textConfirmed
      };
    })()
  `);
}

async function selectDistributionModeAndAllShopsStable(client, { itemCount = 0, distributionMode = DISTRIBUTION_AUTO } = {}) {
  await client.evaluate(pageHelpersExpression());

  let selection = await readShopSelectionState(client);
  const mode = resolveDistributionMode({
    itemCount,
    shopCount: selection.total || 0,
    preferredMode: distributionMode
  });
  const shopMode = resolveShopSelectionMode({
    itemCount,
    shopCount: selection.total || 0,
    preferredShops: SHOP_SELECTION_AUTO
  });
  const modeText = TXT_RANDOM_AVERAGE;
  const modeClick = await client.evaluate(`window.__ecom1688.clickExact(${jsString(modeText)}, 'label,span,div,button')`);
  if (!modeClick || !modeClick.ok) {
    throw new Error(modeClick && modeClick.reason ? modeClick.reason : `Failed to select ${modeText} distribution`);
  }
  await sleep(500);

  selection = await readShopSelectionState(client);
  if (shopMode === SHOP_SELECTION_FIRST) {
    const first = await client.evaluate(`
      (() => {
        const labels = Array.from(document.querySelectorAll('.shopItem label.el-checkbox'));
        if (labels.length === 0) return { ok: false, reason: 'shop checkbox labels not found' };
        let clicked = 0;
        labels.forEach((label, index) => {
          const input = label.querySelector('input[type="checkbox"]');
          const checked = input ? input.checked : label.classList.contains('is-checked');
          const shouldCheck = index === 0;
          if (checked !== shouldCheck) {
            label.click();
            clicked += 1;
          }
        });
        return { ok: true, clicked, total: labels.length };
      })()
    `);
    if (!first || !first.ok) throw new Error(first && first.reason ? first.reason : 'Failed to select first shop');
    await sleep(1200);
    selection = await readShopSelectionState(client);
    if (selection.selected !== 1) {
      throw new Error(`First shop was not confirmed as the only selected shop (selected=${selection.selected || 0}, total=${selection.total || 0})`);
    }
    return { ...selection, distributionMode: mode, distributionModeText: modeText, shopSelectionMode: shopMode };
  }

  if (selection.ok) return { ...selection, distributionMode: mode, distributionModeText: modeText, shopSelectionMode: shopMode };

  let selectAll = await client.evaluate(`window.__ecom1688.clickExact(${jsString(TXT_SELECT_ALL)}, 'label,span,div,button')`);
  if (!selectAll || !selectAll.ok) {
    selectAll = await client.evaluate(`window.__ecom1688.clickContains(${jsString(TXT_SELECT_ALL)}, 'label,span,div,button')`);
  }
  if (!selectAll || !selectAll.ok) {
    selectAll = await client.evaluate(`
      (() => {
        const labels = Array.from(document.querySelectorAll('.shopItem label.el-checkbox'));
        if (labels.length === 0) return { ok: false, reason: 'shop checkbox labels not found' };
        let clicked = 0;
        for (const label of labels) {
          const input = label.querySelector('input[type="checkbox"]');
          const checked = input ? input.checked : label.classList.contains('is-checked');
          if (checked) continue;
          label.click();
          clicked += 1;
        }
        return { ok: true, clicked, total: labels.length };
      })()
    `);
  }
  if (!selectAll || !selectAll.ok) throw new Error(selectAll && selectAll.reason ? selectAll.reason : 'Failed to select all shops');

  await sleep(1200);
  selection = await readShopSelectionState(client);
  if (!selection.ok) {
    await client.evaluate(`
      (() => {
        const labels = Array.from(document.querySelectorAll('.shopItem label.el-checkbox'));
        for (const label of labels) {
          const input = label.querySelector('input[type="checkbox"]');
          const checked = input ? input.checked : label.classList.contains('is-checked');
          if (checked) continue;
          label.dispatchEvent(new MouseEvent('click', { bubbles: true, view: window }));
        }
        return true;
      })()
    `);
    await sleep(1200);
    selection = await readShopSelectionState(client);
  }
  if (!selection.ok) {
    throw new Error(`All shops were not confirmed as selected (selected=${selection.selected || 0}, total=${selection.total || 0})`);
  }
  if (itemCount > 0 && selection.selected > itemCount) {
    throw new Error(`Selected shop count (${selection.selected}) exceeds product count (${itemCount}); select only the first shop for this batch`);
  }
  return { ...selection, distributionMode: mode, distributionModeText: modeText, shopSelectionMode: shopMode };
}

function validateFilledText(readText, items) {
  const normalized = String(readText || '');
  if (normalized.includes('????')) throw new Error('Filled text contains ????; stop before submit');
  for (const item of items) {
    if (!normalized.includes(item.offerId)) {
      throw new Error(`Filled text does not include offer id ${item.offerId}`);
    }
    if (item.title) {
      const probe = item.title.slice(0, Math.min(4, item.title.length));
      if (probe && !normalized.includes(probe)) {
        throw new Error(`Filled text may have lost Chinese title for offer ${item.offerId}`);
      }
    }
  }
}

function assertNoDistributionAllocationError(text) {
  const normalized = String(text || '');
  if (/提交复制商品数小于当前所选店铺数|无法分配复制|请更换分配方式/.test(normalized)) {
    throw new Error('Selected distribution mode is incompatible with product/shop count; use repeat distribution when product count is smaller than selected shop count');
  }
}

async function preSubmitCheck(client, items) {
  let state = await client.evaluate('window.__ecom1688.readState()');
  if (isLoginExpiredText(state.body)) {
    state = await assertOrRecoverLogin(client, state, 'before submit');
  }
  assertNoDistributionAllocationError(state.body);
  validateFilledText(state.body, items);
  if (state.body.includes('不合规') && !state.body.includes('其中0条不合规')) {
    throw new Error('Page reports non-compliant links; stop before submit');
  }
  if (!state.body.includes('开始批量复制')) {
    throw new Error('Start batch copy button is not visible');
  }
  return state;
}

async function preSubmitCheckStable(client, items) {
  let state = await client.evaluate('window.__ecom1688.readState()');
  if (isLoginExpiredText(state.body)) {
    state = await assertOrRecoverLogin(client, state, 'before submit');
  }
  assertNoDistributionAllocationError(state.body);
  validateFilledText(state.body, items);
  if (state.body.includes('\u4e0d\u5408\u89c4') && !state.body.includes('\u5176\u4e2d0\u6761\u4e0d\u5408\u89c4')) {
    throw new Error('Page reports non-compliant links; stop before submit');
  }
  if (!state.body.includes(TXT_START_BATCH_COPY)) {
    throw new Error('Start batch copy button is not visible');
  }
  return state;
}

async function submitAndOpenLog(client) {
  await client.evaluate(pageHelpersExpression());
  const submit = await client.evaluate(`window.__ecom1688.clickExact('开始批量复制', 'button')`);
  if (!submit || !submit.ok) throw new Error(submit && submit.reason ? submit.reason : 'Failed to click start batch copy');
  await sleep(5000);
  await client.evaluate(pageHelpersExpression());
  let state = await client.evaluate('window.__ecom1688.readState()');
  if (isLoginExpiredText(state.body)) {
    state = await assertOrRecoverLogin(client, state, 'after submit click');
  }
  assertNoDistributionAllocationError(state.body);
  if (state.url.includes('ali_batchLog')) return state;
  const logClick = await client.evaluate(`window.__ecom1688.clickExact('查看复制记录', 'button,a,span,div')`);
  if (!logClick || !logClick.ok) throw new Error(logClick && logClick.reason ? logClick.reason : 'Failed to click view copy records');
  await sleep(3000);
  await client.evaluate(pageHelpersExpression());
  state = await client.evaluate('window.__ecom1688.readState()');
  if (isLoginExpiredText(state.body)) {
    state = await assertOrRecoverLogin(client, state, 'while opening copy records');
  }
  assertNoDistributionAllocationError(state.body);
  if (!state.url.includes('ali_batchLog') && !state.body.includes('复制日志')) {
    await navigate(client, DEFAULT_BATCH_LOG_URL);
    await client.evaluate(pageHelpersExpression());
    state = await client.evaluate('window.__ecom1688.readState()');
  }
  if (!state.url.includes('ali_batchLog') && !state.body.includes('复制日志')) {
    throw new Error('Copy record page was not confirmed after submit');
  }
  return state;
}

async function submitAndOpenLogStable(client) {
  await client.evaluate(pageHelpersExpression());
  const submit = await client.evaluate(`window.__ecom1688.clickExact(${jsString(TXT_START_BATCH_COPY)}, 'button')`);
  if (!submit || !submit.ok) throw new Error(submit && submit.reason ? submit.reason : 'Failed to click start batch copy');
  await sleep(5000);
  await client.evaluate(pageHelpersExpression());
  let state = await client.evaluate('window.__ecom1688.readState()');
  if (isLoginExpiredText(state.body)) {
    state = await assertOrRecoverLogin(client, state, 'after submit click');
  }
  assertNoDistributionAllocationError(state.body);
  if (state.url.includes('ali_batchLog')) return state;
  const logClick = await client.evaluate(`window.__ecom1688.clickExact(${jsString(TXT_VIEW_COPY_RECORDS)}, 'button,a,span,div')`);
  if (!logClick || !logClick.ok) throw new Error(logClick && logClick.reason ? logClick.reason : 'Failed to click view copy records');
  await sleep(3000);
  await client.evaluate(pageHelpersExpression());
  state = await client.evaluate('window.__ecom1688.readState()');
  if (isLoginExpiredText(state.body)) {
    state = await assertOrRecoverLogin(client, state, 'while opening copy records');
  }
  assertNoDistributionAllocationError(state.body);
  if (!state.url.includes('ali_batchLog') && !state.body.includes(TXT_COPY_LOG)) {
    await navigate(client, DEFAULT_BATCH_LOG_URL);
    await client.evaluate(pageHelpersExpression());
    state = await client.evaluate('window.__ecom1688.readState()');
  }
  if (!state.url.includes('ali_batchLog') && !state.body.includes(TXT_COPY_LOG)) {
    throw new Error('Copy record page was not confirmed after submit');
  }
  return state;
}

function classifyCopyRecordText(offerIds, body, extra = {}) {
  const text = String(body || '');
  const confirmedIds = extra.perOfferId && typeof extra.perOfferId === 'object'
    ? new Set(Object.keys(extra.perOfferId))
    : null;
  const searchableText = text
    .split('\n')
    .filter(line => !line.startsWith('--- SINGLE SEARCH '))
    .join('\n');
  const foundOfferIds = confirmedIds
    ? offerIds.filter(id => confirmedIds.has(id))
    : offerIds.filter(id => searchableText.includes(id));
  const foundSet = new Set(foundOfferIds);
  const missingOfferIds = offerIds.filter(id => !foundSet.has(id));
  const perOfferId = {
    ...(extra.perOfferId && typeof extra.perOfferId === 'object' ? extra.perOfferId : {})
  };
  for (const id of foundOfferIds) {
    perOfferId[id] = {
      ...(perOfferId[id] || {}),
      status: inferOfferCopyStatus(searchableText, id)
    };
  }
  const issueOfferIds = foundOfferIds.filter(id => {
    const status = perOfferId[id] && perOfferId[id].status;
    return ['failed', 'skipped', 'stopped', 'cancelled'].includes(status);
  });
  const statusCounts = {
    copying: (text.match(RE_COPYING) || []).length,
    success: (text.match(RE_SUCCESS) || []).length,
    failed: (text.match(RE_FAILED) || []).length,
    skipped: (text.match(RE_SKIPPED) || []).length
  };
  const totalLine = text.split('\n').find(line => line.startsWith('\u5168\u90e8(')) || '';
  const status = missingOfferIds.length === 0
    ? (issueOfferIds.length > 0 ? 'completed_with_issues' : 'confirmed')
    : foundOfferIds.length > 0
      ? 'partial_confirmed'
      : 'not_confirmed';
  return {
    ...extra,
    ok: status === 'confirmed',
    status,
    foundOfferIds,
    missingOfferIds,
    issueOfferIds,
    totalLine,
    statusCounts,
    perOfferId
  };
}

function inferOfferCopyStatus(text, offerId) {
  const body = String(text || '');
  const id = String(offerId || '');
  const marker = '\u4e0a\u5bb6ID\uff1a' + id;
  const markerIndex = body.indexOf(marker);
  const idIndex = markerIndex >= 0 ? markerIndex : body.indexOf(id);
  if (idIndex < 0) return 'unknown';
  const after = body.slice(idIndex, Math.min(body.length, idIndex + 900));
  const nextIdIndex = after.slice(markerIndex >= 0 ? marker.length : id.length).search(/\u4e0a\u5bb6ID\uff1a\d{6,}/);
  const window = nextIdIndex >= 0
    ? after.slice(0, (markerIndex >= 0 ? marker.length : id.length) + nextIdIndex)
    : after;
  if (window.includes('\u8df3\u8fc7\u590d\u5236')) return 'skipped';
  if (window.includes('\u590d\u5236\u5931\u8d25')) return 'failed';
  if (window.includes('\u590d\u5236\u6210\u529f')) return 'success';
  if (window.includes('\u590d\u5236\u4e2d')) return 'copying';
  return 'unknown';
}

async function confirmCopyRecords(client, offerIds) {
  await client.evaluate(pageHelpersExpression());
  let state = await client.evaluate('window.__ecom1688.readState()');
  state = await assertOrRecoverLogin(client, state, 'before confirming copy records');
  if (!state.url.includes('ali_batchLog')) {
    await navigate(client, DEFAULT_BATCH_LOG_URL);
    state = await readBrowserState(client);
    state = await assertOrRecoverLogin(client, state, 'after opening copy records');
  }

  const result = await client.evaluate(`
    (async () => {
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const offerIds = ${JSON.stringify(offerIds)};
      const inputs = Array.from(document.querySelectorAll('input'));
      const idInput = inputs.find(el => (el.placeholder || '').includes('逗号或空格'))
        || inputs.find((el, index) => index >= 5 && !el.readOnly && !el.disabled);
      if (!idInput) {
        return { ok: false, status: 'not_confirmed', reason: 'copy log offer id input not found' };
      }
      idInput.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(idInput, offerIds.join(','));
      idInput.dispatchEvent(new Event('input', { bubbles: true }));
      idInput.dispatchEvent(new Event('change', { bubbles: true }));
      const searchButton = Array.from(document.querySelectorAll('button'))
        .find(button => (button.innerText || '').trim() === '搜索');
      if (!searchButton) {
        return { ok: false, status: 'not_confirmed', reason: 'copy log search button not found' };
      }
      searchButton.click();
      // 轮询稳定检测：连续3次检测结果一致才退出，避免6秒不够用导致误判
      let lastFoundCount = -1;
      let stableCount = 0;
      const MAX_POLL_ROUNDS = 20; // 最多轮询20次（约60秒超时）
      let pollRound = 0;
      while (stableCount < 3 && pollRound < MAX_POLL_ROUNDS) {
        await sleep(3000); // 每次间隔3秒
        pollRound++;
        const currentBody = document.body ? document.body.innerText : '';
        const currentFoundCount = offerIds.filter(id => currentBody.includes(id)).length;
        if (currentFoundCount === lastFoundCount) {
          stableCount++;
        } else {
          stableCount = 0;
          lastFoundCount = currentFoundCount;
        }
      }
      // Bug B 修复：翻页收集所有页面的 DOM 文本，避免只检测当前页导致误判
      let allBodyText = document.body ? document.body.innerText : '';
      const MAX_PAGE_TURNS = 10; // 防止无限循环
      for (let pageTurn = 0; pageTurn < MAX_PAGE_TURNS; pageTurn++) {
        // 查找"下一页"按钮或分页数字中的下一页
        const nextPageBtn = Array.from(document.querySelectorAll('a, button, span, div'))
          .find(el => {
            const text = (el.innerText || '').trim();
            return (text === '下一页' || text === '>' || text === 'Next')
              && el.offsetParent !== null; // 可见
          });
        if (!nextPageBtn) break;
        nextPageBtn.click();
        await sleep(1000); // 等待翻页渲染（1秒足够，DOM更新快）
        const pageText = document.body ? document.body.innerText : '';
        if (pageText === allBodyText) break; // 内容没变说明已经到末页
        allBodyText += '\\n--- PAGE BREAK ---\\n' + pageText;
      }
      const body = allBodyText;
      const foundOfferIds = offerIds.filter(id => body.includes(id));
      const missingOfferIds = offerIds.filter(id => !body.includes(id));
      const statusCounts = {
        copying: (body.match(/复制中/g) || []).length,
        success: (body.match(/复制成功/g) || []).length,
        failed: (body.match(/复制失败/g) || []).length,
        skipped: (body.match(/跳过复制/g) || []).length
      };
      const totalLine = body.split('\\n').find(line => line.startsWith('全部(')) || '';
      const status = foundOfferIds.length === offerIds.length
        ? 'confirmed'
        : foundOfferIds.length > 0
          ? 'partial_confirmed'
          : 'not_confirmed';
      return {
        ok: status === 'confirmed',
        status,
        foundOfferIds,
        missingOfferIds,
        issueOfferIds: [],
        totalLine,
        statusCounts,
        preview: body.slice(0, 2000),
        url: location.href
      };
    })()
  `);
  return result;
}

async function confirmCopyRecordsStable(client, offerIds) {
  await client.evaluate(pageHelpersExpression());
  let state = await client.evaluate('window.__ecom1688.readState()');
  state = await assertOrRecoverLogin(client, state, 'before confirming copy records');
  if (!state.url.includes('ali_batchLog')) {
    await navigate(client, DEFAULT_BATCH_LOG_URL);
    state = await readBrowserState(client);
    state = await assertOrRecoverLogin(client, state, 'after opening copy records');
  }

  const pageResult = await client.evaluate(`
    (async () => {
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const offerIds = ${JSON.stringify(offerIds)};
      const visible = el => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const inputs = () => Array.from(document.querySelectorAll('input'));
      const idInput = inputs().find(el => (el.placeholder || '').includes(${jsString(TXT_COMMA_OR_SPACE)}))
        || inputs().find((el, index) => index >= 5 && !el.readOnly && !el.disabled);
      if (!idInput) {
        return { ok: false, status: 'not_confirmed', reason: 'copy log offer id input not found' };
      }
      const searchButton = Array.from(document.querySelectorAll('button'))
        .find(button => visible(button) && (button.innerText || '').trim() === ${jsString(TXT_SEARCH)});
      if (!searchButton) {
        return { ok: false, status: 'not_confirmed', reason: 'copy log search button not found' };
      }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const setSearchValue = value => {
        idInput.focus();
        setter.call(idInput, value);
        idInput.dispatchEvent(new Event('input', { bubbles: true }));
        idInput.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const collectPages = async (maxPages = 8) => {
        let allText = document.body ? document.body.innerText : '';
        for (let pageTurn = 0; pageTurn < maxPages; pageTurn++) {
          const before = document.body ? document.body.innerText : '';
          const nextPageBtn = Array.from(document.querySelectorAll('a, button, span, div'))
            .find(el => {
              const text = (el.innerText || '').trim();
              const disabled = el.classList.contains('disabled') || el.classList.contains('is-disabled') || el.getAttribute('aria-disabled') === 'true';
              return visible(el) && !disabled && (text === '\\u4e0b\\u4e00\\u9875' || text === '>' || text === 'Next');
            });
          if (!nextPageBtn) break;
          nextPageBtn.click();
          await sleep(1000);
          const after = document.body ? document.body.innerText : '';
          if (after === before || allText.includes(after.slice(0, 120))) break;
          allText += '\\n--- PAGE BREAK ---\\n' + after;
        }
        return allText;
      };
      const runSearch = async (query, waitMs) => {
        setSearchValue(query);
        searchButton.click();
        await sleep(waitMs);
        return collectPages(query.includes(',') ? 10 : 2);
      };

      let combinedText = await runSearch(offerIds.join(','), 2500);
      let found = new Set(offerIds.filter(id => combinedText.includes(id)));
      const perOfferId = {};
      for (const id of found) perOfferId[id] = { source: 'batch' };

      const missingAfterBatch = offerIds.filter(id => !found.has(id));
      for (const id of missingAfterBatch) {
        const singleText = await runSearch(id, 1800);
        combinedText += '\\n--- SINGLE SEARCH ' + id + ' ---\\n' + singleText;
        if (singleText.includes(id)) {
          found.add(id);
          perOfferId[id] = { source: 'single' };
        }
      }

      return {
        ok: found.size === offerIds.length,
        text: combinedText,
        perOfferId,
        preview: combinedText.slice(0, 2000),
        url: location.href
      };
    })()
  `);

  if (!pageResult || pageResult.reason) {
    return pageResult || { ok: false, status: 'not_confirmed', reason: 'copy log confirmation failed' };
  }
  return classifyCopyRecordText(offerIds, pageResult.text, {
    preview: pageResult.preview,
    url: pageResult.url,
    perOfferId: pageResult.perOfferId || {}
  });
}

async function distributeProducts(options = {}) {
  const input = options.inputFile ? readTextFile(options.inputFile) : options.input;
  const items = parseItems(input);
  if (items.length === 0) throw new Error('No distribution items provided');
  const batches = splitBatches(items, options.batchSize || 20);
  const port = parseInt(options.port || process.env.BROWSER_CDP_PORT || process.env.CHROME_DEBUG_PORT || DEFAULT_CDP_PORT, 10);
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const results = [];
  let stoppedStatus = null;

  const reportProgress = async (event) => {
    if (typeof options.onProgress === 'function') {
      await options.onProgress({
        total: items.length,
        batchTotal: batches.length,
        results: results.slice(),
        ...event
      });
    }
  };

  const control = async (event = {}) => {
    if (typeof options.shouldStop === 'function') {
      const action = await options.shouldStop({
        total: items.length,
        batchTotal: batches.length,
        results: results.slice(),
        ...event
      });
      if (action === 'cancel' || action === 'pause') return action;
    }
    return null;
  };

  for (let i = 0; i < batches.length; i += 1) {
    const batchItems = batches[i];
    const batchIndex = i + 1;
    const requestedAction = await control({ batchIndex, batchItems, phase: 'before_batch' });
    if (requestedAction) {
      stoppedStatus = requestedAction;
      await reportProgress({ batchIndex, phase: requestedAction, status: requestedAction });
      break;
    }
    await reportProgress({ batchIndex, batchItems, phase: 'batch_started', status: 'running' });
    const batchHash = createBatchHash(batchItems, options);
    const duplicate = findRecentDuplicate(batchHash, stateFile);
    if (duplicate && !options.force) {
      results.push({
        ok: false,
        skipped: true,
        reason: 'recent_duplicate',
        batchIndex: i + 1,
        batchHash,
        duplicate
      });
      await reportProgress({ batchIndex, batchItems, phase: 'batch_skipped', status: 'skipped' });
      continue;
    }
    if (options.dryRun) {
      results.push({
        ok: true,
        dryRun: true,
        batchIndex: i + 1,
        count: batchItems.length,
        offerIds: batchItems.map(item => item.offerId),
        batchHash,
        input: normalizeItemsForInput(batchItems)
      });
      await reportProgress({ batchIndex, batchItems, phase: 'batch_completed', status: 'completed' });
      continue;
    }

    const target = await getBusinessTarget(port);
    const client = await createCdpClientForTarget(target);
    try {
      await ensureMultiStorePage(client, { port });
      const filled = await fillItems(client, normalizeItemsForInput(batchItems));
      validateFilledText(filled.text, batchItems);
      const shopSelection = await selectDistributionModeAndAllShopsStable(client, {
        itemCount: batchItems.length,
        distributionMode: options.distributionMode || DISTRIBUTION_AUTO
      });
      await preSubmitCheckStable(client, batchItems);
      const logState = await submitAndOpenLogStable(client);
      const confirmation = await confirmCopyRecordsStable(client, batchItems.map(item => item.offerId));
      if (confirmation.status !== 'confirmed') {
        results.push({
          ok: false,
          status: confirmation.status || 'not_confirmed',
          batchIndex: i + 1,
          count: batchItems.length,
          offerIds: batchItems.map(item => item.offerId),
          batchHash,
          distributionMode: shopSelection.distributionMode,
          shopSelectionMode: shopSelection.shopSelectionMode,
          logUrl: logState.url,
          confirmation
        });
        await reportProgress({ batchIndex, batchItems, phase: 'batch_completed', status: confirmation.status || 'failed' });
        continue;
      }
      appendRunRecord({
        batchHash,
        submittedAt: new Date().toISOString(),
        count: batchItems.length,
        offerIds: batchItems.map(item => item.offerId),
        status: 'submitted',
        distributionMode: shopSelection.distributionMode,
        shopSelectionMode: shopSelection.shopSelectionMode,
        logUrl: logState.url,
        confirmation
      }, stateFile);
      results.push({
        ok: true,
        status: 'confirmed',
        batchIndex: i + 1,
        count: batchItems.length,
        offerIds: batchItems.map(item => item.offerId),
        batchHash,
        distributionMode: shopSelection.distributionMode,
        shopSelectionMode: shopSelection.shopSelectionMode,
        logUrl: logState.url,
        confirmation,
        logPreview: confirmation.preview || logState.body.slice(0, 1000)
      });
      await reportProgress({ batchIndex, batchItems, phase: 'batch_completed', status: 'confirmed' });
    } finally {
      await client.close();
    }

    const requestedAfterBatch = await control({ batchIndex, batchItems, phase: 'after_batch' });
    if (requestedAfterBatch) {
      stoppedStatus = requestedAfterBatch;
      await reportProgress({ batchIndex, batchItems, phase: requestedAfterBatch, status: requestedAfterBatch });
      break;
    }
  }

  const reviewStatuses = ['partial_confirmed', 'not_confirmed', 'completed_with_issues'];
  const hasReviewStatus = status => reviewStatuses.includes(status);
  const reviewRows = results.filter(row =>
    row.skipped
    || hasReviewStatus(row.status)
    || (row.confirmation && hasReviewStatus(row.confirmation.status))
  );
  const ok = options.dryRun
    ? results.every(row => row.ok)
    : results.every(row => row.ok);
  return withAgentResponseFields({
    ok: stoppedStatus ? false : ok,
    total: items.length,
    batches: results,
    canSubmit: !options.dryRun && !stoppedStatus && ok,
    status: stoppedStatus || (ok ? 'confirmed' : 'completed_with_issues'),
    stoppedStatus,
    mustReview: reviewRows.length > 0,
    blockers: reviewRows.map(row => row.reason || row.status || (row.confirmation && row.confirmation.status)),
    nextActionCode: options.dryRun
      ? 'review_dry_run'
      : reviewRows.some(row => row.reason === 'recent_duplicate')
        ? 'blocked_recent_duplicate'
        : reviewRows.some(row => row.status === 'completed_with_issues' || (row.confirmation && row.confirmation.status === 'completed_with_issues'))
        ? 'report_completed_with_issues'
        : results.some(row => row.status === 'partial_confirmed')
        ? 'report_partial_confirmed'
        : results.some(row => row.status === 'not_confirmed')
          ? 'report_not_confirmed'
          : 'report_confirmed',
    nextAction: options.dryRun
      ? 'Review this dry-run output. If item count and batches are correct, rerun the same command with --submit.'
      : 'Report copy record status to the user. If status is partial_confirmed, not_confirmed, or completed_with_issues, do not retry automatically.'
  });
}

async function confirmDistributionLog(options = {}) {
  const input = options.inputFile ? readTextFile(options.inputFile) : options.input;
  const items = parseItems(input);
  if (items.length === 0) throw new Error('No distribution items provided');
  const offerIds = items.map(item => item.offerId);
  const client = options.client || await createCdpClientForTarget(await getBusinessTarget(
    parseInt(options.port || process.env.BROWSER_CDP_PORT || process.env.CHROME_DEBUG_PORT || DEFAULT_CDP_PORT, 10)
  ));
  const shouldClose = !options.client;
  try {
    const confirmation = await confirmCopyRecordsStable(client, offerIds);
    const blockers = [];
    if (confirmation.missingOfferIds && confirmation.missingOfferIds.length) blockers.push('missing_offer_ids');
    if (confirmation.issueOfferIds && confirmation.issueOfferIds.length) blockers.push('copy_record_issues');
    return withAgentResponseFields({
      ok: confirmation.ok === true,
      status: confirmation.status || 'not_confirmed',
      total: items.length,
      offerIds,
      confirmation,
      mustReview: confirmation.ok !== true,
      blockers,
      nextActionCode: confirmation.ok === true ? 'report_confirmed' : 'report_copy_record_issues',
      nextAction: confirmation.ok === true
        ? 'Report confirmed copy log status.'
        : 'Report copy log issues. Do not retry submit automatically.'
    });
  } finally {
    if (shouldClose) await client.close();
  }
}

async function checkDistributionReadiness(options = {}) {
  const input = options.inputFile ? readTextFile(options.inputFile) : options.input;
  const port = parseInt(options.port || process.env.BROWSER_CDP_PORT || process.env.CHROME_DEBUG_PORT || DEFAULT_CDP_PORT, 10);
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const items = parseItems(input);
  const batches = splitBatches(items, options.batchSize || 20).map((batchItems, index) => {
    const batchHash = createBatchHash(batchItems, options);
    const duplicate = findRecentDuplicate(batchHash, stateFile);
    return {
      batchIndex: index + 1,
      count: batchItems.length,
      offerIds: batchItems.map(item => item.offerId),
      batchHash,
      duplicate: duplicate || null
    };
  });
  let browser = options.skipBrowser ? { ok: true, skipped: true } : await inspectBrowser(port, { ensureJnesoft: true });
  if (!options.skipBrowser && browser.loginRecoverable) {
    const recovery = await recoverBrowserLogin(port).catch(err => ({
      ok: false,
      reason: err.message
    }));
    browser = await inspectBrowser(port, { ensureJnesoft: true });
    browser.loginRecovery = recovery;
  }
  const duplicates = batches.filter(batch => batch.duplicate);
  const ok = items.length > 0 && browser.ok && duplicates.length === 0;
  const blockers = getReadinessBlockers({ itemCount: items.length, browser, duplicates });
  return withAgentResponseFields({
    ok,
    status: ok ? 'ready' : 'blocked',
    canSubmit: ok,
    mustReview: !ok,
    total: items.length,
    batchSize: parseInt(options.batchSize, 10) || 20,
    batches,
    browser,
    blockers,
    allowedCommands: ok ? ['rerun_with_submit'] : [],
    nextActionCode: ok ? 'submit_ready' : 'fix_blockers',
    nextAction: ok
      ? 'Review this readiness result. If it is correct, rerun the same command with --submit to submit.'
      : 'Fix blockers before submitting. Do not click Start Batch Copy manually.'
  });
}

function getReadinessBlockers({ itemCount, browser, duplicates }) {
  const blockers = [];
  if (itemCount === 0) blockers.push('empty_input');
  if (!browser.ok) {
    if (browser.loginExpired) blockers.push('login_expired');
    else if (browser.quotaExhausted) blockers.push('distribution_quota_exhausted');
    else blockers.push('browser_cdp_unavailable');
  }
  if (duplicates.length > 0) blockers.push('recent_duplicate_batch');
  return blockers;
}

module.exports = {
  DEFAULT_CDP_PORT,
  DEFAULT_STATE_FILE,
  parseItems,
  splitBatches,
  normalizeItemsForInput,
  createBatchHash,
  resolveDistributionMode,
  resolveShopSelectionMode,
  readRunRecords,
  appendRunRecord,
  findRecentDuplicate,
  inspectBrowser,
  isLoginExpiredText,
  isDistributionQuotaExhausted,
  classifyLoginState,
  recoverLoginIfNeeded,
  getReadinessBlockers,
  confirmCopyRecords,
  confirmCopyRecordsStable,
  classifyCopyRecordText,
  inferOfferCopyStatus,
  confirmDistributionLog,
  checkDistributionReadiness,
  distributeProducts
};
