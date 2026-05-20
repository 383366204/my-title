const crypto = require('crypto');
const axios = require('axios');
const { getRateLimiter, RateLimitError } = require('./rate-limiter');

class Alibaba1688Client {
  /**
   * @param {string} ak - 1688 Access Key (可能为 Base64 编码，或原始格式: 前32字符=Secret, 剩余=KeyID)
   */
  constructor(ak) {
    if (!ak || ak.length < 32) {
      throw new Error('Invalid ALI_1688_AK: must be at least 32 characters');
    }
    // 先尝试 Base64 解码，失败则回退到原始字符串
    let decoded = ak;
    try {
      const buf = Buffer.from(ak, 'base64url');
      const text = buf.toString('utf-8');
      if (text && text.length >= 32) {
        decoded = text;
      }
    } catch (e) {
      // 非 Base64，使用原始值
    }
    this.secret = decoded.substring(0, 32);
    this.keyId = decoded.substring(32);
    this.baseUrl = 'https://ainext.1688.com';
  }

  /**
   * 计算 body 的 MD5 并 Base64 编码
   */
  _getContentMd5(body) {
    if (!body) return '';
    return crypto.createHash('md5').update(body, 'utf-8').digest('base64');
  }

  /**
   * 规范化 URI 资源路径
   */
  _getCanonicalizedResource(uri) {
    const url = new URL(uri, 'https://ainext.1688.com');
    const path = url.pathname;
    if (!url.search) return path;

    const params = new URLSearchParams(url.search);
    const sortedKeys = [...params.keys()].sort();
    const parts = sortedKeys.map(key => {
      const values = params.getAll(key).sort();
      return values.map(v => `${encodeURIComponent(key)}=${encodeURIComponent(v)}`).join('&');
    });
    return `${path}?${parts.join('&')}`;
  }

  /**
   * 生成签名请求头（Canonical Request 方式）
   * @param {string} method - HTTP 方法 (POST)
   * @param {string} uri - 请求路径
   * @param {string} body - 请求体 JSON 字符串
   * @returns {object} 签名请求头
   */
  generateSignHeaders(method, uri, body) {
    const timestamp = Math.floor(Date.now() / 1000).toString(); // 秒级时间戳
    const nonce = crypto.randomUUID().replace(/-/g, '').substring(0, 8);
    const contentMd5 = this._getContentMd5(body);
    const contentType = 'application/json';

    // 构造 x-csk-* 自定义头
    const cskHeaders = {
      'x-csk-ak': this.keyId,
      'x-csk-time': timestamp,
      'x-csk-nonce': nonce,
      'x-csk-content-md5': contentMd5,
      'x-csk-version': '1.0.1',
    };

    const sortedKeys = Object.keys(cskHeaders).sort();
    const canonicalizedHeaders = sortedKeys
      .map(key => `${key}:${cskHeaders[key].trim()}`)
      .join('\n');

    // CanonicalizedResource
    const canonicalizedResource = this._getCanonicalizedResource(uri);

    // 构造待签名字符串
    const stringToSign = [
      method.toUpperCase(),
      contentMd5,
      contentType,
      timestamp,
      canonicalizedHeaders,
      canonicalizedResource
    ].join('\n');

    // HMAC-SHA256 签名
    const sign = crypto
      .createHmac('sha256', this.secret)
      .update(stringToSign)
      .digest('base64');

    return {
      'Content-Type': contentType,
      'x-csk-sign': sign,
      ...cskHeaders,
    };
  }

