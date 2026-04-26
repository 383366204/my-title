/**
 * 生意参谋 Tab 分隔数据解析器
 * 解析从生意参谋复制的 Tab 分隔文本，提取关键词市场数据
 */

/**
 * 解析区间值为中值数字
 * @param {string} rangeStr - 区间字符串，如 "1万 ~ 2万", "82%", "7.57"
 * @returns {number} 解析后的数值
 */
function parseRangeValue(rangeStr) {
  if (!rangeStr || typeof rangeStr !== 'string') return 0;

  const trimmed = rangeStr.trim();

  // 处理纯数字（浮点数或整数）
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return parseFloat(trimmed);
  }

  // 处理百分比（无区间）
  const percentMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (percentMatch) {
    return parseFloat(percentMatch[1]);
  }

  // 处理区间 "A ~ B" 或 "A~B" 或 "A ~B" 或 "A~ B"
  const rangeMatch = trimmed.match(/^([\d万一]+(?:\.\d+)?)\s*~+\s*([\d万一]+(?:\.\d+)?)\s*$/);
  if (rangeMatch) {
    const [_, left, right] = rangeMatch;
    const leftNum = parseChineseNumber(left);
    const rightNum = parseChineseNumber(right);
    return (leftNum + rightNum) / 2;
  }

  // 处理带 "万" 的单个值
  const wanMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*万$/);
  if (wanMatch) {
    return parseFloat(wanMatch[1]) * 10000;
  }

  // 处理纯中文数字区间
  const chineseRangeMatch = trimmed.match(/^([\d万]+)\s*~+\s*([\d万]+)$/);
  if (chineseRangeMatch) {
    const leftNum = parseChineseNumber(chineseRangeMatch[1]);
    const rightNum = parseChineseNumber(chineseRangeMatch[2]);
    return (leftNum + rightNum) / 2;
  }

  return 0;
}

/**
 * 解析中文数字（支持 "万" 单位）
 * @param {string} numStr - 数字字符串，如 "1万", "5000", "2.5万"
 * @returns {number} 解析后的数值
 */
function parseChineseNumber(numStr) {
  if (!numStr) return 0;

  const trimmed = numStr.trim();

  // 处理 "万" 单位
  const wanMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*万$/);
  if (wanMatch) {
    return parseFloat(wanMatch[1]) * 10000;
  }

  // 纯数字
  return parseFloat(trimmed) || 0;
}

/**
 * 解析生意参谋 Tab 分隔数据
 * @param {string} rawText - 从生意参谋复制的 Tab 分隔文本
 * @returns {Array<{keyword: string, searchPopularity: number, clickRate: number, conversionRate: number, buyerCount: number, demandSupplyRatio: number, tmallClickShare: number}>}
 */
function parseSycmData(rawText) {
  // 容错：空输入
  if (!rawText || typeof rawText !== 'string') {
    return [];
  }

  const lines = rawText.split('\n');
  const result = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 按 Tab 分割
    const fields = trimmed.split('\t');

    // 表头行跳过（包含 "搜索人气" 等特征词）
    if (fields.length >= 7) {
      const headerCheck = fields.join('').toLowerCase();
      if (headerCheck.includes('搜索人气') ||
          headerCheck.includes('相关搜索词') ||
          headerCheck.includes('keyword')) {
        continue;
      }
    }

    // 必须有 7 列数据
    if (fields.length < 7) continue;

    const [keyword, searchPopularity, clickRate, conversionRate, buyerCount, demandSupplyRatio, tmallClickShare] = fields;

    // 关键词不能为空
    if (!keyword || keyword.trim() === '') continue;

    // 尝试解析各字段数值
    const parsedDemandSupplyRatio = parseRangeValue(demandSupplyRatio);

    // 需求供给比必须是有效数字（用于排序和过滤无效行）
    if (isNaN(parsedDemandSupplyRatio) || parsedDemandSupplyRatio === 0) {
      continue;
    }

    result.push({
      keyword: keyword.trim(),
      searchPopularity: parseRangeValue(searchPopularity),
      clickRate: parseRangeValue(clickRate),
      conversionRate: parseRangeValue(conversionRate),
      buyerCount: parseRangeValue(buyerCount),
      demandSupplyRatio: parsedDemandSupplyRatio,
      tmallClickShare: parseRangeValue(tmallClickShare)
    });
  }

  // 按 demandSupplyRatio 降序排序
  result.sort((a, b) => b.demandSupplyRatio - a.demandSupplyRatio);

  // 数据量上限
  const limited = result.slice(0, 200);

  return limited;
}

module.exports = { parseSycmData, parseRangeValue };