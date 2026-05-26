# AUDIT_PRE — Step 10.3: Wire `ensureSharedStream` at memory-daemon startup; verify R=3 propagates

## §1 — Intent

Wire the existing `ensureSharedStream(nc)` helper (from Step 1.4, `lib/shared-event-stream.mjs`) to actually run at memory-daemon startup. After ensuring the stream exists, read its config back via `inspectSharedStream` and verify that `num_replicas === 3` and `storage === File`. If the shared stream config doesn't match, refuse to start (exit with error). If NATS itself is unavailable, the daemon continues without federation (existing graceful degradation, unchanged).

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 10 | 10.3 | v10.3 | [A] | Wire `ensureSharedStream` at memory-daemon startup; verify R=3 propagates |

## §3 — Design decisions (consumed from Step 10.2 AUDIT_POST §6)

- Test baseline: 1037 tests (962 pass, 75 fail — 73 pre-existing + 2 flaky variance). No tests added last step (infrastructure-only).
- NATS cluster configs are in `services/nats/nats-{1,2,3}.conf` — ready for operator deployment.
- The cluster must be running before Step 10.3 can verify R=3 propagation of `OPENCLAW_SHARED`.
- `nats-server` binary confirmed at `/opt/homebrew/bin/nats-server`.
- `@publish` directive wiring deferred (carried from Step 9.5).

Block 10 §0 frozen decisions for 10.3:
> Wire `ensureSharedStream(nc)` (Block 1.4) to actually run at memory-daemon startup, not just be available as a helper. Verify R=3 propagates by reading stream info on each node. Refuse to start if shared stream config doesn't match expected R=3 / file storage.

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | Daemon refuses to start when NATS cluster has <3 nodes | LOW | Only refuse on config mismatch when NATS IS connected and stream EXISTS with wrong config. If NATS unavailable → existing graceful degradation (no change). |
| 2 | `ensureSharedStream` throws on cluster with <3 nodes (R=3 rejected) | LOW | Catch the error, log it, and let existing graceful degradation handle it (NATS subsystem unavailable, daemon continues locally). Only refuse-to-start when stream EXISTS but with wrong config. |
| 3 | Existing daemon behavior changes for single-node operators | LOW | No change: single-node setups that don't have a 3-node NATS cluster simply get the existing "NATS unavailable" graceful degradation. |

## §5 — Deferrals

- `@publish` directive wiring into daemon per-prompt path (carried from Step 9.5).
- Real multi-node runtime verification (Steps 10.5/10.6).

## §6 — Phase 4 implementation outline

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `lib/shared-event-stream.mjs` | modify | Add `verifySharedStreamConfig(streamInfo)` export: validates `config.num_replicas === 3` and `config.storage === File`. Returns `{ valid: boolean, reasons: string[] }`. |
| 2 | `workspace-bin/memory-daemon.mjs` | modify | Import `ensureSharedStream`, `inspectSharedStream`, `verifySharedStreamConfig`. After NATS connection + local event log init (~line 1109), add shared stream wiring: call `ensureSharedStream(natsConn)` → `inspectSharedStream(natsConn)` → `verifySharedStreamConfig(info)`. On invalid config → log error + `process.exit(1)`. On stream creation failure (e.g. <3 nodes) → log warning, continue without shared stream. |
| 3 | `test/shared-stream-startup.test.mjs` | new | Tests for `verifySharedStreamConfig`: valid config passes, wrong `num_replicas` fails, wrong `storage` fails, both wrong lists both reasons, missing fields handled. Plus mock pipeline test: ensure → inspect → verify sequence with mock NATS. ~8-10 `it()` blocks. |
