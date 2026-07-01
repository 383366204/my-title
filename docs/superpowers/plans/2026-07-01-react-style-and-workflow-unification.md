# React Style And Workflow Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the React web UI visually consistent with the original native web UI and connect dashboard, keyword mining, title generation, review, and history into one business workflow.

**Architecture:** Keep React as the only main frontend. Restore the native web visual language through shared CSS tokens and focused React components, then lift workflow state into `App.jsx` so cross-tab actions do not feel disconnected. Keep `WorkflowStudio.jsx` as a hidden developer/debug surface instead of a daily user page.

**Tech Stack:** React, Vite, plain CSS, existing Express APIs in `bin/server.js`, existing browser IndexedDB history store concepts from `web/js/storage/*`.

---

## File Structure

- Modify `apps/web/src/App.css`: restore original visual tokens, glass cards, buttons, sidebar, forms, tables, product cards, and responsive rules.
- Modify `apps/web/src/App.jsx`: add workflow funnel, simplify navigation, persist cross-tab workflow context, pass richer candidate context from mining to title generation, and expose review actions.
- Create `apps/web/src/workflow-ui.js`: pure helpers for stage mapping, action labels, source candidate normalization, and review product shaping.
- Create `apps/web/src/workflow-ui.test.mjs`: node-test coverage for workflow UI helpers.
- Create `apps/web/src/use-session-state.js`: small sessionStorage-backed state hook for tab switching persistence.
- Create `apps/web/src/history-service.js`: ESM browser history helper adapted from `web/js/storage/history-service.js`.
- Create `apps/web/src/indexeddb-history-store.js`: ESM IndexedDB implementation adapted from `web/js/storage/indexeddb-history-store.js`.
- Modify `apps/web/src/WorkflowStudio.jsx`: make developer/debug use explicit and remove old “open legacy” affordance from the main workflow.
- Modify `docs/superpowers/plans/2026-07-01-react-unified-web-migration.md`: append the follow-up decision that styling and workflow closure are part of the React migration.

## Task 1: Workflow UI Helper Tests

**Files:**
- Create: `apps/web/src/workflow-ui.js`
- Create: `apps/web/src/workflow-ui.test.mjs`

- [ ] **Step 1: Add failing tests for stage mapping and review shaping**

Create `apps/web/src/workflow-ui.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mapPipelineStageToFunnel,
  getWorkflowAction,
  normalizeCandidateForTitle,
  buildReviewProduct
} from './workflow-ui.js';

test('mapPipelineStageToFunnel maps backend stages to five business stages', () => {
  assert.equal(mapPipelineStageToFunnel('seed'), 'candidate');
  assert.equal(mapPipelineStageToFunnel('mined'), 'candidate');
  assert.equal(mapPipelineStageToFunnel('verified'), 'verified');
  assert.equal(mapPipelineStageToFunnel('generated'), 'generated');
  assert.equal(mapPipelineStageToFunnel('review'), 'pending_review');
  assert.equal(mapPipelineStageToFunnel('ready'), 'pending_review');
  assert.equal(mapPipelineStageToFunnel('submitted'), 'submitted');
  assert.equal(mapPipelineStageToFunnel('unknown'), 'candidate');
});

test('getWorkflowAction recommends the next business action', () => {
  assert.deepEqual(getWorkflowAction({ stage: 'mined', requiresUserAction: true }), {
    label: '去挖词确认',
    targetTab: 'mine',
    tone: 'warn'
  });
  assert.deepEqual(getWorkflowAction({ stage: 'generated', requiresUserAction: false }), {
    label: '查看标题货源',
    targetTab: 'title',
    tone: 'default'
  });
  assert.deepEqual(getWorkflowAction({ stage: 'ready', requiresUserAction: true }), {
    label: '处理待复核',
    targetTab: 'dashboard',
    tone: 'warn'
  });
});

test('normalizeCandidateForTitle carries mining metrics into title context', () => {
  const candidate = normalizeCandidateForTitle({
    keyword: '纯银项链女',
    localScore: 82,
    source: 'sycm_blue',
    canDistribute: true,
    gateStatus: 'verified',
    gateReason: '搜索人气和供需比通过',
    sycmData: { searchPopularity: 2300, demandSupplyRatio: 1.8 }
  });

  assert.equal(candidate.keyword, '纯银项链女');
  assert.equal(candidate.canDistribute, true);
  assert.equal(candidate.market.searchPopularity, 2300);
  assert.equal(candidate.score, 82);
  assert.equal(candidate.source, 'sycm_blue');
});

test('buildReviewProduct preserves title, source product, and safety fields', () => {
  const review = buildReviewProduct({
    keyword: '纯银项链女',
    product: {
      产品链接: 'https://detail.1688.com/offer/1.html',
      铺货标题: '纯银项链女小众设计感锁骨链',
      链接原标题: 'S925纯银项链',
      商品原价: '12.80'
    },
    candidate: { canDistribute: true, gateReason: '已验真' }
  });

  assert.equal(review.keyword, '纯银项链女');
  assert.equal(review.title, '纯银项链女小众设计感锁骨链');
  assert.equal(review.productUrl, 'https://detail.1688.com/offer/1.html');
  assert.equal(review.canDistribute, true);
  assert.equal(review.reason, '已验真');
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
```

