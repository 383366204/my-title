'use strict';

const { mineKeywords } = require('../../skills/keyword-mining');
const { generateTitlePipeline } = require('../../skills/title-gen');

const registry = {};

function shouldUseRealNodes() {
  return process.env.ECOM_WORKFLOW_USE_REAL_NODES === '1';
}

/**
 * 注册节点类型
 * @param {string} type 节点类型名称
 * @param {object} definition 节点定义，包含 execute 函数
 */
function registerNode(type, definition) {
  registry[type] = definition;
}

const keywordInputNode = {
  name: '输入参数',
  description: '工作流的起点，提供关键词和配置参数',
  inputs: [],
  outputs: ['keyword', 'maxLength', 'minPrice', 'maxPrice'],
  requiredParams: ['keyword'],
  execute: async (inputs, params, context) => {
    context.logger.info(`[Input] 收到输入关键词: "${params.keyword || ''}"`);
    return {
      keyword: params.keyword || '',
      maxLength: parseInt(params.maxLength, 10) || 60,
      minPrice: parseFloat(params.minPrice) || 0,
      maxPrice: parseFloat(params.maxPrice) || 9999
    };
  }
};

// 1. 输入节点。`input` is kept as a legacy alias, but the canvas uses
// `keyword-input` to avoid React Flow's built-in .react-flow__node-input style.
registerNode('keyword-input', keywordInputNode);
registerNode('input', keywordInputNode);

// 2. 关键词挖掘节点
registerNode('keyword-mining', {
  name: '关键词挖掘',
  description: '挖掘长尾词与词根',
  inputs: ['keyword'],
  outputs: ['keywords', 'keyword'],
  requiredParams: [],
  execute: async (inputs, params, context) => {
    const keyword = inputs.keyword || params.keyword;
    if (!keyword) {
      throw new Error('关键词挖掘节点：未接收到输入关键词');
    }
    const count = parseInt(params.count, 10) || 10;
    context.logger.info(`[Keyword Mining] 开始为关键词 "${keyword}" 挖掘 ${count} 个候选词...`);

    let resultKeywords = null;
    try {
      // The canvas MVP defaults to deterministic local output. Real nodes must be
      // explicitly enabled so opening the visual prototype cannot spend API quota.
      if (shouldUseRealNodes() && process.env.GLM_API_KEY) {
        context.logger.info(`[Keyword Mining] 正在调用 GLM AI 挖掘服务...`);
        const result = await mineKeywords({
          count,
          source: 'local',
          sycmPrecheck: false,
          persist: false
        });
        if (result && result.passed && result.passed.length > 0) {
          resultKeywords = result.passed.map(p => p.keyword);
          context.logger.info(`[Keyword Mining] 挖掘成功，获取到 ${resultKeywords.length} 个验真词: ${resultKeywords.slice(0, 5).join(', ')}...`);
        }
      }
    } catch (err) {
      context.logger.warn(`[Keyword Mining] 调用真实挖掘服务失败 (${err.message})，降级为模拟数据。`);
    }

    if (!resultKeywords) {
      // 默认降级模拟数据
      resultKeywords = [
        `${keyword}女`,
        `${keyword}高级感`,
        `${keyword}爆款`,
        `${keyword}新款2026`,
        `小众设计${keyword}`,
        `气质送礼${keyword}`,
        `百搭${keyword}`
      ].slice(0, count);
    }

    context.logger.info(`[Keyword Mining] (模拟) 获取到 ${resultKeywords.length} 个词: ${resultKeywords.join(', ')}`);
    return { keywords: resultKeywords, keyword };
  }
});

// 3. 标题生成节点
registerNode('title-generator', {
  name: '标题生成',
  description: '根据词根和搜索结果生成 SEO 优化标题',
  inputs: ['keyword', 'keywords'],
  outputs: ['titles', 'coreWord', 'blueOceanWord', 'products'],
  requiredParams: [],
  execute: async (inputs, params, context) => {
    let keyword = inputs.keyword || params.keyword;
    if (!keyword && inputs.keywords && inputs.keywords.length > 0) {
      keyword = inputs.keywords[0];
    }
    if (!keyword) {
      throw new Error('标题生成节点：未接收到输入关键词');
    }
    const maxLength = parseInt(inputs.maxLength || params.maxLength, 10) || 60;
    context.logger.info(`[Title Generator] 开始为 "${keyword}" 生成标题，最大长度 ${maxLength}...`);

    try {
      if (shouldUseRealNodes() && process.env.GLM_API_KEY) {
        context.logger.info(`[Title Generator] 正在调用 GLM AI 生成标题管道...`);
        // 使用简化的 mock 搜索，避免真正发起 1688 外部请求
        const result = await generateTitlePipeline(keyword, {
          maxLength,
          useImageSearch: false,
          searchProducts: async () => [] // 降级为空，只让 pipeline 生成
        });
        if (result && result.titles && result.titles.length > 0) {
          context.logger.info(`[Title Generator] 标题生成成功: ${result.titles.join(' | ')}`);
          return {
            titles: result.titles,
            coreWord: result.coreWord,
            blueOceanWord: result.blueOceanWord,
            products: result.products || []
          };
        }
      }
    } catch (err) {
      context.logger.warn(`[Title Generator] 调用真实标题生成失败 (${err.message})，降级为模拟标题。`);
    }

    // 降级模拟标题
    const mockTitles = [
      `【新款爆款】${keyword}女高级感小众设计2026新款气质百搭送女友礼物`,
      `【送礼推荐】${keyword}纯银气质设计感简约百搭轻奢高级感首饰批发`
    ];
    context.logger.info(`[Title Generator] (模拟) 生成标题: ${mockTitles.join(' | ')}`);
    return {
      titles: mockTitles,
      coreWord: keyword,
      blueOceanWord: `${keyword}高级感`,
      products: [
        {
          "链接原标题": `1688优质货源-${keyword}`,
          "产品链接": "https://detail.1688.com/offer/placeholder.html",
          "主图链接": "https://cbu01.alicdn.com/img/ibank/O1CN01placeholder.jpg",
          "铺货标题": mockTitles[0],
          "商品原价": "19.90",
          "30天销量": 800,
          "好评率": 0.98,
          "复购率": 0.15,
          "蓝海词": `${keyword}高级感`,
          "选品理由": "符合当季流行，搜索量大，竞争度低",
          "定价建议": "建议售价 39.00 - 59.00 元",
          "风险提示": "建议进行材质真伪标识检查"
        }
      ]
    };
  }
});

function getNodeDefinition(type) {
  return registry[type];
}

function listNodeTypes() {
  return Object.keys(registry).map(type => ({
    type,
    name: registry[type].name,
    description: registry[type].description,
    inputs: registry[type].inputs || [],
    outputs: registry[type].outputs || [],
    requiredParams: registry[type].requiredParams || []
  }));
}

module.exports = {
  registerNode,
  getNodeDefinition,
  listNodeTypes
};
