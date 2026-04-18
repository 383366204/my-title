const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Windows 路径（WSL2 环境）
const TAOBAO_NATIVE_PATH = '/mnt/c/Users/38336/AppData/Local/Programs/taobao/bin/taobao-native.cmd';

/**
 * 检测 taobao-native CLI 是否已安装
 * @returns {boolean} 是否已安装
 */
function isTaobaoNativeInstalled() {
  try {
    // 检查 CLI 文件是否存在
    fs.accessSync(TAOBAO_NATIVE_PATH, fs.constants.F_OK);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 将 WSL2 路径转换为 Windows 路径
 * @param {string} wslPath - WSL2 路径
 * @returns {string} Windows 路径
 */
function toWindowsPath(wslPath) {
  return wslPath.replace('/mnt/c/', 'C:\\').replace(/\//g, '\\');
}

/**
 * 启动淘宝桌面版
 * @returns {boolean} 是否成功启动
 */
function launchTaobaoDesktop() {
  try {
    console.log('🚀 正在启动淘宝桌面版...');
    const winPath = toWindowsPath(TAOBAO_NATIVE_PATH);
    execSync(
      `cmd.exe /c "${winPath}" launch`,
      { stdio: 'ignore', timeout: 10000 }
    );
    console.log('✅ 淘宝桌面版已启动');
    return true;
  } catch (error) {
    console.warn('⚠️  启动淘宝桌面版失败:', error.message);
    return false;
  }
}

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
    launchTaobaoDesktop();
    
    // 等待淘宝桌面版准备就绪
    console.log('⏳ 等待淘宝桌面版准备就绪...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 转换路径为 Windows 格式
    const winPath = toWindowsPath(cliPath);
    
    console.log(`🔍 搜索关键词: ${keyword}`);
    
    // 调用 taobao-native 搜索商品
    const result = execSync(
      `cmd.exe /c "${winPath} search_products --args '{\\"keyword\\":\\"${keyword}\\",\\"sourceApp\\":\\"my-title\\"}'"`,
      {
        encoding: 'utf8',
        timeout: timeout,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );

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
      
      console.log(`✅ 找到 ${titles.length} 个商品标题`);
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