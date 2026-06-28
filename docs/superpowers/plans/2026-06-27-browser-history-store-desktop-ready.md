# Browser History Store Desktop Ready Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add browser-side keyword/product history recording with IndexedDB while keeping the storage boundary ready for a future desktop SQLite implementation.

**Architecture:** Introduce a storage-neutral history contract first, then implement `BrowserIndexedDbHistoryStore` behind that contract with an in-memory fallback. Web UI code first reads historical duplicates, then records the current batch, so current results are not mistaken for old duplicates. Later Electron/Tauri desktop builds can swap in `DesktopSqliteHistoryStore` or an IPC-backed adapter without changing mining/title UI logic.

**Tech Stack:** Node.js CommonJS for tests/shared schema, browser JavaScript for IndexedDB, existing Web UI in `web/`, existing keyword-mining pipeline fields such as `keyword`, `signature`, `coreProduct`, `gateStatus`, `canDistribute`, and `marketMetrics`.

---

## File Structure

- Create `core/history-record.js`: shared normalization helpers and record shape validation that can run in Node tests and be mirrored by browser code.
- Create `core/test/history-record.test.js`: unit tests for record normalization, key building, and cooldown rules.
- Create `web/js/storage/history-store-contract.js`: browser-facing documentation object and constants for store names/status values.
- Create `web/js/storage/indexeddb-history-store.js`: IndexedDB adapter implementing the browser history store methods.
- Create `web/js/storage/history-service.js`: small facade used by UI modules; hides the chosen adapter.
- Modify `web/index.html`: load storage scripts before `mine.js` and `title.js`.
- Modify `web/js/mine.js`: mark recent duplicate candidates in the UI without hiding them, record mined candidates after duplicate checks, and expose a reject action.
- Modify `web/js/title.js`: record generation attempts and pending-review actions.
- Modify `web/js/app.js`: expose a lightweight dashboard count for local browser history.
- Modify `web/css/style.css`: add compact styles for duplicate badges/history notices.
- Create `docs/storage/history-store-contract.md`: describe the storage contract and future desktop SQLite mapping.

---

### Task 1: Shared History Record Contract

**Files:**
- Create: `core/history-record.js`
- Create: `core/test/history-record.test.js`

- [ ] **Step 1: Write the failing tests**

Create `core/test/history-record.test.js`:

