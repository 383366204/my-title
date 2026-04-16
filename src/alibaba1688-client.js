const crypto = require('crypto');
const axios = require('axios');

class Alibaba1688Client {
  /**
   * 构造函数
   * @param {string} ak - 1688 Access Key (前32字符是Secret, 剩余是KeyID)
   */
  constructor(ak) {
    if (!ak || ak.length < 32) {
      throw new Error('Invalid ALI_1688_AK: must be at least 32 characters');
    }
    this.secret = ak.substring(0, 32);
    this.keyId = ak.substring(32);
    this.baseUrl = 'https://ainext.1688.com';
  }

  /**
   * 生成签名请求头
   * @param {string} body - 请求体 JSON 字符串
   * @returns {object} 签名请求头
   */
  generateSignHeaders(body) {
    const time = Date.now().toString();
    const nonce = crypto.randomBytes(4).toString('hex');
    const contentMd5 = crypto
      .createHash('md5')
      .update(body)
      .digest('base64');
    
    const stringToSign = `${time}\n${nonce}\n${contentMd5}`;
    const sign = crypto
      .createHmac('sha256', this.secret)
      .update(stringToSign)
      .digest('base64');

    return {
      'x-csk-ak': this.keyId,
      'x-csk-time': time,
      'x-csk-nonce': nonce,
      'x-csk-content-md5': contentMd5,
      'x-csk-version': '1.0.1',
      'x-csk-sign': sign
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
    const signHeaders = this.generateSignHeaders(body);
    
    const url = `${this.baseUrl}${endpoint}`;
    const response = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        ...signHeaders
      },
      timeout: 10000
    });

    if (!response.data || !response.data.success) {
      throw new Error(`1688 API error: ${JSON.stringify(response.data)}`);
    }

    const data = response.data.model?.data || {};
    return Object.values(data);
  }
}

module.exports = Alibaba1688Client;
