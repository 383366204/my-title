const fs = require('fs');

// 中文停用词
const STOP_WORDS = new Set(['的', '和', '与', '或', '等', '可', '及', '带', '送', '专', '真', '假', '是', '在', '有', '了', '不', '也', '就', '都', '而', '及', '到', '为', '中', '对', '上', '下', '个', '好', '很', '这', '那']);

// 中文汉字检测
const isChinese = (ch) => /[\u4e00-\u9fff]/.test(ch);

/**
 * 从淘宝同行标题中提取高频关键词和竞品缺口词
 * @param {string[]} peerTitles - 淘宝同行标题数组
 * @param {string} sourceTitle - 1688 原标题（用于缺口分析）
 * @returns {{ topKeywords: Array<{word: string, count: number}>, gapKeywords: Array<{word: string, count: number}>, summary: string }}
 */
function analyzePeerTitles(peerTitles, sourceTitle) {
  if (!Array.isArray(peerTitles) || peerTitles.length === 0) {
    return { topKeywords: [], gapKeywords: [], summary: '' };
  }

  const counts = new Map();

  for (const title of peerTitles) {
    if (!title || typeof title !== 'string') continue;

    // 按空格分词
    const segments = title.split(/\s+/).filter(s => s.length > 0);

    for (const seg of segments) {
      // 过滤：单字符、纯停用词
      if (seg.length < 2) continue;

      // 直接加入完整段
      increment(counts, seg);

      // 对包含中文的段，提取2字滑动窗口
      const chineseChars = [];
      for (const ch of seg) {
        if (isChinese(ch)) {
          chineseChars.push(ch);
        }
      }

      // 提取2字组合
      for (let i = 0; i < chineseChars.length - 1; i++) {
        const bigram = chineseChars[i] + chineseChars[i + 1];
        if (!STOP_WORDS.has(bigram)) {
          increment(counts, bigram);
        }
      }

      // 提取3字组合（更高价值）
      for (let i = 0; i < chineseChars.length - 2; i++) {
        const trigram = chineseChars[i] + chineseChars[i + 1] + chineseChars[i + 2];
        if (!STOP_WORDS.has(trigram)) {
          increment(counts, trigram);
        }
      }

      // 提取4字组合
      for (let i = 0; i < chineseChars.length - 3; i++) {
        const fourgram = chineseChars[i] + chineseChars[i + 1] + chineseChars[i + 2] + chineseChars[i + 3];
        increment(counts, fourgram);
      }
    }
  }

  // 排序得到高频词（取 Top 30）
  const sorted = [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .filter(item => {
      // 过滤单字符和停用词
      if (item.word.length < 2) return false;
      if (STOP_WORDS.has(item.word)) return false;
      // 过滤纯数字（保留 S925、18K 等混合格式）
      if (/^\d+$/.test(item.word)) return false;
      return true;
    })
    .sort((a, b) => b.count - a.count);

  const topKeywords = sorted.slice(0, 30);

  // 竞品缺口分析：高频但 1688 原标题中不存在的词
  const normalizedSource = (sourceTitle || '').replace(/\s+/g, '').toLowerCase();
  const gapKeywords = topKeywords
    .filter(item => {
      if (item.count < 3) return false; // 至少出现3次才算缺口
      return !normalizedSource.includes(item.word.toLowerCase());
    })
    .slice(0, 15);

  // 生成摘要
  const topStr = topKeywords.slice(0, 8).map(k => `${k.word}(${k.count}次)`).join(', ');
  const gapStr = gapKeywords.slice(0, 8).map(k => k.word).join(', ');
  let summary = '';
  if (topStr) summary += `同行高频词: ${topStr}`;
  if (gapStr) summary += `。缺口词(淘宝有/1688无): ${gapStr}`;

  return { topKeywords, gapKeywords, summary };
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

module.exports = { analyzePeerTitles };
