const axios = require('axios');
const { parseJsonFromLLM, retry } = require('../../../core/llm-utils');
const { createLLMClient } = require('../../../core/llm');
const { productWords } = require('./product-words');
const { normalizeKeyword } = require('./seed-store');

const LOCAL_ASSOCIATIONS = [
  { markers: ['高温', '炎热', '清凉', '降温', '夏天', '初夏'], roots: ['小风扇', '冰垫', '凉席', '冰袖', '遮阳帽'] },
  { markers: ['雨季', '下雨', '防水', '防汛', '潮湿'], roots: ['雨伞', '雨衣', '防水鞋套', '除湿袋'] },
  { markers: ['开学', '宿舍', '学生', '整理'], roots: ['床帘', '收纳盒', '小夜灯', '书包', '笔袋'] },
  { markers: ['旅行', '出行', '露营', '户外'], roots: ['收纳袋', '洗漱包', '行李牌', '折叠凳', '遮阳帽'] },
  { markers: ['宠物', '陪伴', '猫', '狗'], roots: ['宠物玩具', '逗猫棒', '猫包', '狗咬胶'] },
  { markers: ['运动', '健身', '解压'], roots: ['瑜伽垫', '弹力带', '泡沫轴', '握力器'] },
  { markers: ['厨房', '烹饪', '团聚'], roots: ['调料盒', '封口夹', '厨房置物架', '保鲜盒'] },
  { markers: ['浴室', '洗护', '柔软'], roots: ['干发帽', '肥皂盒', '浴室置物架', '洗脸巾'] },
  { markers: ['办公室', '通勤', '安静'], roots: ['办公室冰垫', '耳塞', '桌面收纳盒', '手机挂绳'] },
  { markers: ['儿童', '阅读', '绘画', '手工'], roots: ['儿童益智玩具', '修正带', '文具盒', '书包'] },
  { markers: ['照明', '明亮', '夜晚'], roots: ['小夜灯', '台灯', '化妆镜'] },
  { markers: ['防晒', '春游'], roots: ['防晒面罩', '遮阳帽', '冰袖', '雨伞'] },
  { markers: ['驱蚊', '端午'], roots: ['驱蚊手环', '蚊帐', '香囊', '五彩绳'] },
  { markers: ['生日', '婚礼', '情人节', '七夕', '礼物'], roots: ['项链', '戒指', '手链', '喜糖盒'] },
  { markers: ['春节', '圣诞', '元旦', '中秋', '节日'], roots: ['灯笼', '香包', '月饼包装盒', '喜糖盒'] },
  { markers: ['收纳', '整洁', '搬家'], roots: ['收纳盒', '置物架', '收纳袋', '封口夹'] },
  { markers: ['汽车', '通勤'], roots: ['汽车冰垫', '车载收纳', '手机挂绳'] },
  { markers: ['园艺', '春天', '阳台'], roots: ['多肉盆栽', '花盆', '置物架'] }
];

/**
 * Build the constrained prompt used to convert inspirations into products.
 * @param {Array<object>} inspirations Safe inspiration rows.
 * @param {object} [options] Prompt options.
 * @returns {string} Productization prompt.
 */
function buildProductizationPrompt(inspirations, { maxRootsPerInspiration = 3 } = {}) {
  return [
    '你是电商商品词根研究助手。把灵感转换成真实、可搜索、可在1688采购的短商品词根。',
    '只返回严格JSON，不要Markdown。',
    '',
    '规则：',
    '- 每个灵感最多生成指定数量的商品词根。',
    '- 词根通常2到6个汉字，必须是具体商品，不得是场景、形容词或泛词。',
    '- 禁止品牌、人物、影视动漫IP、灾难营销、医疗功效和夸张词。',
    '- 关联理由必须说明灵感如何转化为商品需求。',
    '- 优先从允许商品目录中选择；没有合理商品时返回空数组。',
    '',
    `每个灵感最多商品数: ${maxRootsPerInspiration}`,
    `允许商品目录: ${JSON.stringify(productWords({ maxSeeds: 0 }).slice(0, 180))}`,
    `灵感列表: ${JSON.stringify(inspirations.map(item => ({
      inspirationId: item.id,
      sourceType: item.sourceType,
      inspirationWord: item.inspirationWord,
      contextWords: item.contextWords,
      rawSourceText: item.rawSourceText,
      categoryHint: item.categoryHint
    })))}`,
    '',
    '返回结构：',
    JSON.stringify({
      roots: [{
        inspirationId: 'insp_xxx',
        rootKeyword: '具体商品词根',
        category: '商品类目',
        relationReason: '关联理由',
        confidence: 80
      }]
    })
  ].join('\n');
}

async function callProductizerLLM(client, inspirations, options) {
  if (typeof client.productizeInspirations === 'function') {
    return client.productizeInspirations({ inspirations, ...options });
  }
  const messages = [
    { role: 'system', content: '你是电商商品词根研究助手，只输出严格JSON。' },
    { role: 'user', content: buildProductizationPrompt(inspirations, options) }
  ];
  const body = typeof client._buildChatPayload === 'function'
    ? client._buildChatPayload({ messages, temperature: 0.35 })
    : { model: client.model, messages, temperature: 0.35 };
  const response = await retry(() => axios.post(
    `${String(client.apiBase || '').replace(/\/+$/, '')}/chat/completions`,
    body,
    {
      headers: { Authorization: `Bearer ${client.apiKey}`, 'Content-Type': 'application/json' },
      timeout: client._longTimeout || client._timeout || 60000
    }
  ), 1, 1200);
  const content = response.data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Invalid LLM response: missing productized roots');
  return parseJsonFromLLM(String(content));
}

