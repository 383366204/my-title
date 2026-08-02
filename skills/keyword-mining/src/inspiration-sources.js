const crypto = require('crypto');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const { normalizeKeyword } = require('./seed-store');

const DEFAULT_DICTIONARY_WORDS = [
  '清凉', '安静', '整洁', '轻便', '柔软', '明亮', '清香', '防护', '陪伴', '睡眠',
  '通勤', '旅行', '露营', '收纳', '阅读', '运动', '烹饪', '洗护', '装饰', '整理',
  '春天', '夏天', '秋天', '冬天', '雨季', '高温', '潮湿', '干燥', '夜晚', '户外',
  '开学', '宿舍', '办公室', '汽车', '厨房', '浴室', '阳台', '儿童', '宠物', '情侣',
  '生日', '婚礼', '节日', '团聚', '出行', '搬家', '健身', '园艺', '手工', '绘画',
  '防晒', '降温', '保暖', '防滑', '防尘', '防水', '驱蚊', '照明', '解压', '便携'
];

const CALENDAR_INSPIRATIONS = {
  1: ['保暖', '收纳', '春节', '团聚'],
  2: ['开学', '通勤', '情人节', '整理'],
  3: ['春游', '园艺', '防潮', '户外'],
  4: ['露营', '防晒', '旅行', '清明'],
  5: ['初夏', '驱蚊', '儿童', '端午'],
  6: ['高温', '降温', '防晒', '雨季'],
  7: ['暑假', '旅行', '清凉', '户外'],
  8: ['开学', '宿舍', '收纳', '七夕'],
  9: ['中秋', '团聚', '秋游', '换季'],
  10: ['国庆', '旅行', '露营', '婚礼'],
  11: ['保暖', '冬季', '通勤', '收纳'],
  12: ['圣诞', '元旦', '礼物', '保暖']
};

const HEADLINE_STOP_WORDS = new Set([
  '最新', '今日', '消息', '记者', '表示', '发布', '持续', '多个', '全国', '中国',
  '进行', '有关', '相关', '工作', '情况', '问题', '开始', '已经', '今年', '目前'
]);

/**
 * Build a stable hash for deterministic daily sampling.
 * @param {*} value Value to hash.
 * @returns {string} SHA-1 hex digest.
 */
function stableHash(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex');
}

function seededNumber(seed) {
  return parseInt(stableHash(seed).slice(0, 12), 16) / 0xffffffffffff;
}

/**
 * Select a deterministic subset without mutating the input rows.
 * @param {Array<*>} rows Candidate rows.
 * @param {number} count Maximum rows to return.
 * @param {string} seed Sampling seed.
 * @returns {Array<*>} Deterministically sampled rows.
 */
function deterministicSample(rows = [], count = rows.length, seed = '') {
  return rows
    .map((row, index) => ({ row, index, order: seededNumber(`${seed}:${index}:${JSON.stringify(row)}`) }))
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .slice(0, Math.max(0, Number(count || 0)))
    .map(item => item.row);
}

