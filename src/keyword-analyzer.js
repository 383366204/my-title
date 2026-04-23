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

module.exports = { analyzePeerTitles };
