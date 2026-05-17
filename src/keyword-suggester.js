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
  INDUSTRY: 'industry' // 行业/职业 → 专用工具关键词
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
function generatePrompt(strategy, input, seasonCategories = []) {
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
 * @param {string} options.strategy - 策略类型：'crowd' | 'scene' | 'season' | 'problem' | 'industry'
 * @param {string} options.input - 用户输入（人群、场景、痛点等）
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

  // 2. 验证输入（season 策略允许省略 input，自动检测月份）
  if (strategy !== STRATEGIES.SEASON) {
    if (!input || typeof input !== 'string' || input.trim().length === 0) {
      throw new Error('输入不能为空');
    }
  }
  // season 策略无输入时使用默认描述
  const effectiveInput = (input && input.trim()) ? input.trim() : '应季热门品类';

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

  // 5. 季节策略特殊处理：加载季节数据
  let seasonCategories = [];
  if (strategy === STRATEGIES.SEASON) {
    const dataPath = path.join(__dirname, '..', 'data', 'season-data.json');
    seasonCategories = loadSeasonCategories(dataPath);
    if (seasonCategories.length === 0) {
      console.warn('⚠️  季节数据为空，GLM 将仅基于用户输入生成关键词');
    }
  }

  // 6. 生成提示词并调用 GLM
  const prompt = generatePrompt(strategy, effectiveInput, seasonCategories);
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
    // 去除空格，检查是否以百分号结尾
    const trimmed = value.trim();
    if (trimmed.endsWith('%')) {
      return parseFloat(trimmed) / 100;
    }
    // 可能是纯数字字符串
    const parsed = parseFloat(trimmed);
    if (!isNaN(parsed)) {
      // 如果数字大于等于1，假设是百分比（例如 5.2 表示 5.2%）
      if (parsed >= 1) {
        return parsed / 100;
      }
      return parsed;
    }
    return 0;
  } else if (typeof value === 'number') {
    // 如果数字大于等于1，假设是百分比（例如 5.2 表示 5.2%）
    if (value >= 1) {
      return value / 100;
    }
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
 * @param {Object} [options.filterCriteria] - 蓝海词筛选标准
 * @param {number} [options.filterCriteria.searchPopularity=50] - 最低搜索人气
 * @param {number} [options.filterCriteria.minConversionRate=0.05] - 最低转化率
 * @param {number} [options.filterCriteria.maxConversionRate=0.15] - 最高转化率
 * @param {Function} [options.onProgress] - 进度回调 fn(msg)
 * @returns {Promise<Object>} {ok, keywords, verified, failed, errors, message?}
 */
async function verifyKeywordsWithSycm(candidates, options = {}) {
  const {
    port = 9222,
    delay = 5000,
    filterCriteria = {},
    onProgress = (msg) => console.log(`[SYCM] ${msg}`)
  } = options;

  // 规范化筛选标准：将百分比值转换为小数
  const normalizeFilterValue = (key, value) => {
    if (key === 'tmallClickShare' && typeof value === 'number' && value >= 1) {
      return value / 100; // 百分比转换为小数
    }
    return value;
  };

  const normalizedFilterCriteria = Object.fromEntries(
    Object.entries(filterCriteria).map(([key, value]) => [key, normalizeFilterValue(key, value)])
  );

  // 默认筛选标准
  const criteria = {
    searchPopularity: 50,
    minConversionRate: 0.05,
    maxConversionRate: 0.15,
    tmallClickShare: 0.65, // 65% 转换为小数
    demandSupplyRatio: 1,
    ...normalizedFilterCriteria
  };

  // 检查 Chrome DevTools 是否可用
  const { isChromeDevToolsAvailable, generateChromeLaunchCommand } = require('./sycm-browser-helper');
  const { extractSycmData } = require('./sycm-cdp-extractor');

  const chromeAvailable = await isChromeDevToolsAvailable(port);
  if (!chromeAvailable) {
    const launchCmd = generateChromeLaunchCommand({ port }).command;
    return {
      ok: false,
      error: 'Chrome DevTools 未启动，请先启动 Chrome 调试模式',
      chromeLaunchCmd: launchCmd,
      keywords: [],
      verified: 0,
      failed: candidates.length,
      errors: []
    };
  }

  const keywords = [];
  const errors = [];
  let verified = 0;
  let failed = 0;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    onProgress(`正在验证关键词 (${i + 1}/${candidates.length}): ${candidate}`);

    try {
      // 调用 SYCM 数据提取
      const result = await extractSycmData(candidate, {
        mode: 'blue',
        port,
        onProgress: (msg) => onProgress(`[SYCM ${candidate}] ${msg}`)
      });

      if (!result.data || !Array.isArray(result.data)) {
        throw new Error('SYCM 返回数据格式无效');
      }

      // 筛选符合蓝海条件的数据行
      for (const item of result.data) {
        // 解析数值字段
        const searchPopularity = typeof item.searchPopularity === 'number' ? item.searchPopularity : parseSycmValue(item.searchPopularity);
        const conversionRate = typeof item.conversionRate === 'number' ? item.conversionRate : parseSycmValue(item.conversionRate);
        const tmallClickShare = typeof item.tmallClickShare === 'number' ? item.tmallClickShare : parseSycmValue(item.tmallClickShare);
        const demandSupplyRatio = typeof item.demandSupplyRatio === 'number' ? item.demandSupplyRatio : parseSycmValue(item.demandSupplyRatio);
        const clickRate = typeof item.clickRate === 'number' ? item.clickRate : parseSycmValue(item.clickRate);

        // 应用筛选条件
        if (
          searchPopularity >= criteria.searchPopularity &&
          conversionRate >= criteria.minConversionRate &&
          conversionRate <= criteria.maxConversionRate &&
          tmallClickShare < criteria.tmallClickShare &&
          demandSupplyRatio >= criteria.demandSupplyRatio
        ) {
          keywords.push({
            keyword: item.keyword || candidate,
            searchPopularity,
            clickRate,
            conversionRate,
            demandSupplyRatio,
            tmallClickShare
          });
          verified++;
        } else {
          failed++;
        }
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
    result.message = '未找到符合蓝海条件的关键词';
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