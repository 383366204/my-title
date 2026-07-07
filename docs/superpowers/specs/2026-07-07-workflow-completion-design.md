# Workflow Completion Design

## Goal

Make the Web workflow center feel like one coherent production workflow instead of a mixed canvas, monitor, and pipeline console.

## Decisions

1. The production templates are authoritative. The Web canvas should show the fixed business flow and node state, but it should not offer free node insertion or edge editing until the backend supports arbitrary executable graphs.
2. The frontend should use `/api/workflows/...` as the single public workflow API. The server may delegate to `pipeline-flow/runtime`, but that detail should not leak into the UI.
3. Runtime recovery must preserve the existing safe controls: pause requests stop at safe boundaries, resume continues from the current active step, and retry reruns the selected pipeline step and downstream work.
4. Review and distribution are human-confirmed states. The UI should show review/report actions and explicit confirmation guidance, but it must not silently submit distribution.
5. Start nodes have no artifacts. Mining and later nodes should prefer business-friendly artifact views over raw JSON dumps.
6. Generated runtime files under `data/platform-access/` are local circuit-breaker state and should be ignored by git.

## Scope

This implementation slice covers workflow-center clarity, API unification, recovery behavior, and review/confirmation state hints. It does not add automatic distribution submit, arbitrary graph execution, or a scheduler.

## Data Flow

`WorkflowStudio.jsx` loads production templates from `/api/workflows/templates`, starts runs through `/api/workflows/run`, listens through `/api/workflows/runs/:runId/events`, fetches node artifacts through `/api/workflows/runs/:runId/artifacts/:nodeId`, and sends pause/resume/retry through `/api/workflows/runs/:runId/*`.

`bin/server.js` keeps legacy `core/workflow` recovery behavior for old `run_` style runs. For production pipeline runs with runtime state, the same workflow endpoints proxy into the runtime store and runner.

## Testing

Add failing tests first for:

- review and ready-to-distribute node states exposing clear recommended actions;
- workflow recovery endpoints delegating to production pipeline runtime;
- frontend operation endpoint selection using `/api/workflows/...`;
- ignored platform-access runtime state.

Then run focused node tests and the Web build.