```js
const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  normalizeHistoryKeyword,
  buildHistoryKeys,
  normalizeHistoryRecord,
  shouldSuppressHistoryRecord
} = require('../history-record');

describe('history-record', () => {
  test('normalizes keyword and builds stable keys', () => {
    const keys = buildHistoryKeys({
      keyword: '  纯银 吊坠 ',
      signature: '吊坠|纯银',
      coreProduct: '吊坠'
    });

    assert.strictEqual(keys.normalizedKeyword, '纯银吊坠');
    assert.strictEqual(keys.keywordKey, 'kw:纯银吊坠');
    assert.strictEqual(keys.signatureKey, 'sig:吊坠|纯银');
    assert.strictEqual(keys.coreProductKey, 'core:吊坠');
  });

  test('normalizes candidate records for browser and desktop stores', () => {
    const record = normalizeHistoryRecord({
      keyword: '纯银吊坠',
      signature: '吊坠|纯银',
      coreProduct: '吊坠',
      gateStatus: 'verified',
      canDistribute: true,
      marketMetrics: { searchPopularity: 128, demandSupplyRatio: 1.4 },
      source: 'local'
    }, { now: '2026-06-27T00:00:00.000Z' });

    assert.strictEqual(record.id, 'sig:吊坠|纯银');
    assert.strictEqual(record.status, 'verified');
    assert.strictEqual(record.seenCount, 1);
    assert.strictEqual(record.firstSeenAt, '2026-06-27T00:00:00.000Z');
    assert.strictEqual(record.lastSeenAt, '2026-06-27T00:00:00.000Z');
    assert.strictEqual(record.canDistribute, true);
  });

  test('does not suppress candidate-only records by default', () => {
    const candidate = {
      signature: '吊坠|纯银',
      lastSeenAt: '2026-06-26T00:00:00.000Z',
      status: 'candidate'
    };

    assert.strictEqual(shouldSuppressHistoryRecord(candidate, {
      now: '2026-06-27T00:00:00.000Z'
    }).suppress, false);
  });

  test('suppresses recent generated signatures but allows old records', () => {
    const recent = {
      signature: '吊坠|纯银',
      lastSeenAt: '2026-06-20T00:00:00.000Z',
      status: 'generated'
    };
    const old = {
      signature: '吊坠|纯银',
      lastSeenAt: '2026-04-01T00:00:00.000Z',
      status: 'generated'
    };

    assert.strictEqual(shouldSuppressHistoryRecord(recent, {
      now: '2026-06-27T00:00:00.000Z',
      cooldownDays: 30
    }).suppress, true);
    assert.strictEqual(shouldSuppressHistoryRecord(old, {
      now: '2026-06-27T00:00:00.000Z',
      cooldownDays: 30
    }).suppress, false);
  });

  test('uses longer cooldown for rejected records', () => {
    const rejected = {
      signature: '宿舍好物|收纳',
      lastSeenAt: '2026-05-01T00:00:00.000Z',
      status: 'rejected'
    };

    const decision = shouldSuppressHistoryRecord(rejected, {
      now: '2026-06-27T00:00:00.000Z',
      cooldownDays: 30,
      rejectedCooldownDays: 90
    });

    assert.strictEqual(decision.suppress, true);
    assert.strictEqual(decision.reason, 'recent_rejected_signature');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test core/test/history-record.test.js
```

Expected: FAIL with `Cannot find module '../history-record'`.

- [ ] **Step 3: Implement shared helpers**

Create `core/history-record.js`:

```js
'use strict';

function normalizeHistoryKeyword(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

function buildHistoryKeys(input = {}) {
  const normalizedKeyword = normalizeHistoryKeyword(input.keyword);
  const signature = String(input.signature || normalizedKeyword).trim();
  const coreProduct = String(input.coreProduct || '').trim();
  return {
    normalizedKeyword,
    signature,
    coreProduct,
    keywordKey: `kw:${normalizedKeyword}`,
    signatureKey: `sig:${signature}`,
    coreProductKey: coreProduct ? `core:${coreProduct}` : ''
  };
}

function normalizeHistoryRecord(input = {}, { now = new Date().toISOString(), existing = null } = {}) {
  const keys = buildHistoryKeys(input);
  const id = keys.signatureKey || keys.keywordKey;
  return {
    id,
    keyword: String(input.keyword || '').trim(),
    normalizedKeyword: keys.normalizedKeyword,
    keywordKey: keys.keywordKey,
    signature: keys.signature,
    signatureKey: keys.signatureKey,
    coreProduct: keys.coreProduct,
    coreProductKey: keys.coreProductKey,
    status: input.status || input.gateStatus || 'candidate',
    gateStatus: input.gateStatus || input.status || 'candidate',
    canDistribute: !!input.canDistribute,
    marketMetrics: input.marketMetrics || null,
    source: input.source || 'unknown',
    firstSeenAt: existing && existing.firstSeenAt ? existing.firstSeenAt : now,
    lastSeenAt: now,
    seenCount: existing && Number.isFinite(existing.seenCount) ? existing.seenCount + 1 : 1,
    lastAction: input.lastAction || '',
    lastReason: input.lastReason || input.gateReason || ''
  };
}

function daysBetween(leftIso, rightIso) {
  const left = new Date(leftIso).getTime();
  const right = new Date(rightIso).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Infinity;
  return Math.abs(right - left) / 86400000;
}

function shouldSuppressHistoryRecord(record, {
  now = new Date().toISOString(),
  candidateCooldownDays = 0,
  generatedCooldownDays = 30,
  distributedCooldownDays = 90,
  rejectedCooldownDays = 90
} = {}) {
  if (!record || !record.lastSeenAt) return { suppress: false, reason: '' };
  const ageDays = daysBetween(record.lastSeenAt, now);
  const status = record.status || record.gateStatus || '';
  if (status === 'rejected' && ageDays < rejectedCooldownDays) {
    return { suppress: true, reason: 'recent_rejected_signature', ageDays };
  }
  if (status === 'distributed' && ageDays < distributedCooldownDays) {
    return { suppress: true, reason: 'recent_distributed_signature', ageDays };
  }
  if (status === 'generated' && ageDays < generatedCooldownDays) {
    return { suppress: true, reason: 'recent_generated_signature', ageDays };
  }
  if (status === 'candidate' && candidateCooldownDays > 0 && ageDays < candidateCooldownDays) {
    return { suppress: true, reason: 'recent_signature', ageDays };
  }
  return { suppress: false, reason: '', ageDays };
}

module.exports = {
  normalizeHistoryKeyword,
  buildHistoryKeys,
  normalizeHistoryRecord,
  shouldSuppressHistoryRecord
};
```

