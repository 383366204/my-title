# Project Hardening And Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the repository easier to verify and hand off by adding one full local quality command, GitHub Actions CI, current documentation, platform smoke checks, and post-merge branch cleanup.

**Architecture:** Keep changes small and operational. The first task creates a single source of truth for local verification; CI reuses that command. Documentation explains the current CLI, MCP, Web UI, workflow, platform dependencies, and manual-action states without changing business logic.

**Tech Stack:** Node.js CommonJS, `node:test`, React/Vite under `apps/web`, GitHub Actions, Markdown documentation.

---

## Current Context

- Repository root: `/Users/sunnstars/Documents/Codex/2026-06-11/new-chat/work/my-title`
- Current branch after merge: `master`
- Current status before this plan was written: `master...origin/master`
- Root `npm test` only runs `node --test test/*.test.js`.
- Full verification currently requires three separate commands:
  - `npm test`
  - `node --test core/test/*.js skills/alibaba1688/test/*.js skills/title-gen/test/*.js`
  - `npm run web:build`
- `.github/workflows` does not exist yet.
- `apps/web/README.md` still contains the default Vite template text.
- `doctor --json` currently reports the local environment as ready, but SYCM and Taobao still depend on live platform state and may require manual login, slider, feature activation, or account access.

## Files

- Modify: `package.json`
  - Add `test:core-skills` and `test:all` scripts.
- Create: `.github/workflows/ci.yml`
  - Run install and `npm run test:all` on push and pull request.
- Modify: `README.md`
  - Update usage, Web UI, workflow, environment variables, and test instructions.
- Replace: `apps/web/README.md`
  - Replace Vite template text with project-specific Web UI instructions.
- Create: `docs/operations/platform-smoke-checks.md`
  - Document live Taobao/SYCM/image-search verification commands and expected manual-action responses.
- Optional cleanup after all verification passes:
  - Delete local and remote `feature/workflow-ui-canvas` branch.

---

## Task 1: Add One Full Local Verification Command

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Verify the current full command is missing**

Run:

```bash
npm run test:all
```

Expected:

```text
npm ERR! Missing script: "test:all"
```

- [ ] **Step 2: Add root scripts**

Edit `package.json` so `scripts` becomes:

```json
{
  "test": "node --test test/*.test.js",
  "test:core-skills": "node --test core/test/*.js skills/alibaba1688/test/*.js skills/title-gen/test/*.js",
  "test:all": "npm test && npm run test:core-skills && npm run web:build",
  "ui": "node bin/server.js",
  "web:dev": "npm run dev --prefix apps/web",
  "web:build": "npm run build --prefix apps/web",
  "web:preview": "npm run preview --prefix apps/web",
  "ui:react": "npm run web:build && npm run ui"
}
```

Do not add new dependencies.

- [ ] **Step 3: Run the new focused script**

Run:

```bash
npm run test:core-skills
```

Expected:

```text
ℹ fail 0
```

The exact pass count can change as tests are added. The command must exit `0`.

- [ ] **Step 4: Run the full verification command**

Run:

```bash
npm run test:all
```

Expected:

```text
✓ built
```

The command must exit `0`. It must run root tests, core/skill tests, and Vite build.

- [ ] **Step 5: Commit**

Run:

```bash
git add package.json
git commit -m "chore: add full project verification script"
```

---

## Task 2: Add GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Verify no CI workflow exists**

Run:

```bash
find .github/workflows -maxdepth 1 -type f -print 2>/dev/null || true
```

Expected before implementation:

```text
```

- [ ] **Step 2: Create the workflow**

Create `.github/workflows/ci.yml` with exactly this content:

```yaml
name: CI

on:
  push:
    branches:
      - master
  pull_request:
    branches:
      - master

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 26
          cache: npm

      - name: Install root dependencies
        run: npm ci

      - name: Install web dependencies
        run: npm ci --prefix apps/web

      - name: Run full verification
        run: npm run test:all
```

- [ ] **Step 3: Verify workflow file exists and references the full command**

Run:

```bash
test -f .github/workflows/ci.yml && rg -n "npm run test:all|node-version: 26|npm ci --prefix apps/web" .github/workflows/ci.yml
```

