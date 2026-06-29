# Workflow Product Card Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the workflow canvas 1688 product preview so images have robust fallbacks, summary cards are readable, and product cards open a detail drawer without breaking node configuration.

**Architecture:** Keep the first implementation scoped to `apps/web/src/App.jsx` and `apps/web/src/App.css`. Add Web UI normalization helpers and small presentational components near the existing custom node definitions. Pass an `onOpenProduct` callback through node data so React Flow nodes can open an app-level detail drawer while node clicks still select/configure nodes.

**Tech Stack:** React 19, React Flow `@xyflow/react`, lucide-react icons, existing CSS/Tailwind-like utility classes, Vite build verification.

---

## Source Spec

Design doc: `docs/superpowers/specs/2026-06-29-workflow-product-card-detail-design.md`

## File Map

- Modify: `apps/web/src/App.jsx`
  - Import extra lucide icons.
  - Add `normalizeProduct`, formatting helpers, `ProductImage`, `ProductSummaryCard`, `ProductDetailDrawer`.
  - Replace the current `1688推荐货源` preview in `TitleGeneratorNode`.
  - Add app-level `selectedProduct` state and drawer close/open handlers.
  - Inject `onOpenProduct` into node data before passing nodes to `ReactFlow`.
- Modify: `apps/web/src/App.css`
  - Add utility styles for two-line clamp, product thumbnail placeholder, product drawer, and small card polish.

Do not modify backend payload shape in this pass.

---

## Task 1: Add Product Normalization And Image Components

**Files:**
- Modify: `apps/web/src/App.jsx`
- Modify: `apps/web/src/App.css`

- [ ] **Step 1: Add imports**

In `apps/web/src/App.jsx`, extend the lucide import:

```diff
 import {
   Play,
   Square,
   RefreshCw,
   Plus,
   Trash2,
   FileText,
   Clock,
   Sparkles,
   Settings,
   Layers,
   ChevronRight,
   Database,
   ExternalLink,
-  Tag
+  Tag,
+  ImageOff,
+  X,
+  Copy,
+  ShoppingBag
 } from 'lucide-react';
```

- [ ] **Step 2: Add normalization helpers above `InputNode`**

Insert this block after `// ==================== Custom Flow Nodes ====================`:

```jsx
const EMPTY_VALUE = '-';

function firstNonEmpty(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') || '';
}

function normalizeProduct(product) {
  const images = Array.isArray(product?.images) ? product.images : [];
  const productUrl = firstNonEmpty(product?.产品链接, product?.link, product?.productUrl, product?.url1688);

  return {
    original: product || {},
    id: firstNonEmpty(product?.id, product?.offerId, product?.productId, productUrl),
    title: firstNonEmpty(product?.链接原标题, product?.title, product?.subject, product?.name, '未命名货源'),
    generatedTitle: firstNonEmpty(product?.铺货标题, product?.generatedTitle),
    imageUrl: firstNonEmpty(product?.主图链接, product?.imageUrl, product?.url, images[0], product?.image),
    productUrl,
    price: firstNonEmpty(product?.商品原价, product?.price),
    sales: firstNonEmpty(product?.['30天销量'], product?.sales, product?.last30DaysSales),
    goodRate: firstNonEmpty(product?.好评率, product?.goodRate, product?.goodRates),
    repurchaseRate: firstNonEmpty(product?.复购率, product?.repurchaseRate),
    blueOceanWord: firstNonEmpty(product?.蓝海词, product?.blueOceanWord),
    reason: firstNonEmpty(product?.选品理由, product?.reason),
    pricingAdvice: firstNonEmpty(product?.定价建议, product?.pricingAdvice),
    risk: firstNonEmpty(product?.风险提示, product?.risk)
  };
}

function displayValue(value) {
  return value === undefined || value === null || String(value).trim() === '' ? EMPTY_VALUE : String(value);
}
```

- [ ] **Step 3: Add `ProductImage` below the helpers**

Insert this component below `displayValue`:

