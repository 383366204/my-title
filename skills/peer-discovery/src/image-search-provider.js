'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { CdpClient } = require('../../alibaba1688/src/search-web-1688');
const { runWithPlatformGuard, PlatformAccessError } = require('../../../core/platform-access-guard');
const { readImageSearchCards, normalizeImageSearchCard } = require('./image-search-cards');

const INPUT_SELECTOR = 'input[type="file"][aria-label="以图搜款"]';
const SEARCH_SELECTOR = 'button[class*="actionPrimary--"]';
const RESULT_PATH = '/kapp/1688-search/pc-image-search/';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function stopped(signal) {
  if (signal?.aborted) throw Object.assign(new Error('图搜已中断'), { code: 'PLATFORM_ACCESS_INTERRUPTED' });
}

/**
 * Classify only explicit platform blockers, never an ordinary login navigation link.
 * @param {object} state Observed page URL, text and visible challenge flag.
 * @returns {string|null} Platform guard status.
 */
function imagePageBlocker(state) {
  if (state.challengeVisible || /请完成安全验证|拖动滑块|访问验证|验证码验证/.test(state.text || '')) return 'captcha_required';
  if (/访问过于频繁|操作过于频繁|稍后再试.*频繁/.test(state.text || '')) return 'rate_limited';
  if (/passport\.1688\.com|login\.taobao\.com/.test(state.url || '') || /请先登录后.*(?:图搜|搜索)/.test(state.text || '')) return 'login_required';
  return null;
}

/**
 * Download public Alibaba CDN images with bounded size and no redirects.
 * @param {string} imageUrl Public product image URL.
 * @param {object} options Abort signal.
 * @returns {Promise<object>} Image bytes, extension and content digest.
 */
async function downloadSearchImage(imageUrl, options = {}) {
  const url = new URL(imageUrl);
  if (url.protocol !== 'https:' || !/(^|\.)alicdn\.com$/.test(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('图搜图片须为 HTTPS 阿里商品图片地址');
  }
  stopped(options.signal);
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000);
  const response = await fetch(url, { redirect: 'error', signal });
  if (!response.ok) throw new Error(`图片下载失败：HTTP ${response.status}`);
  const size = Number(response.headers.get('content-length'));
  if (size > MAX_IMAGE_BYTES) { await response.body?.cancel(); throw new Error('图片超过10MB'); }
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > MAX_IMAGE_BYTES) throw new Error('图片超过10MB');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const extension = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'jpg'
    : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
    : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' ? 'webp' : null;
  if (!extension) throw new Error('图片格式不支持，仅支持 JPEG、PNG、WEBP');
  return { bytes, extension, digest: createHash('sha256').update(bytes).digest('hex') };
}

async function pageState(client) {
  return client.evaluate(`({url:location.href,text:document.body?.innerText.slice(0,1800)||'',challengeVisible:Array.from(document.querySelectorAll('iframe[src*="captcha"],iframe[src*="punish"],#nc_1_wrapper')).some(e=>e.getBoundingClientRect().height>0)})`);
}

async function poll(check, { signal, timeoutMs = 30000, message }) {
  const deadline = Date.now() + timeoutMs;
  do {
    stopped(signal);
    const value = await check();
    if (value) return value;
    await delay(500);
  } while (Date.now() < deadline);
  throw Object.assign(new Error(message), { code: 'IMAGE_SEARCH_TIMEOUT', platform: '1688' });
}

async function assertPage(client) {
  const state = await pageState(client);
  const status = imagePageBlocker(state);
  if (status) throw new PlatformAccessError('1688图搜需要处理登录或安全验证，请处理浏览器后重试', { platform: '1688', status });
  return state;
}

/**
 * Create an image-only provider using the user's existing debug Chrome session.
 * @param {object} options Port, progress callback and platform guard options.
 * @returns {object} Provider with search(source, {signal}).
 */