Expected: FAIL because `apps/web/src/workflow-ui.js` does not exist.

- [ ] **Step 3: Implement pure workflow helpers**

Create `apps/web/src/workflow-ui.js`:

```js
export const BUSINESS_FUNNEL = [
  { id: 'candidate', label: '候选词' },
  { id: 'verified', label: '大盘验真' },
  { id: 'generated', label: '标题货源' },
  { id: 'pending_review', label: '待确认铺货' },
  { id: 'submitted', label: '已提交' }
];

export function mapPipelineStageToFunnel(stage) {
  const normalized = String(stage || '').toLowerCase();
  if (normalized === 'verified') return 'verified';
  if (normalized === 'generated') return 'generated';
  if (normalized === 'review' || normalized === 'ready') return 'pending_review';
  if (normalized === 'submitted') return 'submitted';
  return 'candidate';
}

export function getWorkflowAction(run = {}) {
  const stage = mapPipelineStageToFunnel(run.stage);
  const needsAction = Boolean(run.requiresUserAction || run.requiresReview || run.status === 'needs_review');
  if (stage === 'candidate') {
    return { label: needsAction ? '去挖词确认' : '继续挖词', targetTab: 'mine', tone: needsAction ? 'warn' : 'default' };
  }
  if (stage === 'verified') return { label: '生成标题货源', targetTab: 'title', tone: 'default' };
  if (stage === 'generated') return { label: '查看标题货源', targetTab: 'title', tone: needsAction ? 'warn' : 'default' };
  if (stage === 'pending_review') return { label: '处理待复核', targetTab: 'dashboard', tone: needsAction ? 'warn' : 'default' };
  return { label: '查看已提交', targetTab: 'dashboard', tone: 'default' };
}

export function normalizeCandidateForTitle(candidate = {}) {
  const sycmData = candidate.sycmData || candidate.marketMetrics || {};
  return {
    keyword: String(candidate.keyword || '').trim(),
    score: candidate.localScore ?? candidate.score ?? null,
    source: candidate.source || 'manual',
    gateStatus: candidate.gateStatus || (candidate.canDistribute ? 'verified' : 'candidate'),
    gateReason: candidate.gateReason || candidate.lastReason || '',
    canDistribute: Boolean(candidate.canDistribute),
    market: {
      searchPopularity: sycmData.searchPopularity ?? null,
      demandSupplyRatio: sycmData.demandSupplyRatio ?? null,
      clickRate: sycmData.clickRate ?? null,
      conversionRate: sycmData.conversionRate ?? null
    },
    raw: candidate
  };
}

export function buildReviewProduct({ keyword, product = {}, candidate = {} }) {
  return {
    id: `${keyword || candidate.keyword || ''}:${product['产品链接'] || product.productUrl || product['铺货标题'] || Date.now()}`,
    keyword: keyword || candidate.keyword || '',
    title: product['铺货标题'] || product.title || '',
    productTitle: product['链接原标题'] || product.productTitle || '',
    productUrl: product['产品链接'] || product.productUrl || '',
    imageUrl: product['主图链接'] || product.imageUrl || '',
    price: product['商品原价'] || product.price || '',
    canDistribute: Boolean(candidate.canDistribute),
    reason: candidate.gateReason || candidate.reason || ''
  };
}
```

