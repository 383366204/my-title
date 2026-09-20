/**
 * 将货源商品与查询失败记录分开，失败记录不能成为可勾选商品。
 * @param {object[]} records 节点原始记录。
 * @returns {{products: object[], failures: object[]}} 展示数据。
 */
export function productSelectionView(records = []) {
  const products = [], failures = [];
  for (const row of records) {
    const product = row.product || row;
    const url = row.url || row.productUrl || product['产品链接'] || product.detailUrl || product.productUrl || product.url || '';
    if (['select_failed', 'enrich_failed'].includes(row.status) || !/^https?:\/\/detail\.1688\.com\/offer\/\d+\.html(?:[?#]|$)/i.test(url)) {
      const error = row.error || row.enrichError || '记录缺少有效的 1688 商品链接';
      failures.push({ ...row, error: /status code 502/i.test(error) ? '上游接口返回 HTTP 502，未取得商品资料。请稍后重试货源查询。' : error });
      continue;
    }
    products.push({ ...row, url,
      sourceTitle: row.sourceTitle || row.title || product['链接原标题'] || product.title || product.subject || product.name || '商品标题未读取',
      recommendedCategory: row.recommendedCategory || product['铺货类目'] || product['推荐类目'] || product['类目'] || product.category || product.categoryListName || product.categoryName || product.stats?.categoryListName || product.stats?.categoryName || ''
    });
  }
  return { products, failures };
}
