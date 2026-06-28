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
