/**
 * 粘贴订单信息自动填充：从用户复制的订单文本中提取订单号、买家旺旺和收货电话，
 * 并填充到刷单表解析出的订单组里。纯逻辑无 DOM 依赖，便于单元测试。
 */

// 字段别名 → 订单组字段；兼容不同平台复制出来的标签写法
const FIELD_ALIASES = {
  orderNumber: ['订单编号', '订单号', '订单ID'],
  buyerName: ['买家旺旺', '旺旺名', '旺旺', '买家昵称'],
  buyerPhone: ['收货电话', '买家手机号', '收货手机', '手机号码', '手机号', '联系电话']
};

const LINE_PATTERN = new RegExp(
  `^\\s*(${Object.values(FIELD_ALIASES).flat().join('|')})\\s*[:：]\\s*(.+?)\\s*$`
);

function fieldOf(label) {
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.includes(label)) return field;
  }
  return '';
}

/**
 * 解析粘贴的订单文本。支持一单或多单：同一字段第二次出现时自动开新单，
 * 无关行（商品名、时间等）直接忽略。
 * @param {string} text 用户粘贴的原始文本
 * @returns {{orderNumber:string, buyerName:string, buyerPhone:string}[]} 识别出的订单记录
 */
export function parsePastedOrders(text) {
  const lines = String(text || '').split(/\r?\n/);
  const records = [];
  let current = null;
  for (const line of lines) {
    const match = line.match(LINE_PATTERN);
    if (!match) continue;
    const field = fieldOf(match[1]);
    const value = match[2].trim();
    if (!field || !value) continue;
    if (current && current[field]) {
      // 同一字段再次出现说明进入了下一单，先把当前单收掉
      records.push(current);
      current = null;
    }
    if (!current) current = { orderNumber: '', buyerName: '', buyerPhone: '' };
    current[field] = value;
  }
  if (current && (current.orderNumber || current.buyerName || current.buyerPhone)) {
    records.push(current);
  }
  return records;
}

const sameText = (left, right) => String(left || '').trim() === String(right || '').trim();

/**
 * 把识别出的订单记录填充进订单组：先按订单号精确匹配，剩余的按出现顺序
 * 填给还没旺旺/手机号的组。只补空字段，不覆盖人工已填内容。
 * @param {Array<object>} groups 刷单表解析出的订单组
 * @param {Array<object>} records parsePastedOrders 的结果
 * @returns {{groups:Array<object>, summary:{recognized:number, byOrderNumber:number, sequential:number, skipped:number}}} 填充结果
 */
export function applyPastedOrders(groups = [], records = []) {
  const next = (Array.isArray(groups) ? groups : []).map(group => ({ ...group }));
  const remaining = (Array.isArray(records) ? records : []).map(record => ({ ...record }));
  let byOrderNumber = 0;

  // 第一轮：订单号精确匹配（订单号唯一，是最可靠的锚点）
  for (const group of next) {
    if (!group.orderNumber) continue;
    const index = remaining.findIndex(record => record.orderNumber && sameText(record.orderNumber, group.orderNumber));
    if (index < 0) continue;
    const [record] = remaining.splice(index, 1);
    if (!group.buyerName && record.buyerName) group.buyerName = record.buyerName;
    if (!group.buyerPhone && record.buyerPhone) group.buyerPhone = record.buyerPhone;
    byOrderNumber += 1;
  }

  // 第二轮：剩余记录按粘贴顺序填给仍缺买家信息的组（多单粘贴顺序通常与表格一致）
  let sequential = 0;
  for (const group of next) {
    if (remaining.length === 0) break;
    const hasBuyerInfo = Boolean(String(group.buyerName || '').trim() || String(group.buyerPhone || '').trim());
    if (hasBuyerInfo) continue;
    const [record] = remaining.splice(0, 1);
    if (!group.buyerName && record.buyerName) group.buyerName = record.buyerName;
    if (!group.buyerPhone && record.buyerPhone) group.buyerPhone = record.buyerPhone;
    if (!group.orderNumber && record.orderNumber) group.orderNumber = record.orderNumber;
    sequential += 1;
  }

  return {
    groups: next,
    summary: {
      recognized: Array.isArray(records) ? records.length : 0,
      byOrderNumber,
      sequential,
      skipped: remaining.length
    }
  };
}