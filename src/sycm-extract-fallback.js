/**
 * SYCM 数据提取降级模块
 *
 * 当 SYCM 插件数据未就绪时，通过轮询本地 HTTP API 等待数据到达。
 * 纯 Node.js 内置 http 模块，零外部依赖。
 */

const http = require('http');
const { URL } = require('url');

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
          reject(new Error('Invalid JSON'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

/**
 * 轮询等待指定关键词的 SYCM 数据到达
 *
 * 每隔 interval 毫秒请求一次 /api/status，直到：
 * - 目标 keyword 出现在 storedKeywords 中 → resolve(available: true)
 * - 超过 timeout 毫秒仍未出现 → resolve(available: false)
 *
 * @param {string} keyword - 要等待的关键词
 * @param {Object} [options={}] - 配置选项
 * @param {number} [options.timeout=120000] - 最长等待时间（毫秒）
 * @param {number} [options.interval=2000] - 轮询间隔（毫秒）
 * @param {number} [options.httpPort=3000] - 本地 HTTP API 端口
 * @returns {Promise<Object>} 结果对象
 *   - {boolean} available - 是否成功等到数据
 *   - {string} keyword - 目标关键词
 *   - {number} waitedMs - 实际等待时长（毫秒）
 *   - {string[]} cachedKeywords - 当前服务端缓存的所有关键词列表
 *   - {string} [hint] - 超时时的中文提示
 */
async function waitForSycmData(keyword, options = {}) {
  const {
    timeout = 120000,
    interval = 2000,
    httpPort = 3000
  } = options;

  const statusUrl = `http://127.0.0.1:${httpPort}/api/status`;
  const startTime = Date.now();

  return new Promise((resolve) => {
    let resolved = false;

    // 立即执行一次检查，避免首次 interval 延迟
    const check = async () => {
      try {
        const data = await httpGet(statusUrl, 3000);
        const storedKeywords = Array.isArray(data.storedKeywords)
          ? data.storedKeywords
          : [];

        if (storedKeywords.includes(keyword)) {
          resolved = true;
          clearInterval(timer);
          clearTimeout(timeoutTimer);
          resolve({
            available: true,
            keyword,
            waitedMs: Date.now() - startTime,
            cachedKeywords: storedKeywords
          });
        }
      } catch (err) {
        // 单次请求失败继续轮询，不中断
      }
    };

    // 启动轮询
    const timer = setInterval(check, interval);
    check(); // 首次立即检查

    // 总超时控制
    const timeoutTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        clearInterval(timer);
        resolve({
          available: false,
          keyword,
          waitedMs: Date.now() - startTime,
          cachedKeywords: [],
          hint: '等待超时，请确认已通过插件或 API 提交数据'
        });
      }
    }, timeout);
  });
}

/**
 * 获取 SYCM HTTP 服务端当前缓存的所有关键词
 * @param {number} [httpPort=3000] - 本地 HTTP API 端口
 * @returns {Promise<Object>} 结果对象
 *   - {boolean} available - 请求是否成功
 *   - {string[]} keywords - 缓存的关键词列表（失败时为空数组）
 */
async function getSycmCachedKeywords(httpPort = 3000) {
  const statusUrl = `http://127.0.0.1:${httpPort}/api/status`;
  try {
    const data = await httpGet(statusUrl, 3000);
    const keywords = Array.isArray(data.storedKeywords)
      ? data.storedKeywords
      : [];
    return { available: true, keywords };
  } catch (err) {
    return { available: false, keywords: [] };
  }
}

/**
 * 快速检测 SYCM HTTP 服务端是否正在运行
 * @param {number} [httpPort=3000] - 本地 HTTP API 端口
 * @returns {Promise<boolean>} true 表示服务端可达
 */
async function isHttpServerRunning(httpPort = 3000) {
  const statusUrl = `http://127.0.0.1:${httpPort}/api/status`;
  try {
    await httpGet(statusUrl, 3000);
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = {
  waitForSycmData,
  getSycmCachedKeywords,
  isHttpServerRunning
};
