'use strict';

/**
 * @typedef {object} OrderProduct
 * @property {string} [itemId] 商品 ID
 * @property {string} [sourceKey] 来源标识（用于无 ID 短链或手工项）
 * @property {string} title 商品标题
 * @property {string} [productUrl] 商品链接
 * @property {string} [imageUrl] 商品主图链接
 * @property {string} [storeName] 店铺名称
 * @property {number|null} [orderAmount] 下单金额（实付参考价）
 * @property {number|null} [paymentAmount] 支付金额
 * @property {number|null} [visitorCount] 访客数
 * @property {number|null} [paidItemCount] 支付件数
 * @property {number|null} [cartItemCount] 加购件数
 * @property {'rank'|'manual'|string} [sourceType] 商品来源类型
 * @property {'main'|'sub'} [role] 组内角色：主品(main) 或 副品/拖品(sub)
 * @property {string} [enrichmentStatus] 补全状态
 * @property {string} [enrichmentError] 补全错误
 */

/**
 * @typedef {object} OrderGroup
 * @property {string} id 组唯一标识（如 group_1）
 * @property {string} [name] 组显示名称（如 组 1）
 * @property {OrderProduct} mainProduct 主品（1 个）
 * @property {OrderProduct[]} subProducts 副品/拖品列表（N 个）
 * @property {string} [orderDate] 刷单日期
 * @property {string} [storeName] 店铺名称
 * @property {string} [workRequirement] 做单要求
 * @property {string} [orderNote] 下单备注
 */

/**
 * 解析数值金额。
 * @param {*} val 输入金额
 * @returns {number|null} 解析后的数值或 null
 */
function parseAmount(val) {
  if (val == null || val === '') return null;
  const num = Number(val);
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : null;
}

/**
 * 获取商品唯一标识键（itemId 优先，其次 sourceKey 或 productUrl）。
 * @param {object} product 商品对象
 * @returns {string} 商品唯一标识
 */
function getProductKey(product) {
  if (!product || typeof product !== 'object') return '';
  const itemId = String(product.itemId != null ? product.itemId : (product.id != null ? product.id : '')).trim();
  if (itemId) return itemId;
  const sourceKey = String(product.sourceKey || '').trim();
  if (sourceKey) return sourceKey;
  const productUrl = String(product.productUrl || product.url || product.link || '').trim();
  if (productUrl) {
    const match = productUrl.match(/[?&]id=(\d+)/i);
    if (match) return match[1];
    return productUrl;
  }
  return String(product.title || '').trim();
}

/**
 * 规范化单个商品对象。
 * @param {object} product 原始商品对象
 * @param {'main'|'sub'} [defaultRole='main'] 默认角色
 * @returns {OrderProduct} 规范化后的商品对象
 */
function normalizeOrderProduct(product = {}, defaultRole = 'main') {
  const itemId = String(product.itemId != null ? product.itemId : (product.id != null ? product.id : '')).trim();
  const sourceKey = String(product.sourceKey || '').trim();
  const title = String(product.title || '').trim();
  const productUrl = String(product.productUrl || product.url || product.link || (itemId ? `https://item.taobao.com/item.htm?id=${itemId}` : '')).trim();
  const imageUrl = String(product.imageUrl || product.image || '').trim();
  const storeName = String(product.storeName || '').trim();
  const sourceType = String(product.sourceType || (product.rank != null ? 'rank' : 'manual')).trim();
  const role = product.role === 'sub' ? 'sub' : (product.role === 'main' ? 'main' : defaultRole);

  const orderAmount = parseAmount(product.orderAmount != null ? product.orderAmount : product.price);
  const paymentAmount = parseAmount(product.paymentAmount);
  const visitorCount = Number.isFinite(Number(product.visitorCount)) ? Number(product.visitorCount) : null;
  const paidItemCount = Number.isFinite(Number(product.paidItemCount)) ? Number(product.paidItemCount) : null;
  const cartItemCount = Number.isFinite(Number(product.cartItemCount)) ? Number(product.cartItemCount) : null;

  return {
    ...product,
    itemId,
    ...(sourceKey ? { sourceKey } : {}),
    title,
    productUrl,
    imageUrl,
    storeName,
    orderAmount,
    paymentAmount,
    visitorCount,
    paidItemCount,
    cartItemCount,
    sourceType,
    role,
    enrichmentStatus: product.enrichmentStatus || (title ? 'complete' : 'normalized'),
    ...(product.enrichmentError ? { enrichmentError: String(product.enrichmentError) } : {}),
    ...(product.rank != null ? { rank: Number(product.rank) } : {}),
    ...(product.sourcePage != null ? { sourcePage: Number(product.sourcePage) } : {}),
    ...(product.statDate ? { statDate: String(product.statDate) } : {})
  };
}

