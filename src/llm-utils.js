/**
 * LLM 输出处理工具集
 * 提供以下导出函数:
 *  - parseJsonFromLLM(content): 从可能包含 JSON 的 LLM 输出中提取并解析 JSON
 *  - retry(fn, maxRetries, delayMs): 对异步函数进行简单重试
 *
 * 该文件遵循 CommonJS 模块规范，所有导出均采用 module.exports 暴露。
 */

/**
 * 从 LLm 的输出中提取并解析 JSON。
 * 支持常见场景：直接 JSON 字符串、被 Markdown 代码块包裹、文本中嵌入 JSON、以及尾部多出的逗号。
 *
 * @param {string} content 输入文本，可能包含 JSON、markdown 包裹、额外文本、尾逗号等
 * @returns {any} 解析得到的 JSON 对象/数组
 */
function parseJsonFromLLM(content) {
  if (typeof content !== 'string') throw new Error('Expected string input');
  let text = content.trim();
  // 1. 移除 markdown 代码块包裹（```json ... ```）
  text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?\s*```$/, '');
  // 2. 如果仍然不是以 { 或 [ 开头，尝试从中提取 JSON
  if (!text.startsWith('{') && !text.startsWith('[')) {
    const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) text = jsonMatch[0];
  }
  // 3. 移除尾逗号（JSON 标准不允许，但 LLM 经常输出）
  text = text.replace(/,\s*([}\]])/g, '$1');
  // 4. 解析
  return JSON.parse(text);
}

/**
 * 对异步函数进行简单重试。
 *
 * @param {Function} fn 需要执行的异步函数，返回一个 Promise
 * @param {number} [maxRetries=2] 最大重试次数（不包含初次尝试）
 * @param {number} [delayMs=1000] 每次重试的延迟（毫秒）
 * @param {Function} [shouldRetry] 可选函数，接收错误对象，返回是否应重试
 * @returns {Promise<any>} 第一次成功返回的值
 */
async function retry(fn, maxRetries = 2, delayMs = 1000, shouldRetry = null) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      // 如果提供了 shouldRetry 且返回 false，直接抛出不重试
      if (shouldRetry && !shouldRetry(err)) throw err;
      // 默认行为：只重试有 code（网络错误）或 response（HTTP错误）的错误，跳过解析错误
      const retryable = shouldRetry ? shouldRetry(err) : (err.code || err.response);
      if (!retryable) throw err;
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

module.exports = { parseJsonFromLLM, retry };