  async _requestWithRetry(endpoint, body, timeout = 10000) {
    const signHeaders = this.generateSignHeaders('POST', endpoint, body);
    const url = `${this.baseUrl}${endpoint}`;

    const MAX_RETRIES = 3;
    let attempt = 0;
    let lastError = null;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const rateLimiter = getRateLimiter();
    const acquireResult = await rateLimiter.acquire();
    if (!acquireResult.allowed) {
      if (acquireResult.cooldown) {
        throw new RateLimitError(
          `1688 API 冷却中，剩余 ${Math.ceil(acquireResult.waitMs / 1000)} 秒`,
          acquireResult.waitMs
        );
      }
      throw new RateLimitError(
        `1688 API 请求限流，请稍后重试（预计等待 ${Math.ceil(acquireResult.waitMs / 1000)} 秒）`,
        acquireResult.waitMs
      );
    }

    while (attempt <= MAX_RETRIES) {
      try {
        if (process.env.ENABLE_DELAY === 'true') {
          const delayMs = 3000 + Math.floor(Math.random() * 2000);
          await sleep(delayMs);
        }

        const response = await axios.post(url, body, {
          headers: signHeaders,
          timeout
        });

        if (!response.data || response.data.success !== true) {
          throw new Error(`1688 API error: ${JSON.stringify(response.data)}`);
        }

        rateLimiter.reportSuccess();
        return response.data;
      } catch (err) {
        lastError = err;
        if (err.response && err.response.status === 429) {
          rateLimiter.report429();
        }
        const isRetryable =
          (err.response && (err.response.status === 429 || err.response.status === 503)) ||
          (!err.response && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT')) ||
          (err.message && err.message.includes('1688 API error'));
        if (isRetryable && attempt < MAX_RETRIES) {
          attempt += 1;
          const backoff = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
          const jitter = Math.floor(Math.random() * 1000);
          await sleep(backoff + jitter);
          continue;
        }
        throw err;
      }
    }

    throw lastError;
  }

  /**
   * 搜索商品
   * @param {string} query - 搜索关键词
   * @param {string} channel - 渠道，默认为 'default'
   * @returns {Promise<Array<object>>} 商品列表
   */
  async searchOffers(query, channel = 'default') {
    const endpoint = '/1688claw/skill/searchoffer';
    const body = JSON.stringify({ query, channel });
    const response = await this._requestWithRetry(endpoint, body);

    const data = response.model?.data || {};
    const products = Object.keys(data).map((key) => {
      const item = data[key] || {};
      const id = item.offerId != null ? String(item.offerId) : key;
      const title = item.title ?? '';
      const price = item.price ?? '';
      const urlField = item.image ?? '';
      const rawStats = item.stats ?? {};

      const parseNumber = (v) => {
        if (typeof v === 'number') return v;
        if (typeof v === 'string') {
          const m = v.match(/\d+(?:\.\d+)?/);
          return m ? Number(m[0]) : 0;
        }
        return 0;
      };

      return {
        id,
        title,
        price,
        url: urlField,
        stats: {
          last30DaysSales: parseNumber(rawStats.last30DaysSales),
          goodRates: parseNumber(rawStats.goodRates),
          repurchaseRate: parseNumber(rawStats.repurchaseRate),
          downstreamOffer: rawStats.downstreamOffer ?? 0,
          totalSales: rawStats.totalSales ?? 0,
          remarkCnt: rawStats.remarkCnt ?? 0,
          categoryListName: rawStats.categoryListName ?? '',
          earliestListingTime: rawStats.earliestListingTime ?? 0,
          collectionRate24h: rawStats.collectionRate24h ?? 0,
          last30DaysDropShippingSales: parseNumber(rawStats.last30DaysDropShippingSales),
          totalOrder: parseNumber(rawStats.totalOrder)
        }
      };
    });

    return products;
  }

  /**
   * 获取商品详情
   * @param {string} offerId - 1688 商品 ID
   * @returns {Promise<object>} 商品详情（含完整响应结构）
   */
  async getOfferDetail(offerId) {
    const endpoint = '/1688claw/skill/workflow';
    const body = JSON.stringify({ 
      code: "offer_detail", 
      bizParams: { item_id: [offerId] } 
    });
    return this._requestWithRetry(endpoint, body);
  }

  /**
   * 获取商机数据（多平台爆款商品）
   * @param {number} timeout - 请求超时时间（毫秒），默认 15000
   * @returns {Promise<object>} 商机数据（含 1688、淘宝、小红书等平台爆款）
   */
  async fetchOpportunities(timeout = 15000) {
    const endpoint = '/1688claw/skill/workflow';
    const body = JSON.stringify({ code: "offer_opportunity" });
    const response = await this._requestWithRetry(endpoint, body, timeout);
    return response.model.bizData;
  }

  /**
   * 获取热门趋势（搜索词趋势分析）
   * @param {string} query - 搜索关键词
   * @param {number} timeout - 请求超时时间（毫秒），默认 15000
   * @returns {Promise<string|object>} 趋势分析结果（Markdown 格式或对象）
   */
  async fetchTrend(query, timeout = 15000) {
    if (!query || typeof query !== 'string' || query.trim() === '') {
      throw new Error('fetchTrend: query 参数不能为空');
    }

    const endpoint = '/1688claw/skill/workflow';
    const body = JSON.stringify({ code: "offer_hot", bizParams: { query: query.trim() } });
    const response = await this._requestWithRetry(endpoint, body, timeout);
    return response.model.bizData;
  }
}

/**
 * 从 1688 链接提取 offerId
 * @param {string} url - 1688 商品详情页 URL
 * @returns {object|null} { offerId: string } 或 null（无效 URL）
 * 
 * 支持的 URL 格式:
 * - https://detail.1688.com/offer/123456.html
 * - https://detail.1688.com/offer/123456.html?spm=xxx (带追踪参数)
 * - https://m.1688.com/offer/123456.html (移动端)
 * - https://detail.m.1688.com/page/index.htm?offerId=123456 (移动端H5)
 */
function parse1688Url(url) {
  if (typeof url !== 'string') return null;
  
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname;
    
    // 验证域名是否为 1688
    if (!hostname.endsWith('1688.com')) return null;
    
    // 匹配路径模式 /offer/数字.html
    const pathMatch = parsedUrl.pathname.match(/\/offer\/(\d+)(?:\.html)?/);
    if (pathMatch && pathMatch[1]) {
      return { offerId: pathMatch[1] };
    }
    
    // 匹配查询参数模式 offerId 或 offer_id
    let offerId = parsedUrl.searchParams.get('offerId');
    if (!offerId) {
      offerId = parsedUrl.searchParams.get('offer_id');
    }
    if (offerId) {
      return { offerId };
    }
    
    return null;
  } catch (e) {
    // URL 解析失败
    return null;
  }
}