/**
 * 将商品列表自动按 1 拖 N（1 主品 + N 副品）规则进行分组。
 * 尾组不足 N 个副品时，自动归入该组（尾组不足容差）。
 * 
 * 注意区分：
 * - dragCount (1拖N): 业务上的商品编组，1 主品拖 N 副品（组大小为 1 + dragCount）。
 * - rowSpan: Excel 渲染排版参数，决定每个商品在表格中占用的行高合并数（默认 3）。
 * 
 * @param {Array<object>} products 商品列表
 * @param {object} [options] 分组选项
 * @param {number} [options.dragCount=0] 每个主品拖带的副品数（N）。0 表示单品组（1拖0），2 表示 1拖2（组大小 3）。
 * @param {string} [options.groupPrefix='组 '] 组名前缀
 * @returns {OrderGroup[]} 分组后的 OrderGroup 数组
 */
function autoGroupOrderProducts(products = [], options = {}) {
  const list = Array.isArray(products) ? products : [];
  if (list.length === 0) return [];

  const rawDragCount = Number.parseInt(options.dragCount, 10);
  const dragCount = Number.isFinite(rawDragCount) && rawDragCount > 0 ? rawDragCount : 0;
  const groupSize = 1 + dragCount;
  const groupPrefix = options.groupPrefix || '组 ';
  const groups = [];

  for (let i = 0; i < list.length; i += groupSize) {
    const groupIndex = Math.floor(i / groupSize) + 1;
    const groupId = `group_${groupIndex}`;
    const groupName = `${groupPrefix}${groupIndex}`;
    const mainRaw = list[i];
    const subsRaw = list.slice(i + 1, i + groupSize);

    const mainProduct = normalizeOrderProduct(mainRaw, 'main');
    mainProduct.role = 'main';

    const subProducts = subsRaw.map(item => {
      const sub = normalizeOrderProduct(item, 'sub');
      sub.role = 'sub';
      return sub;
    });

    groups.push({
      id: groupId,
      groupId,
      name: groupName,
      groupName,
      mainProduct,
      subProducts,
      totalCount: 1 + subProducts.length
    });
  }

  return groups;
}

/**
 * 将扁平的历史商品 rows 转为单品组（1拖0）。
 * @param {Array<object>} rows 历史商品列表
 * @param {object} [options] 选项
 * @returns {OrderGroup[]} 单品组数组
 */
function rowsToOrderGroups(rows = [], options = {}) {
  return autoGroupOrderProducts(rows, { ...options, dragCount: 0 });
}

/**
 * 校验 OrderGroups 数据有效性。
 * 
 * 核心规则：
 * 1. 组内重复拦截：同一个组内（主品 + 所有副品）不能出现重复的商品（按 itemId 或 key 校验）。
 * 2. 跨组复用允许：同一个商品可以出现在不同组中（例如在组 1 作副品，在组 2 作主品或副品）。
 * 3. 必须包含有效的主品，且商品必须有标题。
 * 
 * @param {Array<object>} groups 待校验的组列表
 * @param {object} [options] 校验选项
 * @param {boolean} [options.requireNonEmpty=true] 是否要求至少包含 1 个组
 * @returns {{ valid: boolean, errors: string[], groupCount: number, productCount: number }} 校验结果
 */
