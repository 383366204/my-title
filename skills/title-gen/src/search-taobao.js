const { execSync, execFileSync } = require('child_process');

const { TAOBAO_NATIVE_PATH, isTaobaoNativeInstalled, toWindowsPath, ensureTaobaoDesktopReady } = require('./taobao-utils');

/**
 * 搜索淘宝同行标题
 * @param {string} keyword - 搜索关键词
 * @param {object} options - 配置选项
 * @param {string} [options.path] - CLI路径，默认自动检测
 * @param {number} [options.timeout] - 超时时间(毫秒)，默认30000
 * @param {number} [options.maxResults] - 最大结果数，默认10
 * @returns {Promise<string[]>} 同行标题数组
 */
async function searchTaobaoTitles(keyword, options = {}) {
  const cliPath = options.path || TAOBAO_NATIVE_PATH;
  const timeout = options.timeout || 30000;

  // 检测是否安装
  if (!isTaobaoNativeInstalled()) {
    console.warn('[taobao] taobao-native CLI 未安装，请使用 --peer-titles 手动提供同行标题');
    return [];
  }

  try {
    // 确保淘宝桌面版已启动并就绪（同进程只启动一次）
    const ready = await ensureTaobaoDesktopReady();
    if (!ready) {
      console.warn('⚠️  淘宝桌面版启动失败');
      return [];
    }

    // 转换路径为 Windows 格式
    const winPath = toWindowsPath(cliPath);
    
    console.error(`🔍 搜索关键词: ${keyword}`);
    
    // 调用 taobao-native 搜索商品
    const args = JSON.stringify({ keyword, sourceApp: 'ecom-ai-tools' });
    const result = execFileSync('/mnt/c/Windows/System32/cmd.exe', ['/c', winPath, 'search_products', '--args', args], {
      encoding: 'utf8',
      timeout: timeout,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // 解析输出（第一行应该是 JSON）
    const lines = result.trim().split('\n');
    const jsonLine = lines.find(line => line.startsWith('{'));
    
    if (!jsonLine) {
      console.warn('⚠️  未找到有效的 JSON 响应');
      return [];
    }

    const data = JSON.parse(jsonLine);

    // 提取商品标题（从 result.products 数组）
    if (data?.result?.products && Array.isArray(data.result.products)) {
      const titles = data.result.products
        .slice(0, options.maxResults || 10)
        .map(p => p.title || '')
        .filter(t => t.length > 0);
      
      console.error(`✅ 找到 ${titles.length} 个商品标题`);
      return titles;
    }

    console.warn('⚠️  搜索结果格式异常，数据结构:', Object.keys(data || {}));
    return [];
  } catch (error) {
    if (error && error.message && error.message.includes('timeout')) {
      console.warn('[taobao] peer title search timed out: ' + error.message);
    } else {
      console.warn('[taobao] peer title search failed: ' + (error ? error.message : error));
    }
    console.warn('[taobao]   请使用 --peer-titles 手动提供同行标题');
    return [];
  }
}

module.exports = { searchTaobaoTitles, isTaobaoNativeInstalled };
