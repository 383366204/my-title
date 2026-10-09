const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseJsonFromLLM, retry } = require('../../../core/llm-utils');
const { createLLMClient } = require('../../../core/llm');
const { normalizeKeyword } = require('./seed-store');
const { deterministicSample } = require('./inspiration-sources');

const PRODUCTIZER_VERSION = 2;

/**
 * 灵感节点独立的模型配置，不改变标题生成客户端。
 * @param {object} [client] 已注入客户端。
 * @returns {object} 生效配置和缓存标识。
 */
function inspirationModelConfig(client) {
  const resolved = client || createLLMClient({ model: process.env.INSPIRATION_LLM_MODEL || undefined });
  const thinking = process.env.INSPIRATION_LLM_THINKING || 'disabled';
  return { client: resolved, thinking,
    identity: { version: PRODUCTIZER_VERSION, provider: resolved.provider, apiBase: resolved.apiBase, model: resolved.model, thinking } };
}

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
    '- 从人群、任务、场景、痛点推导采购需求，再提取具体商品名词；避免机械拆成单字或拼接形容词。',
    '- dimension=direction 表示用户指定的整体选词方向。围绕该方向自主分析需求并挖掘不同商品词根，严格遵守目标人群、场景、商品范围和排除条件；不得引入方向外的商品来凑数量。',
    '- 词根优先简短，但完整商品名可以较长，必须是具体商品，不得是场景、形容词或泛词。',
    '- 保留完整商品词 rootKeyword；另外用 queryCore 提取其中连续出现的商品核心名词，用 queryAttributes 拆出原词中连续出现的材质 material、场景 scene、功能 function、人群 audience，各值为字符串数组。不要杜撰原词没有的属性。',
    '- 示例：硅藻土浴室吸水脚垫 → queryCore=脚垫，material=[硅藻土]，scene=[浴室]，function=[吸水]；无法可靠拆分时留空。',
    '- 禁止品牌、人物、影视动漫IP、灾难营销、医疗功效和夸张词。',
    '- 关联理由用一句话说明采购需求，最多25字。实体形态与用途各不超过12字。',
    '- 不限固定商品目录。给出实体形态 productForm、具体用途 productUse；没有合理商品时返回 {"roots":[]}。不要输出额外分析或置信度。',
    '- 时事仅用于提出需求假设，不得编造新闻或搜索人气，市场表现留给生意参谋验证。',
    '',
    `每个灵感最多商品数: ${maxRootsPerInspiration}`,
    `灵感列表: ${JSON.stringify(inspirations.map(item => ({
      inspirationId: item.id,
      sourceType: item.sourceType,
      inspirationWord: item.inspirationWord,
      contextWords: item.contextWords,
      rawSourceText: item.rawSourceText,
      categoryHint: item.categoryHint,
      dimension: item.dimension,
      actor: item.actor,
      task: item.task,
      scene: item.scene,
      problem: item.problem,
      purchaseJob: item.purchaseJob
    })))}`,
    '',
    '返回结构：',
    JSON.stringify({
      roots: [{
        inspirationId: 'insp_xxx',
        rootKeyword: '具体商品词根',
        queryCore: '商品核心名词',
        queryAttributes: { material: [], scene: [], function: [], audience: [] },
        category: '商品类目',
        relationReason: '关联理由',
        productForm: '商品实体形态',
        productUse: '商品具体用途'
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
  if (client.provider === 'minimax' && client.model === 'MiniMax-M3') {
    body.thinking = { type: options.thinking === 'adaptive' ? 'adaptive' : 'disabled' };
  }
  const startedAt = Date.now();
  const response = await retry(() => {
    if (options.signal?.aborted || options.shouldStop?.()) throw Object.assign(new Error('已暂停灵感分析'), { code: 'INSPIRATION_STOPPED' });
    return axios.post(
    `${String(client.apiBase || '').replace(/\/+$/, '')}/chat/completions`,
    body,
    {
      headers: { Authorization: `Bearer ${client.apiKey}`, 'Content-Type': 'application/json' },
      timeout: options.requestTimeoutMs,
      signal: options.signal
    }
  ); }, 1, 1200, error => {
    if (error.response?.status === 429) options.onRateLimit?.();
    return !options.signal?.aborted && error.code !== 'INSPIRATION_STOPPED' && !isProductizerTimeout(error) && (error.response
    ? error.response.status === 429 || error.response.status >= 500
    : Boolean(error.code));
  });
  const content = response.data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Invalid LLM response: missing productized roots');
  let result;
  try {
    const parsed = parseJsonFromLLM(String(content));
    result = Array.isArray(parsed) ? { roots: parsed } : parsed;
    if (!Array.isArray(result?.roots) || result.roots.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
      throw new Error('Expected roots array containing objects');
    }
  } catch (cause) {
    throw Object.assign(new Error('灵感选词的 AI 返回格式异常，未得到有效词根列表。请重试当前节点，已完成批次会保留。', { cause }), { code: 'INSPIRATION_LLM_FORMAT' });
  }
  return { ...result, telemetry: { durationMs: Date.now() - startedAt, usage: response.data?.usage || null } };
}

function isProductizerTimeout(error) {
  return ['ECONNABORTED', 'ETIMEDOUT'].includes(error?.code) || /timeout.*exceeded/i.test(error?.message || '');
}

async function productizeBatch(client, batch, options) {
  const { maxRootsPerInspiration, batchCacheDir, shouldStop, onProgress } = options;
  if (shouldStop?.()) throw Object.assign(new Error('已暂停，继续时复用已完成 AI 批次'), { code: 'INSPIRATION_STOPPED' });
  const key = crypto.createHash('sha256').update(JSON.stringify({ batch, maxRootsPerInspiration, ...options.identity })).digest('hex');
  const cacheFile = batchCacheDir ? path.join(batchCacheDir, `${key}.json`) : null;
  if (cacheFile && fs.existsSync(cacheFile)) {
    options.onCacheHit?.();
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  }
  const splitFile = cacheFile && `${cacheFile}.split`;
  const split = async () => {
    onProgress?.({ ...options.progress, message: `AI 请求超时，改为小批次继续（原批 ${batch.length} 条）；已完成结果保留` });
    const middle = Math.ceil(batch.length / 2);
    const left = await productizeBatch(client, batch.slice(0, middle), options);
    const right = await productizeBatch(client, batch.slice(middle), options);
    return { roots: [...(left?.roots || left || []), ...(right?.roots || right || [])] };
  };
  let result;
  if (splitFile && fs.existsSync(splitFile)) result = await split();
  else {
    try {
      const startedAt = Date.now();
      const controller = new AbortController();
      const stopTimer = setInterval(() => { if (shouldStop?.()) controller.abort(); }, 250);
      const timer = setInterval(() => onProgress?.({
        ...options.progress,
        message: `AI 分析中（${batch.length} 条灵感），已等待 ${Math.floor((Date.now() - startedAt) / 1000)} 秒，单次上限 ${Math.ceil(options.requestTimeoutMs / 1000)} 秒；可暂停并保留已完成结果`
      }), 10000);
      try {
        result = await retry(() => callProductizerLLM(client, batch, { ...options, maxRootsPerInspiration, signal: controller.signal }),
          1, 1200, error => !controller.signal.aborted && !shouldStop?.() && error.code === 'INSPIRATION_LLM_FORMAT');
      } finally {
        clearInterval(timer);
        clearInterval(stopTimer);
      }
    } catch (error) {
      if (shouldStop?.() || error.code === 'ERR_CANCELED') throw Object.assign(new Error('已暂停，继续时复用已完成 AI 批次'), { code: 'INSPIRATION_STOPPED' });
      if (!isProductizerTimeout(error)) throw error;
      if (batch.length <= 1) {
        throw Object.assign(new Error(`灵感选词的 AI 请求超时（${client.model || '当前模型'}，单条灵感，${Math.ceil(options.requestTimeoutMs / 1000)} 秒）。请检查模型服务或网络后重试，已完成批次会保留。`, { cause: error }), { code: 'INSPIRATION_LLM_TIMEOUT' });
      }
      if (splitFile) {
        fs.mkdirSync(batchCacheDir, { recursive: true });
        fs.writeFileSync(splitFile, 'split');
      }
      result = await split();
    }
  }
  if (cacheFile) {
    fs.mkdirSync(batchCacheDir, { recursive: true });
    fs.writeFileSync(`${cacheFile}.tmp`, JSON.stringify(result));
    fs.renameSync(`${cacheFile}.tmp`, cacheFile);
  }
  return result;
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
    const unique = [...new Set(matched)];
    const selected = inspiration.createdAt
      ? deterministicSample(unique, maxRootsPerInspiration, `${inspiration.id}:${inspiration.createdAt.slice(0, 10)}`)
      : unique.slice(0, maxRootsPerInspiration);
    selected.forEach(rootKeyword => {
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
      queryCore: typeof row.queryCore === 'string' ? row.queryCore.trim() : '',
      queryAttributes: Object.fromEntries(['material', 'scene', 'function', 'audience'].map(key => [key,
        Array.isArray(row.queryAttributes?.[key]) ? row.queryAttributes[key].filter(value => typeof value === 'string') : []])),
      relationReason: String(row.relationReason || row.reason || ''),
      confidence: row.confidence != null && Number.isFinite(Number(row.confidence))
        ? Math.max(0, Math.min(100, Number(row.confidence))) : null,
      productizer: row.productizer || 'llm',
      productForm: String(row.productForm || ''),
      productUse: String(row.productUse || ''),
      hypothesis: Object.fromEntries(['actor', 'task', 'scene', 'problem', 'purchaseJob'].map(key => [key, String(row.hypothesis?.[key] || inspiration[key] || '')])),
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
  batchSize = 1,
  requestTimeoutMs = Number(process.env.INSPIRATION_LLM_TIMEOUT_MS || 180000),
  concurrency = Number(process.env.INSPIRATION_LLM_CONCURRENCY || 2),
  useLLM = true, onProgress, shouldStop, batchCacheDir
} = {}) {
  const inspirationMap = new Map(inspirations.map(item => [item.id, item]));
  const values = [];
  const errors = [];
  let client = llmClient;
  let modelConfig;
  let cacheHits = 0;
  let rateLimited = false;
  if (!client && useLLM) {
    try {
      client = inspirationModelConfig().client;
    } catch (error) {
      errors.push({ offset: 0, error: error.message });
    }
  }
  if (useLLM && (client?.apiKey || typeof client?.productizeInspirations === 'function')) {
    modelConfig = inspirationModelConfig(client);
    const size = Math.max(1, Number(batchSize || 1));
    const timeoutMs = Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0 ? requestTimeoutMs : 180000;
    const width = Math.max(1, Math.min(2, Math.floor(concurrency) || 1));
    for (let offset = 0; offset < inspirations.length;) {
      if (shouldStop?.()) throw Object.assign(new Error('已暂停，继续时复用已完成 AI 批次'), { code: 'INSPIRATION_STOPPED' });
      const waveWidth = rateLimited ? 1 : width;
      const total = Math.ceil(inspirations.length / size);
      const current = Math.floor(offset / size);
      const batches = Array.from({ length: waveWidth }, (_, index) => inspirations.slice(offset + index * size, offset + (index + 1) * size)).filter(batch => batch.length);
      onProgress?.({ current, total, message: `AI 分析 ${current + 1}/${total} 批，并发 ${batches.length}，缓存复用 ${cacheHits} 批` });
      const settled = await Promise.allSettled(batches.map(batch => productizeBatch(client, batch, {
        maxRootsPerInspiration, requestTimeoutMs: timeoutMs, batchCacheDir, shouldStop, onProgress,
        ...modelConfig, onCacheHit: () => { cacheHits += 1; }, onRateLimit: () => { rateLimited = true; }, progress: { current, total }
      })));
      for (const result of settled) {
        if (result.status === 'fulfilled') { values.push(result.value); continue; }
        const error = result.reason;
        if (batchCacheDir || error.code === 'INSPIRATION_STOPPED') throw error;
        errors.push({ offset, error: error.message });
      }
      offset += batches.length * size;
    }
  }
  const llmRoots = normalizeProductizedRoots({ roots: values.flatMap(value => value?.roots || value || []) }, inspirationMap, maxRootsPerInspiration);
  // 已启用 AI 时，空结果或失败不能悄悄用固定词表凑数。
  const usedAI = useLLM && (client?.apiKey || typeof client?.productizeInspirations === 'function');
  const fallback = localProductize(usedAI ? [] : inspirations.filter(item => item.dimension !== 'direction'), maxRootsPerInspiration);
  const roots = normalizeProductizedRoots(fallback, inspirationMap, maxRootsPerInspiration);
  return {
    roots: [...llmRoots, ...roots],
    meta: {
      provider: usedAI ? (client?.provider || 'llm') : 'local-fallback',
      model: usedAI ? (client?.model || '') : '',
      generated: llmRoots.length + roots.length,
      fallbackGenerated: roots.length,
      cacheHits,
      rateLimited,
      requests: values.map(value => value.telemetry).filter(Boolean),
      errors
    }
  };
}

module.exports = {
  LOCAL_ASSOCIATIONS,
  inspirationModelConfig,
  buildProductizationPrompt,
  localProductize,
  normalizeProductizedRoots,
  productizeInspirations
};
