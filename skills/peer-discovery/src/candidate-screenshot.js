'use strict';

/**
 * 读取目标卡片位置并临时编号；代码在页面执行，不读取私有应用状态。
 * @param {string[]} ids 按页面顺序排列的商品ID。
 * @param {string} action inspect、scroll、mark 或 clean。
 * @returns {object[]} 候选位置和图片就绪信息。
 */
function locateScreenshotCards(ids, action = 'inspect') {
  const markerAttribute = 'data-peer-screenshot-label';
  if (action === 'clean') {
    document.querySelectorAll(`[${markerAttribute}]`).forEach(node => node.remove());
    return [];
  }
  const cards = [...document.querySelectorAll('[data-tracker="offer"]')];
  return ids.map((id, index) => {
    const card = cards.find(node => String(node.getAttribute('data-renderkey') || '').match(/_(\d+)$/)?.[1] === id);
    if (!card) return { id, missing: true };
    if (action === 'scroll') card.scrollIntoView({ block: 'center', behavior: 'instant' });
    const box = card.getBoundingClientRect();
    const img = card.querySelector('img[class*="mainImg--"]');
    const row = { id, number: index + 1, x: box.x + scrollX, y: box.y + scrollY,
      width: box.width, height: box.height, imageUrl: img?.currentSrc || img?.src || '',
      ready: Boolean(img?.complete && img.naturalWidth > 0) };
    if (action === 'mark') {
      const label = document.createElement('span');
      label.setAttribute(markerAttribute, ''); label.textContent = `候选 ${index + 1}`;
      Object.assign(label.style, { position: 'absolute', left: `${row.x}px`, top: `${row.y}px`,
        zIndex: '2147483647', color: '#fff', background: '#111', padding: '3px 6px', fontSize: '16px', pointerEvents: 'none' });
      document.body.appendChild(label);
    }
    return row;
  });
}

/** @param {object[]} rows 卡片快照。 @returns {object} 有界截图区域。 */
function screenshotClip(rows) {
  if (!rows.length || rows.length > 12 || rows.some(r => r.missing || !r.ready || r.width < 100 || r.height <= 0)) throw new Error('候选图片尚未加载或卡片不完整');
  const x = Math.min(...rows.map(r => r.x)), y = Math.min(...rows.map(r => r.y));
  const width = Math.max(...rows.map(r => r.x + r.width)) - x;
  const height = Math.max(...rows.map(r => r.y + r.height)) - y;
  if (x < 0 || y < 0 || !Number.isFinite(width * height) || width > 2400 || height > 4000) throw new Error('候选截图区域过大或越界，请调整浏览器窗口后重试');
  return { x, y, width, height, scale: 1 };
}

/** @param {object} client 页面连接。 @param {string[]} ids 商品ID。 @param {object} options 取消信号。 @returns {Promise<object>} PNG及编号映射。 */
async function captureCandidateScreenshot(client, ids, { signal } = {}) {
  const read = action => client.evaluate(`(${locateScreenshotCards.toString()})(${JSON.stringify(ids)},${JSON.stringify(action)})`);
  try {
    signal?.throwIfAborted();
    for (const id of ids) {
      signal?.throwIfAborted();
      await client.evaluate(`(${locateScreenshotCards.toString()})(${JSON.stringify([id])},'scroll')`);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    let rows;
    const deadline = Date.now() + 15000;
    do {
      signal?.throwIfAborted(); rows = await read('inspect');
      if (rows.every(r => r.ready)) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    } while (Date.now() < deadline);
    const clip = screenshotClip(rows);
    await read('mark');
    const image = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
    const after = await read('inspect');
    if (JSON.stringify(rows) !== JSON.stringify(after)) throw new Error('截图期间商品位置或图片发生变化，请重新采集');
    signal?.throwIfAborted();
    return { data: image.data, mapping: rows, clip };
  } finally { await read('clean').catch(() => {}); }
}

module.exports = { locateScreenshotCards, screenshotClip, captureCandidateScreenshot };
