# Title Generator 电商选品标题生成工具 - 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完整实现一个 Node.js 命令行工具，接收用户关键词，通过 GLM 提取核心词和分类修饰词，调用 1688 AI 搜索 API 搜索商品，然后根据刚性修饰词过滤结果，最终生成符合淘宝 SEO 规范的 60 字符标题。

**Architecture:** 采用分层模块化架构，每个模块职责单一清晰：CLI 入口 → 主流程编排 → GLM 客户端 → 1688 客户端 → 核心词提取 → 搜索过滤 → 标题生成。基于环境变量配置 API 密钥，不保存任何数据到本地。

**Tech Stack:**
- 运行时: Node.js 18+
- CLI 框架: Commander.js
- HTTP 客户端: axios
- 加密: Node.js built-in crypto (HMAC-SHA256 签名)
- 环境变量: dotenv

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `package.json` | 项目配置、依赖声明 |
| `bin/cli.js` | 命令行入口，参数解析 |
| `src/index.js` | 主流程编排 |
| `src/glm-client.js` | GLM API 客户端，调用 AI 提取核心词和修饰词刚性 |
| `src/alibaba1688-client.js` | 1688 API 客户端，HMAC-SHA256 签名认证 |
| `src/extract-core.js` | 核心词提取 + 降级逻辑 |
| `src/search-1688.js` | 搜索 + 产品相关性过滤（只过滤刚性修饰词） |
| `src/generate-title.js` | 标题生成（三段式结构 + 词频分析 + 长度控制） |
| `src/banned-words.js` | 违禁词列表和过滤逻辑 |
| `data/banned-words.json` | 违禁词库 |
| `.env.example` | 环境变量示例 |
| `README.md` | 使用说明 |

---

## 任务分解

### Task 1: 初始化 package.json

**Files:**
- Create: `package.json`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "my-title",
  "version": "1.0.0",
  "description": "电商选品标题生成工具 - 关键词 → GLM提取 → 1688搜索 → 相关性过滤 → 生成淘宝标题",
  "main": "src/index.js",
  "bin": {
    "my-title": "bin/cli.js"
  },
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "keywords": ["ecommerce", "title", "generator", "1688", "taobao"],
  "author": "",
  "license": "MIT",
  "dependencies": {
    "commander": "^12.0.0",
    "axios": "^1.6.0",
    "dotenv": "^16.4.0"
  }
}
```

- [ ] **Step 2: 创建 bin 目录**

```bash
mkdir -p bin
mkdir -p src
mkdir -p data
```

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: initialize package.json"
```

---

### Task 2: 实现 1688 API 客户端和签名认证

**Files:**
- Create: `src/alibaba1688-client.js`

- [ ] **Step 1: 创建文件并实现完整功能**

```javascript
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
    
    const stringToSign = `${time}\\n${nonce}\\n${contentMd5}`;
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
```

- [ ] **Step 2: 验证语法**

```bash
node -c src/alibaba1688-client.js
```

Expected: 无输出说明语法正确

- [ ] **Step 3: Commit**

```bash
git add src/alibaba1688-client.js
git commit -m "feat: add alibaba1688 client with HMAC-SHA256 signing"
```

---

### Task 3: 实现 GLM API 客户端（核心词 + 修饰词刚性提取）

**Files:**
- Create: `src/glm-client.js`

- [ ] **Step 1: 创建文件并实现完整功能**

