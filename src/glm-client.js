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

// 品类过滤词表生成 Prompt
const CATEGORY_FILTER_PROMPT = `你是一个电商品类分析专家。
根据用户输入的核心词和蓝海词，分析该类商品在淘宝上的常见分类和相关词汇。

核心词: {{coreWord}}
蓝海词: {{blueOceanWord}}

请返回 JSON 格式:
{
  "targetCategories": ["该核心词下的细分品类列表"],
  "excludeCategories": ["不属于该类别的品类词，用于过滤噪音"],
  "relatedMaterials": ["常见材质/材料词"]
}

注意:
- excludeCategories 应该包含明显不属于该类别的词（如搜索"项链"时，应排除"耳环"、"手链"等）
- 返回必须是合法 JSON，不要有任何其他文字`;

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
    // 优先使用火山引擎方舟（付费模型，质量更高）
    if (process.env.VOLC_API_KEY) {
      this.apiKey = process.env.VOLC_API_KEY;
      this.apiBase = process.env.VOLC_API_BASE || 'https://ark.cn-beijing.volces.com/api/coding/v3';
      // doubao-seed-2-0-lite: 比 glm-5.1 快 20%+，且返回有效结果（glm-5.1 selectAndGenerate 返回空）
      this.model = config.model || 'doubao-seed-2-0-lite-260428';
    } else {
      this.apiKey = config.apiKey;
      this.apiBase = config.apiBase || 'https://open.bigmodel.cn/api/paas/v4';
      this.model = config.model || 'glm-4-flash';
    }
    // 火山引擎 doubao-lite 响应更快，超时适当缩短
    this._timeout = this.apiBase.includes('volces.com') ? 30000 : 15000;
    this._longTimeout = this._timeout * 2;
  }

  /**
   * 提取核心词和带刚性分类的修饰词
   * @param {string} input - 用户输入关键词
   * @returns {Promise<{
   *   coreWord: string,
   *   modifiers: Array<{word: string, rigidity: 'rigid'|'optional', group: string, synonyms: string[]}>,
   *   semanticGroups: {[group: string]: string[]}
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
- 品类限定词 → rigid（如"猫咪"限定宠物用品、"婴儿"限定婴儿用品、"汽车"限定汽车用品。这些词虽然不是材质/颜色/规格，但不匹配则商品完全错误）
- 风格 → optional（如"ins风"是风格描述，不强制）
- 流行词 → optional（如"高级感"、"网红"是描述性词，不强制）
- 时间/季节 → optional（如"2026新款"、"夏季"不强制）

如果该修饰词有常见的语义等价变体（如颜色的不同叫法、材质的不同标号、人群的不同称呼），请在 synonyms 中列出
group 用简短的语义族命名如'蓝色系'、'纯银系'、'女系'
synonyms 每组最多10个，只列最常见的变体

输出严格 JSON 格式，不要任何其他文字：
{
  "coreWord": "核心词",
  "modifiers": [
    {"word": "修饰词1", "rigidity": "rigid", "group": "语义族", "synonyms": ["同义词1", "同义词2"]},
    {"word": "修饰词2", "rigidity": "optional", "group": "语义族", "synonyms": ["同义词1", "同义词2"]}
  ],
  "semanticGroups": {
    "蓝色系": ["蓝色", "天蓝", "浅蓝", "宝蓝", "藏青", "湖蓝"],
    "纯银系": ["纯银", "S925", "925银", "足银", "镀银"]
  }
}

示例：
输入"猫咪衣服春装" → {"coreWord": "衣服", "modifiers": [{"word": "猫咪", "rigidity": "rigid", "group": "宠物系", "synonyms": ["宠物"]}, {"word": "春装", "rigidity": "rigid", "group": "春季系", "synonyms": ["春季", "春天"]}], "semanticGroups": {"宠物系": ["猫咪", "宠物", "宠物猫"], "春季系": ["春装", "春季", "春天"]}}
输入"宠物狗衣服冬装" → {"coreWord": "衣服", "modifiers": [{"word": "宠物狗", "rigidity": "rigid", "group": "宠物系", "synonyms": ["宠物", "狗"]}, {"word": "冬装", "rigidity": "rigid", "group": "冬季系", "synonyms": ["冬季", "冬天"]}], "semanticGroups": {"宠物系": ["宠物狗", "宠物", "狗"], "冬季系": ["冬装", "冬季", "冬天"]}}
输入"婴儿连体衣纯棉" → {"coreWord": "连体衣", "modifiers": [{"word": "婴儿", "rigidity": "rigid", "group": "婴儿系", "synonyms": ["婴幼儿", "宝宝"]}, {"word": "纯棉", "rigidity": "rigid", "group": "纯棉系", "synonyms": ["全棉", "100%棉"]}], "semanticGroups": {"婴儿系": ["婴儿", "婴幼儿", "宝宝"], "纯棉系": ["纯棉", "全棉", "100%棉"]}}
输入"儿童书包小学生" → {"coreWord": "书包", "modifiers": [{"word": "儿童", "rigidity": "rigid", "group": "学生系", "synonyms": ["学生", "学龄"]}, {"word": "小学生", "rigidity": "rigid", "group": "学生系", "synonyms": ["学生", "学龄"]}], "semanticGroups": {"学生系": ["儿童", "小学生", "学生", "学龄"]}}`;

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
        timeout: this._timeout
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

    // Ensure group and synonyms defaults for each modifier
    result.modifiers.forEach(mod => {
      mod.group = mod.group || mod.word;
      mod.synonyms = mod.synonyms || [mod.word];
      if (mod.synonyms.length > 10) mod.synonyms = mod.synonyms.slice(0, 10);
    });

    // Handle semanticGroups: if not present, build from modifiers
    if (!result.semanticGroups) {
      result.semanticGroups = {};
      result.modifiers.forEach(mod => {
        const group = mod.group || mod.word;
        const synonyms = mod.synonyms || [mod.word];
        if (!result.semanticGroups[group]) {
          result.semanticGroups[group] = [];
        }
        // Merge, dedupe, truncate to 10
        result.semanticGroups[group] = [...new Set([...result.semanticGroups[group], ...synonyms])].slice(0, 10);
      });
    }

    return result;
  }

  /**
   * 从同行标题数组中提取核心词、蓝海词和修饰词
   * @param {string[]} peerTitles - 同行标题数组
   * @returns {Promise<{coreWord: string, blueOceanWord: string, modifiers: Array<{word: string, rigidity: 'rigid'|'optional', group: string, synonyms: string[]}>, semanticGroups: {[group: string]: string[]}}>}
   */
  async extractKeywordsFromPeers(peerTitles) {
    const { RIGIDITY_RULES_TEXT } = require('./extract-core');

    const systemPrompt = `你是一个电商标题分析专家。请分析以下同行标题数组，提取：

1. 核心词 (coreWord) - 1-2个词，代表商品的核心类别（如"项链"、"连衣裙"）
2. 蓝海词 (blueOceanWord) - 从同行标题中提取出现频率最高的核心词组合，作为最佳标题前缀（如"银项链女"、"纯棉T恤男"）
3. 修饰词列表 (modifiers) - 分析同行标题中的高频修饰词，并标注刚性程度：
   - "rigid" = 刚性修饰词（材质、颜色、规格、人群、品类限定词）
   - "optional" = 可选修饰词（风格、流行词、季节词）

判断规则：
${RIGIDITY_RULES_TEXT}

如果该修饰词有常见的语义等价变体（如颜色的不同叫法、材质的不同标号、人群的不同称呼），请在 synonyms 中列出
group 用简短的语义族命名如'蓝色系'、'纯银系'、'女系'
synonyms 每组最多10个，只列最常见的变体

输出严格 JSON 格式，不要任何其他文字：
{
  "coreWord": "核心词",
  "blueOceanWord": "蓝海词",
  "modifiers": [
    {"word": "修饰词1", "rigidity": "rigid", "group": "语义族", "synonyms": ["同义词1", "同义词2"]},
    {"word": "修饰词2", "rigidity": "optional", "group": "语义族", "synonyms": ["同义词1", "同义词2"]}
  ],
  "semanticGroups": {
    "蓝色系": ["蓝色", "天蓝", "浅蓝", "宝蓝", "藏青", "湖蓝"],
    "纯银系": ["纯银", "S925", "925银", "足银", "镀银"]
  }
}

示例：
同行标题["猫咪衣服宠物猫春装可爱小猫服装","猫咪衣服薄款夏季布偶猫宠物衣服"] → {"coreWord": "衣服", "blueOceanWord": "猫咪衣服", "modifiers": [{"word": "猫咪", "rigidity": "rigid", "group": "宠物系", "synonyms": ["宠物"]}, {"word": "宠物", "rigidity": "rigid", "group": "宠物系", "synonyms": ["宠物猫", "猫咪"]}, {"word": "春装", "rigidity": "optional", "group": "春季系", "synonyms": ["春季", "春天"]}], "semanticGroups": {"宠物系": ["猫咪", "宠物", "宠物猫"], "春季系": ["春装", "春季", "春天"]}}
同行标题["婴儿连体衣纯棉春秋款","婴儿衣服纯棉连体衣夏季"] → {"coreWord": "连体衣", "blueOceanWord": "婴儿连体衣", "modifiers": [{"word": "婴儿", "rigidity": "rigid", "group": "婴儿系", "synonyms": ["婴幼儿", "宝宝"]}, {"word": "纯棉", "rigidity": "rigid", "group": "纯棉系", "synonyms": ["全棉", "100%棉"]}, {"word": "春秋款", "rigidity": "optional", "group": "季节系", "synonyms": ["春秋季", "春秋"]}], "semanticGroups": {"婴儿系": ["婴儿", "婴幼儿", "宝宝"], "纯棉系": ["纯棉", "全棉", "100%棉"], "季节系": ["春秋款", "春秋季", "春秋"]}}`;

    const userContent = `同行标题数组：\n${peerTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
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
        timeout: this._timeout
      }
    );

    let content = response.data.choices[0].message.content.trim();
    const result = parseJsonFromLLM(content);

    // 验证格式
    if (!result.coreWord || !result.blueOceanWord || !Array.isArray(result.modifiers)) {
      throw new Error('Invalid response format from GLM');
    }

    result.modifiers.forEach(mod => {
      if (!['rigid', 'optional'].includes(mod.rigidity)) {
        mod.rigidity = 'optional';
      }
    });

    // Ensure group and synonyms defaults for each modifier
    result.modifiers.forEach(mod => {
      mod.group = mod.group || mod.word;
      mod.synonyms = mod.synonyms || [mod.word];
      if (mod.synonyms.length > 10) mod.synonyms = mod.synonyms.slice(0, 10);
    });

    // Handle semanticGroups: if not present, build from modifiers
    if (!result.semanticGroups) {
      result.semanticGroups = {};
      result.modifiers.forEach(mod => {
        const group = mod.group || mod.word;
        const synonyms = mod.synonyms || [mod.word];
        if (!result.semanticGroups[group]) {
          result.semanticGroups[group] = [];
        }
        // Merge, dedupe, truncate to 10
        result.semanticGroups[group] = [...new Set([...result.semanticGroups[group], ...synonyms])].slice(0, 10);
      });
    }

    return result;
  }

  /**
   * @deprecated 此方法已被 selectAndGenerate() 内部替代，保留仅用于测试兼容性。
   *             新代码请使用 selectAndGenerate() 进行产品选择和标题生成。
   *
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
        timeout: this._timeout
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
  5. 每个标题必须差异化：从不同角度（风格、场景、人群、卖点）切入，禁止生成相同或高度相似的标题
   ${COMMON_TITLE_RULES_TEXT}
 
 输出严格 JSON 格式，不要任何其他文本：
 {
   "titles": ["标题1", "标题2", "标题3"]
 }`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify({ coreWord, modifiers, peerTitles, maxLength, products }) }
    ];

    const response = await retry(async () => {
      const res = await axios.post(
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
          timeout: this._timeout
        }
      );
      return res;
    }, 1, 2000);

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
  async selectAndGenerate({ blueOceanWord, coreWord, modifiers, peerTitles = [], keywordAnalysis = null, sycmKeywords = null, products = [], maxLength = 60 }) {
    // 构造关键词分析区块，优先级：sycmKeywords > keywordAnalysis > 默认文本
    let keywordSection = '';
    if (sycmKeywords && Array.isArray(sycmKeywords) && sycmKeywords.length > 0) {
      // 按需求供给比降序排列
      const sortedSycm = [...sycmKeywords].sort((a, b) => (b.demandSupplyRatio || 0) - (a.demandSupplyRatio || 0));
      const sycmLines = sortedSycm.map(k => {
        const ratio = k.demandSupplyRatio || 0;
        let stars = '';
        if (ratio >= 5.0) stars = ' ★★★';
        else if (ratio >= 2.0) stars = ' ★★';
        else if (ratio >= 1.0) stars = ' ★';
        return `${k.keyword} | 搜索人气:${k.searchPopularity || 0} | 倍数:${ratio.toFixed(2)} | 转化率:${k.conversionRate || 0}%${stars}`;
      }).join('\n');
      keywordSection = `
【生意参谋搜索数据（按关键词倍数排序，★越多越优先使用）】
${sycmLines}

用词策略（基于真实搜索数据）：
- 优先使用需求供给比高的关键词（★★★ > ★★ > ★）
- 标题前段：蓝海词 + 核心词 + 需求供给比最高的修饰词
- 标题中段：需求供给比次高的词
- 标题后段：补充高搜索人气但竞争适中的词
- 避免使用需求供给比 < 1.0 的词（竞争大于需求）`;
    }
    if (keywordAnalysis && keywordAnalysis.topKeywords) {
      keywordSection += (keywordSection ? '\n\n' : '') + `
【同行标题分析（补充）】
高频词（出现频次最高，应优先使用）: ${keywordAnalysis.topKeywords.slice(0, 15).map(k => k.word + '(' + k.count + ')').join(', ')}
缺口词（竞品有但我们没有的高价值词，标题应尽量包含）: ${keywordAnalysis.gapKeywords.slice(0, 10).map(k => k.word + '(' + k.count + ')').join(', ')}

用词策略：
- 标题前段：蓝海词 + 核心词（已保证）
- 标题中段：优先使用高频词（确保搜索曝光）
- 标题后段：补充2-3个缺口词（填补竞品优势）
- 避免堆砌：同类词选1个（如"锁骨链"和"颈链"只取搜索量更高的）`;
    }
    if (!keywordSection) {
      keywordSection = '\n【关键词分析】无同行数据，请根据商品标题和常识生成标题。\n';
    }

    const systemPrompt = `你是一个电商标题选择与生成助手。请在给定的候选商品中，基于核心词和刚性修饰词，选择出最符合意图的若干商品，并给出价格建议与风险提示，同时生成对应的标题候选。
  标题生成必须遵守以下规则：
  ${COMMON_TITLE_RULES_TEXT}
  - 每个生成的标题必须以蓝海词"${blueOceanWord}"开头（硬性要求，不可省略）
  ${keywordSection}
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
      { role: 'user', content: JSON.stringify({ blueOceanWord, coreWord, modifiers, peerTitles: peerTitles.slice(0, 50), maxLength, products }) }
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
          timeout: this._longTimeout
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
      score: !isNaN(Number(p.score)) ? Number(p.score) : 0,
      reason: p.reason || '',
      priceAdvice: p.priceAdvice || '',
      risk: p.risk || ''
    }));

    // Defense-in-depth: 此处先过滤违禁词，后续 postProcessTitle 还会再过滤一次
    const titles = result.titles.map(t => ({
      productId: String(t.productId || t.product_id || '').trim(),
      title: removeBannedWords(t.title) // 双重过滤保护
    }));

    return {
      selectedProducts,
      titles,
      overallAdvice: result.overallAdvice || ''
    };
  }

  /**
   * AI 动态生成品类过滤词表
   * @param {string} coreWord - 核心词
   * @param {string} blueOceanWord - 蓝海词
   * @returns {Promise<{targetCategories: string[], excludeCategories: string[], relatedMaterials: string[]}>}
   */
  async generateCategoryFilters(coreWord, blueOceanWord) {
    const prompt = CATEGORY_FILTER_PROMPT
      .replace('{{coreWord}}', coreWord)
      .replace('{{blueOceanWord}}', blueOceanWord);

    const messages = [
      { role: 'system', content: '你是一个电商品类分析专家。' },
      { role: 'user', content: prompt }
    ];

    const response = await retry(async () => {
      return await axios.post(
        `${this.apiBase}/chat/completions`,
        {
          model: this.model,
          messages,
          temperature: 0.3
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: this._timeout
        }
      );
    }, 1, 2000);

    let content = response.data.choices[0].message.content.trim();
    const result = parseJsonFromLLM(content);

    if (!result || !Array.isArray(result.targetCategories) || !Array.isArray(result.excludeCategories) || !Array.isArray(result.relatedMaterials)) {
      throw new Error('Invalid JSON response from generateCategoryFilters');
    }

    return {
      targetCategories: result.targetCategories,
      excludeCategories: result.excludeCategories,
      relatedMaterials: result.relatedMaterials
    };
  }
}

module.exports = GLMClient;
