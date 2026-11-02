---
name: peer-discovery
description: "淘宝以货找店与以图选货铺货：分析同行优质店铺并挖掘优质1688货源商品。"
version: 1.0.0
platforms: [linux, macos, windows]
---

# peer-discovery

Use this skill to discover competitor Taobao shops from product links ("以货找店") or source products via image search ("以图选货铺货").

## Unified MCP Tools (PR-07)

External AI harnesses (Codex, Antigravity, dsh) access peer discovery capabilities through unified MCP tools:

1. `discover_peers` (`peer.discover`):
   - Initiates an asynchronous peer discovery task.
   - Arguments:
     - `links`: Comma-separated Taobao item URLs.
     - `discoveryBranch`: `'peer-analysis'` (shop discovery) or `'image-selection'` (image sourcing and draft preparation).
     - `imagePriceRatioThreshold`: Strict upper limit on sourcing price ratio (e.g. `1` or `0.8`).
     - `port`: Chrome CDP remote debugging port (default `9222`).
   - Returns `{ ok: true, taskId, status: 'queued' | 'running', ... }`.

2. `get_peer_discovery_status` (`peer.status`):
   - Queries real-time progress and snapshot for an existing task.
   - Arguments:
     - `taskId`: The task ID returned by `discover_peers`.

3. `cancel_peer_discovery` (`peer.cancel`):
   - Requests graceful cancellation of an active task.
   - Arguments:
     - `taskId`: The task ID to cancel.

## Workflow Integration

Peer discovery is fully integrated into the unified Workflow runner:

- Use `workflow_start` with `mode: 'peer-discovery'` and pass `links` in `params`.
- Supports human review at `peer-review` checkpoint before publishing or exporting.