```jsx
function ProductImage({ src, alt, size = 'summary' }) {
  const [failed, setFailed] = useState(false);
  const className = size === 'detail' ? 'product-image-detail' : 'product-image-summary';

  if (!src || failed) {
    return (
      <div className={`${className} product-image-placeholder`} aria-label="商品图片缺失">
        <ImageOff size={size === 'detail' ? 28 : 18} />
        <span>{size === 'detail' ? '暂无商品图' : '无图'}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      className={className}
      alt={alt || '商品图片'}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
```

- [ ] **Step 4: Add image CSS**

Append this CSS to `apps/web/src/App.css`:

```css
.product-image-summary,
.product-image-detail {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
  border: 1px solid #1e293b;
  background: #020617;
  object-fit: cover;
}

.product-image-summary {
  width: 56px;
  height: 56px;
  border-radius: 8px;
}

.product-image-detail {
  width: 112px;
  height: 112px;
  border-radius: 10px;
}

.product-image-placeholder {
  color: #64748b;
  flex-direction: column;
  gap: 4px;
  font-size: 10px;
  line-height: 1;
}
```

- [ ] **Step 5: Run Web build**

Run:

```bash
npm run web:build
```

Expected: Vite build exits `0`.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/web/src/App.jsx apps/web/src/App.css
git commit -m "feat: add workflow product image normalization"
```

---

## Task 2: Replace The Inline 1688 Preview With A Clickable Summary Card

**Files:**
- Modify: `apps/web/src/App.jsx`
- Modify: `apps/web/src/App.css`

- [ ] **Step 1: Add `ProductSummaryCard` below `ProductImage`**

Insert:

```jsx
function ProductSummaryCard({ product, onOpen }) {
  const normalized = normalizeProduct(product);

  const handleOpen = (event) => {
    event.stopPropagation();
    if (typeof onOpen === 'function') onOpen(normalized);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleOpen(event);
    }
  };

  return (
    <button
      type="button"
      className="product-summary-card"
      onClick={handleOpen}
      onKeyDown={handleKeyDown}
      aria-label={`查看1688货源详情：${normalized.title}`}
    >
      <div className="flex gap-2">
        <ProductImage src={normalized.imageUrl} alt={normalized.title} />
        <div className="flex-1 min-w-0 text-left">
          <div className="product-title-clamp text-[11px] font-semibold text-slate-200 leading-snug">
            {normalized.title}
          </div>
          <div className="mt-1 grid grid-cols-3 gap-1 text-[10px] text-slate-400">
            <span className="truncate">¥{displayValue(normalized.price)}</span>
            <span className="truncate">销 {displayValue(normalized.sales)}</span>
            <span className="truncate">好评 {displayValue(normalized.goodRate)}</span>
          </div>
        </div>
      </div>
      <div className="mt-2 border-t border-slate-800/70 pt-2 text-left">
        <div className="product-reason-clamp text-[10px] leading-relaxed text-slate-400">
          <span className="text-emerald-400 font-bold">推荐理由：</span>
          {displayValue(normalized.reason)}
        </div>
        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] font-bold text-emerald-300">
          查看详情 <ChevronRight size={11} />
        </div>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Replace the current product block in `TitleGeneratorNode`**

Replace the entire current block that starts with:

```jsx
{product && (
  <div className="bg-slate-950 p-2 rounded border border-slate-800 text-[11px] space-y-1">
```

and ends at its matching `</div>` with:

```jsx
{product && (
  <div className="bg-slate-950 p-2 rounded border border-slate-800 text-[11px]">
    <div className="font-semibold text-emerald-300 mb-2 flex items-center gap-1">
      <ShoppingBag size={11} /> 1688推荐货源:
    </div>
    <ProductSummaryCard product={product} onOpen={data.onOpenProduct} />
  </div>
)}
```

- [ ] **Step 3: Add summary card CSS**

Append:

```css
.product-summary-card {
  width: 100%;
  display: block;
  padding: 8px;
  border: 1px solid #1e293b;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.72);
  color: inherit;
  cursor: pointer;
  transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
}

.product-summary-card:hover {
  border-color: rgba(16, 185, 129, 0.65);
  background: rgba(15, 23, 42, 0.95);
  transform: translateY(-1px);
}

.product-summary-card:focus-visible {
  outline: 2px solid rgba(16, 185, 129, 0.85);
  outline-offset: 2px;
}

.product-title-clamp,
.product-reason-clamp {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.product-title-clamp {
  -webkit-line-clamp: 2;
}

.product-reason-clamp {
  -webkit-line-clamp: 2;
}
```

