export const AUTO_LOWEST_SKU = '__auto_lowest__';

/** Return available SKU options sorted by price. */
export function availableSkuOptions(item = {}) {
  return (Array.isArray(item.skuOptions) ? item.skuOptions : [])
    .filter(option => option?.available !== false && Number(option?.price) > 0)
    .sort((left, right) => Number(left.price) - Number(right.price));
}

/** Return the select control value for an item SKU choice. */
export function skuSelectionValue(item = {}) {
  return item.skuSelectionMode === 'manual' && item.selectedSkuId
    ? String(item.selectedSkuId)
    : AUTO_LOWEST_SKU;
}

/** Build the item patch produced by an automatic or manual SKU choice. */
export function applySkuSelection(item = {}, value = AUTO_LOWEST_SKU) {
  const options = availableSkuOptions(item);
  const lowest = options[0] || null;
  const selected = value === AUTO_LOWEST_SKU
    ? lowest
    : (options.find(option => String(option.skuId) === String(value)) || lowest);
  if (!selected) return {};
  return {
    selectedSkuId: String(selected.skuId || ''),
    selectedSkuName: String(selected.name || ''),
    selectedSkuPrice: Number(selected.price),
    lowestSkuId: String(lowest?.skuId || ''),
    lowestSkuName: String(lowest?.name || ''),
    lowestSkuPrice: Number(lowest?.price || selected.price),
    skuSelectionMode: value === AUTO_LOWEST_SKU ? 'lowest' : 'manual',
    orderAmount: Number(selected.price),
    ...(selected.imageUrl ? { imageUrl: selected.imageUrl } : {})
  };
}

/** Format one SKU option for the confirmation dropdown. */
export function skuOptionLabel(option = {}) {
  const price = Number(option.price);
  const amount = Number.isFinite(price) ? `¥${price.toFixed(2)}` : '价格未知';
  const stock = Number.isFinite(Number(option.quantity)) ? ` · 库存 ${Number(option.quantity)}` : '';
  return `${option.name || `SKU ${option.skuId || ''}`} · ${amount}${stock}`;
}
