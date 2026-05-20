const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { parseJsonFromLLM, retry } = require('./llm-utils');

// 策略定义
const STRATEGIES = {
  CROWD: 'crowd',      // 人群 → 产品关键词
  SCENE: 'scene',      // 场景 → 产品关键词
  SEASON: 'season',    // 季节 → 应季品类关键词
  PROBLEM: 'problem',  // 痛点动词 → 细分产品关键词
  INDUSTRY: 'industry', // 行业/职业 → 专用工具关键词
  HOLIDAY: 'holiday',  // 节日 → 节日营销关键词
  GIFT: 'gift',        // 送礼 → 产品关键词
  CROSS: 'cross',      // 跨界 → 产品关键词
  GUOCHAO: 'guochao',  // 国潮 → 产品关键词
  TREND: 'trend',      // 趋势 → 产品关键词
  NICHE: 'niche',      // 细分 → 产品关键词
  EMOTION: 'emotion',  // 情绪 → 产品关键词
  PRICE: 'price'       // 价格 → 产品关键词
};

// 有效策略数组（供外部使用）
const VALID_STRATEGIES = Object.values(STRATEGIES);

// 默认候选词数量
const DEFAULT_MAX_CANDIDATES = 5;
const MAX_CANDIDATES_LIMIT = 10;

/**
 * 根据策略生成 GLM 提示词
 * @param {string} strategy - 策略名称
 * @param {string} input - 用户输入
 * @param {Array<{name: string, keywords: string[]}>} [seasonCategories] - 季节品类列表（仅 season 策略需要）
 * @returns {string} 系统提示词
 */
