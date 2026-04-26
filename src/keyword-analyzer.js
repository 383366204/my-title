// 中文停用词
const STOP_WORDS = new Set(['的', '和', '与', '或', '等', '可', '及', '带', '送', '专', '真', '假', '是', '在', '有', '了', '不', '也', '就', '都', '而', '及', '到', '为', '中', '对', '上', '下', '个', '好', '很', '这', '那']);

// 中文汉字检测
const isChinese = (ch) => /[\u4e00-\u9fff]/.test(ch);

// 惰性加载 jieba（与 title-utils.js 相同模式）
let _jieba = null;
function getJieba() {
  if (_jieba === null) {
    try { _jieba = require('nodejieba'); } catch (e) { _jieba = false; }
  }
  return _jieba || null;
}

/**
 * 从淘宝同行标题中提取高频关键词和竞品缺口词
 * @param {string[]} peerTitles - 淘宝同行标题数组
 * @param {string|string[]} sourceTitleOrArray - 1688 原标题（字符串或数组，用于缺口分析）
 * @returns {{ topKeywords: Array<{word: string, count: number}>, gapKeywords: Array<{word: string, count: number}>, summary: string }}
 */
function analyzePeerTitles(peerTitles, sourceTitleOrArray) {
  // 1. 防御性去重 + 过滤
  const uniqueTitles = [...new Set(
    (peerTitles || []).filter(t => t && typeof t === 'string' && t.trim())
  )];

  if (uniqueTitles.length === 0) {
    return { topKeywords: [], gapKeywords: [], summary: '' };
  }

  // 2. 归一化 sourceTitles 为数组（向后兼容：也接受字符串）
  const sourceTitles = Array.isArray(sourceTitleOrArray)
    ? sourceTitleOrArray.filter(t => typeof t === 'string')
    : (sourceTitleOrArray || '').split(/[\s,，、;；]+/).filter(Boolean);

  // 3. 选择分词策略
  const jieba = getJieba();
  const counts = new Map();

  for (const title of uniqueTitles) {
    if (jieba) {
      // JIEBA 模式：先分词，再做词内 n-gram（不跨词边界）
      const words = jieba.cut(title);
      for (const word of words) {
        if (word.length < 2) continue;
        if (STOP_WORDS.has(word)) continue;
        inc(counts, word.trim());

        const chineseChars = [];
        for (const ch of word) {
          if (isChinese(ch)) chineseChars.push(ch);
        }

        for (let i = 0; i < chineseChars.length - 1; i++) {
          const bg = chineseChars[i] + chineseChars[i + 1];
          if (!STOP_WORDS.has(bg) && bg.length >= 2) inc(counts, bg);
        }

        for (let i = 0; i < chineseChars.length - 2; i++) {
          const tg = chineseChars[i] + chineseChars[i + 1] + chineseChars[i + 2];
          if (!STOP_WORDS.has(tg) && tg.length >= 2) inc(counts, tg);
        }
      }
    } else {
      // FALLBACK 模式：原始字符级滑动窗口
      const segments = title.split(/\s+/).filter(s => s.length > 0);
      for (const seg of segments) {
        if (seg.length < 2) continue;
        inc(counts, seg);

        const chineseChars = [];
        for (const ch of seg) {
          if (isChinese(ch)) chineseChars.push(ch);
        }

        for (let i = 0; i < chineseChars.length - 1; i++) {
          const bg = chineseChars[i] + chineseChars[i + 1];
          if (!STOP_WORDS.has(bg)) inc(counts, bg);
        }
        for (let i = 0; i < chineseChars.length - 2; i++) {
          const tg = chineseChars[i] + chineseChars[i + 1] + chineseChars[i + 2];
          if (!STOP_WORDS.has(tg)) inc(counts, tg);
        }
        for (let i = 0; i < chineseChars.length - 3; i++) {
          inc(counts, chineseChars.slice(i, i + 4).join(''));
        }
      }
    }
  }

  // 排序 + 过滤 → Top15
  const sorted = [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .filter(item => item.word.length >= 2)
    .filter(item => !STOP_WORDS.has(item.word))
    .filter(item => !/^\d+$/.test(item.word))
    .filter(item => item.word.length <= 8)
    .sort((a, b) => b.count - a.count);

  const topKeywords = sorted.slice(0, 15);

  // 缺口词检测：覆盖率 < 50%
  const gapKeywords = topKeywords.filter(item => {
    if (item.count < 3) return false;
    if (sourceTitles.length === 0) return true;

    const coveredCount = sourceTitles.filter(st =>
      st.toLowerCase().includes(item.word.toLowerCase())
    ).length;

    return (coveredCount / sourceTitles.length) < 0.5;
  }).slice(0, 10);

  // 生成摘要
  const topStr = topKeywords.slice(0, 8).map(k => `${k.word}(${k.count}次)`).join(', ');
  const gapStr = gapKeywords.slice(0, 8).map(k => k.word).join(', ');
  let summary = '';
  if (topStr) summary += `同行高频词: ${topStr}`;
  if (gapStr) summary += `。缺口词(淘宝有/1688无): ${gapStr}`;

  return { topKeywords, gapKeywords, summary };
}

function inc(m, k) { m.set(k, (m.get(k) || 0) + 1); }

/**
 * 关键词推荐器：根据核心词、蓝海词、修饰词、同行标题生成待调研关键词列表
 * @param {Object} params - 输入参数
 * @param {string} params.coreWord - 核心词（必填）
 * @param {string} [params.blueOceanWord] - 蓝海词（可选）
 * @param {Array<{word: string, rigidity: string}>} [params.modifiers] - 修饰词数组（每个元素有 word 和 rigidity 字段）
 * @param {string[]} [params.peerTitles] - 同行标题数组（用于提取高频词和缺口词）
 * @returns {{ keywords: Array<{word: string, source: string, priority: number}> }}
 */
function recommendResearchKeywords({ coreWord, blueOceanWord, modifiers = [], peerTitles = [] }) {
  const result = [];
  const seen = new Set();

  // 工具函数：添加关键词（去重，优先级高的保留）
  const addKeyword = (word, source, priority) => {
    if (!word || seen.has(word)) return;
    seen.add(word);
    result.push({ word, source, priority });
  };

  // 1. 核心词本身（priority: 1, source: '核心词'）
  if (coreWord) {
    addKeyword(coreWord, '核心词', 1);
  }

  // 2. 蓝海词（priority: 2, source: '蓝海词'，如果与核心词不同）
  if (blueOceanWord && blueOceanWord !== coreWord) {
    addKeyword(blueOceanWord, '蓝海词', 2);
  }

  // 3. 核心词 + 每个刚性修饰词（priority: 3, source: '核心词+刚性修饰词'）
  const rigidModifiers = modifiers.filter(m => m.rigidity === 'rigid');
  for (const mod of rigidModifiers) {
    if (mod.word && coreWord) {
      addKeyword(coreWord + mod.word, '核心词+刚性修饰词', 3);
    }
  }

  if (peerTitles && peerTitles.length > 0) {
    const { topKeywords, gapKeywords } = analyzePeerTitles(peerTitles, []);

    const top5 = topKeywords.slice(0, 5);
    for (let i = 0; i < top5.length; i++) {
      addKeyword(top5[i].word, '高频词', 4 + i);
    }

    const topGap = gapKeywords.slice(0, 5);
    for (let i = 0; i < topGap.length; i++) {
      addKeyword(topGap[i].word, '缺口词', 9 + i);
    }
  }

  // 按 priority 升序排序
  result.sort((a, b) => a.priority - b.priority);

  return { keywords: result };
}

/**
 * 按需求供给比增强排序：将 SYCM 数据附加到关键词，并按供需比重排
 * @param {Object} params - 输入参数
 * @param {Array<{word: string, count: number}>} params.topKeywords - 高频关键词数组
 * @param {Array<{word: string, count: number}>} params.gapKeywords - 缺口关键词数组
 * @param {Array<{keyword: string, demandSupplyRatio: number, searchPopularity: number}>} sycmDataArray - SYCM 数据数组（从 parseSycmData 返回）
 * @returns {{ topKeywords: Array, gapKeywords: Array, sycmKeywords: Array }}
 */
function enrichWithSycmData({ topKeywords = [], gapKeywords = [] }, sycmDataArray = []) {
  // 构建 SYCM 关键词映射（支持精确匹配和子串包含）
  const sycmMap = new Map();
  const sycmKeywords = [];

  for (const item of sycmDataArray) {
    const keyword = item.keyword;
    if (!keyword) continue;

    // 记录所有 SYCM 关键词用于补充来源
    sycmMap.set(keyword, {
      demandSupplyRatio: item.demandSupplyRatio,
      searchPopularity: item.searchPopularity,
      hasSycmData: false // 初始为 false，后面会更新
    });

    // 检查是否已在 topKeywords 或 gapKeywords 中（子串包含方向：k.word包含keyword）
    // 子串匹配需要 >= 2 字符，避免单字词（如"银"、"金"）错误触发匹配
    const inTop = topKeywords.some(k => k.word === keyword || (keyword.length >= 2 && k.word.includes(keyword)));
    const inGap = gapKeywords.some(k => k.word === keyword || (keyword.length >= 2 && k.word.includes(keyword)));

    if (!inTop && !inGap) {
      sycmKeywords.push({
        word: keyword,
        demandSupplyRatio: item.demandSupplyRatio,
        searchPopularity: item.searchPopularity,
        hasSycmData: true
      });
    }
  }

  // 工具函数：为关键词附加 SYCM 数据
  const enrichKeywords = (keywords) => {
    // 第一步：标记哪些词有 SYCM 数据
    const enriched = keywords.map(k => {
      let match = sycmMap.get(k.word);

      if (!match) {
        for (const [sycmWord, data] of sycmMap.entries()) {
          if ((k.word.length >= 2 && sycmWord.length >= 2) && (sycmWord.includes(k.word) || k.word.includes(sycmWord))) {
            match = data;
            break;
          }
        }
      }

      if (match) {
        return {
          ...k,
          demandSupplyRatio: match.demandSupplyRatio,
          searchPopularity: match.searchPopularity,
          hasSycmData: true
        };
      }

      return {
        ...k,
        hasSycmData: false
      };
    });

    // 第二步：按 demandSupplyRatio 降序重排
    // 有 SYCM 数据的排前面（按倍数降序），无数据的排后面保持原顺序
    const withData = enriched.filter(k => k.hasSycmData).sort((a, b) => b.demandSupplyRatio - a.demandSupplyRatio);
    const withoutData = enriched.filter(k => !k.hasSycmData);

    return [...withData, ...withoutData];
  };

  return {
    topKeywords: enrichKeywords(topKeywords),
    gapKeywords: enrichKeywords(gapKeywords),
    sycmKeywords: sycmKeywords.sort((a, b) => b.demandSupplyRatio - a.demandSupplyRatio)
  };
}

module.exports = { analyzePeerTitles, recommendResearchKeywords, enrichWithSycmData };