function textValue(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') return String(value['#text'] || value.__cdata || '').trim();
  return '';
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Parse RSS or Atom XML into normalized news rows.
 * @param {string} xml Feed XML.
 * @param {string} sourceUrl Feed URL used as a fallback.
 * @returns {Array<object>} Normalized feed items.
 */
function parseFeedItems(xml, sourceUrl = '') {
  const parsed = new XMLParser({ ignoreAttributes: false, trimValues: true }).parse(String(xml || ''));
  const rssRows = asArray(parsed?.rss?.channel?.item);
  const atomRows = asArray(parsed?.feed?.entry);
  return [...rssRows, ...atomRows].map(row => ({
    title: textValue(row.title),
    url: textValue(row.link) || String(row.link?.['@_href'] || textValue(row.guid) || sourceUrl),
    publishedAt: textValue(row.pubDate) || textValue(row.published) || textValue(row.updated),
    sourceTitle: textValue(parsed?.rss?.channel?.title) || textValue(parsed?.feed?.title) || sourceUrl
  })).filter(row => row.title);
}

/**
 * Fetch configured news feeds serially with per-source error isolation.
 * @param {string[]} urls Feed URLs.
 * @param {object} [options] Fetch options.
 * @returns {Promise<{items:Array<object>,errors:Array<object>}>} Feed rows and source errors.
 */
async function fetchNewsFeeds(urls = [], { timeoutMs = 8000, fetcher = axios.get } = {}) {
  const items = [];
  const errors = [];
  for (const url of urls.filter(Boolean)) {
    try {
      const response = await fetcher(url, {
        timeout: timeoutMs,
        maxContentLength: 2 * 1024 * 1024,
        headers: { 'User-Agent': 'ecom-ai-tools inspiration collector' }
      });
      items.push(...parseFeedItems(response.data, url).slice(0, 30));
    } catch (error) {
      errors.push({ url, error: error.message });
    }
  }
  return { items, errors };
}

/**
 * Extract short Chinese noun, verb, and adjective tokens from a headline.
 * @param {string} title Headline text.
 * @returns {string[]} Candidate inspiration words.
 */
function headlineTokens(title) {
  const text = String(title || '').replace(/[A-Za-z0-9]+/g, ' ').trim();
  try {
    const nodejieba = require('nodejieba');
    return nodejieba.tag(text)
      .filter(item => /^(n|v|a)/.test(item.tag))
      .map(item => normalizeKeyword(item.word))
      .filter(word => word.length >= 2 && word.length <= 6 && !HEADLINE_STOP_WORDS.has(word));
  } catch (_error) {
    return (text.match(/[\u3400-\u9fff]{2,6}/g) || [])
      .map(normalizeKeyword)
      .filter(word => word && !HEADLINE_STOP_WORDS.has(word));
  }
}

function normalizeSourceItem(raw, sourceType, index, runSeed) {
  const row = typeof raw === 'string' ? { title: raw } : (raw || {});
  const title = String(row.title || row.sourceTitle || row.text || row.keyword || row.word || '').trim();
  const explicitWord = normalizeKeyword(row.inspirationWord || row.keyword || row.word || '');
  const tokens = explicitWord ? [explicitWord] : headlineTokens(title);
  const inspirationWord = tokens[0] || normalizeKeyword(title).slice(0, 6);
  if (!inspirationWord) return null;
  const id = `insp_${stableHash(`${runSeed}:${sourceType}:${index}:${title}:${inspirationWord}`).slice(0, 16)}`;
  return {
    id,
    sourceType,
    sourceTitle: String(row.sourceTitle || title).trim(),
    sourceUrl: String(row.url || row.sourceUrl || '').trim(),
    publishedAt: row.publishedAt || row.date || '',
    rawSourceText: title,
    inspirationWord,
    contextWords: tokens.slice(0, 5),
    categoryHint: String(row.category || row.categoryHint || '').trim(),
    createdAt: new Date().toISOString(),
    status: 'discovered'
  };
}

/**
 * Normalize configured news-feed URLs.
 * @param {string|string[]} value Comma-separated URLs or an URL array.
 * @returns {string[]} Non-empty feed URLs.
 */
function configuredNewsFeedUrls(value = process.env.INSPIRATION_NEWS_FEEDS || '') {
  return Array.isArray(value) ? value.filter(Boolean) : String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

/**
 * Collect deterministic daily inspiration rows from news, dictionary, calendar, and trend inputs.
 * @param {object} [options] Collection options.
 * @returns {Promise<{inspirations:Array<object>,stats:object,errors:Array<object>}>} Inspiration batch.
 */
async function collectInspirations({
  date = new Date().toISOString().slice(0, 10),
  runAttempt = 0,
  newsItems = [],
  newsFeedUrls = configuredNewsFeedUrls(),
  dictionaryWords = DEFAULT_DICTIONARY_WORDS,
  trendItems = [],
  sourceLimits = { news: 20, dictionary: 20, calendar: 10, trend: 10 },
  fetcher
} = {}) {
  const runSeed = `${date}:${String(runAttempt ?? 0)}`;
  const fetched = newsItems.length > 0
    ? { items: newsItems, errors: [] }
    : await fetchNewsFeeds(newsFeedUrls, { fetcher });
  const month = Math.max(1, Math.min(12, Number(String(date).slice(5, 7)) || new Date().getMonth() + 1));
  const sourceRows = {
    news: deterministicSample(fetched.items, sourceLimits.news, `${runSeed}:news`),
    dictionary: deterministicSample(dictionaryWords, sourceLimits.dictionary, `${runSeed}:dictionary`),
    calendar: deterministicSample(CALENDAR_INSPIRATIONS[month] || [], sourceLimits.calendar, `${runSeed}:calendar`),
    trend: deterministicSample(trendItems, sourceLimits.trend, `${runSeed}:trend`)
  };
  const inspirations = [];
  const seen = new Set();
  for (const [sourceType, rows] of Object.entries(sourceRows)) {
    rows.forEach((row, index) => {
      const normalized = normalizeSourceItem(row, sourceType, index, runSeed);
      const key = `${sourceType}:${normalized?.inspirationWord}:${normalized?.sourceUrl}`;
      if (!normalized || seen.has(key)) return;
      seen.add(key);
      inspirations.push(normalized);
    });
  }
  return {
    inspirations,
    errors: fetched.errors,
    stats: Object.fromEntries(Object.entries(sourceRows).map(([source, rows]) => [source, rows.length]))
  };
}

module.exports = {
  DEFAULT_DICTIONARY_WORDS,
  CALENDAR_INSPIRATIONS,
  collectInspirations,
  configuredNewsFeedUrls,
  deterministicSample,
  fetchNewsFeeds,
  headlineTokens,
  parseFeedItems,
  stableHash
};
