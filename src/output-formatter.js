/**
 * 结果输出格式化模块
 * @module output-formatter
 */

/**
 * 格式化数字，添加千分位分隔符
 * @param {number} num - 要格式化的数字
 * @returns {string} 格式化后的字符串
 */
function formatNumber(num) {
  if (typeof num !== 'number' || isNaN(num)) return String(num);
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 格式化百分比 (0.962 → 96.2%)
 * @param {number} ratio - 0-1 之间的小数
 * @returns {string} 格式化后的百分比字符串
 */
function formatPercent(ratio) {
  if (typeof ratio !== 'number' || isNaN(ratio)) return String(ratio);
  return (ratio * 100).toFixed(1) + '%';
}

/**
 * 表格列对齐方式
 */
const ALIGN = {
  LEFT: 'left',
  RIGHT: 'right',
  CENTER: 'center'
};

/**
 * 列配置
 */
const COLUMNS = [
  { key: '链接原标题', header: '链接原标题', width: 20, align: ALIGN.LEFT },
  { key: '产品链接', header: '产品链接', width: 15, align: ALIGN.LEFT },
  { key: '主图链接', header: '主图链接', width: 15, align: ALIGN.LEFT },
  { key: '铺货标题', header: '铺货标题', width: 20, align: ALIGN.LEFT },
  { key: '商品原价', header: '商品原价', width: 12, align: ALIGN.RIGHT },
  { key: '30天销量', header: '30天销量', width: 10, align: ALIGN.RIGHT },
  { key: '好评率', header: '好评率', width: 10, align: ALIGN.RIGHT },
  { key: '复购率', header: '复购率', width: 10, align: ALIGN.RIGHT },
  { key: '蓝海词', header: '蓝海词', width: 15, align: ALIGN.LEFT },
  { key: '选品理由', header: '选品理由', width: 20, align: ALIGN.LEFT },
  { key: '定价建议', header: '定价建议', width: 20, align: ALIGN.LEFT },
  { key: '风险提示', header: '风险提示', width: 20, align: ALIGN.LEFT }
];

/**
 * 截断字符串到指定宽度
 * @param {string} str - 字符串
 * @param {number} width - 最大宽度
 * @returns {string} 截断后的字符串
 */
function truncate(str, width) {
  if (str === null || str === undefined || str === '') return '';
  const s = String(str);
  if (s.length <= width) return s;
  return s.substring(0, width - 1) + '…';
}

/**
 * 生成表格行
 * @param {Object} row - 行数据对象
 * @param {Array} columns - 列配置
 * @returns {string} 格式化后的行字符串
 */
function formatRow(row, columns) {
  return columns.map(col => {
    let value = row[col.key];
    
    // 特殊格式化
    if (col.key === '好评率' || col.key === '复购率') {
      value = formatPercent(value);
    } else if (col.key === '30天销量' || col.key === '商品原价') {
      value = formatNumber(value);
    }
    
    const cell = truncate(value, col.width);
    
    if (col.align === ALIGN.RIGHT) {
      return cell.padStart(col.width);
    } else if (col.align === ALIGN.CENTER) {
      return cell.padStart(Math.floor((col.width + cell.length) / 2))
             .padEnd(col.width);
    }
    return cell.padEnd(col.width);
  }).join(' | ');
}

/**
 * 生成表格头
 * @param {Array} columns - 列配置
 * @returns {string} 表格头字符串
 */
function formatHeader(columns) {
  return columns.map(col => {
    const cell = col.header.padEnd(col.width);
    return col.align === ALIGN.RIGHT ? cell.trim().padStart(col.width) : cell;
  }).join(' | ');
}

/**
 * 生成分隔线
 * @param {Array} columns - 列配置
 * @returns {string} 分隔线字符串
 */
function formatDivider(columns) {
  return columns.map(col => '-'.repeat(col.width)).join('-+-');
}

/**
 * 格式化结果为表格字符串
 * @param {Array} results - 结果数组
 * @returns {string} 表格格式的字符串
 */
function formatTable(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return '无结果';
  }

  const lines = [];
  lines.push(formatHeader(COLUMNS));
  lines.push(formatDivider(COLUMNS));
  
  for (const row of results) {
    lines.push(formatRow(row, COLUMNS));
  }
  
  return lines.join('\n');
}

/**
 * 格式化结果为 JSON 字符串
 * @param {Array} results - 结果数组
 * @returns {string} JSON 格式的字符串
 */
function formatJSON(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return JSON.stringify([], null, 2);
  }

  // 中文字段已经在 row 中，不需要额外处理英文字段
  const formatted = results;

  return JSON.stringify(formatted, null, 2);
}

/**
 * 根据格式返回格式化后的结果
 * @param {Array} results - 结果数组
 * @param {string} [format='both'] - 格式类型: 'table', 'json', 'both'
 * @returns {string} 格式化后的字符串
 */
function formatResult(results, format = 'both') {
  switch (format) {
    case 'table':
      return formatTable(results);
    case 'json':
      return formatJSON(results);
    case 'both':
    default:
      return formatTable(results) + '\n\n--- JSON 输出 ---\n\n' + formatJSON(results);
  }
}

module.exports = {
  formatTable,
  formatJSON,
  formatResult
};
