/**
 * 上传刷单表后逐组填写的订单信息，字段定义与必填规则的唯一来源。
 * 之前面板和启动闸门各自硬编码了一份五个字段，改一处漏一处，导致"选填"字段仍然拦下流程。
 */
export const REVIEW_GROUP_FIELDS = [
  { field: 'orderDate', label: '刷单日期', type: 'date', required: true },
  { field: 'storeName', label: '店铺名', type: 'text', required: true },
  { field: 'buyerName', label: '买家旺旺', type: 'text', required: false },
  { field: 'buyerPhone', label: '买家手机号', type: 'text', required: false },
  { field: 'orderNumber', label: '订单号', type: 'text', required: false }
];

export const REQUIRED_REVIEW_GROUP_FIELDS = REVIEW_GROUP_FIELDS
  .filter(item => item.required)
  .map(item => item.field);

/**
 * List groups still missing a required order field.
 * @param {Array<object>} groups parsed order groups
 * @returns {Array<string>} entries shaped like `2:storeName`
 */
export function findMissingReviewGroupFields(groups = []) {
  return groups.flatMap((group, index) => REQUIRED_REVIEW_GROUP_FIELDS
    .filter(field => !String(group?.[field] || '').trim())
    .map(field => `${index + 1}:${field}`));
}

/**
 * Human readable list of the required fields, for error copy.
 * @returns {string} e.g. `刷单日期、店铺名`
 */
export function describeRequiredReviewGroupFields() {
  return REVIEW_GROUP_FIELDS
    .filter(item => item.required)
    .map(item => item.label)
    .join('、');
}