- [ ] **Step 4: Run helper tests and commit**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
```

Expected: PASS.

Commit:

```bash
git add apps/web/src/workflow-ui.js apps/web/src/workflow-ui.test.mjs
git commit -m "test: add workflow ui helpers"
```

## Task 2: Restore Original Visual Language

**Files:**
- Modify: `apps/web/src/App.css`
- Modify: `apps/web/src/index.css`

- [ ] **Step 1: Add visual tokens and font baseline**

In `apps/web/src/App.css`, replace the current hard-coded React console palette by adding the old native visual tokens near the top:

```css
:root {
  --bg-primary: #0b0f19;
  --bg-secondary: #111827;
  --card-bg: rgba(31, 41, 55, 0.45);
  --card-border: rgba(255, 255, 255, 0.08);
  --text-primary: #f3f4f6;
  --text-secondary: #9ca3af;
  --accent-purple: #8b5cf6;
  --accent-purple-glow: rgba(139, 92, 246, 0.25);
  --accent-blue: #3b82f6;
  --accent-blue-glow: rgba(59, 130, 246, 0.25);
  --accent-green: #10b981;
  --accent-green-glow: rgba(16, 185, 129, 0.25);
  --accent-red: #ef4444;
  --accent-red-glow: rgba(239, 68, 68, 0.25);
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --font-display: 'Outfit', 'Inter', system-ui, sans-serif;
}
```

Update `body` in `apps/web/src/App.css`:

```css
body {
  margin: 0;
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  background-color: var(--bg-primary);
  background-image:
    radial-gradient(at 0% 0%, rgba(139, 92, 246, 0.15) 0px, transparent 50%),
    radial-gradient(at 100% 100%, rgba(59, 130, 246, 0.12) 0px, transparent 50%);
  color: var(--text-primary);
}
```

- [ ] **Step 2: Restyle the React shell to match old sidebar**

In `apps/web/src/App.css`, update these selectors:

```css
.app-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  background: transparent;
  color: var(--text-primary);
}

.app-sidebar {
  position: sticky;
  top: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--card-border);
  background: rgba(17, 24, 39, 0.8);
  backdrop-filter: blur(20px);
  padding: 24px 12px;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--accent-purple), var(--accent-blue));
  color: #fff;
  font-weight: 800;
  box-shadow: 0 8px 24px var(--accent-purple-glow);
}

.nav-button {
  justify-content: flex-start;
  width: 100%;
  min-height: 42px;
  padding: 11px 14px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
}

.nav-button-active {
  color: #fff;
  background: rgba(139, 92, 246, 0.15);
  border-color: rgba(139, 92, 246, 0.3);
  box-shadow: 0 4px 12px rgba(139, 92, 246, 0.1);
}
```

- [ ] **Step 3: Restyle cards, buttons, forms, and product cards**

In `apps/web/src/App.css`, replace current card/button primitives with:

```css
.metric-card,
.table-panel,
.launcher-panel,
.latest-run-panel,
.product-card {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 14px;
  backdrop-filter: blur(12px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.primary-button {
  border: 0;
  background: linear-gradient(135deg, var(--accent-purple), var(--accent-blue));
  color: #fff;
  box-shadow: 0 4px 14px rgba(139, 92, 246, 0.35);
}

.primary-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(139, 92, 246, 0.45);
}

.secondary-button,
.icon-button,
.legacy-link {
  border: 1px solid var(--card-border);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-secondary);
}

input,
select,
textarea {
  border: 1px solid var(--card-border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-primary);
}

input:focus,
select:focus,
textarea:focus {
  border-color: rgba(139, 92, 246, 0.45);
  box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.12);
}
```

- [ ] **Step 4: Run build and visual smoke**

Run:

```bash
npm run web:build
```

Expected: PASS.

Start server:

```bash
node bin/server.js
```

Open `http://127.0.0.1:<printed-port>/` and verify:

- Sidebar resembles old native sidebar.
- Cards use glass background, not solid slate panels.
- Primary buttons use purple-blue gradient.
- Text remains readable on dashboard, mining, and title pages.

Commit:

```bash
git add apps/web/src/App.css apps/web/src/index.css
git commit -m "style: restore native web visual language"
```

## Task 3: Replace Seven-Step Monitor With Five-Step Business Funnel

**Files:**
- Modify: `apps/web/src/App.jsx`
- Modify: `apps/web/src/App.css`

- [ ] **Step 1: Import workflow helpers**

In `apps/web/src/App.jsx`, add:

```js
import {
  BUSINESS_FUNNEL,
  getWorkflowAction,
  mapPipelineStageToFunnel,
  normalizeCandidateForTitle,
  buildReviewProduct
} from './workflow-ui.js';
```

- [ ] **Step 2: Replace `PIPELINE_STAGES` with business funnel**

Remove the seven-stage `PIPELINE_STAGES` constant from `apps/web/src/App.jsx`. Use `BUSINESS_FUNNEL` inside `FlowStatusPanel`.