Expected:

```text
.github/workflows/ci.yml:23:          node-version: 26
.github/workflows/ci.yml:30:        run: npm ci --prefix apps/web
.github/workflows/ci.yml:33:        run: npm run test:all
```

Line numbers can differ if comments are added, but all three matches must exist.

- [ ] **Step 4: Run local full verification again**

Run:

```bash
npm run test:all
```

Expected: command exits `0`.

- [ ] **Step 5: Commit**

Run:

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add project verification workflow"
```

---

## Task 3: Update Root README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Verify README is missing current Web UI and test command details**

Run:

```bash
rg -n "test:all|Workflow UI|React|Vite|platform smoke|MiniMax|DeepSeek" README.md || true
```

Expected before implementation: no `test:all`, no `Workflow UI`, and no `platform smoke` matches.

- [ ] **Step 2: Update README content**

Keep the existing title and project framing, then make these concrete edits:

1. Add these feature bullets under `## 功能`:

```markdown
- 🖥️ **Web UI**: React + Vite 工作流画布，支持从浏览器发起标题生成与工作流运行
- 🧩 **Workflow 编排**: 内置 workflow registry、validator、scheduler、run-store 和 SSE 实时日志
- 🛡️ **平台访问保护**: 对 1688、淘宝、SYCM 的登录/滑块/限流状态做结构化拦截与人工动作提示
```

2. Add this section after the CLI examples:

```markdown
## Web UI

```bash
npm run ui:react
```

访问：

```text
http://localhost:3000/workflow/
```

开发模式：

```bash
npm run web:dev
```

Web UI 位于 `apps/web/`，后端 API 和 SSE 入口位于 `bin/server.js`。生产运行时 `npm run ui:react` 会先构建前端，再启动 Express 服务。
```

3. Add this section after `## MCP Server`:

```markdown
## Workflow API

后端提供工作流模板、校验、运行、取消、历史记录和 SSE 日志：

| API | 功能 |
|-----|------|
| `GET /api/workflows/templates` | 获取内置工作流模板 |
| `POST /api/workflows/validate` | 校验工作流节点和连线 |
| `POST /api/workflows/run` | 启动工作流 |
| `GET /api/workflows/runs` | 查看运行历史 |
| `GET /api/workflows/runs/:runId` | 查看单次运行状态和日志 |
| `POST /api/workflows/runs/:runId/cancel` | 取消运行 |
| `GET /api/workflows/runs/:runId/events` | SSE 实时事件流 |
```

4. Replace the environment variable table with:

```markdown
| 变量 | 必填 | 说明 |
|------|------|------|
| `GLM_API_KEY` | 是 | 智谱 GLM API 密钥 |
| `GLM_API_BASE` | 否 | GLM API 地址，默认官方 |
| `GLM_API_MODEL` | 否 | GLM 模型名称，默认 `glm-4-flash` |
| `ALI_1688_AK` | 是 | 1688 AI 版 Access Key |
| `LLM_PROVIDER` | 否 | 标题生成 LLM 提供方：`glm`、`minimax`、`deepseek`、`openai-compatible` |
| `MINIMAX_API_KEY` | 否 | `LLM_PROVIDER=minimax` 时使用 |
| `DEEPSEEK_API_KEY` | 否 | `LLM_PROVIDER=deepseek` 时使用 |
| `TAOBAO_NATIVE_PATH` | 否 | taobao-native CLI 路径，用于淘宝同行标题和图搜 |
| `SYCM_LOGIN_MODE` | 否 | 当前仅支持 `manual`，复用人工登录态 |
| `SYCM_CHROME_PROFILE_DIR` | 否 | 生意参谋 Chrome profile 目录 |
| `SYCM_REMOTE_DEBUGGING_PORT` | 否 | Chrome CDP 端口，默认 `9222` |
| `TAOBAO_OPC_URL` | 否 | 淘宝图片优化 MCP 网关地址 |
```

5. Replace the test section with:

```markdown
## 测试

```bash
# 根集成测试
npm test

# core + skill 单元测试
npm run test:core-skills

