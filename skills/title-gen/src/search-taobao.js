const {
  isTaobaoNativeInstalled,
  runTaobaoNativeSync,
  ensureTaobaoDesktopReady
} = require('./taobao-utils');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Search Taobao peer titles through taobao-native.
 *
 * @param {string} keyword - Search keyword.
 * @param {object} [options={}] - Search options.
 * @param {number} [options.timeout=30000] - Command timeout in milliseconds.
 * @param {number} [options.maxResults=10] - Max titles to return.
 * @returns {Promise<string[]>} Peer product titles.
 */
async function searchTaobaoTitles(keyword, options = {}) {
  const timeout = options.timeout || 30000;

  if (!isTaobaoNativeInstalled()) {
    console.warn('[taobao] taobao-native CLI 未安装，请使用 --peer-titles 手动提供同行标题');
    return [];
  }

  try {
    const ready = await ensureTaobaoDesktopReady();
    if (!ready) {
      console.warn('[taobao] 淘宝桌面版启动失败');
      return [];
    }

    console.error(`[taobao] 搜索关键词: ${keyword}`);

    const reqFile = path.join(os.tmpdir(), `taobao-search-req-${Date.now()}.json`);
    const outFile = path.join(os.tmpdir(), `taobao-search-out-${Date.now()}.json`);
    fs.writeFileSync(reqFile, JSON.stringify({
      tool: 'search_products',
      arguments: { keyword, sourceApp: 'ecom-ai-tools' }
    }), 'utf8');

    const result = runTaobaoNativeSync(['--request', reqFile, '-o', outFile], {
      encoding: 'utf8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const output = fs.existsSync(outFile)
      ? fs.readFileSync(outFile, 'utf8')
      : String(result || '');

    try { fs.unlinkSync(reqFile); } catch (_) {}
    try { fs.unlinkSync(outFile); } catch (_) {}

    const text = output.trim();
    if (!text) {
      console.warn('[taobao] 未找到有效的 JSON 响应');
      return [];
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      const lines = text.split(/\r?\n/);
      const jsonLine = lines.find(line => line.trim().startsWith('{'));
      if (!jsonLine) {
        console.warn('[taobao] 未找到有效的 JSON 响应');
        return [];
      }
      data = JSON.parse(jsonLine);
    }
    const products = data?.result?.products;
    if (Array.isArray(products)) {
      const titles = products
        .slice(0, options.maxResults || 10)
        .map(p => p.title || '')
        .filter(Boolean);

      console.error(`[taobao] 找到 ${titles.length} 个商品标题`);
      return titles;
    }

    console.warn('[taobao] 搜索结果格式异常:', Object.keys(data || {}));
    return [];
  } catch (error) {
    const detail = [
      error && error.stdout ? String(error.stdout).trim() : '',
      error && error.stderr ? String(error.stderr).trim() : ''
    ].filter(Boolean).join(' ');
    if (error && error.message && error.message.includes('timeout')) {
      console.warn('[taobao] peer title search timed out: ' + error.message);
    } else {
      console.warn('[taobao] peer title search failed: ' + (error ? error.message : error));
      if (detail) console.warn('[taobao] detail: ' + detail);
    }
    console.warn('[taobao] 请使用 --peer-titles 手动提供同行标题');
    return [];
  }
}

module.exports = { searchTaobaoTitles, isTaobaoNativeInstalled };
