const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_CDP_PORT = 9222;
const DEFAULT_BASE_URL = 'https://item.jnesoft.com/';
const DEFAULT_MULTI_STORE_URL = 'https://item.jnesoft.com/ali_view/ali_multiStore';
const DEFAULT_BATCH_LOG_URL = 'https://item.jnesoft.com/ali_view/ali_batchLog';
const DEFAULT_STATE_FILE = path.join(process.cwd(), 'data', 'distribution-runs.jsonl');
const RECENT_SUBMIT_WINDOW_MS = 30 * 60 * 1000;

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
    distributionMode: options.distributionMode || 'random-average',
    shops: options.shops || 'all'
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
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

function pickBusinessTarget(targets) {
  return targets.find(t => t.type === 'page' && t.url.includes('item.jnesoft.com/ali_view/ali_multiStore'))
    || targets.find(t => t.type === 'page' && t.url.includes('item.jnesoft.com/ali_view/ali_batchLog'))
    || targets.find(t => t.type === 'page' && t.url.includes('item.jnesoft.com'))
    || targets.find(t => t.type === 'page' && (t.url === 'about:blank' || t.url.startsWith('chrome://newtab')))
    || targets.find(t => t.type === 'page');
}

async function getBusinessTarget(port = DEFAULT_CDP_PORT) {
  const targets = await listTargets(port);
  const target = pickBusinessTarget(targets);
  if (!target) throw new Error('No available Chrome page target found');
  return target;
}

