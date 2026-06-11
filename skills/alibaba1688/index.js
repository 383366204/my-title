const {
  searchAll,
  searchAndFilter,
  filterRelevantProducts,
  buildSearchQueries,
  mergeProducts
} = require('./src/search-1688');
const { searchWeb1688, checkWeb1688Status } = require('./src/search-web-1688');
const { fetchOpportunities, fetchTrend } = require('./src/insights');
const Alibaba1688Client = require('./src/client');

const { parse1688Url, resolve1688ShortUrl, RateLimitError } = Alibaba1688Client;

module.exports = {
  searchAll,
  searchAndFilter,
  filterRelevantProducts,
  buildSearchQueries,
  mergeProducts,
  searchWeb1688,
  checkWeb1688Status,
  fetchOpportunities,
  fetchTrend,
  Alibaba1688Client,
  parse1688Url,
  resolve1688ShortUrl,
  RateLimitError
};
