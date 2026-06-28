# Keyword Mining Quality And Safe Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve keyword mining quality, make Web workflow states explicit, and keep daily automation safe by producing reviewable distribution batches instead of silently submitting products.

**Architecture:** Add a small candidate-quality layer before ranking: classify seed roles, check modifier/product compatibility, and gate candidates into `candidate`, `review`, `verified`, or `rejected`. Keep title generation available for experimentation, but block unverified keywords from entering distribution review. Web UI should become a funnel over persisted pipeline runs.

**Tech Stack:** Node.js CommonJS, `node:test`, existing CLI/Web server in `bin/`, existing keyword mining skill under `skills/keyword-mining/`.

---

## File Structure

- Create `skills/keyword-mining/src/seed-classifier.js`: classify seed keyword role and existing facets.
- Create `skills/keyword-mining/src/facet-compatibility.js`: decide whether an expansion pattern is semantically allowed for a seed/product.
- Create `skills/keyword-mining/src/candidate-gate.js`: convert local score plus compatibility signals into review status.
- Modify `skills/keyword-mining/src/expand-keywords.js`: apply seed classification and compatibility before adding generated candidates.
- Modify `skills/keyword-mining/src/score-keyword.js`: stop treating broad seeds as concrete product words.
- Modify `skills/keyword-mining/src/pipeline.js`: include `gateStatus`, `canDistribute`, and gate reasons in mined candidates.
- Modify `skills/keyword-mining/index.js`: export new helpers for tests and future Web/API use.
- Modify `skills/keyword-mining/test/keyword-mining.test.js`: add regression tests for mechanical keywords and gate output.
- Later Web tasks modify `bin/server.js`, `web/index.html`, `web/js/mine.js`, `web/js/title.js`, and `web/css/style.css`.

---

### Task 1: Keyword Quality Gate

**Files:**
- Create: `skills/keyword-mining/src/seed-classifier.js`
- Create: `skills/keyword-mining/src/facet-compatibility.js`
- Create: `skills/keyword-mining/src/candidate-gate.js`
- Modify: `skills/keyword-mining/src/expand-keywords.js`
- Modify: `skills/keyword-mining/src/score-keyword.js`
- Modify: `skills/keyword-mining/src/pipeline.js`
- Modify: `skills/keyword-mining/index.js`
- Test: `skills/keyword-mining/test/keyword-mining.test.js`

- [ ] **Step 1: Write failing tests**

Add tests that assert broad scene seeds do not produce mechanical candidates, broad seeds do not get product-core boosts, and mined candidates expose `gateStatus`/`canDistribute`.

- [ ] **Step 2: Run focused tests**

Run: `node --test skills/keyword-mining/test/keyword-mining.test.js`

Expected before implementation: FAIL because `classifySeed`, `gateCandidate`, or the new fields are missing.

- [ ] **Step 3: Implement seed classifier**

Add deterministic classification using configured product words and existing facets. Treat terms such as `好物`, `礼物`, `神器`, and season/event words without a concrete product as broad or event seeds.

- [ ] **Step 4: Implement facet compatibility**

Block obvious bad expansions such as `function+seed` for abstract seeds, `scene+seed` for event seeds, and generic function modifiers for naturally portable products such as phone cases.

- [ ] **Step 5: Implement candidate gate**

Return:

```js
{
  gateStatus: 'candidate' | 'review' | 'verified' | 'rejected',
  canDistribute: false,
  gateReason: '...',
  gateFlags: []
}
```

Only SYCM-passed candidates may become `verified` and `canDistribute: true`.

- [ ] **Step 6: Wire gate into expansion, scoring, and pipeline ranking**

Expansion should avoid generating known-bad patterns. Scoring should not pass broad seeds as extra product words. Pipeline should keep reviewable candidates but exclude rejected candidates from ranking.

- [ ] **Step 7: Run focused tests**

Run: `node --test skills/keyword-mining/test/keyword-mining.test.js`

Expected: PASS.

- [ ] **Step 8: Run broader tests**

Run: `npm test`

Expected: PASS.

---

### Task 2: Web Workflow State Clarity

**Files:**
- Modify: `bin/server.js`
- Modify: `web/index.html`
- Modify: `web/js/mine.js`
- Modify: `web/js/title.js`
- Modify: `web/css/style.css`
- Test: add API contract checks if a Web server test harness exists, otherwise run `node --check bin/server.js web/js/*.js`.

- [ ] **Step 1: Add shared workflow status vocabulary**

Use these states consistently in API responses and UI labels:

```text
candidate -> verifying -> verified -> generated -> pending_review -> submitted
```

- [ ] **Step 2: Show a persistent funnel header**

Render five stages: `候选词`, `大盘验真`, `标题货源`, `待确认铺货`, `已提交`.

- [ ] **Step 3: Disable distribution actions for unverified keywords**

Generated titles may be shown for manual study, but `加入待铺货清单` stays disabled unless `canDistribute === true`.

- [ ] **Step 4: Surface degraded generation**

Read both `data.degraded` and `data.stats.degraded` / `data.stats.trace.degraded`; show a warning banner and block distribution for degraded outputs.

---

### Task 3: Daily Automation Review Surface

**Files:**
- Modify: `bin/server.js`
- Modify: `web/js/app.js`
- Modify: `web/index.html`
- Modify: `web/css/style.css`

- [ ] **Step 1: Add read-only batch API**

Add `GET /api/workflow/batches` that scans `data/pipeline/runs/*` and returns latest run metadata plus paths for `distribution-review.md` and `distribution-batch.txt`.

- [ ] **Step 2: Add dashboard review card**

Show the latest generated batch with counts, timestamps, and open/review actions.

- [ ] **Step 3: Keep submit out of first release**

Do not add `POST /api/distribution/submit` until keyword quality and human review controls are stable.

---

### Task 4: Safe Distribution Controls

**Files:**
- Modify later only after Task 1-3 are stable: `bin/server.js`, `skills/1688-distribution/*`, `web/js/*`.

- [ ] **Step 1: Keep CLI three-stage flow**

Use existing CLI safety model:

```bash
node bin/cli.js distribute --input-file data/pipeline/runs/<runId>/distribution-batch.txt --dry-run --json
node bin/cli.js distribute --input-file data/pipeline/runs/<runId>/distribution-batch.txt --check --json
node bin/cli.js distribute --input-file data/pipeline/runs/<runId>/distribution-batch.txt --submit --json
```

- [ ] **Step 2: Require explicit human confirmation before submit**

Submit must require an explicit user action in the current session and must not be triggered by the daily automation command.

---

## Self-Review

- Spec coverage: keyword mining quality, Web workflow clarity, daily automation review, and safe distribution are each mapped to a task.
- Placeholder scan: no `TBD`, `TODO`, or unspecified "add tests" instructions remain.
- Type consistency: status fields are consistently named `gateStatus`, `canDistribute`, `gateReason`, and `gateFlags`.