- [ ] **Step 4: Run Web build**

Run:

```bash
npm run web:build
```

Expected: Vite build exits `0`.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/web/src/App.jsx apps/web/src/App.css
git commit -m "feat: improve workflow product summary card"
```

---

## Task 3: Add Product Detail Drawer

**Files:**
- Modify: `apps/web/src/App.jsx`
- Modify: `apps/web/src/App.css`

- [ ] **Step 1: Add `DetailMetric` and `ProductDetailDrawer` below `ProductSummaryCard`**

Insert:

```jsx
function DetailMetric({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{label}</div>
      <div className="mt-1 text-xs font-semibold text-slate-200 break-words">{displayValue(value)}</div>
    </div>
  );
}

function ProductDetailDrawer({ product, onClose }) {
  if (!product) return null;

  const copyText = async (text) => {
    if (!text || !navigator?.clipboard) return;
    await navigator.clipboard.writeText(text);
  };

  const stop = (event) => event.stopPropagation();

  return (
    <div className="product-detail-backdrop" onClick={onClose}>
      <aside className="product-detail-drawer" onClick={stop} aria-label="1688货源详情">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold">1688 Product Detail</div>
            <h2 className="mt-1 text-sm font-bold text-slate-100">推荐货源详情</h2>
          </div>
          <button
            type="button"
            className="rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-300 hover:border-slate-500 hover:text-white"
            onClick={onClose}
            aria-label="关闭货源详情"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="flex gap-4">
            <ProductImage src={product.imageUrl} alt={product.title} size="detail" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-relaxed text-slate-100">{product.title}</div>
              {product.generatedTitle && (
                <div className="mt-3 rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-3">
                  <div className="text-[10px] font-bold text-emerald-400 mb-1">铺货标题</div>
                  <div className="text-xs leading-relaxed text-slate-200">{product.generatedTitle}</div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!product.productUrl}
              onClick={() => product.productUrl && window.open(product.productUrl, '_blank', 'noopener,noreferrer')}
              className="product-detail-action"
            >
              <ExternalLink size={13} /> 打开1688
            </button>
            <button
              type="button"
              disabled={!product.productUrl}
              onClick={() => copyText(product.productUrl)}
              className="product-detail-action"
            >
              <Copy size={13} /> 复制链接
            </button>
            <button
              type="button"
              disabled={!product.generatedTitle}
              onClick={() => copyText(product.generatedTitle)}
              className="product-detail-action col-span-2"
            >
              <Copy size={13} /> 复制铺货标题
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <DetailMetric label="商品原价" value={product.price ? `¥${product.price}` : ''} />
            <DetailMetric label="30天销量" value={product.sales} />
            <DetailMetric label="好评率" value={product.goodRate} />
            <DetailMetric label="复购率" value={product.repurchaseRate} />
            <DetailMetric label="蓝海词" value={product.blueOceanWord} />
            <DetailMetric label="货源ID" value={product.id} />
          </div>

          <div className="space-y-3">
            <DetailText title="选品理由" value={product.reason} />
            <DetailText title="定价建议" value={product.pricingAdvice} />
            <DetailText title="风险提示" value={product.risk} tone="risk" />
          </div>
        </div>
      </aside>
    </div>
  );
}

function DetailText({ title, value, tone = 'default' }) {
  return (
    <section className={`rounded-lg border p-3 ${
      tone === 'risk'
        ? 'border-amber-900/60 bg-amber-950/10'
        : 'border-slate-800 bg-slate-950/50'
    }`}>
      <div className={`text-[10px] font-bold mb-1 ${
        tone === 'risk' ? 'text-amber-300' : 'text-emerald-400'
      }`}>
        {title}
      </div>
      <div className="text-xs leading-relaxed text-slate-300">{displayValue(value)}</div>
    </section>
  );
}
```

- [ ] **Step 2: Add drawer CSS**

Append:

```css
.product-detail-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  justify-content: flex-end;
  background: rgba(2, 6, 23, 0.45);
  backdrop-filter: blur(3px);
}