function generatePrompt(strategy, input, seasonCategories = [], options = {}) {
  switch (strategy) {
    case STRATEGIES.CROWD:
      return `你是一个电商选品专家。请根据以下目标人群，生成相关的产品关键词列表。

目标人群: ${input}

要求:
1. 生成与该人群相关的商品品类关键词
2. 每个关键词应为 2-6 个汉字，描述具体商品
3. 避免通用词（如"礼物"、"用品"），尽量具体（如"婴儿连体衣"、"宝妈哺乳衣"）
4. 返回 JSON 格式: {"keywords": ["关键词1", "关键词2", ...]}`;

    case STRATEGIES.SCENE:
      return `你是一个电商选品专家。请根据以下使用场景，生成相关的产品关键词列表。

使用场景: ${input}

要求:
1. 生成适合该场景的商品品类关键词
2. 每个关键词应为 2-6 个汉字，描述具体商品
3. 考虑场景下的实际需求（如"办公室"→"办公椅"、"笔记本电脑支架"）
4. 返回 JSON 格式: {"keywords": ["关键词1", "关键词2", ...]}`;

    case STRATEGIES.SEASON:
      const categoryList = seasonCategories.map(cat => `- ${cat.name}: ${cat.keywords.join(', ')}`).join('\n');
      return `你是一个电商选品专家。现在是 ${new Date().getMonth() + 1} 月，请根据当前月份和应季品类，生成相关的产品关键词列表。

本月应季品类:
${categoryList}

用户输入: ${input}

要求:
1. 结合用户输入和应季品类，生成相关的商品关键词
2. 每个关键词应为 2-6 个汉字，描述具体商品
3. 优先考虑应季品类中的高频词
4. 返回 JSON 格式: {"keywords": ["关键词1", "关键词2", ...]}`;

    case STRATEGIES.PROBLEM:
      return `你是一个电商选品专家。请根据以下用户痛点动词，生成相关的产品关键词列表。

用户痛点: ${input}

要求:
1. 生成能够解决该痛点的商品品类关键词
2. 每个关键词应为 2-6 个汉字，描述具体商品
3. 痛点可能是身体不适（如"腰酸背痛"→"护腰带"）、生活不便（如"收纳困难"→"收纳箱"）等
4. 返回 JSON 格式: {"keywords": ["关键词1", "关键词2", ...]}`;

    case STRATEGIES.INDUSTRY:
      return `你是一个电商选品专家。请根据以下行业/职业，生成相关的专用工具或产品关键词列表。

行业/职业: ${input}

要求:
1. 生成该行业/职业专用的工具、设备、耗材等商品关键词
2. 每个关键词应为 2-6 个汉字，描述具体商品
3. 考虑专业需求（如"程序员"→"机械键盘"、"程序员桌垫"）
4. 返回 JSON 格式: {"keywords": ["关键词1", "关键词2", ...]}`;

    case STRATEGIES.HOLIDAY:
      var holidayInfo = options._holidayInfo || { name: '当前节日', description: '', keywords: [] };
      var kwList = holidayInfo.keywords.join('、');
      return `你是一个电商选品专家。当前日期: ${new Date().toLocaleDateString('zh-CN')}。

即将到来的节日: ${holidayInfo.name}（${holidayInfo.daysUntil > 0 ? holidayInfo.daysUntil + '天后' : '进行中'}）
节日说明: ${holidayInfo.description}

该节日常见品类参考: ${kwList}

用户输入: ${input}

要求:
1. 结合节日特性和用户输入，生成相关的电商商品关键词
2. 每个关键词应为 2-6 个汉字，描述具体商品
3. 关键词应适合该节日期间的搜索和推广
4. 可参考常见品类，但不要照搬，要发散出更多具体商品
5. 返回 JSON 格式: {"keywords": ["关键词1", "关键词2", ...]}`;

    case STRATEGIES.GIFT:
      return `你是一个电商选品专家。请根据以下送礼场景，生成相关的产品关键词列表。送礼对象/场景: ${input}。考虑收礼人的身份和关系（如送领导→高档钢笔、送闺蜜→香薰礼盒）

要求:
1. 每个关键词应为 2-6 个汉字，描述具体商品
2. 返回 JSON 格式: {"keywords": ["关键词1", "关键词2", ...]}`;

    case STRATEGIES.CROSS:
      return `你是一个电商选品专家。请将以下两个品类/概念进行跨界组合，生成创新的产品关键词。两个品类（用+或空格分隔）: ${input}。组合要自然合理，有真实消费场景（如宠物+旅行→便携猫包）

要求:
1. 每个关键词应为 2-6 个汉字，描述具体商品
2. 返回 JSON 格式: {"keywords": ["关键词1", "关键词2", ...]}`;

    case STRATEGIES.GUOCHAO:
      return `你是一个电商选品专家。请结合中国传统文化元素和现代消费品，生成国潮风格的产品关键词。品类方向: ${input}。风格要年轻化、有设计感（如国风手机壳、新中式茶具、汉元素连衣裙）

要求:
1. 每个关键词应为 2-6 个汉字，描述具体商品
2. 返回 JSON 格式: {"keywords": ["关键词1", "关键词2", ...]}`;

    case STRATEGIES.TREND:
      const hotDataText = options._hotData || '暂无热榜数据，请基于你的知识推荐';
      return `你是一个电商选品专家。以下是当前市场热榜数据，请结合热榜趋势和用户输入，生成有潜力的产品关键词。当前热榜数据: ${hotDataText}。用户关注方向: ${input}。优先选择热榜中上升势头强的品类

要求:
1. 每个关键词应为 2-6 个汉字，描述具体商品
2. 返回 JSON 格式: {"keywords": ["关键词1", "关键词2", ...]}`;

    case STRATEGIES.NICHE:
      return `你是一个电商选品专家。请从以下大品类中挖掘冷门细分市场的产品关键词。大品类: ${input}。细分方向：特定人群、特定场景、特定功能、特定材质（如杯子→婴儿学饮杯、车载保温杯）。避免大词和通用词，只输出长尾细分词

要求:
1. 每个关键词应为 2-6 个汉字，描述具体商品
2. 返回 JSON 格式: {"keywords": ["关键词1", "关键词2", ...]}`;

    case STRATEGIES.EMOTION:
      return `你是一个电商选品专家。请根据以下消费者情绪/心理需求，生成满足该情绪的商品关键词。情绪/心理: ${input}。情绪可能是: 解压→捏捏乐、仪式感→香薰蜡烛、治愈→毛绒玩具、怀旧→复古摆件等

要求:
1. 每个关键词应为 2-6 个汉字，描述具体商品
2. 返回 JSON 格式: {"keywords": ["关键词1", "关键词2", ...]}`;

    case STRATEGIES.PRICE:
      return `你是一个电商选品专家。请根据以下价格区间，生成适合该价格带的商品关键词。价格带/预算: ${input}。考虑价格带对应的消费心理和品质预期（如10元以内→小商品、百元级→轻奢小物）

要求:
1. 每个关键词应为 2-6 个汉字，描述具体商品
2. 返回 JSON 格式: {"keywords": ["关键词1", "关键词2", ...]}`;

    default:
      throw new Error(`未知策略: ${strategy}`);
  }
}