Update `FlowStatusPanel`:

```jsx
function FlowStatusPanel({ run, onNavigate }) {
  const activeStage = mapPipelineStageToFunnel(run.stage);
  const activeIndex = Math.max(0, BUSINESS_FUNNEL.findIndex((stage) => stage.id === activeStage));
  const action = getWorkflowAction(run);
  const statusText = run.status || 'unknown';

  return (
    <div className="run-summary">
      <div className="run-summary-top">
        <span className={`status-pill status-${statusText}`}>{statusText}</span>
        <span>{formatDateTime(run.updatedAt || run.startedAt)}</span>
      </div>
      <strong>{run.runId}</strong>
      <div className="workflow-funnel-react">
        {BUSINESS_FUNNEL.map((stage, index) => {
          const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : '';
          return (
            <div className={`workflow-funnel-step ${state}`} key={stage.id}>
              <span>{index + 1}</span>
              <b>{stage.label}</b>
            </div>
          );
        })}
      </div>
      <div className={`next-action-card ${action.tone === 'warn' ? 'next-action-warn' : ''}`}>
        <div>
          <span>{action.tone === 'warn' ? '需要处理' : '下一步'}</span>
          <p>{run.userMessage || run.nextActionCode || '流程记录已更新，可继续从工作台处理。'}</p>
        </div>
        {action.tone === 'warn' ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
      </div>
      <div className="flow-action-row">
        <button className="secondary-button" type="button" onClick={() => onNavigate(action.targetTab)}>
          <Play size={15} /> {action.label}
        </button>
        <button className="secondary-button muted" type="button" onClick={() => onNavigate('mine')}>
          <Search size={15} /> 挖词
        </button>
        <button className="secondary-button muted" type="button" onClick={() => onNavigate('title')}>
          <PenLine size={15} /> 标题
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add funnel CSS matching old `workflow-funnel`**

In `apps/web/src/App.css`, add:

```css
.workflow-funnel-react {
  display: grid;
  grid-template-columns: repeat(5, minmax(120px, 1fr));
  gap: 8px;
}

.workflow-funnel-step {
  min-height: 46px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 12px;
  border: 1px solid var(--card-border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
  color: var(--text-secondary);
}

.workflow-funnel-step span {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.08);
}

.workflow-funnel-step b {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.workflow-funnel-step.done {
  border-color: rgba(16, 185, 129, 0.24);
  background: rgba(16, 185, 129, 0.08);
  color: var(--text-primary);
}

.workflow-funnel-step.active {
  border-color: rgba(59, 130, 246, 0.45);
  background: rgba(59, 130, 246, 0.12);
  color: #fff;
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.08), 0 8px 24px rgba(59, 130, 246, 0.08);
}

.workflow-funnel-step.active span {
  background: linear-gradient(135deg, var(--accent-purple), var(--accent-blue));
  color: #fff;
}
```

- [ ] **Step 4: Run helper and build tests**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
npm run web:build
```

Expected: both PASS.

Commit:

```bash
git add apps/web/src/App.jsx apps/web/src/App.css
git commit -m "feat: add business workflow funnel"
```

## Task 4: Preserve Cross-Tab Workflow State

**Files:**
- Create: `apps/web/src/use-session-state.js`
- Modify: `apps/web/src/App.jsx`

- [ ] **Step 1: Create session-backed state hook**

Create `apps/web/src/use-session-state.js`:

```js
import { useEffect, useState } from 'react';

export function useSessionState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : initialValue;
    } catch (_) {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }, [key, value]);

  return [value, setValue];
}
```

- [ ] **Step 2: Use session state for tab-critical data**

In `apps/web/src/App.jsx`, import:

```js
import { useSessionState } from './use-session-state.js';
```

Replace:

```js
const [sourceCandidate, setSourceCandidate] = useState(null);
```

with:

```js
const [sourceCandidate, setSourceCandidate] = useSessionState('ecom.sourceCandidate', null);
const [reviewProducts, setReviewProducts] = useSessionState('ecom.reviewProducts', []);
```

Pass `reviewProducts` into `DashboardView` and pass `setReviewProducts` into `TitleView`.

- [ ] **Step 3: Run build and browser smoke**

Run:

```bash
npm run web:build
```

Expected: PASS.

Browser smoke:

1. Go to 挖词选品.
2. Click a candidate's 生成 button.
3. Refresh the page.
4. Go to 标题生成.
5. Confirm the selected candidate context is still visible.

Commit:

