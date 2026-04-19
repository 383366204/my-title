const crypto = require('crypto');
const axios = require('axios');

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

  /**
   * 搜索商品
   * @param {string} query - 搜索关键词
   * @param {string} channel - 渠道，默认为 'default'
   * @returns {Promise<Array<object>>} 商品列表
   */
  async searchOffers(query, channel = 'default') {
    const endpoint = '/1688claw/skill/searchoffer';
    const body = JSON.stringify({ query, channel });
    const signHeaders = this.generateSignHeaders('POST', endpoint, body);

    const url = `${this.baseUrl}${endpoint}`;

    // 简单重试策略：遇到网络错误或 429 时重试，最多 3 次，指数退避 + 随机抖动
    const MAX_RETRIES = 3;
    let attempt = 0;
    let lastError = null;

    // 可控的请求间隔，默认不强制等待，但在多请求场景下应实现节流策略
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    while (attempt <= MAX_RETRIES) {
      try {
        // 可选：在每次请求前引入一个随机的短暂停顿，避免请求集中
        // 仅在环境变量 ENABLE_DELAY=true 时启用，默认关闭以便单元测试快速运行
        if (process.env.ENABLE_DELAY === 'true') {
          const delayMs = 3000 + Math.floor(Math.random() * 2000); // 3-5 秒
          await sleep(delayMs);
        }

        const response = await axios.post(url, body, {
          headers: signHeaders,
          timeout: 10000
        });

        if (!response.data || response.data.success !== true) {
          throw new Error(`1688 API error: ${JSON.stringify(response.data)}`);
        }

        const data = response.data.model?.data || {};
        // data 是以 offerId 为 key 的对象，需保留 key 以便 id 字段赋值
        const products = Object.keys(data).map((key) => {
          const item = data[key] || {};
          const id = item.offerId != null ? String(item.offerId) : key;
          const title = item.title ?? '';
          const price = item.price ?? '';
          // 使用 image 作为商品链接/封面 URL
          const urlField = item.image ?? '';
          // stats 需要提取 last30DaysSales、goodRates、repurchaseRate 等字段
          const rawStats = item.stats ?? {};

          const parseNumber = (v) => {
            if (typeof v === 'number') return v;
            if (typeof v === 'string') {
              const m = v.match(/\d+(?:\.\d+)?/);
              return m ? Number(m[0]) : 0;
            }
            return 0;
          };

          const last30DaysSalesRaw = rawStats.last30DaysSales;
          const last30DaysSales = parseNumber(last30DaysSalesRaw);
          const goodRates = parseNumber(rawStats.goodRates);
          const repurchaseRate = parseNumber(rawStats.repurchaseRate);

          const stats = {
            last30DaysSales,
            goodRates,
            repurchaseRate,
            downstreamOffer: rawStats.downstreamOffer ?? 0,
            totalSales: rawStats.totalSales ?? 0,
            remarkCnt: rawStats.remarkCnt ?? 0,
            categoryListName: rawStats.categoryListName ?? '',
            earliestListingTime: rawStats.earliestListingTime ?? 0
          };

          return {
            id,
            title,
            price,
            url: urlField,
            stats
          };
        });

        return products;
      } catch (err) {
        lastError = err;
        // 429 或网络错误时重试
        const isRetryable =
          (err.response && (err.response.status === 429 || err.response.status === 503)) ||
          (!err.response && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT'));
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

    // 如果循环结束仍未返回，抛出最后的错误
    throw lastError;
  }
}

module.exports = Alibaba1688Client;