/**
 * 加载季节数据并获取当前月份对应的品类
 * @param {string} dataPath - season-data.json 路径
 * @returns {Array<{name: string, keywords: string[]}>} 当前月份的品类列表
 */
function loadSeasonCategories(dataPath) {
  try {
    const rawData = fs.readFileSync(dataPath, 'utf8');
    const data = JSON.parse(rawData);
    const currentMonth = new Date().getMonth() + 1; // 1-12
    const monthData = data.months.find(m => m.month === currentMonth);
    return monthData ? monthData.categories : [];
  } catch (error) {
    console.warn(`⚠️  无法加载季节数据: ${error.message}`);
    return [];
  }
}

function loadHolidayData(dataPath) {
  try {
    var rawData = fs.readFileSync(dataPath, 'utf8');
    var data = JSON.parse(rawData);
    return data.holidays || [];
  } catch (error) {
    console.warn('⚠️  无法加载节日数据: ' + error.message);
    return [];
  }
}

function findNearestHoliday(holidays) {
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var candidates = holidays.map(function(h) {
    var holidayDate = new Date(now.getFullYear(), h.month - 1, h.day);
    if (holidayDate < today) {
      holidayDate = new Date(now.getFullYear() + 1, h.month - 1, h.day);
    }
    var daysUntil = Math.ceil((holidayDate - today) / 86400000);
    var leadStart = new Date(holidayDate);
    leadStart.setDate(leadStart.getDate() - h.leadDays);
    return Object.assign({}, h, {
      nextDate: holidayDate,
      daysUntil: daysUntil,
      inLeadWindow: today >= leadStart
    });
  });
  var inWindow = candidates.filter(function(c) { return c.inLeadWindow; }).sort(function(a, b) { return a.daysUntil - b.daysUntil; });
  if (inWindow.length > 0) return inWindow[0];
  candidates.sort(function(a, b) { return a.daysUntil - b.daysUntil; });
  return candidates[0];
}

/**
 * 候选词归一化（去除空格，全角转半角，小写转换）
 * @param {string} keyword - 原始关键词
 * @returns {string} 归一化后的关键词
 */
function normalizeKeyword(keyword) {
  if (!keyword || typeof keyword !== 'string') return '';
  // 1. 去除所有空格（包括全角空格）
  let normalized = keyword.replace(/\s+/g, '').replace(/　/g, '');
  // 2. 去除首尾空白字符（如换行符等）
  normalized = normalized.trim();
  // 3. 转换为小写以实现大小写不敏感去重
  normalized = normalized.toLowerCase();
  return normalized;
}

/**
 * 候选词去重（基于归一化后的字符串）
 * @param {string[]} keywords - 原始候选词列表
 * @returns {string[]} 去重后的列表
 */
function deduplicateKeywords(keywords) {
  const seen = new Set();
  const result = [];
  for (const kw of keywords) {
    const normalized = normalizeKeyword(kw);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(kw); // 保留原始形式（不含多余空格）
    }
  }
  return result;
}

