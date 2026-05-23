const Alibaba1688Client = require('./client');

/**
 * 获取商机数据（多平台爆款商品）
 * @param {number} timeout - 请求超时时间（毫秒），默认 15000
 * @returns {Promise<object>} 商机数据（含 1688、淘宝、小红书等平台爆款）
 */
async function fetchOpportunities(timeout = 15000) {
  const ak = process.env.ALI_1688_AK;
  if (!ak) {
    throw new Error('环境变量 ALI_1688_AK 未设置');
  }
  const client = new Alibaba1688Client(ak);
  const endpoint = '/1688claw/skill/workflow';
  const body = JSON.stringify({ code: "offer_opportunity" });
  const response = await client._requestWithRetry(endpoint, body, timeout);
  return response.model.bizData;
}

/**
 * 获取热门趋势（搜索词趋势分析）
 * @param {string} query - 搜索关键词
 * @param {number} timeout - 请求超时时间（毫秒），默认 15000
 * @returns {Promise<string|object>} 趋势分析结果（Markdown 格式或对象）
 */
async function fetchTrend(query, timeout = 15000) {
  if (!query || typeof query !== 'string' || query.trim() === '') {
    throw new Error('fetchTrend: query 参数不能为空');
  }
  const ak = process.env.ALI_1688_AK;
  if (!ak) {
    throw new Error('环境变量 ALI_1688_AK 未设置');
  }
  const client = new Alibaba1688Client(ak);
  const endpoint = '/1688claw/skill/workflow';
  const body = JSON.stringify({ code: "offer_hot", bizParams: { query: query.trim() } });
  const response = await client._requestWithRetry(endpoint, body, timeout);
  return response.model.bizData;
}

module.exports = { fetchOpportunities, fetchTrend };