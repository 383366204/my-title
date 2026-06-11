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

function safeJiebaCut(jieba, title) {
  if (!jieba) return null;
  try {
    return jieba.cut(title);
  } catch (e) {
    _jieba = false;
    return null;
  }
}

/**
 * 计算位置权重
 * @param {number} offset - 字符偏移量
 * @returns {number} 位置权重
 */
function getPositionWeight(offset) {
  if (offset < 8) return 2.0;
  if (offset < 20) return 1.5;
  if (offset < 40) return 1.0;
  return 0.5;
}

/**
 * 从淘宝同行标题中提取高频关键词和竞品缺口词
 * @param {string[]} peerTitles - 淘宝同行标题数组
 * @param {string|string[]} sourceTitleOrArray - 1688 原标题（字符串或数组，用于缺口分析）
 * @returns {{ topKeywords: Array<{word: string, count: number}>, gapKeywords: Array<{word: string, count: number}>, positionWeightedKeywords: Array<{word: string, count: number, positionWeight: number}>, summary: string }}
 */
function analyzePeerTitles(peerTitles, sourceTitleOrArray) {
  // 1. 防御性去重 + 过滤
  const uniqueTitles = [...new Set(
    (peerTitles || []).filter(t => t && typeof t === 'string' && t.trim())
  )];

  if (uniqueTitles.length === 0) {
    return { topKeywords: [], gapKeywords: [], positionWeightedKeywords: [], summary: '' };
  }

  // 2. 归一化 sourceTitles 为数组（向后兼容：也接受字符串）
  const sourceTitles = Array.isArray(sourceTitleOrArray)
    ? sourceTitleOrArray.filter(t => typeof t === 'string')
    : (sourceTitleOrArray || '').split(/[\s,，、;；]+/).filter(Boolean);

  // 3. 选择分词策略
  const jieba = getJieba();
  const counts = new Map();
  const weightedCounts = new Map();

  for (const title of uniqueTitles) {
    const words = safeJiebaCut(jieba, title);
    if (words) {
      let currentOffset = 0;
      // JIEBA 模式：先分词，再做词内 n-gram（不跨词边界）
      for (const word of words) {
        const wordStart = title.indexOf(word, currentOffset);
        if (wordStart === -1) {
          currentOffset += word.length;
          continue;
        }
        currentOffset = wordStart + word.length;
        
        if (word.length < 2) continue;
        if (STOP_WORDS.has(word)) continue;
        const trimmedWord = word.trim();
        inc(counts, trimmedWord);
        const weight = getPositionWeight(wordStart);
        incWeighted(weightedCounts, trimmedWord, weight);

        const chineseChars = [];
        const chineseOffsets = [];
        for (let i = 0; i < word.length; i++) {
          const ch = word[i];
          if (isChinese(ch)) {
            chineseChars.push(ch);
            chineseOffsets.push(wordStart + i);
          }
        }

        for (let i = 0; i < chineseChars.length - 1; i++) {
          const bg = chineseChars[i] + chineseChars[i + 1];
          if (!STOP_WORDS.has(bg) && bg.length >= 2) {
            inc(counts, bg);
            const bgWeight = getPositionWeight(chineseOffsets[i]);
            incWeighted(weightedCounts, bg, bgWeight);
          }
        }

        for (let i = 0; i < chineseChars.length - 2; i++) {
          const tg = chineseChars[i] + chineseChars[i + 1] + chineseChars[i + 2];
          if (!STOP_WORDS.has(tg) && tg.length >= 2) {
            inc(counts, tg);
            const tgWeight = getPositionWeight(chineseOffsets[i]);
            incWeighted(weightedCounts, tg, tgWeight);
          }
        }
      }
    } else {
      // FALLBACK 模式：原始字符级滑动窗口
      const segments = title.split(/\s+/).filter(s => s.length > 0);
      let currentOffset = 0;
      for (const seg of segments) {
        const segStart = title.indexOf(seg, currentOffset);
        if (segStart === -1) {
          currentOffset += seg.length;
          continue;
        }
        currentOffset = segStart + seg.length;
        
        if (seg.length < 2) continue;
        inc(counts, seg);
        const segWeight = getPositionWeight(segStart);
        incWeighted(weightedCounts, seg, segWeight);

        const chineseChars = [];
        const chineseOffsets = [];
        for (let i = 0; i < seg.length; i++) {
          const ch = seg[i];
          if (isChinese(ch)) {
            chineseChars.push(ch);
            chineseOffsets.push(segStart + i);
          }
        }

        for (let i = 0; i < chineseChars.length - 1; i++) {
          const bg = chineseChars[i] + chineseChars[i + 1];
          if (!STOP_WORDS.has(bg)) {
            inc(counts, bg);
            const bgWeight = getPositionWeight(chineseOffsets[i]);
            incWeighted(weightedCounts, bg, bgWeight);
          }
        }
        for (let i = 0; i < chineseChars.length - 2; i++) {
          const tg = chineseChars[i] + chineseChars[i + 1] + chineseChars[i + 2];
          if (!STOP_WORDS.has(tg)) {
            inc(counts, tg);
            const tgWeight = getPositionWeight(chineseOffsets[i]);
            incWeighted(weightedCounts, tg, tgWeight);
          }
        }
        for (let i = 0; i < chineseChars.length - 3; i++) {
          const qg = chineseChars.slice(i, i + 4).join('');
          inc(counts, qg);
          const qgWeight = getPositionWeight(chineseOffsets[i]);
          incWeighted(weightedCounts, qg, qgWeight);
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

  // 构建位置权重关键词数组
  const positionWeightedKeywords = [...weightedCounts.entries()]
    .map(([word, { count, weight }]) => ({ word, count, positionWeight: weight }))
    .filter(item => item.word.length >= 2)
    .filter(item => !STOP_WORDS.has(item.word))
    .filter(item => !/^\d+$/.test(item.word))
    .filter(item => item.word.length <= 8)
    .sort((a, b) => b.positionWeight - a.positionWeight)
    .slice(0, 15);

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

  // 提取语义族（简单实现：基于关键词子串包含关系）
  const semanticGroups = {};
  const processed = new Set();
  for (let i = 0; i < topKeywords.length; i++) {
    const word = topKeywords[i].word;
    if (processed.has(word)) continue;
    const group = [word];
    for (let j = i + 1; j < topKeywords.length; j++) {
      const other = topKeywords[j].word;
      if (processed.has(other)) continue;
      if (word.includes(other) || other.includes(word)) {
        group.push(other);
        processed.add(other);
      }
    }
    if (group.length > 1) {
      semanticGroups[word] = group;
    }
    processed.add(word);
  }

  return { topKeywords, gapKeywords, positionWeightedKeywords, summary, semanticGroups };
}

function inc(m, k) { m.set(k, (m.get(k) || 0) + 1); }
function incWeighted(m, k, w) {
  const current = m.get(k) || { count: 0, weight: 0 };
  m.set(k, {
    count: current.count + 1,
    weight: current.weight + w
  });
}

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
        keyword: keyword,
        demandSupplyRatio: item.demandSupplyRatio,
        searchPopularity: item.searchPopularity,
        clickRate: item.clickRate,
        conversionRate: item.conversionRate,
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

/**
 * 移除标题中同一语义族的重复词变体
 * @param {string} title - 标题
 * @param {Object} semanticGroups - { "纯银系": ["纯银", "S925银", "925银"], ... }
 * @returns {string} 去重后的标题
 */
function removeSemanticDuplicates(title, semanticGroups) {
  if (!semanticGroups || Object.keys(semanticGroups).length === 0) return title;
  
  let result = title;
  for (const [groupName, variants] of Object.entries(semanticGroups)) {
    // 找出标题中包含的该族变体
    const foundPositions = [];
    for (const variant of variants) {
      let pos = 0;
      while (pos < result.length) {
        const idx = result.indexOf(variant, pos);
        if (idx === -1) break;
        foundPositions.push({ variant, idx });
        pos = idx + 1; // 继续搜索同一变体的其他出现位置
      }
    }
    
    // 如果没有找到任何变体，继续下一个语义族
    if (foundPositions.length === 0) continue;
    
    // 按位置排序
    foundPositions.sort((a, b) => a.idx - b.idx);
    
    // 找出要保留的第一个变体（位置最靠前的）
    // 我们需要处理变体可能是其他变体子串的情况
    const keepRanges = [];
    for (const { variant, idx } of foundPositions) {
      const endIdx = idx + variant.length;
      
      // 检查这个范围是否与已保留的范围重叠
      const overlaps = keepRanges.some(range => 
        (idx >= range.start && idx < range.end) || // 当前起始在某个保留范围内
        (endIdx > range.start && endIdx <= range.end) || // 当前结束在某个保留范围内
        (idx <= range.start && endIdx >= range.end) // 当前包含某个保留范围
      );
      
      if (!overlaps) {
        keepRanges.push({ start: idx, end: endIdx });
      }
    }
    
    // 如果只有一个要保留的范围，说明没有重复，继续下一个语义族
    if (keepRanges.length <= 1) continue;
    
    // 保留第一个范围，标记其他范围要删除
    const toDelete = [];
    for (let i = 1; i < keepRanges.length; i++) {
      toDelete.push(keepRanges[i]);
    }
    
    // 从后往前删除，避免索引偏移
    toDelete.sort((a, b) => b.start - a.start); // 按起始位置降序排序
    for (const { start, end } of toDelete) {
      result = result.slice(0, start) + result.slice(end);
    }
  }
  return result;
}

module.exports = { analyzePeerTitles, recommendResearchKeywords, enrichWithSycmData, removeSemanticDuplicates };
