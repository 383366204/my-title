/**
 * 生意参谋 SYCM 浏览器连接助手
 * Chrome DevTools Protocol 检测与启动辅助工具
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

// 错误提示常量
const ERRORS = {
  CHROME_NOT_RUNNING: 'Chrome 未运行调试模式。请先用以下命令启动 Chrome:\n',
  SYCM_NOT_LOGGED_IN: 'Chrome 已运行，但未检测到生意参谋登录状态。请先在 Chrome 中登录 sycm.taobao.com',
  CAPTCHA_DETECTED: '检测到验证码或滑块验证，需要人工介入处理',
  NETWORK_TIMEOUT: '网络请求超时，请检查 Chrome 调试端口是否正确',
  DATA_NOT_LOADED: '生意参谋数据未加载完成，请等待页面完全加载'
};

// 生意参谋页面选择器常量（供 chrome-devtools-mcp 使用）
const SYCM_SELECTORS = {
  SEARCH_URL: 'https://sycm.taobao.com/mc/free/search_analysis',
  SEARCH_INPUT: 'input[placeholder*="搜索词"], input[placeholder*="关键词"], .search-input input',
  SEARCH_BUTTON: '.search-btn, button.ant-btn-primary',
  DATA_TABLE: '.ant-table-tbody, .el-table__body-wrapper tbody',
  LOADING_INDICATOR: '.ant-spin, .el-loading-mask, [class*="loading"]',
  CAPTCHA_INDICATOR: '[class*="captcha"], [class*="slider"], [class*="verify"], #nc_1_wrapper',
  SEARCH_URL_PARAM: 'keyWord' // 注意：大写 W
};

/**
 * 发送 HTTP GET 请求并解析 JSON 响应
 * @param {string} url - 请求地址
 * @param {number} [timeout=3000] - 超时时间（毫秒）
 * @returns {Promise<Object>} 解析后的 JSON 对象
 */
function httpGet(url, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Chrome 返回了无效的 JSON 数据'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });
  });
}

/**
 * 检查 Chrome DevTools Protocol 是否可用
 * @param {number} [port=9222] - Chrome 调试端口
 * @returns {Promise<boolean>} 是否可用
 */
async function isChromeDevToolsAvailable(port = 9222) {
  try {
    await httpGet(`http://127.0.0.1:${port}/json/version`, 3000);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 获取 Chrome DevTools 版本信息
 * @param {number} [port=9222] - Chrome 调试端口
 * @returns {Promise<{Browser: string, 'Protocol-Version': string, 'User-Agent': string, webSocketDebuggerUrl: string}>}
 * @throws {Error} 当 Chrome 不可用时抛出描述性错误
 */
async function getChromeDevToolsInfo(port = 9222) {
  try {
    const info = await httpGet(`http://127.0.0.1:${port}/json/version`, 3000);
    return info;
  } catch (e) {
    const launchCmd = generateChromeLaunchCommand({ port }).command;
    throw new Error(`${ERRORS.CHROME_NOT_RUNNING}${launchCmd}`);
  }
}

/**
 * 获取默认的 Chrome 用户数据目录
 * @returns {string} 用户数据目录路径
 */
function getDefaultUserDataDir() {
  const home = process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH || '/tmp';
  switch (process.platform) {
    case 'win32':
      return path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
    default:
      return path.join(home, '.config', 'google-chrome');
  }
}

/**
 * 查找 Windows 上的 Chrome 可执行文件路径
 * @returns {string} Chrome 路径或 'chrome' 作为降级
 */
function findWindowsChrome() {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
  ];
  for (const p of paths) {
    try { if (fs.existsSync(p)) return p; } catch (e) { /* 继续查找 */ }
  }
  return 'chrome';
}

/**
 * 生成跨平台 Chrome 启动命令
 * @param {Object} [options={}] - 配置选项
 * @param {number} [options.port=9222] - 调试端口
 * @param {string} [options.userDataDir] - 用户数据目录（保存登录态）
 * @param {string} [options.os] - 操作系统类型，默认自动检测
 * @returns {{command: string, chromePath: string, args: string[]}}
 */
function generateChromeLaunchCommand(options = {}) {
  const port = options.port || 9222;
  const osType = options.os || process.platform;
  const userDataDir = options.userDataDir || getDefaultUserDataDir();

  let chromePath = '';
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir="${userDataDir}"`,
    '--no-first-run'
  ];

  switch (osType) {
    case 'win32':
      chromePath = findWindowsChrome();
      break;
    case 'darwin':
      chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      break;
    case 'linux':
    default:
      chromePath = 'google-chrome';
      break;
  }

  return {
    command: `"${chromePath}" ${args.join(' ')}`,
    chromePath,
    args
  };
}

/**
 * 检查生意参谋登录状态（最佳努力检测）
 * @param {number} [port=9222] - Chrome 调试端口
 * @returns {Promise<{loggedIn: boolean, sycmTabs: Array<{url: string, title: string}>}>}
 */
async function checkSycmLoginStatus(port = 9222) {
  try {
    const tabs = await httpGet(`http://127.0.0.1:${port}/json/list`, 3000);
    const sycmTabs = Array.isArray(tabs)
      ? tabs
          .filter(tab => tab.url && tab.url.includes('sycm.taobao.com'))
          .map(tab => ({ url: tab.url, title: tab.title || '' }))
      : [];
    return { loggedIn: sycmTabs.length > 0, sycmTabs };
  } catch (e) {
    return { loggedIn: false, sycmTabs: [] };
  }
}

module.exports = {
  isChromeDevToolsAvailable,
  getChromeDevToolsInfo,
  generateChromeLaunchCommand,
  checkSycmLoginStatus,
  ERRORS,
  SYCM_SELECTORS
};