```bash
git add apps/web/src/App.jsx apps/web/src/use-session-state.js
git commit -m "feat: persist workflow tab state"
```

## Task 5: Restore Mine To Title Context Passing

**Files:**
- Modify: `apps/web/src/App.jsx`

- [ ] **Step 1: Normalize candidate before sending to title**

In `App.jsx`, update `sendToTitle`:

```js
const sendToTitle = (candidate) => {
  setSourceCandidate(normalizeCandidateForTitle(candidate));
  setActiveTab('title');
};
```

- [ ] **Step 2: Show mining context on Title page**

In `TitleView`, add a source context panel above the form submit button:

```jsx
{sourceCandidate?.keyword && (
  <div className="source-context-panel">
    <div>
      <span>来源候选词</span>
      <strong>{sourceCandidate.keyword}</strong>
    </div>
    <div>
      <span>质量分</span>
      <strong>{sourceCandidate.score ?? '-'}</strong>
    </div>
    <div>
      <span>搜索人气</span>
      <strong>{sourceCandidate.market?.searchPopularity ?? '-'}</strong>
    </div>
    <div>
      <span>供需比</span>
      <strong>{sourceCandidate.market?.demandSupplyRatio ?? '-'}</strong>
    </div>
  </div>
)}
```

- [ ] **Step 3: Adjust title safety to use normalized candidate**

In `TitleView`, keep existing safety semantics but read fields from normalized candidate:

```js
if (sourceCandidate?.canDistribute && sourceCandidate.keyword === form.keyword.trim()) {
  return { canDistribute: true, degraded: false, reason: sourceCandidate.gateReason || '生意参谋验真通过' };
}
```

- [ ] **Step 4: Add source context CSS**

In `apps/web/src/App.css`, add:

```css
.source-context-panel {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  border: 1px solid rgba(139, 92, 246, 0.28);
  border-radius: 10px;
  background: rgba(139, 92, 246, 0.08);
  padding: 10px;
}

.source-context-panel span,
.source-context-panel strong {
  display: block;
}

.source-context-panel span {
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 700;
}

.source-context-panel strong {
  margin-top: 4px;
  color: var(--text-primary);
  font-size: 12px;
}
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
npm run web:build
```

Expected: PASS.

Commit:

```bash
git add apps/web/src/App.jsx apps/web/src/App.css
git commit -m "feat: carry mined candidate context to title generation"
```

## Task 6: Add Review Queue On Dashboard

**Files:**
- Modify: `apps/web/src/App.jsx`
- Modify: `apps/web/src/App.css`

- [ ] **Step 1: Wire ProductCard review click**

In `ProductCard`, add `onAddReview` prop and update the review button:

```jsx
function ProductCard({ product, safety, sourceCandidate, onAddReview }) {
  const disabled = !safety.canDistribute;
  return (
    <article className="product-card">
      {/* existing product body */}
      <footer className="product-footer">
        <span>质量分 {product['标题质量分'] || 0}</span>
        <button className="secondary-button" type="button" onClick={() => copyText(product['铺货标题'])}><Copy size={15} /> 复制</button>
        <button
          className="secondary-button"
          type="button"
          disabled={disabled}
          onClick={() => onAddReview(buildReviewProduct({ keyword: sourceCandidate?.keyword, product, candidate: sourceCandidate }))}
        >
          <CheckCircle2 size={15} /> 加入复核
        </button>
      </footer>
    </article>
  );
}
```

- [ ] **Step 2: Pass review handler from App to TitleView**

In `App`, pass:

```jsx
{activeTab === 'title' && (
  <TitleView
    sourceCandidate={sourceCandidate}
    onAddReviewProduct={(product) => setReviewProducts((current) => [product, ...current.filter((item) => item.id !== product.id)])}
  />
)}
```

In `TitleView`, pass `onAddReviewProduct` to each `ProductCard`.

- [ ] **Step 3: Render review queue on Dashboard**

In `DashboardView`, add props `reviewProducts` and `onClearReviewProduct`.

Under the current flow panel, add:

```jsx
<section className="table-panel review-queue-panel">
  <div className="section-title-row">
    <h3>待确认铺货</h3>
    <span className="tiny-muted">{reviewProducts.length} 个</span>
  </div>
  {reviewProducts.length === 0 ? (
    <div className="empty-panel">从标题生成页点击“加入复核”后，商品会出现在这里。</div>
  ) : (
    <div className="review-queue-list">
      {reviewProducts.map((item) => (
        <div className="review-queue-item" key={item.id}>
          <div>
            <strong>{item.title}</strong>
            <span>{item.keyword} · {item.price || '暂无价'}</span>
          </div>
          <button className="secondary-button" type="button" onClick={() => copyText(item.title)}>复制标题</button>
          {item.productUrl && <a className="secondary-button" href={item.productUrl} target="_blank" rel="noreferrer">打开货源</a>}
          <button className="icon-button danger" type="button" onClick={() => onClearReviewProduct(item.id)}><Trash2 size={15} /></button>
        </div>
      ))}
    </div>
  )}
</section>
```

