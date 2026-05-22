/**
 * @fileoverview 产品数据类型接口定义
 * 使用 JSDoc @typedef 格式定义数据结构，供其他模块引用
 * 同时导出模板对象用于运行时验证
 */

/**
 * @typedef {Object} Stats
 * @property {number} last30DaysSales - 近30天销量
 * @property {number} goodRates - 好评率 (0-1之间的小数)
 * @property {number} repurchaseRate - 复购率 (0-1之间的小数)
 * @property {number} downstreamOffer - 下游offer数量
 * @property {number} totalSales - 总销量
 * @property {number} remarkCnt - 备注数量
 * @property {string} categoryListName - 类目名称列表
 * @property {number} earliestListingTime - 最早上架时间 (时间戳)
 */

/**
 * @typedef {Object} Product
 * @property {string} id - 商品ID
 * @property {string} title - 商品标题
 * @property {string|number} price - 商品价格
 * @property {string} url - 商品链接
 * @property {Stats} stats - 商品统计数据
 */

/**
 * @typedef {Object} RelevanceResult
 * @property {string} productId - 商品ID
 * @property {number} score - 相关性评分 (0-10)
 * @property {string} reason - 评分原因
 */

/**
 * @typedef {Object} SelectionProduct
 * @property {string} 链接原标题 - 1688原始商品标题
 * @property {string} 产品链接 - 1688商品URL
 * @property {string} 铺货标题 - 生成的淘宝铺货标题
 * @property {string|number} 商品原价 - 1688商品原价
 * @property {number} 30天销量 - 近30天销量
 * @property {number} 好评率 - 好评率 (0-1之间的小数)
 * @property {number} 复购率 - 复购率 (0-1之间的小数)
 * @property {string} 蓝海词 - 蓝海词（用户搜索关键词）
 */

/**
 * @typedef {Object} SelectionAdvice
 * @property {string} productId - 商品ID
 * @property {string} reason - 选品理由
 * @property {string} priceAdvice - 定价建议
 * @property {string} riskLevel - 风险等级 (low/medium/high)
 * @property {string} suggestedTitle - 建议标题
 */

/**
 * @typedef {Object} SelectionResult
 * @property {string} 蓝海词 - 蓝海词（用户原始输入）
 * @property {SelectionProduct[]} products - 选品结果产品数组
 */

/**
 * @typedef {Object} SearchResult
 * @property {Product[]} products - 商品数组
 * @property {number} totalCount - 总数量
 * @property {string} dataId - 数据ID
 */

/**
 * 产品数据模板 - 用于运行时验证数据结构
 * @type {Product}
 */
const PRODUCT_TEMPLATE = {
  id: '',
  title: '',
  price: '',
  url: '',
  stats: {
    last30DaysSales: 0,
    goodRates: 0,
    repurchaseRate: 0,
    downstreamOffer: 0,
    totalSales: 0,
    remarkCnt: 0,
    categoryListName: '',
    earliestListingTime: 0
  }
};

/**
 * 相关性评分结果模板
 * @type {RelevanceResult}
 */
const RELEVANCE_RESULT_TEMPLATE = {
  productId: '',
  score: 0,
  reason: ''
};

/**
 * 选品结果产品模板 - 包含11个输出字段（8个原有+3个新增）
 * @type {SelectionProduct}
 */
const SELECTION_PRODUCT_TEMPLATE = {
  链接原标题: '',
  产品链接: '',
  铺货标题: '',
  商品原价: '',
  '30天销量': 0,
  好评率: 0,
  复购率: 0,
  蓝海词: '',
  选品理由: '',
  定价建议: '',
  风险提示: ''
};

/**
 * 选品结果模板
 * @type {SelectionResult}
 */
const SELECTION_RESULT_TEMPLATE = {
  蓝海词: '',
  products: []
};

/**
 * 搜索结果模板
 * @type {SearchResult}
 */
const SEARCH_RESULT_TEMPLATE = {
  products: [],
  totalCount: 0,
  dataId: ''
};

/**
 * 选品建议模板
 * @type {SelectionAdvice}
 */
const SELECTION_ADVICE_TEMPLATE = {
  productId: '',
  reason: '',
  priceAdvice: '',
  riskLevel: '',
  suggestedTitle: ''
};

module.exports = {
  PRODUCT_TEMPLATE,
  RELEVANCE_RESULT_TEMPLATE,
  SELECTION_PRODUCT_TEMPLATE,
  SELECTION_RESULT_TEMPLATE,
  SEARCH_RESULT_TEMPLATE,
  SELECTION_ADVICE_TEMPLATE
};