# ecom-ai-tools Web UI

React + Vite workflow canvas for the ecommerce title and product-selection tool.

## Commands

Run from the repository root:

```bash
npm start       # Build and start the complete application
npm run dev    # Start backend + frontend with React hot reload
npm run build  # Build frontend assets only
npm run serve  # Serve existing assets and backend APIs
```

Frontend-only maintenance commands, run from this directory (dev/preview do not start the backend):

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
- Static production route: `/`
- Workflow APIs: `/api/workflows/*`
- Live run updates: `/api/workflows/runs/:runId/events`

## Expected Local Flow

1. Run `npm start` from the repository root.
2. Open the URL printed in the terminal (normally `http://127.0.0.1:3000/`).
3. Select a workflow template or edit the canvas.
4. Run validation before starting the workflow.
5. Watch node status and logs update over SSE.

For development, run `npm run dev` from the root and open its frontend URL (normally port 5173). The API proxy follows the actual backend port. Ctrl+C stops both services. Backend edits require restarting the command. `UI_PORT` and `WEB_PORT` select starting ports.

## Verification

```bash
npm run build
```

The build must complete without Vite errors. Root-level verification is:

```bash
npm run test:all
```