- [ ] **Step 4: Add review queue CSS**

In `App.css`, add:

```css
.review-queue-panel {
  margin-bottom: 14px;
}

.review-queue-list {
  display: grid;
  gap: 8px;
}

.review-queue-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto 34px;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--card-border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
  padding: 10px;
}

.review-queue-item strong,
.review-queue-item span {
  display: block;
}

.review-queue-item strong {
  color: var(--text-primary);
  font-size: 13px;
}

.review-queue-item span {
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 11px;
}
```

- [ ] **Step 5: Run build and commit**

Run:

```bash
npm run web:build
```

Expected: PASS.

Commit:

```bash
git add apps/web/src/App.jsx apps/web/src/App.css
git commit -m "feat: add dashboard review queue"
```

## Task 7: Restore Browser History/Duplicate Guard In React

**Files:**
- Create: `apps/web/src/history-service.js`
- Create: `apps/web/src/indexeddb-history-store.js`
- Modify: `apps/web/src/App.jsx`

- [ ] **Step 1: Port the history service to ESM**

Create `apps/web/src/history-service.js`:

```js
function normalizeKeyword(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

export function historyRecordFromCandidate(candidate = {}) {
  const normalizedKeyword = normalizeKeyword(candidate.keyword);
  const signature = candidate.signature || normalizedKeyword;
  return {
    id: `sig:${signature}`,
    keyword: candidate.keyword,
    normalizedKeyword,
    keywordKey: `kw:${normalizedKeyword}`,
    signature,
    signatureKey: `sig:${signature}`,
    coreProduct: candidate.coreProduct || '',
    coreProductKey: candidate.coreProduct ? `core:${candidate.coreProduct}` : '',
    status: candidate.status || candidate.gateStatus || 'candidate',
    gateStatus: candidate.gateStatus || candidate.status || 'candidate',
    canDistribute: Boolean(candidate.canDistribute),
    marketMetrics: candidate.marketMetrics || candidate.sycmData || null,
    source: candidate.source || 'unknown',
    lastReason: candidate.lastReason || candidate.gateReason || ''
  };
}

export function duplicateDecision(existing) {
  if (!existing || !existing.lastSeenAt) return { duplicate: false, record: existing || null };
  const ageDays = Math.abs(Date.now() - new Date(existing.lastSeenAt).getTime()) / 86400000;
  const status = existing.status || existing.gateStatus || '';
  if (status === 'rejected' && ageDays < 90) return { duplicate: true, reason: 'recent_rejected_signature', ageDays, record: existing };
  if (status === 'distributed' && ageDays < 90) return { duplicate: true, reason: 'recent_distributed_signature', ageDays, record: existing };
  if ((status === 'generated' || status === 'pending_review') && ageDays < 30) return { duplicate: true, reason: 'recent_generated_signature', ageDays, record: existing };
  return { duplicate: false, record: existing };
}

export class HistoryService {
  constructor(store) {
    this.store = store;
  }

  async recordCandidates(candidates) {
    const records = (candidates || []).map(historyRecordFromCandidate);
    if (typeof this.store.upsertSeenBatch === 'function') return this.store.upsertSeenBatch(records);
    const rows = [];
    for (const record of records) rows.push(await this.store.upsertSeen(record));
    return rows;
  }

  async findDuplicate(candidate) {
    const record = historyRecordFromCandidate(candidate);
    return duplicateDecision(await this.store.findBySignature(record.signatureKey));
  }

  async markGenerated(candidate, payload = {}) {
    const record = historyRecordFromCandidate(candidate);
    await this.store.upsertSeen({ ...record, status: 'generated', lastAction: 'generated' });
    return this.store.markAction(record.id, 'generated', payload);
  }

  async markPendingReview(candidate, payload = {}) {
    const record = historyRecordFromCandidate(candidate);
    await this.store.upsertSeen({ ...record, status: 'pending_review', lastAction: 'pending_review' });
    return this.store.markAction(record.id, 'pending_review', payload);
  }

  async markRejected(candidate, reason = '') {
    const record = historyRecordFromCandidate(candidate);
    await this.store.upsertSeen({ ...record, status: 'rejected', lastAction: 'rejected', lastReason: reason });
    return this.store.markAction(record.id, 'rejected', { keyword: record.keyword, reason });
  }
}
```