/**
 * Productize known inspiration patterns without an external LLM.
 * @param {Array<object>} inspirations Safe inspiration rows.
 * @param {number} maxRootsPerInspiration Per-inspiration result limit.
 * @returns {{roots:Array<object>}} Locally associated product roots.
 */
function localProductize(inspirations = [], maxRootsPerInspiration = 3) {
  const roots = [];
  for (const inspiration of inspirations) {
    const text = `${inspiration.inspirationWord || ''}${inspiration.rawSourceText || ''}${(inspiration.contextWords || []).join('')}`;
    const matched = LOCAL_ASSOCIATIONS.filter(rule => rule.markers.some(marker => text.includes(marker)))
      .flatMap(rule => rule.roots);
    [...new Set(matched)].slice(0, maxRootsPerInspiration).forEach(rootKeyword => {
      roots.push({
        inspirationId: inspiration.id,
        rootKeyword,
        category: inspiration.categoryHint || '',
        relationReason: `从灵感「${inspiration.inspirationWord}」匹配到具体商品需求`,
        confidence: 68,
        productizer: 'local-fallback'
      });
    });
  }
  return { roots };
}

/**
 * Normalize and deduplicate product roots returned by any productizer.
 * @param {object|Array<object>} value Productizer output.
 * @param {Map<string, object>} inspirationMap Inspirations indexed by ID.
 * @param {number} maxRootsPerInspiration Per-inspiration result limit.
 * @returns {Array<object>} Normalized product roots.
 */
function normalizeProductizedRoots(value, inspirationMap, maxRootsPerInspiration) {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.roots) ? value.roots : [];
  const counts = new Map();
  const seen = new Set();
  const output = [];
  for (const row of rows) {
    const inspirationId = String(row.inspirationId || row.inspiration_id || '');
    const inspiration = inspirationMap.get(inspirationId);
    const rootKeyword = normalizeKeyword(row.rootKeyword || row.keyword || row.root || '');
    if (!inspiration || !rootKeyword) continue;
    if ((counts.get(inspirationId) || 0) >= maxRootsPerInspiration) continue;
    const key = `${inspirationId}:${rootKeyword}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts.set(inspirationId, (counts.get(inspirationId) || 0) + 1);
    output.push({
      inspirationId,
      rootKeyword,
      category: String(row.category || inspiration.categoryHint || ''),
      relationReason: String(row.relationReason || row.reason || ''),
      confidence: Math.max(0, Math.min(100, Number(row.confidence || 60))),
      productizer: row.productizer || 'llm',
      inspiration
    });
  }
  return output;
}

/**
 * Convert inspirations into short product roots, with an offline fallback.
 * @param {Array<object>} inspirations Safe inspiration rows.
 * @param {object} [options] Productization options.
 * @returns {Promise<{roots:Array<object>,meta:object}>} Product roots and model metadata.
 */
async function productizeInspirations(inspirations = [], {
  llmClient = null,
  maxRootsPerInspiration = 3,
  batchSize = 20,
  useLLM = true
} = {}) {
  const inspirationMap = new Map(inspirations.map(item => [item.id, item]));
  const values = [];
  const errors = [];
  let client = llmClient;
  if (!client && useLLM) {
    try {
      client = createLLMClient();
    } catch (error) {
      errors.push({ offset: 0, error: error.message });
    }
  }
  if (useLLM && client?.apiKey) {
    for (let offset = 0; offset < inspirations.length; offset += Math.max(1, Number(batchSize || 20))) {
      const batch = inspirations.slice(offset, offset + Math.max(1, Number(batchSize || 20)));
      try {
        values.push(await callProductizerLLM(client, batch, { maxRootsPerInspiration }));
      } catch (error) {
        errors.push({ offset, error: error.message });
      }
    }
  }
  const llmRoots = normalizeProductizedRoots({ roots: values.flatMap(value => value?.roots || value || []) }, inspirationMap, maxRootsPerInspiration);
  const covered = new Set(llmRoots.map(item => item.inspirationId));
  const fallback = localProductize(inspirations.filter(item => !covered.has(item.id)), maxRootsPerInspiration);
  const roots = normalizeProductizedRoots(fallback, inspirationMap, maxRootsPerInspiration);
  return {
    roots: [...llmRoots, ...roots],
    meta: {
      provider: llmRoots.length > 0 ? (client?.provider || 'llm') : 'local-fallback',
      model: llmRoots.length > 0 ? (client?.model || '') : '',
      generated: llmRoots.length + roots.length,
      fallbackGenerated: roots.length,
      errors
    }
  };
}

module.exports = {
  LOCAL_ASSOCIATIONS,
  buildProductizationPrompt,
  localProductize,
  normalizeProductizedRoots,
  productizeInspirations
};