- [ ] **Step 4: Run focused test**

Run:

```bash
node --test core/test/history-record.test.js
```

Expected: PASS.

---

### Task 2: Browser IndexedDB Adapter

**Files:**
- Create: `web/js/storage/history-store-contract.js`
- Create: `web/js/storage/indexeddb-history-store.js`
- Create: `web/js/storage/history-service.js`
- Modify: `web/index.html`

- [ ] **Step 1: Add browser storage constants**

Create `web/js/storage/history-store-contract.js`:

```js
'use strict';

window.HistoryStoreContract = {
  dbName: 'ecom-ai-tools-history',
  dbVersion: 1,
  stores: {
    records: 'historyRecords',
    actions: 'historyActions'
  },
  statuses: ['candidate', 'review', 'verified', 'rejected', 'distributed']
};
```

- [ ] **Step 2: Add IndexedDB adapter**

Create `web/js/storage/indexeddb-history-store.js`:

```js
'use strict';

class BrowserIndexedDbHistoryStore {
  constructor(options = {}) {
    this.dbName = options.dbName || window.HistoryStoreContract.dbName;
    this.dbVersion = options.dbVersion || window.HistoryStoreContract.dbVersion;
    this.dbPromise = null;
  }

  open() {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.dbVersion);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('historyRecords')) {
          const records = db.createObjectStore('historyRecords', { keyPath: 'id' });
          records.createIndex('keywordKey', 'keywordKey', { unique: false });
          records.createIndex('signatureKey', 'signatureKey', { unique: false });
          records.createIndex('coreProductKey', 'coreProductKey', { unique: false });
          records.createIndex('status', 'status', { unique: false });
          records.createIndex('lastSeenAt', 'lastSeenAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('historyActions')) {
          const actions = db.createObjectStore('historyActions', { keyPath: 'id', autoIncrement: true });
          actions.createIndex('recordId', 'recordId', { unique: false });
          actions.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }

  async get(storeName, key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async put(storeName, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
    });
  }

  async upsertSeen(record) {
    const existing = await this.get('historyRecords', record.id);
    const now = new Date().toISOString();
    const next = {
      ...record,
      firstSeenAt: existing && existing.firstSeenAt ? existing.firstSeenAt : (record.firstSeenAt || now),
      lastSeenAt: record.lastSeenAt || now,
      seenCount: existing && Number.isFinite(existing.seenCount) ? existing.seenCount + 1 : (record.seenCount || 1)
    };
    return this.put('historyRecords', next);
  }

  async upsertSeenBatch(records) {
    const db = await this.open();
    const now = new Date().toISOString();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('historyRecords', 'readwrite');
      const store = tx.objectStore('historyRecords');
      const output = [];
      let pending = records.length;
      if (pending === 0) resolve([]);
      for (const record of records) {
        const getReq = store.get(record.id);
        getReq.onsuccess = () => {
          const existing = getReq.result || null;
          const next = {
            ...record,
            firstSeenAt: existing && existing.firstSeenAt ? existing.firstSeenAt : (record.firstSeenAt || now),
            lastSeenAt: record.lastSeenAt || now,
            seenCount: existing && Number.isFinite(existing.seenCount) ? existing.seenCount + 1 : (record.seenCount || 1)
          };
          output.push(next);
          store.put(next);
          pending -= 1;
        };
        getReq.onerror = () => reject(getReq.error);
      }
      tx.oncomplete = () => resolve(output);
      tx.onerror = () => reject(tx.error);
    });
  }

  async findBySignature(signatureKey) {
    return this.get('historyRecords', signatureKey);
  }

  async markAction(recordId, action, payload = {}) {
    return this.put('historyActions', {
      recordId,
      action,
      payload,
      createdAt: new Date().toISOString()
    });
  }
}

window.BrowserIndexedDbHistoryStore = BrowserIndexedDbHistoryStore;
```