- [ ] **Step 2: Port IndexedDB store**

Create `apps/web/src/indexeddb-history-store.js` by adapting `web/js/storage/indexeddb-history-store.js` into exported class:

```js
export class IndexedDbHistoryStore {
  constructor({ dbName = 'ecom-ai-tools-history', version = 1 } = {}) {
    this.dbName = dbName;
    this.version = version;
  }

  open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('historyRecords')) {
          const records = db.createObjectStore('historyRecords', { keyPath: 'id' });
          records.createIndex('signatureKey', 'signatureKey', { unique: false });
        }
        if (!db.objectStoreNames.contains('historyActions')) {
          db.createObjectStore('historyActions', { keyPath: 'id', autoIncrement: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async get(storeName, key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async put(storeName, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value);
      request.onsuccess = () => resolve(value);
      request.onerror = () => reject(request.error);
    });
  }

  async upsertSeen(record) {
    const existing = await this.get('historyRecords', record.id);
    const now = new Date().toISOString();
    return this.put('historyRecords', {
      ...record,
      firstSeenAt: existing?.firstSeenAt || record.firstSeenAt || now,
      lastSeenAt: record.lastSeenAt || now,
      seenCount: existing?.seenCount ? existing.seenCount + 1 : record.seenCount || 1
    });
  }

  async upsertSeenBatch(records) {
    const output = [];
    for (const record of records || []) output.push(await this.upsertSeen(record));
    return output;
  }

  async findBySignature(signatureKey) {
    return this.get('historyRecords', signatureKey);
  }

  async markAction(recordId, action, payload = {}) {
    return this.put('historyActions', { recordId, action, payload, createdAt: new Date().toISOString() });
  }
}
```

- [ ] **Step 3: Use history service in mining and title actions**

In `App.jsx`, instantiate:

```js
const historyService = useMemo(() => {
  if (!window.indexedDB) return null;
  return new HistoryService(new IndexedDbHistoryStore());
}, []);
```

After mining results:

```js
const nextCandidates = data.data?.candidates || [];
setCandidates(nextCandidates);
historyService?.recordCandidates(nextCandidates).catch(() => {});
```

When adding review:

```js
historyService?.markPendingReview(sourceCandidate.raw || sourceCandidate, product).catch(() => {});
```

- [ ] **Step 4: Run build and commit**

Run:

```bash
npm run web:build
```

Expected: PASS.

Commit:

```bash
git add apps/web/src/App.jsx apps/web/src/history-service.js apps/web/src/indexeddb-history-store.js
git commit -m "feat: restore browser history guard in react"
```

## Task 8: Hide Developer Debug And Legacy Entrypoints

**Files:**
- Modify: `apps/web/src/App.jsx`
- Modify: `apps/web/src/App.css`
- Modify: `apps/web/src/WorkflowStudio.jsx`

- [ ] **Step 1: Remove developer debug from primary nav**

In `App.jsx`, keep `NAV_ITEMS` as:

```js
const NAV_ITEMS = [
  { id: 'dashboard', label: '工作台', icon: LayoutDashboard },
  { id: 'mine', label: '挖词选品', icon: Search },
  { id: 'title', label: '标题生成', icon: PenLine }
];
```

Add state:

```js
const [showDeveloperTools, setShowDeveloperTools] = useState(false);
```

Render developer/legacy links in sidebar footer:

```jsx
<div className="sidebar-tools">
  <button className="sidebar-tool-button" type="button" onClick={() => setShowDeveloperTools((value) => !value)}>
    <Settings size={14} /> 系统
  </button>
  {showDeveloperTools && (
    <div className="sidebar-tool-menu">
      <button type="button" onClick={() => setActiveTab('experiment')}>开发调试</button>
      <a href="/legacy/">旧版备份</a>
    </div>
  )}
</div>
```

- [ ] **Step 2: Add sidebar tool CSS**

In `App.css`, add:

```css
.sidebar-tools {
  margin-top: auto;
  display: grid;
  gap: 8px;
}

.sidebar-tool-button,
.sidebar-tool-menu button,
.sidebar-tool-menu a {
  border: 1px solid var(--card-border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-secondary);
  padding: 8px 10px;
  font-size: 12px;
  text-decoration: none;
  cursor: pointer;
}

.sidebar-tool-menu {
  display: grid;
  gap: 6px;
}
```

