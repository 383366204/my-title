# image_search 返回格式探查报告

**研究日期:** 2026-04-22  
**任务:** Wave 1 - Task 1  
**环境:** WSL2 + Windows (淘宝桌面版 CLI 存在但无法启动图形界面)

---

## 1. 探查结果

### 1.1 无法实际调用原因

```
taobao-native CLI 位于: /mnt/c/Users/38336/AppData/Local/Programs/taobao/bin/taobao-native
CLI 工具存在，但 WSL2 中无法启动淘宝桌面版图形界面
```

SKILL.md 明确说明：
> **【调用前准备】** 在调用本工具之前，需要先获取图片地址，推荐方式：
> 1. 从系统剪切板获取图片
> 2. 获取图片本地路径

由于无法启动桌面版，无法获取图片和执行实际调用。

---

## 2. image_search 返回格式推断

### 2.1 官方文档描述（SKILL.md 第 208 行）

```
【返回数据】工具会依次点击页面上的每个图片分类小卡，获取每个分类下的商品列表。
返回数据包含：categoryCount（分类数量）、totalProducts（总商品数）、
categories（分类数组，每个分类包含imageAlt图片说明、products商品列表）
```

### 2.2 推断的 JSON 结构

```json
{
  "success": true,
  "categoryCount": 3,
  "totalProducts": 45,
  "categories": [
    {
      "imageAlt": "白色T恤",
      "products": [
        {
          "title": "2026新款纯棉白色T恤女宽松休闲",
          "price": "59.00",
          "originalPrice": "89.00",
          "sales": "1234",
          "imageUrl": "https://img.alicdn.com/...",
          "itemId": "1234567890",
          "shopName": "某某旗舰店",
          "shopId": "123456"
        }
      ]
    },
    {
      "imageAlt": "黑色T恤",
      "products": [
        {
          "title": "黑色纯棉T恤男款简约百搭",
          "price": "45.00",
          "sales": "856",
          "imageUrl": "https://img.alicdn.com/..."
        }
      ]
    }
  ]
}
```

### 2.3 字段说明表

| 字段 | 类型 | 说明 | 来源依据 |
|------|------|------|----------|
| `success` | boolean | 调用是否成功 | 所有工具通用的返回结构 |
| `categoryCount` | number | 图片分类数量（分类小卡数量） | SKILL.md 明确说明 |
| `totalProducts` | number | 所有分类的商品总数 | SKILL.md 明确说明 |
| `categories` | array | 分类数组，每个分类包含一组商品 | SKILL.md 明确说明 |
| `categories[].imageAlt` | string | 图片分类的说明文字（如"白色T恤"） | SKILL.md 明确说明 |
| `categories[].products` | array | 该分类下的商品列表 | SKILL.md 明确说明 |
| `products[].title` | string | 商品标题 | 参考 search_products 格式 |
| `products[].price` | string | 商品价格（元） | 参考 search_products 格式 |
| `products[].originalPrice` | string | 原价（可能有划线价） | 参考同类电商 API |
| `products[].sales` | string | 销量 | 参考 search_products 格式 |
| `products[].imageUrl` | string | 商品主图 URL | 参考 search_products 格式 |
| `products[].itemId` | string | 商品 ID | 参考 search_products 格式 |
| `products[].shopName` | string | 店铺名称 | 参考同类电商 API |
| `products[].shopId` | string | 店铺 ID | 参考同类电商 API |

---

## 3. 与 search_products 返回格式的对比

| 特征 | search_products | image_search（推断） |
|------|----------------|---------------------|
| 返回结构 | `{ result: { products: [...] } }` | `{ success, categoryCount, totalProducts, categories: [...] }` |
| 商品组织 | 扁平商品列表 | **按图片分类分组** |
| 分类信息 | 无 | 有 `imageAlt` 说明每个分类 |
| 商品字段 | title, price, sales, imageUrl | 预计相同 + 可能额外字段 |

**关键差异：** `image_search` 返回的是**嵌套结构**（按图片分类分组），而 `search_products` 是扁平列表。

---

## 4. 对 Task 3 解析代码的建议

### 4.1 解析逻辑

```javascript
// 伪代码示例
function parseImageSearchResult(response) {
  const { success, categoryCount, totalProducts, categories } = response;
  
  if (!success) {
    throw new Error('image_search 调用失败');
  }
  
  // 扁平化所有分类下的商品
  const allProducts = categories.flatMap(category => {
    return category.products.map(product => ({
      ...product,
      // 保留分类信息可能有用
      categoryLabel: category.imageAlt
    }));
  });
  
  return allProducts;
}
```

### 4.2 注意事项

1. **嵌套结构处理**：需要 `flatMap` 展平所有分类下的商品
2. **分类标签保留**：建议保留 `imageAlt` 作为商品的 `categoryLabel` 属性，用于后续分析
3. **空分类处理**：某些分类可能 `products` 为空数组，需做防护
4. **结果限制**：通过 `totalProducts` 了解规模，但实际使用时可像 `search_products` 一样用 `slice(0, maxResults)` 限制数量

### 4.3 建议的解析函数签名

```javascript
/**
 * 解析 image_search 返回结果，扁平化所有商品
 * @param {Object} response - image_search API 返回的完整 JSON
 * @param {number} maxResults - 最多返回商品数量（默认 20）
 * @returns {Array} 扁平化的商品列表
 */
function flattenImageSearchProducts(response, maxResults = 20) {
  // 实现...
}
```

---

## 5. 调用示例

### 5.1 正确的调用格式

```bash
# 方式 1：使用本地图片路径
taobao-native image_search --args '{"imagePath":"/tmp/product.jpg","sourceApp":"my-title"}'

# 方式 2：使用 CDN 地址
taobao-native image_search --args '{"imagePath":"https://example.com/image.jpg","sourceApp":"my-title"}'

# 方式 3：使用 base64
taobao-native image_search --args '{"imagePath":"data:image/png;base64,iVBORw0...","sourceApp":"my-title"}'
```

### 5.2 sourceApp 参数说明

- **必填**：所有工具调用都必须传入 `sourceApp` 参数
- **作用**：标识调用来源的 AI 应用名称
- **建议值**：`"my-title"` 或 `"Qcoderwork"`

---

## 6. 降级策略

如果无法获取图片或 `image_search` 调用失败，SKILL.md 建议：

> **降级策略**：如果无法获取图片（无权限、本地找不到、剪切板无图片），则改用 `search_products` 进行文字搜索。

这意味着 Task 3 需要实现双轨策略：
1. 优先尝试 `image_search`（如果用户提供了图片）
2. 降级到 `search_products`（如果无法使用图片）

---

## 7. 结论

- **image_search 返回格式**：嵌套结构，按图片分类分组，每个分类包含 `imageAlt` 说明和 `products` 商品列表
- **关键字段**：categoryCount, totalProducts, categories[].imageAlt, categories[].products
- **解析要点**：需要展平嵌套结构，提取所有商品

---

**参考来源**：
- SKILL.md 第 208 行（image_search 工具定义）
- SKILL.md 第 137-140 行（`-o` 参数说明）
- search-taobao.js 第 104-113 行（search_products 返回格式参考）