```javascript
const axios = require('axios');

class GLMClient {
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
    // 移除可能的 markdown 代码块
    content = content.replace(/^```json\\n?/, '').replace(/\\n?```$/, '');
    const result = JSON.parse(content);

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
}

module.exports = GLMClient;
```

- [ ] **Step 2: 验证语法**

```bash
node -c src/glm-client.js
```

Expected: 无输出 → 语法正确

- [ ] **Step 3: Commit**

```bash
git add src/glm-client.js
git commit -m "feat: add GLM client with modifier rigidity classification"
```

---

### Task 4: 实现核心词提取模块（含降级逻辑）

**Files:**
- Create: `src/extract-core.js`

- [ ] **Step 1: 创建文件并实现完整功能**

```javascript
const GLMClient = require('./glm-client');

/**
 * 从用户输入提取核心词和带刚性分类的修饰词
 * @param {string} input - 用户输入
 * @returns {Promise<{
 *   coreWord: string,
 *   modifiers: Array<{word: string, rigidity: 'rigid'|'optional'}>
 * }>}
 */
async function extractCoreAndModifiers(input) {
  const apiKey = process.env.GLM_API_KEY;
  if (!apiKey) {
    throw new Error('环境变量 GLM_API_KEY 未设置');
  }

  const apiBase = process.env.GLM_API_BASE;
  const client = new GLMClient({ apiKey, apiBase });

  try {
    return await client.extractCoreAndModifiers(input);
  } catch (error) {
    console.warn(`⚠️  GLM API 调用失败，使用降级提取: ${error.message}`);
    return fallbackExtract(input);
  }
}

/**
 * 降级提取（当 GLM API 失败时使用简单规则）
 * @param {string} input - 用户输入
 * @returns {{
 *   coreWord: string,
 *   modifiers: Array<{word: string, rigidity: 'rigid'|'optional'}>
 * }}
 */
function fallbackExtract(input) {
  const words = input.split(/\\s+/).filter(Boolean);
  if (words.length === 0) {
    return {
      coreWord: input,
      modifiers: []
    };
  }

  // 简单规则：最后一个词作为核心词，其余作为修饰词
  const coreWord = words.pop();

  // 判断刚性的简单规则
  const rigidPattern = /纯银|合金|纯棉|羊毛|真丝|真皮|不锈钢|黄铜|金色|银色|黑色|白色|红色|蓝色|女|男|女款|男款|XL|L|M|S|加大|长款|短款|中长款/;
  const modifiers = words.map(word => {
    const rigidity = rigidPattern.test(word) ? 'rigid' : 'optional';
    return { word, rigidity };
  });

  return {
    coreWord,
    modifiers
  };
}

module.exports = { extractCoreAndModifiers, fallbackExtract };
```

- [ ] **Step 2: 验证语法**

```bash
node -c src/extract-core.js
```

Expected: 无输出 → 语法正确

- [ ] **Step 3: Commit**

```bash
git add src/extract-core.js
git commit -m "feat: add extract core module with fallback logic"
```

---

### Task 5: 实现 1688 搜索和产品相关性过滤

**Files:**
- Create: `src/search-1688.js`

- [ ] **Step 1: 创建文件并实现完整功能**

```javascript
const Alibaba1688Client = require('./alibaba1688-client');

/**
 * 搜索 1688 商品并根据刚性修饰词过滤
 * @param {string} coreWord - 核心词
 * @param {Array<{word: string, rigidity: 'rigid'|'optional'}>} modifiers - 修饰词列表
 * @returns {Promise<Array<object>>} 过滤后的商品列表
 */
async function searchAndFilter(coreWord, modifiers) {
  const ak = process.env.ALI_1688_AK;
  if (!ak) {
    throw new Error('环境变量 ALI_1688_AK 未设置');
  }

  const client = new Alibaba1688Client(ak);
  const products = await client.searchOffers(coreWord);

  if (!Array.isArray(products) || products.length === 0) {
    return [];
  }

  // 只过滤刚性修饰词，可选修饰词不参与过滤
  return filterRelevantProducts(products, modifiers);
}

/**
 * 根据刚性修饰词过滤产品
 * @param {Array<object>} products - 商品列表
 * @param {Array<{word: string, rigidity: 'rigid'|'optional'}>} modifiers - 修饰词列表
 * @returns {Array<object>} 过滤后的商品列表
 */
function filterRelevantProducts(products, modifiers) {
  const rigidModifiers = modifiers
    .filter(m => m.rigidity === 'rigid')
    .map(m => m.word.toLowerCase());

  // 如果没有刚性修饰词，保留所有商品
  if (rigidModifiers.length === 0) {
    return products;
  }

  return products.filter(product => {
    const title = (product.subject || '').toLowerCase();
    const description = (product.description || '').toLowerCase();
    const combinedText = `${title} ${description}`;

    // 至少匹配一个刚性修饰词
    return rigidModifiers.some(word => combinedText.includes(word));
  });
}

module.exports = { searchAndFilter, filterRelevantProducts };
```

- [ ] **Step 2: 验证语法**

```bash
node -c src/search-1688.js
```

Expected: 无输出 → 语法正确

- [ ] **Step 3: Commit**

```bash
git add src/search-1688.js
git commit -m "feat: add 1688 search with rigid modifier filtering"
```

---
- - -  
 
---

### Task 6: 实现违禁词列表和过滤

**Files:**
- Create: `src/banned-words.js`
- Create: `data/banned-words.json`

- [ ] **Step 1: 创建违禁词库**

```json
{
  "limitWords": [
    "最", "第一", "顶级", "最佳", "独家", "唯一", "首选", "国家级",
    "最高", "最低", "最好", "最大", "最小", "最强", "绝对", "顶级",
    "秒杀", "清仓", "特价", "限时", "包邮", "正品", "专柜",
    "假一赔十", "全网第一", "行业第一"
  ],
  "falseWords": [
    "正品", "专柜", "原厂直供", "假一赔十"
  ],
  "prohibitedWords": [
    "政治敏感", "色情", "暴力", "赌博", "毒品"
  ]
}
```

- [ ] **Step 2: 实现违禁词过滤逻辑**

```javascript
const bannedWords = require('../data/banned-words.json');

/**
 * 检查并过滤违禁词
 * @param {string} title - 标题
 * @returns {{valid: boolean, words: Array<string>}}
 */
function checkBannedWords(title) {
  const found = [];
  
  // 检查极限词
  [...bannedWords.limitWords, ...bannedWords.falseWords].forEach(word => {
    if (title.includes(word)) {
      found.push(word);
    }
  });
  
  return {
    valid: found.length === 0,
    words: found
  };
}

/**
 * 移除违禁词（替换为空格）
 * @param {string} title - 标题
 * @returns {string} 处理后的标题
 */
function removeBannedWords(title) {
  const allBanned = [
    ...bannedWords.limitWords,
    ...bannedWords.falseWords,
    ...bannedWords.prohibitedWords
  ];
  
  let result = title;
  allBanned.forEach(word => {
    result = result.replace(new RegExp(word, 'g'), '');
  });
  
  // 清理多余空格
  result = result.replace(/\s+/g, ' ').trim();
  return result;
}

module.exports = { checkBannedWords, removeBannedWords };
```

- [ ] **Step 3: 验证语法**

```bash
node -c src/banned-words.js
```

Expected: 无输出 → 语法正确

- [ ] **Step 4: Commit**

```bash
git add src/banned-words.js data/banned-words.json
git commit -m "feat: add banned words filtering"
```

---

### Task 7: 实现标题生成模块（三段式结构 + SEO 优化）

**Files:**
- Create: `src/generate-title.js`

- [ ] **Step 1: 创建文件并实现完整功能**

```javascript
const { removeBannedWords } = require('./banned-words');

/**
 * 统计标题列表中的词频
 * @param {Array<object>} products - 商品列表
 * @returns {Map<string, number>} 词频统计
 */
function countWordFrequency(products) {
  const freq = new Map();
  
  products.forEach(product => {
    const title = product.subject || '';
    // 简单分词（按空格分割）
    const words = title.split(/\s+/).filter(w => w.length > 1);
    
    words.forEach(word => {
      const lower = word.toLowerCase();
      freq.set(lower, (freq.get(lower) || 0) + 1);
    });
  });
  
  return freq;
}

/**
 * 生成标题，符合淘宝 SEO 规范
 * @param {string} userInput - 用户原始输入
 * @param {string} coreWord - 核心词
 * @param {Array<object>} products - 过滤后的商品列表
 * @param {Array<{word: string, rigidity: 'rigid'|'optional'}>} modifiers - 修饰词
 * @param {number} maxLength - 最大字符数（默认60）
 * @returns {Array<string>} 生成的标题列表（3-5个）
 */
function generateTitles(userInput, coreWord, products, modifiers, maxLength = 60) {
  if (!Array.isArray(products) || products.length === 0) {
    return [];
  }

  // 统计高频词
  const freq = countWordFrequency(products);
  
  // 按词频排序，取高频词作为属性词
  const sortedWords = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .filter(([word]) => word !== coreWord.toLowerCase())
    .slice(0, 10)
    .map(([word]) => word);
  
  // 获取刚性修饰词（用户输入的刚性修饰词优先）
  const rigidWords = modifiers
    .filter(m => m.rigidity === 'rigid')
    .map(m => m.word);
  
  // 生成多个候选标题（不同组合）
  const candidates = [];
  
  // 三段式结构：[核心词前置] + [刚性修饰词] + [高频属性词] + [可选修饰词]
  // 核心词必须前置（SEO 权重高）
  
  // 候选 1: 核心词 + 刚性修饰词 + 用户原始输入 + 高频词
  const candidate1 = buildTitle([coreWord, ...rigidWords, userInput, ...sortedWords], maxLength);
  if (candidate1 && candidate1.length >= 10) {
    candidates.push(removeBannedWords(candidate1));
  }
  
  // 候选 2: 核心词 + 用户原始输入 + 高频词
  const candidate2 = buildTitle([coreWord, userInput, ...sortedWords], maxLength);
  if (candidate2 && candidate2.length >= 10 && !candidates.includes(removeBannedWords(candidate2))) {
    candidates.push(removeBannedWords(candidate2));
  }
  
  // 候选 3: 刚性修饰词 + 核心词 + 高频词
  if (rigidWords.length > 0) {
    const candidate3 = buildTitle([...rigidWords, coreWord, ...sortedWords], maxLength);
    if (candidate3 && candidate3.length >= 10 && !candidates.includes(removeBannedWords(candidate3))) {
      candidates.push(removeBannedWords(candidate3));
    }
  }
  
  // 去重并返回前 3-5 个
  return [...new Set(candidates)].filter(t => t.length > 0).slice(0, 5);
}

/**
 * 拼接标题并控制长度
 * @param {Array<string>} parts - 标题部分
 * @param {number} maxLength - 最大长度
 * @returns {string|null} 拼接后的标题
 */
function buildTitle(parts, maxLength) {
  // 去重
  const uniqueParts = [...new Set(parts.filter(p => p && p.length > 0))];
  
  let result = '';
  for (const part of uniqueParts) {
    const newResult = result ? `${result} ${part}` : part;
    // 中文按字符数计算长度
    if (getLength(newResult) > maxLength) {
      break;
    }
    result = newResult;
  }
  
  return result.length >= 5 ? result : null;
}

/**
 * 获取字符串的字符长度（中文每个字算 2 字符？不，淘宝是按字符数，中文每个字算 1 字符）
 * 实际上淘宝标题限制 60 字符 = 60 个中文汉字
 * @param {string} str
 * @returns {number}
 */
function getLength(str) {
  // JavaScript length 按 UTF-16 编码单元计算，中文每个字占 1 个编码单元
  // 在 BMP 范围内（大部分常用汉字都在这里），一个汉字就是一个 length
  return str.length;
}

module.exports = { generateTitles, countWordFrequency };
```

- [ ] **Step 2: 验证语法**

```bash
node -c src/generate-title.js
```

Expected: 无输出 → 语法正确

- [ ] **Step 3: Commit**

```bash
git add src/generate-title.js
git commit -m "feat: add title generation with three-section structure and SEO optimization"
```

---

### Task 8: 实现主流程编排

**Files:**
- Create: `src/index.js`

- [ ] **Step 1: 创建文件并实现完整功能**

```javascript
const { extractCoreAndModifiers } = require('./extract-core');
const { searchAndFilter } = require('./search-1688');
const { generateTitles } = require('./generate-title');

/**
 * 主入口：运行标题生成流程
 * @param {string} input - 用户输入关键词
 * @param {number} maxLength - 最大长度
 * @returns {Promise<{
 *   coreWord: string,
 *   modifiers: Array<{word: string, rigidity: 'rigid'|'optional'}>,
 *   filteredCount: number,
 *   titles: Array<string>
 * }>}
 */
async function run(input, maxLength = 60) {
  console.log(`🔍 正在处理: ${input}`);
  
  // 步骤 1: 提取核心词和修饰词（带刚性判断）
  console.log('📝 提取核心词和修饰词...');
  const { coreWord, modifiers } = await extractCoreAndModifiers(input);
  console.log(`  核心词: ${coreWord}`);
  console.log(`  修饰词: ${modifiers.map(m => `${m.word}(${m.rigidity})`).join(', ')}`);
  
  // 步骤 2: 搜索并过滤
  console.log(`🔎 在 1688 搜索 "${coreWord}" 并过滤...`);
  const products = await searchAndFilter(coreWord, modifiers);
  
  if (products.length === 0) {
    console.log('  ⚠️  没有找到匹配的商品');
    return {
      coreWord,
      modifiers,
      filteredCount: 0,
      titles: []
    };
  }
  
  console.log(`  过滤后剩余 ${products.length} 个商品`);
  
  // 步骤 3: 生成标题
  console.log('✍️  生成标题...');
  const titles = generateTitles(input, coreWord, products, modifiers, maxLength);
  
  return {
    coreWord,
    modifiers,
    filteredCount: products.length,
    titles
  };
}

module.exports = { run };
```

- [ ] **Step 2: 验证语法**

```bash
node -c src/index.js
```

Expected: 无输出 → 语法正确

- [ ] **Step 3: Commit**

```bash
git add src/index.js
git commit -m "feat: add main orchestration"
```

---

### Task 9: 实现 CLI 入口

**Files:**
- Create: `bin/cli.js`

- [ ] **Step 1: 创建文件并实现完整功能**

```javascript
#!/usr/bin/env node

require('dotenv').config();
const { Command } = require('commander');
const { run } = require('../src');

const program = new Command();

program
  .name('my-title')
  .description('电商选品标题生成工具 - 关键词 → GLM提取 → 1688搜索 → 相关性过滤 → 生成淘宝标题')
  .argument('<keywords>', '用户输入关键词，如"纯银项链女高级感"')
  .option('-l, --length <number>', '标题最大长度（字符）', '60')
  .option('-c, --count <number>', '输出候选标题数量', '3')
  .action(async (keywords, options) => {
    try {
      const result = await run(keywords, parseInt(options.length));
      
      console.log('\n✅ 处理完成');
      console.log('='.repeat(50));
      console.log(`核心词: ${result.coreWord}`);
      console.log(`过滤后商品: ${result.filteredCount} 个`);
      
      if (result.titles.length === 0) {
        console.log('\n❌ 没有生成标题，请尝试其他关键词');
        process.exit(1);
      }
      
      console.log('\n📝 生成的标题:');
      result.titles.forEach((title, index) => {
        console.log(`${index + 1}. ${title} (${title.length} 字符)`);
      });
      
      console.log();
    } catch (error) {
      console.error('\n❌ 错误:', error.message);
      process.exit(1);
    }
  });

program.parse();
```

- [ ] **Step 2: 添加执行权限（Unix-like 系统）**

```bash
chmod +x bin/cli.js
```

- [ ] **Step 3: 验证语法**

```bash
node -c bin/cli.js
```

Expected: 无输出 → 语法正确

- [ ] **Step 4: Commit**

```bash
git add bin/cli.js
git commit -m "feat: add CLI entry point"
```

---

### Task 10: 创建环境变量示例和 README

**Files:**
- Create: `.env.example`
- Create: `README.md`

- [ ] **Step 1: 创建 .env.example**

```env
# GLM API 密钥 (从智谱开放平台获取)
GLM_API_KEY=your_glm_api_key_here

# GLM API 地址（可选，默认使用官方地址）
# GLM_API_BASE=https://open.bigmodel.cn/api/paas/v4

# 1688 AI 版 Access Key (从 1688 AI 店长 APP 获取)
# 格式: 前 32 字符是 Secret，剩余是 KeyID
ALI_1688_AK=your_1688_access_key_here
```

- [ ] **Step 2: 创建 README.md**

```markdown
# my-title - 电商选品标题生成工具

> 基于 GLM AI + 1688 搜索的电商标题自动生成工具

## 功能

- 🤖 **AI 提取**: GLM 自动提取核心词 + 判断修饰词刚性程度
- 🔍 **1688 搜索**: 调用 1688 AI 版 API 搜索热门商品
- 🎯 **相关性过滤**: 只保留匹配刚性修饰词的商品（材质/颜色/人群）
- ✨ **SEO 优化**: 三段式结构，核心词前置，符合淘宝搜索规则
- 📏 **长度控制**: 默认 60 字符，支持自定义

## 安装

```bash
git clone <repo-url>
cd my-title
npm install
```

## 使用

```bash
# 复制环境变量配置
cp .env.example .env
# 编辑 .env，填入你的 API KEY

# 生成标题
node bin/cli.js "纯银项链女高级感"

# 自定义长度
node bin/cli.js "纯棉T恤男宽松夏季" --length 60

# 输出帮助
node bin/cli.js --help
```

**示例输出:**

```
🔍 正在处理: 纯银项链女高级感
📝 提取核心词和修饰词...
  核心词: 项链
  修饰词: 纯银(rigid), 女(rigid), 高级感(optional)
🔎 在 1688 搜索 "项链" 并过滤...
  过滤后剩余 15 个商品
✍️  生成标题...

✅ 处理完成
==================================================
核心词: 项链
过滤后商品: 15 个

📝 生成的标题:
1. 项链 纯银 女 高级感 锁骨链 女款 简约 百搭 (42 字符)
2. 项链 纯银 女 高级感 925银 韩版 设计感 小众 (40 字符)
3. 项链 纯银 女 锁骨链 生日礼物 送女友 (30 字符)
```

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `GLM_API_KEY` | 是 | 智谱 GLM API 密钥 |
| `GLM_API_BASE` | 否 | GLM API 地址，默认官方 |
| `ALI_1688_AK` | 是 | 1688 AI 版 Access Key |

## 工作流程

```
用户输入关键词 → GLM AI → 提取核心词 + 判断修饰词刚性 → 1688 搜索 → 刚性修饰词过滤 → 高频词提取 → 三段式生成 → 输出标题
```

## 刚性修饰词 vs 可选修饰词

- **rigid (强制)** → 材质、颜色、规格、人群 → 不匹配则剔除
  - 示例: `纯银` → 商品必须有"纯银"才会保留
- **optional (可选)** → 风格、流行词、时间 → 不强制匹配，只用于标题描述
  - 示例: `高级感`, `ins风`, `2026新款`

## 许可

MIT
```

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs: add env example and readme"
```

---
