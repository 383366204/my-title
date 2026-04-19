const axios = require('axios');
const { removeBannedWords } = require('./banned-words');
// 引入通用的 LLM 结果解析与重试封装
const { parseJsonFromLLM, retry } = require('./llm-utils');

// 公共违禁词列表（两个 prompt 共享）
const BANNED_WORDS_LIST = '最、第一、顶级、正品、专柜、原厂、工厂、批发、直销、厂家、生产、货源、代发、高仿、仿真、同款、包邮、特价、促销、打折、清仓、出厂价、批发价、成本价';

// 公共标题规则（不带编号，各 prompt 自行编号）
const COMMON_TITLE_RULES_TEXT = `标题中不允许出现任何标点符号（包括逗号、句号、感叹号、分号、冒号、顿号、括号、引号等中英文标点）
标题中不要有空格，所有词语连续书写
标题中严禁使用以下违禁词：${BANNED_WORDS_LIST}`;

class GLMClient {
  // Deprecated: use selectAndGenerate() instead. This method remains for compatibility.
  /**
   * 构造函数
   * @param {object} config - 配置
   * @param {string} config.apiKey - GLM API Key
   * @param {string} [config.apiBase] - API 基础地址
   * @param {string} [config.model] - 模型名称
   */
  constructor(config) {
    this.apiKey = config.apiKey;
    this.apiBase = config.apiBase || 'https://open.bigmodel.cn/api/paas/v4';
    this.model = config.model || 'glm-4-flash';
  }