function createImageSearchProvider(options = {}) {
  const port = options.port ?? 9222;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Chrome端口无效');
  return {
    async search(source, { signal } = {}) {
      const image = await downloadSearchImage(source.imageUrl || source.mainImageUrl, { signal });
      if (source.imageDigest && source.imageDigest !== image.digest) {
        throw Object.assign(new Error('商品图片已变化，请刷新源商品证据'), { code: 'IMAGE_EVIDENCE_CHANGED' });
      }
      return runWithPlatformGuard('1688', {
        ...options.guardOptions, cache: false,
        shouldStop: () => signal?.aborted,
        onCooldown: options.onCooldown,
        // 上传与结果等待覆盖整个会话，避免活跃操作被当作陈旧锁清理。
        staleLockMs: 300000, lockTimeoutMs: 300000
      }, async () => {
        stopped(signal);
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-image-search-'));
        let browser;
        let home;
        let result;
        const targets = [];
        let success = false;
        try {
          const version = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(5000) }).then(r => r.json());
          browser = new CdpClient(version.webSocketDebuggerUrl);
          const created = await browser.send('Target.createTarget', { url: 'https://www.1688.com/' });
          targets.push(created.targetId);
          home = new CdpClient(`ws://127.0.0.1:${port}/devtools/page/${created.targetId}`);
          options.onProgress?.({ message: '等待1688图搜上传入口' });
          await poll(async () => {
            await assertPage(home);
            return home.evaluate(`Boolean(document.querySelector(${JSON.stringify(INPUT_SELECTOR)}))`);
          }, { signal, message: '没有找到1688图片上传入口' });
          const file = path.join(tempDir, `image.${image.extension}`);
          await fs.writeFile(file, image.bytes);
          const { root } = await home.send('DOM.getDocument');
          const { nodeId } = await home.send('DOM.querySelector', { nodeId: root.nodeId, selector: INPUT_SELECTOR });
          await home.send('DOM.setFileInputFiles', { nodeId, files: [file] });
          await poll(async () => {
            await assertPage(home);
            return home.evaluate(`document.body.innerText.includes('已上传1张图') && Boolean(document.querySelector(${JSON.stringify(SEARCH_SELECTOR)}))`);
          }, { signal, message: '1688图片上传未完成，请检查页面提示' });
          stopped(signal);
          await home.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(SEARCH_SELECTOR)}).click()`, userGesture: true });
          const target = await poll(async () => {
            await assertPage(home);
            const { targetInfos } = await browser.send('Target.getTargets');
            return targetInfos.find(t => {
              if (t.openerId !== created.targetId && t.targetId !== created.targetId) return false;
              try { const url = new URL(t.url); return url.hostname === 'air.1688.com' && url.pathname === RESULT_PATH; } catch (_) { return false; }
            });
          }, { signal, message: '1688图搜结果页未打开' });
          if (target.targetId !== created.targetId) targets.push(target.targetId);
          result = new CdpClient(`ws://127.0.0.1:${port}/devtools/page/${target.targetId}`);
          options.onProgress?.({ message: '读取1688图搜候选商品' });
          const raw = await poll(async () => {
            await assertPage(result);
            const rows = await result.evaluate(`(${readImageSearchCards.toString()})()`);
            return rows.length ? rows : null;
          }, { signal, timeoutMs: 45000, message: '图搜未读取到商品，无法确认是空结果还是页面未加载' });
          stopped(signal);
          const now = Date.now();
          const candidates = [...new Map(raw.map(row => normalizeImageSearchCard(row, { now, maxAgeMs: options.evidenceMaxAgeMs ?? 86400000 })).filter(Boolean).map(row => [row.offerId, row])).values()];
          if (!candidates.length) throw new Error('图搜卡片缺少商品身份信息');
          success = true;
          return { ok: true, complete: false, candidates, imageDigest: image.digest, collectedAt: now, resultUrl: target.url, scope: 'loaded_cards' };
        } finally {
          result?.close();
          home?.close();
          // 失败保留本次页面供人工处理；成功只清理本次创建的标签页。
          if (success && browser) for (const targetId of targets) await browser.send('Target.closeTarget', { targetId }).catch(() => {});
          browser?.close();
          await fs.rm(tempDir, { recursive: true, force: true });
        }
      });
    }
  };
}

module.exports = { createImageSearchProvider, downloadSearchImage, imagePageBlocker };
