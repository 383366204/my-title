# Workflow Product Card Detail Design

## Goal

Fix the 1688 recommended product preview in the workflow canvas so product images render reliably, the card layout is readable, and users can click cards to inspect product details without losing node configuration behavior.

## Current Problem

The title-generator node preview in `apps/web/src/App.jsx` currently renders only the first product from `result.products?.[0]`. The product image reads only `product.主图链接`, so products shaped with `imageUrl`, `url`, `images[0]`, or `image` show a broken or missing image. The preview also compresses title, price, sales, and recommendation reason into a small block, which makes the card feel crowded. Finally, node selection already drives the right property panel, but result/product cards inside a node do not have their own details interaction.

## Recommended Approach

Use a two-layer interaction model:

- **Node click:** selects the workflow node and keeps the existing right-side configuration panel behavior.
- **Product card click:** opens a product detail drawer or modal with full product data.

The node preview should stay compact and stable. The detail drawer should carry the heavier information: original title, generated title, 1688 URL, image, price, sales, good rate, repurchase rate, blue-ocean word, selection reason, pricing advice, and risk notes.

This keeps the canvas scannable while still making the product result inspectable.

## UI Design

### Product Summary Card

Inside the title-generator node, replace the current small `1688推荐货源` block with a summary card:

- 56x56 or 64x64 thumbnail on the left.
- Two-line product title on the right.
- A compact metrics row: `¥价格`, `销量`, `好评率`.
- A one-line or two-line recommendation reason below.
- A visible affordance such as `查看详情` or a small chevron icon.
- `cursor-pointer`, hover border, and focus-visible styles.

The card must keep stable dimensions whether the image loads or fails. Missing images should show a neutral placeholder with an icon or `无图` label, not a broken browser image.

### Detail Drawer

Add a detail surface that opens from clicking a product card:

- Preferred: right-side drawer overlaying or sitting above the existing property panel.
- Acceptable fallback: centered modal if drawer styling becomes too invasive.

The drawer content:

- Thumbnail or placeholder.
- Product title from normalized original title.
- Generated distribution title.
- Buttons:
  - `打开1688`
  - `复制链接`
  - `复制铺货标题`
- Metrics:
  - 商品原价
  - 30天销量
  - 好评率
  - 复购率
  - 蓝海词
- Text sections:
  - 选品理由
  - 定价建议
  - 风险提示

Closing the drawer should not clear the selected workflow node.

### Node Configuration Panel

Keep the current right-side property panel for node configuration. Clicking the node body should still select the node. Clicking an inner product card must call `event.stopPropagation()` so it opens product details instead of only selecting/reselecting the node.

## Data Normalization

Add a local product-normalization helper in the Web UI layer. Do not spread field guessing across JSX.

Suggested helper signature:

```js
function normalizeProduct(product) {
  const images = Array.isArray(product?.images) ? product.images : [];
  return {
    original: product || {},
    id: product?.id || product?.offerId || product?.productId || product?.产品链接 || '',
    title: product?.链接原标题 || product?.title || product?.subject || product?.name || '未命名货源',
    generatedTitle: product?.铺货标题 || '',
    imageUrl: product?.主图链接 || product?.imageUrl || product?.url || images[0] || product?.image || '',
    productUrl: product?.产品链接 || product?.link || product?.productUrl || '',
    price: product?.商品原价 || product?.price || '',
    sales: product?.['30天销量'] || product?.sales || product?.last30DaysSales || '',
    goodRate: product?.好评率 || product?.goodRate || product?.goodRates || '',
    repurchaseRate: product?.复购率 || product?.repurchaseRate || '',
    blueOceanWord: product?.蓝海词 || '',
    reason: product?.选品理由 || '',
    pricingAdvice: product?.定价建议 || '',
    risk: product?.风险提示 || ''
  };
}
```

If percentage metrics arrive as decimals, the UI can display the raw value in the first pass. Formatting can be improved later if needed.

## Component Boundaries

Keep the change scoped to `apps/web/src/App.jsx` and `apps/web/src/App.css` unless the file becomes too large to manage.

Suggested components inside `App.jsx` for the first pass:

- `normalizeProduct(product)`
- `ProductImage({ src, alt })`
- `ProductSummaryCard({ product, onOpen })`
- `ProductDetailDrawer({ product, onClose })`

If implementation makes `App.jsx` noticeably harder to read, split these into `apps/web/src/components/ProductResult.jsx` and import them from `App.jsx`.

## Error Handling

- Missing image URL: render placeholder.
- Image load failure: switch to placeholder via `onError`.
- Missing product URL: disable `打开1688` and `复制链接`.
- Missing product fields: show `-` rather than empty layout gaps.
- Click inside drawer must not trigger React Flow node selection.

## Accessibility

- Product card should be reachable by keyboard.
- `Enter` and `Space` should open detail drawer.
- Drawer close button should have an accessible label.
- Product image alt should use the product title.

## Testing And Verification

Automated checks:

```bash
npm run web:build
npm run test:all
```

Manual visual checks:

1. Run `npm run ui:react`.
2. Open `http://localhost:3000/workflow/`.
3. Run the title-generation workflow.
4. Confirm the 1688 product thumbnail renders when any supported image field is present.
5. Force or simulate a bad image URL and confirm the placeholder appears without layout shift.
6. Click the product card and confirm a detail drawer/modal opens.
7. Confirm the selected node property panel behavior still works.
8. Confirm detail buttons handle missing links gracefully.

## Antigravity Handoff

Recommended implementation order:

1. Add product normalization and image fallback helper.
2. Replace the title-generator product preview with `ProductSummaryCard`.
3. Add detail drawer state at the workflow app level.
4. Wire product card click to open drawer while preserving node selection.
5. Add CSS polish for thumbnail, placeholder, hover, drawer, and compact metrics.
6. Run build and full verification.

Do not change backend product payloads for this pass. The Web UI should adapt to the existing shapes already returned by title generation and workflow demo data.