async function inspectBrowser(port = DEFAULT_CDP_PORT) {
  try {
    const targets = await listTargets(port);
    const target = pickBusinessTarget(targets);
    let pageState = null;
    let loginExpired = false;
    if (target && target.webSocketDebuggerUrl) {
      const client = await createCdpClientForTarget(target);
      try {
        pageState = await client.evaluate(`(() => ({
          url: location.href,
          title: document.title,
          body: document.body ? document.body.innerText.slice(0, 3000) : ''
        }))()`);
        loginExpired = isLoginExpiredText(pageState.body || '');
      } finally {
        await client.close();
      }
    }
    return {
      ok: !!target && !loginExpired,
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
      message: target
        ? (loginExpired
          ? 'Chrome CDP is available, but the distribution page login/authorization is expired'
          : 'Chrome CDP is available and a reusable page target was found')
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
    const { resolve, reject } = this.pending.get(msg.id);
    this.pending.delete(msg.id);
    if (msg.error) reject(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
    else resolve(msg.result || {});
  }

  send(method, params = {}) {
    const id = this.seq++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 120000); // 2分钟超时（轮询+翻页需要更长时间）
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
    if (this.ws) this.ws.close();
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
      window.__ecom1688.findExactText = (text, selectors = 'button,a,li,span,div,label') =>
        Array.from(document.querySelectorAll(selectors))
          .find(el => window.__ecom1688.visible(el) && window.__ecom1688.hasExactText(el, text));
      window.__ecom1688.findTextContains = (text, selectors = 'button,a,li,span,div,label') =>
        Array.from(document.querySelectorAll(selectors))
          .find(el => window.__ecom1688.visible(el) && (el.innerText || el.textContent || '').includes(text));
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

async function navigate(client, url) {
  await client.send('Page.navigate', { url });
  await sleep(2500);
}

async function ensureMultiStorePage(client, { port = DEFAULT_CDP_PORT } = {}) {
  await client.evaluate(pageHelpersExpression());
  let state = await client.evaluate('window.__ecom1688.readState()');
  if (state.url.includes('ali_batchLog')) {
    await client.evaluate('history.back()');
    await sleep(2500);
    await client.evaluate(pageHelpersExpression());
    state = await client.evaluate('window.__ecom1688.readState()');
  }

  if (!state.url.includes('item.jnesoft.com')) {
    await navigate(client, DEFAULT_BASE_URL);
    await client.evaluate(pageHelpersExpression());
    state = await client.evaluate('window.__ecom1688.readState()');
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
      await client.evaluate(pageHelpersExpression());
      state = await client.evaluate('window.__ecom1688.readState()');
      if (state.url.includes('ali_multiStore') || state.body.includes('商品分配方式')) return state;
    }
  }

  await navigate(client, DEFAULT_MULTI_STORE_URL);
  await waitForTarget(t => t.type === 'page' && t.url.includes('item.jnesoft.com'), { port }).catch(() => null);
  await client.evaluate(pageHelpersExpression());
  state = await client.evaluate('window.__ecom1688.readState()');
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

async function preSubmitCheck(client, items) {
  const state = await client.evaluate('window.__ecom1688.readState()');
  if (isLoginExpiredText(state.body)) {
    throw new Error('Login expired or authorization failed before submit; user must log in again');
  }
  validateFilledText(state.body, items);
  if (state.body.includes('不合规') && !state.body.includes('其中0条不合规')) {
    throw new Error('Page reports non-compliant links; stop before submit');
  }
  if (!state.body.includes('开始批量复制')) {
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
    throw new Error('Login expired or authorization failed after submit click; user must log in again before distribution can continue');
  }
  if (state.url.includes('ali_batchLog')) return state;
  const logClick = await client.evaluate(`window.__ecom1688.clickExact('查看复制记录', 'button,a,span,div')`);
  if (!logClick || !logClick.ok) throw new Error(logClick && logClick.reason ? logClick.reason : 'Failed to click view copy records');
  await sleep(3000);
  await client.evaluate(pageHelpersExpression());
  state = await client.evaluate('window.__ecom1688.readState()');
  if (isLoginExpiredText(state.body)) {
    throw new Error('Login expired or authorization failed while opening copy records');
  }
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

async function confirmCopyRecords(client, offerIds) {
  await client.evaluate(pageHelpersExpression());
  let state = await client.evaluate('window.__ecom1688.readState()');
  if (!state.url.includes('ali_batchLog')) {
    await navigate(client, DEFAULT_BATCH_LOG_URL);
    await client.evaluate(pageHelpersExpression());
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
        totalLine,
        statusCounts,
        preview: body.slice(0, 2000),
        url: location.href
      };
    })()
  `);
  return result;
}

async function distributeProducts(options = {}) {
  const input = options.inputFile ? readTextFile(options.inputFile) : options.input;
  const items = parseItems(input);
  if (items.length === 0) throw new Error('No distribution items provided');
  const batches = splitBatches(items, options.batchSize || 20);
  const port = parseInt(options.port || process.env.BROWSER_CDP_PORT || process.env.CHROME_DEBUG_PORT || DEFAULT_CDP_PORT, 10);
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const results = [];

  for (let i = 0; i < batches.length; i += 1) {
    const batchItems = batches[i];
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
      continue;
    }

    const target = await getBusinessTarget(port);
    const client = await createCdpClientForTarget(target);
    try {
      await ensureMultiStorePage(client, { port });
      const filled = await fillItems(client, normalizeItemsForInput(batchItems));
      validateFilledText(filled.text, batchItems);
      await selectRandomAverageAndAllShops(client);
      await preSubmitCheck(client, batchItems);
      const logState = await submitAndOpenLog(client);
      const confirmation = await confirmCopyRecords(client, batchItems.map(item => item.offerId));
      if (confirmation.status !== 'confirmed') {
        results.push({
          ok: false,
          status: confirmation.status || 'not_confirmed',
          batchIndex: i + 1,
          count: batchItems.length,
          offerIds: batchItems.map(item => item.offerId),
          batchHash,
          logUrl: logState.url,
          confirmation
        });
        continue;
      }
      appendRunRecord({
        batchHash,
        submittedAt: new Date().toISOString(),
        count: batchItems.length,
        offerIds: batchItems.map(item => item.offerId),
        status: 'submitted',
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
        logUrl: logState.url,
        confirmation,
        logPreview: confirmation.preview || logState.body.slice(0, 1000)
      });
    } finally {
      await client.close();
    }
  }

  return {
    ok: results.every(row => row.ok || row.skipped),
    total: items.length,
    batches: results,
    canSubmit: !options.dryRun && results.every(row => row.ok || row.skipped),
    mustReview: results.some(row => row.status === 'partial_confirmed' || row.status === 'not_confirmed'),
    blockers: results
      .filter(row => row.status === 'partial_confirmed' || row.status === 'not_confirmed')
      .map(row => row.status),
    nextActionCode: options.dryRun
      ? 'review_dry_run'
      : results.some(row => row.status === 'partial_confirmed')
        ? 'report_partial_confirmed'
        : results.some(row => row.status === 'not_confirmed')
          ? 'report_not_confirmed'
          : 'report_confirmed',
    nextAction: options.dryRun
      ? 'Review this dry-run output. If item count and batches are correct, rerun without --dry-run.'
      : 'Report copy record status to the user. If status is partial_confirmed or not_confirmed, do not retry automatically.'
  };
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
  const browser = options.skipBrowser ? { ok: true, skipped: true } : await inspectBrowser(port);
  const duplicates = batches.filter(batch => batch.duplicate);
  const ok = items.length > 0 && browser.ok && duplicates.length === 0;
  return {
    ok,
    status: ok ? 'ready' : 'blocked',
    canSubmit: ok,
    mustReview: !ok,
    total: items.length,
    batchSize: parseInt(options.batchSize, 10) || 20,
    batches,
    browser,
    blockers: [
      ...(items.length === 0 ? ['empty_input'] : []),
      ...(!browser.ok ? ['browser_cdp_unavailable'] : []),
      ...(duplicates.length > 0 ? ['recent_duplicate_batch'] : [])
    ],
    allowedCommands: ok ? ['rerun_without_check_or_dry_run'] : [],
    nextActionCode: ok ? 'submit_ready' : 'fix_blockers',
    nextAction: ok
      ? 'Run the same command without --check and without --dry-run to submit.'
      : 'Fix blockers before submitting. Do not click Start Batch Copy manually.'
  };
}

module.exports = {
  DEFAULT_CDP_PORT,
  DEFAULT_STATE_FILE,
  parseItems,
  splitBatches,
  normalizeItemsForInput,
  createBatchHash,
  readRunRecords,
  appendRunRecord,
  findRecentDuplicate,
  inspectBrowser,
  confirmCopyRecords,
  checkDistributionReadiness,
  distributeProducts
};