- [ ] **Step 3: Add history service facade**

Create `web/js/storage/history-service.js`:

```js
'use strict';

function normalizeBrowserKeyword(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

function historyRecordFromCandidate(candidate) {
  const normalizedKeyword = normalizeBrowserKeyword(candidate.keyword);
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
    status: candidate.gateStatus || 'candidate',
    gateStatus: candidate.gateStatus || 'candidate',
    canDistribute: !!candidate.canDistribute,
    marketMetrics: candidate.marketMetrics || null,
    source: candidate.source || 'unknown',
    lastReason: candidate.gateReason || ''
  };
}

class HistoryService {
  constructor(store) {
    this.store = store;
  }

  async recordCandidates(candidates) {
    const records = (candidates || []).map(historyRecordFromCandidate);
    if (typeof this.store.upsertSeenBatch === 'function') {
      return this.store.upsertSeenBatch(records);
    }
    const rows = [];
    for (const record of records) rows.push(await this.store.upsertSeen(record));
    return rows;
  }

  async findDuplicate(candidate) {
    const record = historyRecordFromCandidate(candidate);
    const existing = await this.store.findBySignature(record.signatureKey);
    if (!existing || !existing.lastSeenAt) return { duplicate: false, record: existing };
    const ageDays = Math.abs(new Date() - new Date(existing.lastSeenAt)) / 86400000;
    const cooldownDays = existing.status === 'rejected' ? 90 : 30;
    return {
      duplicate: ageDays < cooldownDays,
      reason: existing.status === 'rejected' ? 'recent_rejected_signature' : 'recent_signature',
      ageDays,
      record: existing
    };
  }

  async markGenerated(candidate, payload = {}) {
    const record = historyRecordFromCandidate(candidate);
    await this.store.upsertSeen({ ...record, lastAction: 'generated' });
    return this.store.markAction(record.id, 'generated', payload);
  }

  async markRejected(candidate, reason = '') {
    const record = historyRecordFromCandidate(candidate);
    const rejected = {
      ...record,
      status: 'rejected',
      gateStatus: candidate.gateStatus || record.gateStatus,
      lastAction: 'rejected',
      lastReason: reason || candidate.gateReason || '用户手动拒绝'
    };
    await this.store.upsertSeen(rejected);
    return this.store.markAction(rejected.id, 'rejected', { keyword: rejected.keyword, reason: rejected.lastReason });
  }
}

class MemoryHistoryStore {
  constructor() {
    this.records = new Map();
    this.actions = [];
  }

  async upsertSeen(record) {
    const existing = this.records.get(record.id);
    const now = new Date().toISOString();
    const next = {
      ...record,
      firstSeenAt: existing && existing.firstSeenAt ? existing.firstSeenAt : (record.firstSeenAt || now),
      lastSeenAt: record.lastSeenAt || now,
      seenCount: existing && Number.isFinite(existing.seenCount) ? existing.seenCount + 1 : (record.seenCount || 1)
    };
    this.records.set(next.id, next);
    return next;
  }

  async upsertSeenBatch(records) {
    const output = [];
    for (const record of records || []) output.push(await this.upsertSeen(record));
    return output;
  }

  async findBySignature(signatureKey) {
    return this.records.get(signatureKey) || null;
  }

  async markAction(recordId, action, payload = {}) {
    const row = { id: this.actions.length + 1, recordId, action, payload, createdAt: new Date().toISOString() };
    this.actions.push(row);
    return row;
  }
}

function createHistoryStore() {
  if (!window.indexedDB || !window.BrowserIndexedDbHistoryStore) return new MemoryHistoryStore();
  return new window.BrowserIndexedDbHistoryStore();
}

window.MemoryHistoryStore = MemoryHistoryStore;
window.historyService = new HistoryService(createHistoryStore());
```