# 完整本地验证：根测试 + core/skill 测试 + Web 构建
npm run test:all
```

不要使用 `node --test core/test/` 目录形式；当前 Node 26 会把目录当作模块入口。请使用显式 glob，例如 `node --test core/test/*.js`。
```

6. Add this section before `## 许可`:

```markdown
## 平台状态诊断

```bash
node bin/cli.js doctor --json
node bin/cli.js sycm-status --json
node bin/cli.js title-gen-preflight --json
```

SYCM、淘宝桌面版和 1688 页面能力可能返回 `login_required`、`slider_required`、`sycm_feature_required`、`captcha_required` 或 `rate_limited`。这些状态需要人工处理后重试，工具不会自动输入密码、验证码或拖动滑块。
```

- [ ] **Step 3: Verify README now advertises current commands**

Run:

```bash
rg -n "npm run test:all|Workflow UI|/api/workflows/run|title-gen-preflight|LLM_PROVIDER" README.md
```

Expected: each term is found at least once.

- [ ] **Step 4: Commit**

Run:

```bash
git add README.md
git commit -m "docs: refresh project usage guide"
```

---

## Task 4: Replace Web README Template

**Files:**
- Replace: `apps/web/README.md`

- [ ] **Step 1: Verify current README is still template text**

Run:

```bash
rg -n "React \\+ Vite|template provides a minimal setup|React Compiler" apps/web/README.md
```

Expected before implementation: matches exist.

- [ ] **Step 2: Replace the file**

Replace `apps/web/README.md` with exactly this content:

```markdown
# ecom-ai-tools Web UI

React + Vite workflow canvas for the ecommerce title and product-selection tool.

## Commands

Run from the repository root:

```bash
npm run web:dev
npm run web:build
npm run web:preview
npm run ui:react
```

Run from this directory:

```bash
npm install
npm run dev
npm run build
npm run preview
npm run lint
```

## Runtime Shape

- Frontend source: `apps/web/src/`
- Express backend: `bin/server.js`
- Static production route: `/workflow/`
- Workflow APIs: `/api/workflows/*`
- Live run updates: `/api/workflows/runs/:runId/events`

## Expected Local Flow

1. Run `npm run ui:react` from the repository root.
2. Open `http://localhost:3000/workflow/`.
3. Select a workflow template or edit the canvas.
4. Run validation before starting the workflow.
5. Watch node status and logs update over SSE.

## Verification

```bash
npm run build
```

The build must complete without Vite errors. Root-level verification is:

```bash
npm run test:all
```
```

- [ ] **Step 3: Verify template text is gone and project text exists**

Run:

```bash
rg -n "React Compiler|template provides a minimal setup" apps/web/README.md || true
rg -n "ecom-ai-tools Web UI|/api/workflows|npm run test:all" apps/web/README.md
```

Expected: first command returns no matches; second command returns matches.

- [ ] **Step 4: Commit**

Run:

```bash
git add apps/web/README.md
git commit -m "docs: document workflow web ui"
```

---

## Task 5: Add Platform Smoke Check Runbook

**Files:**
- Create: `docs/operations/platform-smoke-checks.md`

- [ ] **Step 1: Create operations docs directory**

Run:

```bash
mkdir -p docs/operations
```

- [ ] **Step 2: Add the smoke check document**

Create `docs/operations/platform-smoke-checks.md` with exactly this content:

```markdown
# Platform Smoke Checks

Use this runbook before relying on live Taobao, 1688, SYCM, or image-search flows.

## Baseline

```bash
node bin/cli.js doctor --json
```

Expected ready state:

```json
{
  "ok": true,
  "status": "ready",
  "nextActionCode": "doctor_ready",
  "requiresUserAction": false,
  "blockers": []
}
```

If the command returns `requiresUserAction=true`, complete the `userMessage` instruction before continuing.

## SYCM Readiness

```bash
node bin/cli.js sycm-status --json
```

Ready means Chrome CDP is reachable. Login and slider state are still verified by a real query:

```bash
node bin/cli.js sycm "项链" --mode blue --pages 1 --json
```

Stop and ask the user to act when any of these statuses appear:

- `login_required`
- `slider_required`
- `sycm_feature_required`
- `manual_action_required`

Do not attempt password login, SMS login, QR login, or slider dragging from automation.

## Title Generation Preflight

```bash
node bin/cli.js title-gen-preflight --json
```

Use this before `use_image_search=true`. If Chrome CDP is blocked, start Chrome with remote debugging and rerun the preflight.

## Text Title Generation

```bash
node bin/cli.js "纯银项链女高级感" --length 60 --format json
```

Expected:

- JSON parses successfully.
- `ok` is true or the payload includes actionable blockers.
- Generated titles do not contain platform-banned words.

## Manual Peer Titles Fallback

```bash
node bin/cli.js "纯银项链女高级感" --peer-titles "925纯银项链女锁骨链简约百搭,韩版项链女设计感小众" --format json
```

Expected:

- The run does not require Taobao desktop search.
- Output still includes generated titles or an actionable degraded status.

## Image Search Title Generation

```bash
node bin/cli.js "纯银项链女高级感" --use-image-search --max-image-search 3 --format json
```

Expected:

- Image search either returns peer titles or degrades to text/manual peer-title paths.
- `captcha_required`, `login_required`, or account-access errors are surfaced as manual action states.
- The process exits without hanging beyond the configured run timeout.

## Web UI Smoke

```bash
npm run ui:react
```

Open:

```text
http://localhost:3000/workflow/
```

Verify:

- Templates load.
- Validation rejects invalid graphs.
- A demo workflow run starts.
- Node status and logs update through SSE.
- Cancel changes an in-progress run to a cancelled state.
```

- [ ] **Step 3: Verify runbook is searchable**

Run:

```bash
rg -n "Platform Smoke Checks|title-gen-preflight|--use-image-search|manual_action_required|/workflow/" docs/operations/platform-smoke-checks.md
```

Expected: all terms are found.

- [ ] **Step 4: Commit**

Run:

```bash
git add docs/operations/platform-smoke-checks.md
git commit -m "docs: add platform smoke check runbook"
```

---

## Task 6: Final Verification And Branch Cleanup

**Files:**
- No file edits required.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run test:all
```

Expected: command exits `0`.

- [ ] **Step 2: Run readiness diagnostics**

Run:

```bash
node bin/cli.js doctor --json
node bin/cli.js sycm-status --json
```

Expected: both commands return valid JSON. If either returns `requiresUserAction=true`, report the status and do not claim platform readiness.

- [ ] **Step 3: Confirm branch cleanup target**

Run:

```bash
git branch --merged master
git branch -r --merged origin/master
```

Expected: `feature/workflow-ui-canvas` and `origin/feature/workflow-ui-canvas` appear as merged branches.

- [ ] **Step 4: Delete the merged feature branch**

Run:

```bash
git branch -d feature/workflow-ui-canvas
git push origin --delete feature/workflow-ui-canvas
```

Expected:

```text
Deleted branch feature/workflow-ui-canvas
```

and remote delete succeeds.

- [ ] **Step 5: Push master**

Run:

```bash
git status --short --branch
git push origin master
```

Expected: `master...origin/master` is clean after push.

---

## Final Acceptance Criteria

- `npm run test:all` exists and exits `0`.
- GitHub Actions runs `npm run test:all` on `master` pushes and PRs into `master`.
- Root README documents CLI, MCP, Web UI, Workflow API, environment variables, tests, and platform diagnostics.
- `apps/web/README.md` no longer contains Vite template copy.
- `docs/operations/platform-smoke-checks.md` documents live platform verification and manual-action states.
- `feature/workflow-ui-canvas` is deleted locally and remotely after it is confirmed merged.
- `git status --short --branch` ends clean on `master...origin/master`.

## Execution Options

1. **Antigravity / External Agent**
   - Give the agent this plan file.
   - Ask it to execute tasks in order and commit after each task.
   - Require the final acceptance criteria output before merging or pushing.

2. **Codex Inline Execution**
   - Execute the same tasks in this thread.
   - Use fresh verification after every task.
   - Push `master` after final verification.

3. **Subagent-Driven Execution**
   - Dispatch one fresh implementation worker per task.
   - Review each task diff before starting the next one.
   - Use this when you want maximum isolation between documentation, CI, and cleanup work.

