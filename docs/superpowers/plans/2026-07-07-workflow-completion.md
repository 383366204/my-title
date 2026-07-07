# Workflow Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Web workflow center as a single production workflow surface with clear runtime recovery and review states.

**Architecture:** Keep `pipeline-flow/runtime` as the execution engine and expose it through `/api/workflows/...`. The React workflow center becomes a read-only production flow view with editable start parameters and node-level recovery actions.

**Tech Stack:** Node.js, Express, CommonJS backend, React, React Flow, `node:test`.

---

### Task 1: Review State Intent

**Files:**
- Modify: `core/test/workflow-pipeline-adapter.test.js`
- Modify: `core/workflow/pipeline-adapter.js`

- [ ] Add a test that `needs_review` exposes `open-review`.
- [ ] Add a test that `ready_to_distribute` exposes `confirm-distribution`.
- [ ] Update `summaryInterventionForNode` to return those actions on the review node.
- [ ] Run `node --test core/test/workflow-pipeline-adapter.test.js`.

### Task 2: Workflow API Runtime Proxy

**Files:**
- Modify: `test/workflow-api-recovery.test.js`
- Modify: `bin/server.js`

- [ ] Add a test that `/api/workflows/runs/:runId/pause` pauses a production runtime run.
- [ ] Add a test that `/api/workflows/runs/:runId/retry-node` delegates to runtime retry for `mine|verify|generate|export`.
- [ ] Add a test that `/api/workflows/runs/:runId/resume` delegates to runtime resume from the active step.
- [ ] Implement production-runtime detection by reading runtime state, with legacy workflow fallback.
- [ ] Run `node --test test/workflow-api-recovery.test.js`.

### Task 3: Frontend Workflow Surface

**Files:**
- Modify: `apps/web/src/WorkflowStudio.jsx`
- Modify: `apps/web/src/workflow-ui.js`
- Modify: `apps/web/src/workflow-ui.test.mjs`

- [ ] Add a pure helper for workflow operation request construction.
- [ ] Test that retry/resume/pause target `/api/workflows/...`, not `/api/pipeline/...`.
- [ ] Remove free node insertion, edge connection, and delete controls from the production workflow center.
- [ ] Keep start-node parameter editing.
- [ ] Add UI handling for review/confirm recommended actions as guidance-only logs unless a safe backend submit action is explicitly added later.
- [ ] Run `node --test apps/web/src/workflow-ui.test.mjs`.

### Task 4: Runtime Files Ignore

**Files:**
- Modify: `.gitignore`

- [ ] Add `data/platform-access/`.
- [ ] Verify `git check-ignore data/platform-access/sycm/breaker.json`.

### Task 5: Verification

**Commands:**
- `node --test core/test/workflow-pipeline-adapter.test.js`
- `node --test test/workflow-api-recovery.test.js`
- `node --test apps/web/src/workflow-ui.test.mjs`
- `cd apps/web && npm run build`

- [ ] Run the focused tests and Web build.
- [ ] Inspect `git diff`.
- [ ] Commit and push the branch.