- [ ] **Step 3: Run build and browser smoke**

Run:

```bash
npm run web:build
```

Expected: PASS.

Browser smoke:

- Sidebar primary nav has only 工作台 / 挖词选品 / 标题生成.
- Clicking 系统 reveals 开发调试 and 旧版备份.
- 开发调试 still opens `WorkflowStudio`.

Commit:

```bash
git add apps/web/src/App.jsx apps/web/src/App.css apps/web/src/WorkflowStudio.jsx
git commit -m "refactor: hide developer tools from primary workflow"
```

## Task 9: Failure And Rate-Limit Guidance

**Files:**
- Modify: `apps/web/src/App.jsx`
- Modify: `apps/web/src/App.css`

- [ ] **Step 1: Add fallback guidance component**

In `App.jsx`, create:

```jsx
function RecoveryHint({ message, onGoTitle }) {
  return (
    <div className="recovery-hint">
      <AlertTriangle size={18} />
      <div>
        <strong>自动抓取受阻</strong>
        <p>{message || '如果淘宝/1688触发限流，可以先手工粘贴同行标题继续生成。'}</p>
      </div>
      <button className="secondary-button" type="button" onClick={onGoTitle}>去手工生成</button>
    </div>
  );
}
```

- [ ] **Step 2: Show recovery hints in mining and title pages**

In `MiningView`, maintain:

```js
const [recoveryMessage, setRecoveryMessage] = useState('');
```

In SSE error handler:

```js
setRecoveryMessage('挖词日志流中断或平台限流，请稍后重试，或手工输入关键词进入标题生成。');
```

Render:

```jsx
{recoveryMessage && <RecoveryHint message={recoveryMessage} onGoTitle={() => onSendToTitle({ keyword: minerInput || seedForm.keyword })} />}
```

In `TitleView`, when `/api/title/generate` fails:

```js
setError(`${err.message}。可以粘贴同行标题后重试，减少平台抓取依赖。`);
```

- [ ] **Step 3: Add recovery CSS**

In `App.css`, add:

```css
.recovery-hint {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  align-items: start;
  gap: 10px;
  border: 1px solid rgba(245, 158, 11, 0.36);
  border-radius: 10px;
  background: rgba(120, 53, 15, 0.16);
  color: #fde68a;
  padding: 12px;
  margin-bottom: 12px;
}

.recovery-hint strong,
.recovery-hint p {
  display: block;
  margin: 0;
}

.recovery-hint p {
  margin-top: 4px;
  color: #fef3c7;
  font-size: 12px;
  line-height: 1.5;
}
```

- [ ] **Step 4: Run build and commit**

Run:

```bash
npm run web:build
```

Expected: PASS.

Commit:

```bash
git add apps/web/src/App.jsx apps/web/src/App.css
git commit -m "feat: add platform recovery guidance"
```

## Task 10: Final Verification And Documentation

**Files:**
- Modify: `docs/superpowers/plans/2026-07-01-react-style-and-workflow-unification.md`

- [ ] **Step 1: Run full verification**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
npm run web:build
npm run test:all
```

Expected:

- helper test passes.
- Vite build passes.
- full repo tests pass.

- [ ] **Step 2: Browser smoke checklist**

Start server:

```bash
node bin/server.js
```

Smoke checklist:

- `/` loads React app with old-style glass visual language.
- Primary nav has only 工作台 / 挖词选品 / 标题生成.
- 工作台 current flow shows five-stage funnel.
- 挖词选品 can send a candidate to 标题生成.
- 标题生成 shows source candidate metrics.
- 加入复核 puts product into 工作台待确认铺货.
- 系统 menu opens 开发调试 and old legacy link.
- Browser console has no errors.

- [ ] **Step 3: Commit any doc verification updates**

If verification notes are appended to this plan:

```bash
git add docs/superpowers/plans/2026-07-01-react-style-and-workflow-unification.md
git commit -m "docs: document react style workflow verification"
```

## Self-Review

- Spec coverage: Antigravity suggestions are covered by Task 2, Task 3, Task 5, Task 6, Task 8, and Task 9.
- Placeholder scan: no unfinished placeholder language is used in implementation steps.
- Type consistency: helper names used by `App.jsx` are defined in Task 1.
- Scope check: this remains one coherent frontend migration hardening plan. Backend review API is not introduced yet; review queue uses session state first to keep this iteration shippable and testable.