- [ ] **Step 4: Load storage scripts before feature modules**

Modify `web/index.html` script order:

```html
<script src="js/app.js"></script>
<script src="js/storage/history-store-contract.js"></script>
<script src="js/storage/indexeddb-history-store.js"></script>
<script src="js/storage/history-service.js"></script>
<script src="js/seeds.js"></script>
<script src="js/mine.js"></script>
<script src="js/title.js"></script>
```

- [ ] **Step 5: Run syntax checks**

Run:

```bash
node --check web/js/storage/history-store-contract.js
node --check web/js/storage/indexeddb-history-store.js
node --check web/js/storage/history-service.js
node --check web/js/mine.js
node --check web/js/title.js
```

Expected: all commands exit 0.

---

### Task 3: Integrate Browser History Into Mining UI Without Hiding Results

**Files:**
- Modify: `web/js/mine.js`
- Modify: `web/css/style.css`

- [ ] **Step 1: Add helper to mark duplicates before writing the current batch**

Add this helper to `web/js/mine.js` near `workflowGateMeta`:

```js
function renderDuplicateBadge(tr, duplicate) {
  if (!duplicate || !duplicate.duplicate) return;
  const keywordCell = tr.querySelector('.keyword-cell-main');
  if (!keywordCell) return;
  const badge = document.createElement('span');
  badge.className = 'duplicate-badge';
  const labels = {
    recent_rejected_signature: '近期拒绝',
    recent_distributed_signature: '近期铺货',
    recent_generated_signature: '近期生成',
    recent_signature: '近期出现'
  };
  badge.textContent = labels[duplicate.reason] || '历史命中';
  keywordCell.appendChild(badge);
}
```

- [ ] **Step 2: Mark duplicate candidates while rendering rows**

In the `candidates.forEach(item => { ... })` block, after `const gate = workflowGateMeta(item);`, add a duplicate promise without writing the current batch first:

```js
let duplicatePromise = null;
if (window.historyService) {
  duplicatePromise = window.historyService.findDuplicate(item).catch(() => null);
}
```

Change the keyword cell markup from:

```html
<td>
  <strong>${escapeHtml(item.keyword)}</strong>
  ${subtext}
</td>
```

to:

```html
      <td>
        <div class="keyword-cell-main">
          <strong>${escapeHtml(item.keyword)}</strong>
        </div>
  ${subtext}
    </td>
```

After `mineResultsTbody.appendChild(tr);`, add:

```js
if (duplicatePromise) {
  duplicatePromise.then(dup => renderDuplicateBadge(tr, dup));
}
```

- [ ] **Step 3: Record candidates only after row rendering has scheduled historical checks**

At the end of `renderMinedCandidates(result)`, after all rows are appended and after `updateBatchButtonState();`, add:

```js
if (window.historyService) {
  window.historyService.recordCandidates(candidates).catch(err => {
    console.warn('记录候选词历史失败:', err.message);
  });
}
```

- [ ] **Step 4: Add duplicate badge styles**

Append to `web/css/style.css`:

```css
.keyword-cell-main {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.duplicate-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border: 1px solid rgba(245, 158, 11, 0.32);
  border-radius: 4px;
  color: #fbbf24;
  background: rgba(245, 158, 11, 0.12);
  font-size: 10px;
  font-weight: 700;
}
```

- [ ] **Step 5: Run syntax and smoke checks**

Run:

```bash
node --check web/js/mine.js
node --check web/js/storage/history-service.js
curl -sS http://127.0.0.1:3135/api/mine/run?count=3\\&source=local\\&sycmPrecheck=false | tail -5
```

Expected: JS checks pass; SSE returns a `result` event.

---

### Task 4: Record Title Generation And Review Actions

**Files:**
- Modify: `web/js/title.js`

- [ ] **Step 1: Record title generation attempts**

In `formTitleGen.addEventListener('submit', ...)`, after successful payload handling and after `currentTitleSafety = buildTitleSafety(payload.data, keyword);`, add:

```js
if (window.historyService && window._titleSourceCandidate) {
  window.historyService.markGenerated(window._titleSourceCandidate, {
    keyword,
    productCount: Array.isArray(payload.data.products) ? payload.data.products.length : 0,
    canDistribute: currentTitleSafety.canDistribute,
    degraded: !!currentTitleSafety.degraded
  }).catch(err => console.warn('记录标题生成历史失败:', err.message));
}
```

- [ ] **Step 2: Record pending-review action**

In the `reviewBtn.addEventListener('click', ...)` handler, before `showToast(...)`, add:

```js
if (window.historyService && window._titleSourceCandidate) {
  window.historyService.store.markAction(
    `sig:${window._titleSourceCandidate.signature || window._titleSourceCandidate.keyword}`,
    'pending_review',
    {
      keyword: window._titleSourceCandidate.keyword,
      productUrl: p['产品链接'] || '',
      title: p['铺货标题'] || ''
    }
  ).catch(err => console.warn('记录待确认动作失败:', err.message));
}
```

- [ ] **Step 3: Run syntax checks**

Run:

```bash
node --check web/js/title.js
```

Expected: exit 0.

---

### Task 5: Add Manual Reject Action For Cooldown

**Files:**
- Modify: `web/js/mine.js`

- [ ] **Step 1: Add reject button next to generated/copy actions**

In `renderMinedCandidates(result)`, after creating `genBtn`, add:

```js
const rejectBtn = document.createElement('button');
rejectBtn.className = 'btn btn-secondary btn-sm';
rejectBtn.textContent = '排除';
rejectBtn.title = '将该词加入近期拒绝冷却';
rejectBtn.addEventListener('click', async () => {
  if (!window.historyService) return;
  await window.historyService.markRejected(item, '用户在挖词表手动排除');
  tr.classList.add('row-muted');
  showToast(`已排除「${item.keyword}」`);
});
```

Append it after `genBtn`:

```js
actionCell.appendChild(copyBtn);
actionCell.appendChild(genBtn);
actionCell.appendChild(rejectBtn);
```

- [ ] **Step 2: Add muted row style**

Append to `web/css/style.css`:

```css
.data-table tbody tr.row-muted {
  opacity: 0.52;
}
```

- [ ] **Step 3: Run syntax check**

Run:

```bash
node --check web/js/mine.js
```

Expected: exit 0.

---

### Task 6: Document Desktop SQLite Mapping

**Files:**
- Create: `docs/storage/history-store-contract.md`

- [ ] **Step 1: Create storage contract doc**

Create `docs/storage/history-store-contract.md`:

