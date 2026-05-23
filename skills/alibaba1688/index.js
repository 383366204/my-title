// 统一导出 alibaba1688 skill 的公共接口
const { searchAll } = require('./src/search-1688');
const { fetchOpportunities, fetchTrend } = require('./src/insights');
const Alibaba1688Client = require('./src/client');

// 从 client 中提取静态工具函数
const { parse1688Url, resolve1688ShortUrl, RateLimitError } = Alibaba1688Client;

module.exports = {
  // 主搜索函数
  searchAll,
  // 热榜和趋势
  fetchOpportunities,
  fetchTrend,
  // 客户端类
  Alibaba1688Client,
  // 工具函数
  parse1688Url,
  resolve1688ShortUrl,
  // 错误类型
  RateLimitError,
};