.product-detail-drawer {
  width: min(420px, 100vw);
  height: 100%;
  display: flex;
  flex-direction: column;
  border-left: 1px solid #1e293b;
  background: #0f172a;
  box-shadow: -24px 0 60px rgba(0, 0, 0, 0.35);
}

.product-detail-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  border: 1px solid #334155;
  border-radius: 8px;
  background: #020617;
  color: #cbd5e1;
  font-size: 12px;
  font-weight: 700;
  transition: border-color 160ms ease, color 160ms ease, background 160ms ease;
}

.product-detail-action:hover:not(:disabled) {
  border-color: rgba(16, 185, 129, 0.75);
  color: #f8fafc;
  background: rgba(15, 23, 42, 0.95);
}

.product-detail-action:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
```

- [ ] **Step 3: Add app-level drawer state**

Inside `App()`, near existing state declarations, add:

```jsx
const [selectedProduct, setSelectedProduct] = useState(null);
```

Add handlers near `onNodeClick`:

```jsx
const handleOpenProduct = useCallback((product) => {
  setSelectedProduct(product);
}, []);

const handleCloseProduct = useCallback(() => {
  setSelectedProduct(null);
}, []);
```

- [ ] **Step 4: Run Web build**

Run:

```bash
npm run web:build
```

Expected: Vite build exits `0`.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/web/src/App.jsx apps/web/src/App.css
git commit -m "feat: add workflow product detail drawer"
```

---

## Task 4: Wire Product Card Clicks Through React Flow Node Data

**Files:**
- Modify: `apps/web/src/App.jsx`

- [ ] **Step 1: Create `displayNodes` before the return**

Inside `App()`, after `selectedNode` is computed, add:

```jsx
const displayNodes = useMemo(() => {
  return nodes.map((node) => {
    if (node.type !== 'title-generator') return node;
    return {
      ...node,
      data: {
        ...node.data,
        onOpenProduct: handleOpenProduct
      }
    };
  });
}, [nodes, handleOpenProduct]);
```

- [ ] **Step 2: Use `displayNodes` in `ReactFlow`**

Change:

```jsx
<ReactFlow
  nodes={nodes}
```

to:

```jsx
<ReactFlow
  nodes={displayNodes}
```

- [ ] **Step 3: Render the drawer**

Render this near the end of the main root `<div>`, after the right property panel and before the outer closing `</div>`:

```jsx
<ProductDetailDrawer product={selectedProduct} onClose={handleCloseProduct} />
```

- [ ] **Step 4: Run Web build**

Run:

```bash
npm run web:build
```

Expected: Vite build exits `0`.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/web/src/App.jsx
git commit -m "feat: wire workflow product detail interactions"
```

---

## Task 5: Final Verification And Push

**Files:**
- No new source edits expected.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run test:all
```

Expected:

```text
ℹ fail 0
✓ built
```

The command must exit `0`.

- [ ] **Step 2: Optional manual browser check**

Run:

```bash
npm run ui:react
```

Open:

```text
http://localhost:3000/workflow/
```

Expected:

- The title-generator node shows a stable 1688 product card.
- Broken or missing images show a placeholder.
- Clicking the product card opens the detail drawer.
- Clicking node background still selects the node and shows the right configuration panel.

- [ ] **Step 3: Push**

Run:

```bash
git status --short --branch
git push origin master
```

Expected after push:

```text
## master...origin/master
```

---

## Acceptance Criteria

- 1688 product image does not render as a broken browser image.
- Supported image fields are `主图链接`, `imageUrl`, `url`, `images[0]`, and `image`.
- Product preview card has a stable thumbnail area, compact metrics, and readable recommendation reason.
- Product card opens a detail drawer/modal.
- Drawer shows product title, generated title, image, link actions, metrics, selection reason, pricing advice, and risk note.
- Node selection and right configuration panel still work.
- `npm run web:build` passes.
- `npm run test:all` passes.