/**
 * 关键词推荐器
 * @param {Object} options - 配置选项
 * @param {string} options.strategy - 策略类型：'crowd' | 'scene' | 'season' | 'holiday' | 'problem' | 'industry' | 'gift' | 'cross' | 'guochao' | 'trend' | 'niche' | 'emotion' | 'price'
 * @param {string} options.input - 用户输入（人群、场景、痛点、送礼对象、跨界品类、国潮品类、趋势方向、大品类、情绪、价格区间等，部分策略可省略）
 * @param {number} [options.maxCandidates] - 最大候选词数量（默认 5，最大 10）
 * @param {Object} [options.glmClient] - GLMClient 实例（可选，未提供则自动创建）
 * @returns {Promise<string[]>} 候选关键词数组
 */
async function suggestKeywords(options) {
  const { strategy, input, maxCandidates = DEFAULT_MAX_CANDIDATES, glmClient } = options;

  // 1. 验证策略
  if (!VALID_STRATEGIES.includes(strategy)) {
    throw new Error(`无效策略 "${strategy}"。有效策略: ${VALID_STRATEGIES.join(', ')}`);
  }

  // 2. 验证输入（season/holiday/trend 策略允许省略 input）
  if (strategy !== STRATEGIES.SEASON && strategy !== STRATEGIES.HOLIDAY && strategy !== STRATEGIES.TREND) {
    if (!input || typeof input !== 'string' || input.trim().length === 0) {
      throw new Error('输入不能为空');
    }
  }
  // season/trend 策略无输入时使用默认描述
  const effectiveInput = (input && input.trim()) ? input.trim() : 
    (strategy === STRATEGIES.TREND ? '热门上升品类' : '应季热门品类');

  // 3. 限制候选词数量
  const maxCands = Math.min(Math.max(1, maxCandidates), MAX_CANDIDATES_LIMIT);

  // 4. 准备 GLM 客户端
  let client = glmClient;
  if (!client) {
    const GLMClient = require('./glm-client');
    client = new GLMClient({
      apiKey: process.env.GLM_API_KEY,
      apiBase: process.env.GLM_API_BASE,
      model: process.env.GLM_API_MODEL
    });
  }

  // 5. 季节/节日/趋势策略特殊处理：加载对应数据
  let seasonCategories = [];
  let holidayInfo = null;
  let hotData = null;
  if (strategy === STRATEGIES.SEASON) {
    const dataPath = path.join(__dirname, '..', 'data', 'season-data.json');
    seasonCategories = loadSeasonCategories(dataPath);
    if (seasonCategories.length === 0) {
      console.warn('⚠️  季节数据为空，GLM 将仅基于用户输入生成关键词');
    }
  }
  if (strategy === STRATEGIES.HOLIDAY) {
    const dataPath = path.join(__dirname, '..', 'data', 'holiday-data.json');
    var holidays = loadHolidayData(dataPath);
    if (holidays.length > 0) {
      holidayInfo = findNearestHoliday(holidays);
      console.log('🎉 节日选词: ' + holidayInfo.name + '（' + holidayInfo.daysUntil + '天后）');
    }
  }
  if (strategy === STRATEGIES.TREND) {
    try {
      const Alibaba1688Client = require('./alibaba1688-client');
      const client = new Alibaba1688Client(process.env.ALI_1688_AK);
      const opportunities = await client.fetchOpportunities();
      hotData = JSON.stringify(opportunities, null, 2);
      if (hotData.length > 2000) {
        hotData = hotData.slice(0, 2000) + '...';
      }
      console.log('📈 趋势选词: 已加载1688热榜数据');
    } catch (error) {
      console.warn('⚠️  1688热榜加载失败，将使用纯GLM推理: ' + error.message);
      hotData = '';
    }
  }

  // 6. 生成提示词并调用 GLM
  const prompt = generatePrompt(strategy, effectiveInput, seasonCategories, { 
    _holidayInfo: holidayInfo, 
    _hotData: hotData 
  });
  const messages = [
    { role: 'system', content: '你是一个电商选品专家，擅长根据用户需求生成商品关键词。' },
    { role: 'user', content: prompt }
  ];

  try {
    // 使用 GLM 客户端配置进行 API 调用
    const apiBase = client.apiBase || 'https://open.bigmodel.cn/api/paas/v4';
    const apiKey = client.apiKey || process.env.GLM_API_KEY;
    const model = client.model || 'glm-4-flash';
    const timeout = client._timeout || 15000;

    const response = await retry(async () => {
      const res = await axios.post(
        `${apiBase}/chat/completions`,
        {
          model,
          messages,
          temperature: 0.1
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout
        }
      );
      return res;
    }, 1, 2000);

    let content = response.data.choices[0].message.content.trim();
    const result = parseJsonFromLLM(content);

    // 7. 提取关键词列表
    let keywords = Array.isArray(result.keywords) ? result.keywords : [];
    if (keywords.length === 0 && Array.isArray(result)) {
      // 兼容直接返回数组的情况
      keywords = result;
    }

    // 8. 去重
    keywords = deduplicateKeywords(keywords);

    // 9. 限制数量
    return keywords.slice(0, maxCands);

  } catch (error) {
    console.error(`GLM 调用失败: ${error.message}`);
    // 降级：返回空数组
    return [];
  }
}