  /**
   * 提取核心词和带刚性分类的修饰词
   * @param {string} input - 用户输入关键词
   * @returns {Promise<{
   *   coreWord: string,
   *   modifiers: Array<{word: string, rigidity: 'rigid'|'optional'}>
   * }>} 
   */
  async extractCoreAndModifiers(input) {
    const systemPrompt = `你是一个电商标题分析助手。请从用户关键词中提取：

1. 核心商品词 - 1-2个词，代表商品类别（如项链、裙子）
2. 修饰词列表 - 每个修饰词标注刚性程度：
   - "rigid" = 强制匹配（不满足则产品错误，必须剔除）
   - "optional" = 可选匹配（只用于描述吸引力，不强制）

判断规则：
- 材质 → rigid（如"纯银"必须是纯银材质）
- 颜色 → rigid（如"黑色"必须是黑色）
- 规格尺寸 → rigid（如"XL"必须是XL）
- 目标人群 → rigid（如"女款"必须是女款）
- 风格 → optional（如"ins风"是风格描述，不强制）
- 流行词 → optional（如"高级感"、"网红"是描述性词，不强制）
- 时间/季节 → optional（如"2026新款"、"夏季"不强制）

输出严格 JSON 格式，不要任何其他文字：
{
  "coreWord": "核心词",
  "modifiers": [
    {"word": "修饰词1", "rigidity": "rigid"},
    {"word": "修饰词2", "rigidity": "optional"}
  ]
}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input }
    ];

    const response = await axios.post(
      `${this.apiBase}/chat/completions`,
      {
        model: this.model,
        messages,
        temperature: 0.1
      },
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    let content = response.data.choices[0].message.content.trim();
    // 移除可能的 markdown 代码块并解析 JSON
    const result = parseJsonFromLLM(content);

    // 验证格式
    if (!result.coreWord || !Array.isArray(result.modifiers)) {
      throw new Error('Invalid response format from GLM');
    }

    result.modifiers.forEach(mod => {
      if (!['rigid', 'optional'].includes(mod.rigidity)) {
        mod.rigidity = 'optional';
      }
    });

    return result;
  }

  /**
   * 评估产品与搜索意图的相关性
    * @param {{
   *   blueOceanWord: string,
   *   coreWord: string,
   *   products: Array<{id: string, title: string, price: number, sales?: number}>,
   *   maxProducts?: number
   * }} params
   * @returns {Promise<Array<{productId: string, score: number, reason: string}>>} 评分结果列表
   */
  async judgeRelevance({ blueOceanWord, coreWord, products, maxProducts = 15 }) {
    // 限制最多15个产品进行评分
    const productsToScore = products.slice(0, maxProducts);

    const systemPrompt = `你是电商选品助手，评估产品与搜索意图的相关性。评分0-10，≥6分表示相关。
评分标准：
- 10分：完全匹配核心词和所有关键属性
- 8-9分：高度匹配，可能缺少次要属性
- 6-7分：基本匹配，可作为替代选项
- 0-5分：不匹配或相关性低

输出严格 JSON 格式：
[
  {"productId": "商品ID", "score": 8, "reason": "评分原因"}
]`;

    const userPrompt = JSON.stringify({
      蓝海词: blueOceanWord,
      核心词: coreWord,
      产品列表: productsToScore.map(p => ({
        id: p.id,
        title: p.title,
        price: p.price,
        sales: p.sales || 0
      }))
    });

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const response = await axios.post(
      `${this.apiBase}/chat/completions`,
      {
        model: this.model,
        messages,
        temperature: 0.1
      },
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    let content = response.data.choices[0].message.content.trim();
    // 移除可能的 markdown 代码块并解析 JSON
    const result = parseJsonFromLLM(content);

    // 验证返回格式
    if (!Array.isArray(result)) {
      throw new Error('Invalid response format from GLM: expected array');
    }

    return result.map(item => ({
      productId: item.productId || item.product_id,
      score: Number(item.score),
      reason: item.reason || ''
    }));
  }

  /**
   * 通过 GLM API 生成 SEO 优化标题
   * @param {{
   *   blueOceanWord: string,
   *   coreWord: string,
   *   modifiers: Array<{word: string, rigidity: 'rigid'|'optional'}>,
   *   peerTitles?: string[],
   *   products?: Array<object>,
   *   maxLength?: number
   * }} params
   * @returns {Promise<Array<string>>} 生成的标题列表 (3-5 条)
   */
  async generateTitles({ blueOceanWord, coreWord, modifiers, peerTitles = [], products = [], maxLength = 60 }) {
  const systemPrompt = `你是一个电商标题生成专家。请生成3-5个SEO优化标题。
 
 重要规则：
 1. 每个标题必须以蓝海词"${blueOceanWord}"开头
 2. 标题应参考1688商品标题和淘宝同行标题中的高频词汇
 3. 标题长度控制在${Math.floor(maxLength / 2)}个汉字以内（${maxLength}个字符，1汉字=2字符）
 4. 优先使用刚性修饰词（材质、颜色、规格、人群）
  ${COMMON_TITLE_RULES_TEXT}
 
 输出严格 JSON 格式，不要任何其他文本：
 {
   "titles": ["标题1", "标题2", "标题3"]
 }`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify({ coreWord, modifiers, peerTitles, maxLength, products }) }
    ];

    try {
      const response = await axios.post(
        `${this.apiBase}/chat/completions`,
        {
          model: this.model,
          messages,
          temperature: 0.7
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 20000
        }
      );

      let content = response.data.choices[0].message.content.trim();
      // 使用通用解析器解析 LLM JSON 输出
      const result = parseJsonFromLLM(content);

      if (!Array.isArray(result.titles)) {
        // 兜底：若返回结构异常，尝试返回空数组以降级处理
        return [];
      }

      // 去重并控制数量，确保返回 3-5 条
      const titles = Array.from(new Set(result.titles.map(t => String(t).trim()).filter(t => t.length > 0)));
      return titles.slice(0, 5);
    } catch (err) {
      // 降级日志，保持流程不中断
      console.warn('GLM generateTitles 调用失败，执行降级：', err && err.message ? err.message : err);
      return [];
    }
  }

  /**
   * 根据核心词、修饰词以及候选商品，选择合适的商品并生成对应的标题
   * RED: 测试阶段先通过 GLM 接口获取结果，JSON 结构如下：
   * {
   *   selectedProducts: [{ id, score, reason, priceAdvice, risk }],
   *   titles: [{ productId, title }],
   *   overallAdvice: string
   * }
   *
   * @param {Object} params - 参数集合
   * @param {string} params.blueOceanWord - 蓝海词，标题首词
   * @param {string} params.coreWord - 核心词
   * @param {Array<{word:string, rigidity:'rigid'|'optional'}>} params.modifiers - 修饰词及其刚性
   * @param {Array<string>} [params.peerTitles] - 备选标题（可选）
   * @param {Array<{id:string, title:string, price:number, stats?:object}>} [params.products] - 商品列表（简化字段）
   * @param {number} [params.maxLength=60] - 生成标题的最大长度（字符）
   * @returns {Promise<{selectedProducts:Array<{id:string, score:number, reason:string, priceAdvice:string, risk:string}>, titles:Array<{productId:string, title:string}>, overallAdvice:string}>}
   */
  async selectAndGenerate({ blueOceanWord, coreWord, modifiers, peerTitles = [], products = [], maxLength = 60 }) {
    const systemPrompt = `你是一个电商标题选择与生成助手。请在给定的候选商品中，基于核心词和刚性修饰词，选择出最符合意图的若干商品，并给出价格建议与风险提示，同时生成对应的标题候选。
  标题生成必须遵守以下规则：
  ${COMMON_TITLE_RULES_TEXT}
  7. 标题用词应参考peerTitles（同行标题）和刚性修饰词
  输出严格 JSON 格式，不要任何其他文字，字段名必须完全一致：
  {
    "selectedProducts": [
      {
        "id": "商品id",
        "score": 1-10的相关性评分,
        "reason": "选择理由",
        "priceAdvice": "定价建议",
        "risk": "风险提示"
      }
    ],
    "titles": [
      {
        "productId": "对应商品id",
        "title": "生成的标题（无标点无空格，连续书写）"
      }
    ],
    "overallAdvice": "整体选品建议"
  }`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify({ blueOceanWord, coreWord, modifiers, peerTitles, maxLength, products }) }
    ];

    const response = await retry(async () => {
      return await axios.post(
        `${this.apiBase}/chat/completions`,
        {
          model: this.model,
          messages,
          temperature: 0.7
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );
    }, 1, 2000);

    let content = response.data.choices[0].message.content.trim();
    // 移除可能的 markdown 代码块并解析 JSON
    const result = parseJsonFromLLM(content);

    // 简单校验结构
    if (!result || !Array.isArray(result.selectedProducts) || !Array.isArray(result.titles)) {
      throw new Error('Invalid response format from GLM selectAndGenerate');
    }

    // 兼容性处理：确保字段存在
    const selectedProducts = result.selectedProducts.map(p => ({
      id: p.id,
      score: Number(p.score),
      reason: p.reason || '',
      priceAdvice: p.priceAdvice || '',
      risk: p.risk || ''
    }));

    const titles = result.titles.map(t => ({
      productId: t.productId || t.product_id,
      title: removeBannedWords(t.title)
    }));

    return {
      selectedProducts,
      titles,
      overallAdvice: result.overallAdvice || ''
    };
  }
}

module.exports = GLMClient;
