/**
 * 按订单粘贴识别：从用户复制的单条订单文本中提取订单号、买家旺旺和收货电话。
 * 每个订单组配一个粘贴框，粘贴哪一单的文本就填哪一单，不做跨单匹配。
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

// 单行输入框粘贴多行文本时换行会被压掉：只要标签出现在行中间，就在它前面补一个换行
const INLINE_LABEL_PATTERN = new RegExp(
  `(?<=\\S)\\s*(?=(?:${Object.values(FIELD_ALIASES).flat().join('|')})\\s*[:：])`,
  'g'
);

function fieldOf(label) {
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.includes(label)) return field;
  }
  return '';
}

/**
 * 归一化粘贴文本：统一换行符，并把被压到同一行里的标签重新切开。
 * @param {string} text 原始粘贴内容
 * @returns {string[]} 可解析的行
 */
function pasteLines(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(INLINE_LABEL_PATTERN, '\n')
    .split('\n');
}

/**
 * 解析粘贴的订单文本，返回识别出的第一条订单记录。
 * 无关行（商品名、物流单号等）直接忽略；识别不到任何字段时返回 null。
 * @param {string} text 用户粘贴的原始文本
 * @returns {{orderNumber:string, buyerName:string, buyerPhone:string}|null} 订单记录
 */
export function parsePastedOrder(text) {
  const record = { orderNumber: '', buyerName: '', buyerPhone: '' };
  for (const line of pasteLines(text)) {
    const match = line.match(LINE_PATTERN);
    if (!match) continue;
    const field = fieldOf(match[1]);
    const value = match[2].trim();
    // 只取第一次出现的字段：粘贴内容属于同一单，重复行（如截断复制）不覆盖
    if (field && value && !record[field]) record[field] = value;
  }
  const recognized = record.orderNumber || record.buyerName || record.buyerPhone;
  return recognized ? record : null;
}