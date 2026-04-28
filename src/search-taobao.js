const { execSync, execFileSync } = require('child_process');

const { TAOBAO_NATIVE_PATH, isTaobaoNativeInstalled, toWindowsPath, launchTaobaoDesktop } = require('./taobao-utils');

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
    console.warn('⚠️  taobao-native CLI 未安装，请使用 --peer-titles 手动提供同行标题');
    return [];
  }

  try {
    // 尝试启动淘宝桌面版（如果未运行）
    await launchTaobaoDesktop();
    
    // 等待淘宝桌面版准备就绪
    console.error('⏳ 等待淘宝桌面版准备就绪...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 转换路径为 Windows 格式
    const winPath = toWindowsPath(cliPath);
    
    console.error(`🔍 搜索关键词: ${keyword}`);
    
    // 调用 taobao-native 搜索商品
    const args = JSON.stringify({ keyword, sourceApp: 'my-title' });
    const result = execFileSync('cmd.exe', ['/c', winPath, 'search_products', '--args', args], {
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
    console.warn('⚠️  淘宝搜索失败:', error.message);
    console.warn('   请使用 --peer-titles 手动提供同行标题');
    return [];
  }
}

module.exports = { searchTaobaoTitles, isTaobaoNativeInstalled };