```markdown
# History Store Contract

## Purpose

The Web UI records keyword and product history through a storage-neutral contract. Browser builds use IndexedDB. Future desktop builds should provide the same methods through SQLite, usually via Electron/Tauri IPC.

## Required Methods

```js
async upsertSeen(record)
async upsertSeenBatch(records)
async findBySignature(signatureKey)
async markAction(recordId, action, payload)
```

## Record Shape

```json
{
  "id": "sig:吊坠|纯银",
  "keyword": "纯银吊坠",
  "normalizedKeyword": "纯银吊坠",
  "keywordKey": "kw:纯银吊坠",
  "signature": "吊坠|纯银",
  "signatureKey": "sig:吊坠|纯银",
  "coreProduct": "吊坠",
  "coreProductKey": "core:吊坠",
  "status": "verified",
  "gateStatus": "verified",
  "canDistribute": true,
  "marketMetrics": {
    "searchPopularity": 128,
    "demandSupplyRatio": 1.4,
    "clickRate": 18,
    "conversionRate": 2.5,
    "buyerCount": 12
  },
  "source": "local",
  "firstSeenAt": "2026-06-27T00:00:00.000Z",
  "lastSeenAt": "2026-06-27T00:00:00.000Z",
  "seenCount": 1,
  "lastAction": "generated",
  "lastReason": "生意参谋综合验真通过"
}
```

## SQLite Tables For Desktop

```sql
CREATE TABLE keyword_history (
  id TEXT PRIMARY KEY,
  keyword TEXT NOT NULL,
  normalized_keyword TEXT NOT NULL,
  keyword_key TEXT NOT NULL,
  signature TEXT NOT NULL,
  signature_key TEXT NOT NULL,
  core_product TEXT,
  core_product_key TEXT,
  status TEXT NOT NULL,
  gate_status TEXT NOT NULL,
  can_distribute INTEGER NOT NULL DEFAULT 0,
  market_metrics_json TEXT,
  source TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  seen_count INTEGER NOT NULL DEFAULT 1,
  last_action TEXT,
  last_reason TEXT
);

CREATE INDEX idx_keyword_history_keyword_key ON keyword_history(keyword_key);
CREATE INDEX idx_keyword_history_signature_key ON keyword_history(signature_key);
CREATE INDEX idx_keyword_history_core_product_key ON keyword_history(core_product_key);
CREATE INDEX idx_keyword_history_last_seen_at ON keyword_history(last_seen_at);

CREATE TABLE keyword_history_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL
);
```
```

- [ ] **Step 2: Verify docs path**

Run:

```bash
test -f docs/storage/history-store-contract.md && sed -n '1,80p' docs/storage/history-store-contract.md
```

Expected: file exists and starts with `# History Store Contract`.

---

### Task 7: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused Node tests**

Run:

```bash
node --test core/test/history-record.test.js
```

Expected: PASS.

- [ ] **Step 2: Run Web syntax checks**

Run:

```bash
node --check web/js/storage/history-store-contract.js
node --check web/js/storage/indexeddb-history-store.js
node --check web/js/storage/history-service.js
node --check web/js/mine.js
node --check web/js/title.js
```

Expected: all exit 0.

- [ ] **Step 3: Run project test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Manual browser verification**

Start the server:

```bash
UI_PORT=3135 node bin/server.js
```

Open:

```text
http://127.0.0.1:3135
```

Expected:

- Mining results render normally.
- Duplicate badges appear after the same candidate signature is seen twice within the cooldown window.
- Title generation actions do not throw console errors when IndexedDB is available.
- If IndexedDB is unavailable, mining/title generation still work and only log warnings.

---

## Self-Review

- Spec coverage: IndexedDB recording, duplicate prevention, future desktop SQLite compatibility, UI integration, and tests are each covered.
- Placeholder scan: no placeholder-only steps remain.
- Type consistency: `keywordKey`, `signatureKey`, `coreProductKey`, `gateStatus`, `canDistribute`, and `marketMetrics` are used consistently across browser and desktop contracts.