/**
 * Resolve 1688 short URL by following HTTP redirects
 * @param {string} url - Short URL to resolve
 * @param {number} [maxRedirects=5] - Max redirect hops
 * @returns {Promise<string|null>} Final URL after redirects, or null if failed
 */
async function resolve1688ShortUrl(url, maxRedirects = 5) {
  let currentUrl = url;
  let redirects = 0;

  try {
    while (redirects < maxRedirects) {
      const response = await axios.head(currentUrl, {
        maxRedirects: 0,
        validateStatus: (status) => status < 400,
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      const location = response.headers.location;
      if (!location) {
        // No more redirects, check if current URL is parseable
        if (parse1688Url(currentUrl)) {
          return currentUrl;
        }
        return null;
      }

      // Resolve relative URL if needed
      if (!location.startsWith('http')) {
        currentUrl = new URL(location, currentUrl).href;
      } else {
        currentUrl = location;
      }

      // Check if current URL is parseable
      if (parse1688Url(currentUrl)) {
        return currentUrl;
      }

      redirects++;
    }

    // Exceeded max redirects
    return null;
  } catch (err) {
    // Any error (network, timeout, 4xx, etc.)
    return null;
  }
}

/**
 * 1688 API 客户端
 */
module.exports = Alibaba1688Client;
module.exports.parse1688Url = parse1688Url;
module.exports.resolve1688ShortUrl = resolve1688ShortUrl;
module.exports.RateLimitError = RateLimitError;
