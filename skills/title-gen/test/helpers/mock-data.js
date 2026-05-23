/**
 * @fileoverview Mock data helpers for tests
 * 提供1688 API模拟数据和Mock客户端
 */

/**
 * 模拟产品数据数组
 * @type {Array<Object>}
 */
const mockProducts = [
  {
    productId: '808568029789',
    title: '满天星珍珠项链女年轻款锁骨链2024新款爆款颈链时尚简约项链批发',
    price: '3.00',
    imageUrl: 'https://cbu01.alicdn.com/img/ibank/O1CN01CQBHMY1r7yzfygCn8_!!2215779095585-0-cib.jpg',
    images: ['https://cbu01.alicdn.com/img/ibank/O1CN01CQBHMY1r7yzfygCn8_!!2215779095585-0-cib.jpg'],
    saleCount: 600,
    attributes: {
      goodRates: 100,
      repurchaseRate: 0.457,
      last30DaysSales: '600+',
      category: '项链'
    }
  },
  {
    productId: '717185340741',
    title: 'S925纯银单颗珍珠项链真多麻正圆贝珠时尚女锁骨链小众设计高级感',
    price: '43.47',
    imageUrl: 'https://cbu01.alicdn.com/img/ibank/O1CN014veeYo1EFWbZowN86_!!951110322-0-cib.jpg',
    images: ['https://cbu01.alicdn.com/img/ibank/O1CN014veeYo1EFWbZowN86_!!951110322-0-cib.jpg'],
    saleCount: 10,
    attributes: {
      goodRates: 99.3,
      repurchaseRate: 0.75,
      last30DaysSales: '<10',
      category: '项链'
    }
  }
];

/**
 * 模拟1688搜索API响应
 * @type {Object}
 */
const mockSearchResponse = {
  code: 200,
  message: 'success',
  data: {
    total: 2,
    products: mockProducts
  }
};

/**
 * 模拟1688 API客户端
 * 用于测试时替代真实的Alibaba1688Client
 */
class MockAlibaba1688Client {
  /**
   * @param {Object} options - 配置选项
   * @param {boolean} options.fail - 是否模拟失败
   */
  constructor(options = {}) {
    this.options = options;
  }

  /**
   * 模拟搜索产品
   * @param {string} keyword - 搜索关键词
   * @returns {Promise<Object>} 搜索结果
   */
  async searchProducts(keyword) {
    if (this.options.fail) {
      throw new Error('Mock API failure');
    }
    return mockSearchResponse;
  }

  /**
   * 模拟搜索offers（兼容旧接口）
   * @param {string} query - 搜索关键词
   * @returns {Promise<Array>} 产品数组
   */
  async searchOffers(query) {
    if (this.options.fail) {
      throw new Error('Mock API failure');
    }
    return mockProducts.map(p => ({
      id: p.productId,
      title: p.title,
      price: p.price,
      url: p.imageUrl,
      stats: {
        last30DaysSales: p.saleCount,
        goodRates: p.attributes.goodRates,
        repurchaseRate: p.attributes.repurchaseRate,
        downstreamOffer: 0,
        totalSales: p.attributes.last30DaysSales,
        remarkCnt: 100,
        categoryListName: p.attributes.category,
        earliestListingTime: Date.now()
      }
    }));
  }
}

/**
 * 1688 offers样本数据（原始API格式）
 * @type {Object}
 */
const offersSample = {
  "808568029789": {
    image: "https://example.com/img1.jpg",
    stats: {
      goodRates: 100,
      last30DaysSales: "600+",
      repurchaseRate: "0.45714285714285713",
      downstreamOffer: 0,
      totalSales: "3300+",
      categoryListName: "服饰配件、饰品 > 项饰 > 项链",
      earliestListingTime: "2024-06-22 19:17:09"
    },
    price: "3.00",
    offerId: "808568029789",
    title: "Test Title A"
  },
  "717185340741": {
    image: "https://example.com/img2.jpg",
    stats: {
      goodRates: 99.3,
      last30DaysSales: "<10",
      repurchaseRate: "0.75",
      downstreamOffer: 0,
      totalSales: "400+",
      categoryListName: "服饰配件、饰品 > 项饰 > 项链",
      earliestListingTime: "2023-05-08 18:01:50"
    },
    price: "43.47",
    offerId: "717185340741",
    title: "Test Title B"
  }
};

module.exports = {
  mockProducts,
  mockSearchResponse,
  MockAlibaba1688Client,
  offersSample
};