/**
 * 解析 SYCM 数据中的数值字段（支持字符串百分比和数字）
 * @param {number|string} value - 原始值（如 0.052 或 "5.2%"）
 * @returns {number} 解析后的数值（如 0.052）
 */
function parseSycmValue(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.endsWith('%')) {
      return parseFloat(trimmed) / 100;
    }
    const parsed = parseFloat(trimmed);
    if (!isNaN(parsed)) {
      return parsed;
    }
    return 0;
  } else if (typeof value === 'number') {
    return value;
  }
  return 0;
}

/**
 * SYCM 验证候选关键词
 * @param {string[]} candidates - 候选关键词列表
 * @param {Object} [options={}] - 配置选项
 * @param {number} [options.port=9222] - Chrome 调试端口
 * @param {number} [options.delay=5000] - 连续查询间隔（毫秒）
 * @param {number} [options.maxCandidates] - 返回的最大关键词数量
 * @param {Function} [options.onProgress] - 进度回调 fn(msg)
 * @returns {Promise<Object>} {ok, keywords, verified, failed, errors, message?}
 */
async function verifyKeywordsWithSycm(candidates, options = {}) {
  const {
    port = 9222,
    delay = 5000,
    maxCandidates,
    onProgress = (msg) => console.log(`[SYCM] ${msg}`)
  } = options;

  // 检查 Chrome DevTools 是否可用
  const { isChromeDevToolsAvailable, autoLaunchChrome } = require('./sycm-browser-helper');
  const { extractSycmData } = require('./sycm-cdp-extractor');

  if (!await isChromeDevToolsAvailable(port)) {
    const launchResult = await autoLaunchChrome(port);
    if (!launchResult.success) {
      return {
        ok: false,
        error: launchResult.message,
        keywords: [],
        verified: 0,
        failed: candidates.length,
        errors: []
      };
    }
  }

  const keywordMap = new Map(); // 用于去重，key是normalize后的关键词，value是完整对象
  const errors = [];
  let failed = 0;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    onProgress(`正在验证关键词 (${i + 1}/${candidates.length}): ${candidate}`);
    let foundForCandidate = false;

    try {
      // 调用 SYCM 数据提取
      const result = await extractSycmData(candidate, {
        mode: 'hot',
        port,
        onProgress: (msg) => onProgress(`[SYCM ${candidate}] ${msg}`)
      });

      if (!result.data || !Array.isArray(result.data)) {
        throw new Error('SYCM 返回数据格式无效');
      }

      // 筛选符合条件的数据行
      for (const item of result.data) {
        // 解析数值字段
        const searchPopularity = typeof item.searchPopularity === 'number' ? item.searchPopularity : parseSycmValue(item.searchPopularity);
        const conversionRate = typeof item.conversionRate === 'number' ? item.conversionRate : parseSycmValue(item.conversionRate);
        const tmallClickShare = typeof item.tmallClickShare === 'number' ? item.tmallClickShare : parseSycmValue(item.tmallClickShare);
        const demandSupplyRatio = typeof item.demandSupplyRatio === 'number' ? item.demandSupplyRatio : parseSycmValue(item.demandSupplyRatio);
        const clickRate = typeof item.clickRate === 'number' ? item.clickRate : parseSycmValue(item.clickRate);
        const keyword = item.keyword || candidate;
        const normalizedKeyword = normalizeKeyword(keyword);

        // 应用筛选条件
        if (searchPopularity >= 20) {
          foundForCandidate = true;
          const keywordObj = {
            keyword,
            searchPopularity,
            clickRate,
            conversionRate,
            demandSupplyRatio,
            tmallClickShare,
            source: candidate
          };

          // 去重：如果已存在，保留搜索热度更高的那个
          const existing = keywordMap.get(normalizedKeyword);
          if (!existing || searchPopularity > existing.searchPopularity) {
            keywordMap.set(normalizedKeyword, keywordObj);
          }
        }
      }

      if (!foundForCandidate) {
        failed++;
      }

    } catch (error) {
      errors.push({
        keyword: candidate,
        error: error.message || String(error)
      });
      failed++;
      onProgress(`关键词验证失败: ${candidate} - ${error.message}`);
    }

    // 延迟处理下一个关键词（避免请求过快）
    if (i < candidates.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // 将 Map 转换为数组并按 searchPopularity 降序排序
  let keywords = Array.from(keywordMap.values())
    .sort((a, b) => b.searchPopularity - a.searchPopularity);

  // 应用 maxCandidates 限制
  if (maxCandidates && maxCandidates > 0) {
    keywords = keywords.slice(0, maxCandidates);
  }

  const verified = keywords.length;

  // 构建返回结果
  const result = {
    ok: true,
    keywords,
    verified,
    failed,
    errors
  };

  // 添加提示信息
  if (verified === 0) {
    result.message = '未找到有搜索热度的相关词';
  } else if (failed > 0) {
    result.message = `${failed}个关键词验证失败，已返回已验证结果`;
  }

  return result;
}

/**
 * 推荐 + 验证一体化函数
 * @param {Object} options - 同 suggestKeywords + verifyKeywordsWithSycm 的合并选项
 * @returns {Promise<Object>} SYCM验证结果
 */
async function suggestAndVerify(options) {
  // 调用推荐函数获取候选词
  const candidates = await suggestKeywords(options);
  
  if (!candidates || candidates.length === 0) {
    return {
      ok: true,
      keywords: [],
      verified: 0,
      failed: 0,
      errors: [],
      message: 'GLM未返回有效候选词'
    };
  }

  // 默认跳过 SYCM 验证，除非显式开启
  const skipSycm = options.skipSycm !== false;

  if (skipSycm) {
    return {
      ok: true,
      keywords: candidates.map(c => ({
        keyword: c.keyword || c,
        searchPopularity: c.searchPopularity || null,
        clickRate: c.clickRate || null,
        conversionRate: c.conversionRate || null,
        demandSupplyRatio: c.demandSupplyRatio || null,
        tmallClickShare: c.tmallClickShare || null,
        source: 'ai_suggest'
      })),
      verified: candidates.length,
      failed: 0,
      errors: [],
      message: '已跳过 SYCM 验证，仅返回 AI 推荐候选词'
    };
  }

  // 传递相关选项给验证函数
  const verifyOptions = {
    port: options.port,
    delay: options.delay,
    filterCriteria: options.filterCriteria,
    onProgress: options.onProgress
  };

  return verifyKeywordsWithSycm(candidates, verifyOptions);
}

module.exports = { suggestKeywords, STRATEGIES, VALID_STRATEGIES, verifyKeywordsWithSycm, suggestAndVerify };