function validateOrderGroups(groups = [], options = {}) {
  const list = Array.isArray(groups) ? groups : [];
  const errors = [];
  const requireNonEmpty = options.requireNonEmpty !== false;

  if (requireNonEmpty && list.length === 0) {
    errors.push('商品分组不能为空，至少需要 1 个商品组');
    return { valid: false, errors, groupCount: 0, productCount: 0 };
  }

  let totalProductCount = 0;

  for (let gIdx = 0; gIdx < list.length; gIdx += 1) {
    const group = list[gIdx];
    const groupLabel = group?.name || group?.id || `第 ${gIdx + 1} 组`;

    if (!group || typeof group !== 'object') {
      errors.push(`${groupLabel} 数据格式无效`);
      continue;
    }

    const mainProduct = group.mainProduct || group.main;
    if (!mainProduct || typeof mainProduct !== 'object') {
      errors.push(`${groupLabel} 缺少主品`);
      continue;
    }

    const subProducts = Array.isArray(group.subProducts)
      ? group.subProducts
      : (Array.isArray(group.subs) ? group.subs : []);

    const allGroupProducts = [
      { ...mainProduct, role: 'main' },
      ...subProducts.map(sub => ({ ...sub, role: 'sub' }))
    ];

    // 组内重复检查（组内 Set 独立跟踪，不同组之间相互独立以支持跨组复用）
    const intraGroupSeen = new Set();

    for (const prod of allGroupProducts) {
      totalProductCount += 1;
      const key = getProductKey(prod);
      const prodLabel = prod.title || prod.itemId || '未命名商品';

      if (!key) {
        errors.push(`${groupLabel} 中包含缺少商品 ID 或链接的商品`);
        continue;
      }

      if (intraGroupSeen.has(key)) {
        errors.push(`${groupLabel} 组内存在重复商品: ${prodLabel} (ID: ${key})`);
      } else {
        intraGroupSeen.add(key);
      }

      // 标题非空校验
      if (!String(prod.title || '').trim()) {
        errors.push(`${groupLabel} 中商品 (ID: ${key}) 缺少商品标题`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    groupCount: list.length,
    productCount: totalProductCount
  };
}

/**
 * 断言 OrderGroups 有效，若无效则抛出包含首个错误信息的 Error。
 * @param {Array<object>} groups 待校验的组列表
 * @param {object} [options] 校验选项
 * @throws {Error} 校验失败时抛出异常
 */
function assertValidOrderGroups(groups, options = {}) {
  const result = validateOrderGroups(groups, options);
  if (!result.valid) {
    const message = result.errors.join('；');
    const err = new Error(message);
    err.code = 'INVALID_ORDER_GROUPS';
    err.errors = result.errors;
    throw err;
  }
}

/**
 * 规范化商品组列表（支持已经是 groups 数组或旧 flat rows 数组的输入）。
 * @param {Array<object>} input 组列表或商品列表
 * @param {object} [options] 选项
 * @param {number} [options.dragCount=0] 如果输入为扁平 rows，指定 1 拖 N 编组数
 * @returns {OrderGroup[]} 规范化后的 OrderGroup 数组
 */
function normalizeOrderGroups(input = [], options = {}) {
  const list = Array.isArray(input) ? input : [];
  if (list.length === 0) return [];

  // 判断输入是已经是 group 结构还是 flat rows
  const isGroupFormat = list.some(item => (
    item && typeof item === 'object' &&
    (item.mainProduct != null || item.main != null || Array.isArray(item.subProducts) || Array.isArray(item.subs))
  ));

  if (!isGroupFormat) {
    // 扁平 rows 历史数据兼容
    return autoGroupOrderProducts(list, options);
  }

  return list.map((group, index) => {
    const groupId = String(group.id || group.groupId || `group_${index + 1}`).trim();
    const groupName = String(group.name || group.groupName || `组 ${index + 1}`).trim();
    const rawMain = group.mainProduct || group.main || (Array.isArray(group.products) ? group.products[0] : {});
    const rawSubs = Array.isArray(group.subProducts)
      ? group.subProducts
      : (Array.isArray(group.subs) ? group.subs : (Array.isArray(group.products) ? group.products.slice(1) : []));

    const mainProduct = normalizeOrderProduct(rawMain, 'main');
    mainProduct.role = 'main';

    const subProducts = rawSubs.map(sub => {
      const normalizedSub = normalizeOrderProduct(sub, 'sub');
      normalizedSub.role = 'sub';
      return normalizedSub;
    });

    return {
      id: groupId,
      groupId,
      name: groupName,
      groupName,
      mainProduct,
      subProducts,
      totalCount: 1 + subProducts.length,
      ...(group.orderDate ? { orderDate: String(group.orderDate) } : {}),
      ...(group.storeName ? { storeName: String(group.storeName) } : {}),
      ...(group.workRequirement ? { workRequirement: String(group.workRequirement) } : {}),
      ...(group.orderNote ? { orderNote: String(group.orderNote) } : {})
    };
  });
}

/**
 * 将 OrderGroups 展平为包含组上下文的商品扁平列表。
 * 便于 Excel 生成及通用表格消费。
 * 
 * @param {OrderGroup[]} groups 组列表
 * @returns {Array<OrderProduct & { groupId: string, groupName: string, groupIndex: number, itemIndexInGroup: number }>} 展平后的商品列表
 */
function flattenOrderGroups(groups = []) {
  const normalized = normalizeOrderGroups(groups);
  const rows = [];

  normalized.forEach((group, gIdx) => {
    const main = {
      ...group.mainProduct,
      storeName: group.mainProduct.storeName || group.storeName || '',
      workRequirement: group.workRequirement || group.mainProduct.workRequirement || '',
      orderNote: group.orderNote || group.mainProduct.orderNote || '',
      orderDate: group.orderDate || group.mainProduct.orderDate || '',
      role: 'main',
      groupId: group.id,
      groupName: group.name || `组 ${gIdx + 1}`,
      groupIndex: gIdx + 1,
      itemIndexInGroup: 1
    };
    rows.push(main);

    (group.subProducts || []).forEach((sub, sIdx) => {
      const subItem = {
        ...sub,
        storeName: sub.storeName || group.storeName || '',
        workRequirement: group.workRequirement || sub.workRequirement || '',
        orderNote: group.orderNote || sub.orderNote || '',
        orderDate: group.orderDate || sub.orderDate || '',
        role: 'sub',
        groupId: group.id,
        groupName: group.name || `组 ${gIdx + 1}`,
        groupIndex: gIdx + 1,
        itemIndexInGroup: sIdx + 2
      };
      rows.push(subItem);
    });
  });

  return rows;
}

module.exports = {
  getProductKey,
  normalizeOrderProduct,
  autoGroupOrderProducts,
  rowsToOrderGroups,
  validateOrderGroups,
  assertValidOrderGroups,
  normalizeOrderGroups,
  flattenOrderGroups
};
