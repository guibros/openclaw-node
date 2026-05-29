# AUDIT_PRE — Step 1.2: Create local event log substrate (lib/local-event-log.mjs + JetStream R=1 stream + dual-write wiring)

**Version:** v1.2-pre
**Date:** 2026-05-21
**Author:** memory-plan-tick

---

## §1 — Intent

Create the local event log substrate: a NATS JetStream-backed, per-node, durable event log that enables shadow-mode dual-writing of memory lifecycle events alongside the existing MEMORY.md file writes. This is the second deliverable of Block 1 (Schema & event foundations) and the first consumer of the `packages/event-schemas` package created in Step 1.1.

The module provides:
- A JetStream stream `local-events-${NODE_ID}` at R=1, file-backed (sovereign local storage)
- A `publishLocal(event)` API that validates events against `MemoryEventSchema` before publishing
- Event construction helpers for building envelope-conformant events
- Dual-write wiring in `MemoryBudget` for three call sites: `startSession`, `endSession`, `addEntry`

All publishing is fire-and-forget — NATS failures do not block the existing MEMORY.md write path. This is shadow mode; the event log accumulates alongside existing writes for validation.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 1 | 1.2 | v1.2 | [A] | Create local event log substrate (lib/local-event-log.mjs + JetStream R=1 stream + dual-write wiring) |

## §3 — Design decisions (from prior AUDIT_POST §6 carry-forwards)

Carry-forwards consumed from Step 1.1 `AUDIT_POST §6`:

- **Test baseline:** 497 tests (424 pass, 73 fail pre-existing). +15 tests added in Step 1.1.
- **npm install status:** May still be blocked. Event-schemas build uses mission-control's tsc via path reference. The `pretest` script auto-builds workspace packages before tests.
- **event-schemas imports:** Package exports `MemoryEventSchema` (discriminated union), individual schemas (`SessionStartedSchema`, `SessionEndedSchema`, `FactExtractedSchema`, etc.), and `EventEnvelopeSchema`. Import path from lib/: `../packages/event-schemas/dist/index.js`.
- **Build workaround:** The `as any` cast in `toJsonSchema()` and the tsc path reference resolve when workspace deps install properly. Not relevant to Step 1.2 (no TypeScript in this step).
- **docs stale refs:** `docs/ARCHITECTURE.md` stale references remain (out of scope for this step).
- **Cosmetic carry-forwards:** COMPANION var name, test fixture `confidence`, `pre-compact.sh` stub — unchanged.

Block 1 frozen decisions applied:
- NATS JetStream R=1, file-backed under `~/.openclaw/local-events/` (server-side storage; client creates stream with `storage: file`, `num_replicas: 1`)
- `publishLocal(event)` validates with `MemoryEventSchema.parse()`, uses `idempotency_key` as `msgID`
- Three dual-write sites in MemoryBudget: `startSession` → `memory.session_started`, `endSession` → `memory.session_ended`, `addEntry` → `memory.fact_extracted`
- Dual-write is shadow mode; existing MEMORY.md + session-store writes continue unchanged

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | NATS server not running during `npm test` | MEDIUM | Tests use mock/stub NATS; no live NATS required for unit tests |
| 2 | JetStream stream creation API shape between nats.js versions | LOW | Use documented nats.js v2.28+ API; `jetstreamManager().streams.add()` is stable |
| 3 | Top-level import of event-schemas dist/ may fail if not pre-built | LOW | `pretest` script builds workspace packages; tests always run after build |
| 4 | `MemoryBudget` private field access prevents clean injection | LOW | Use constructor opts pattern (already established: `opts.charBudget`); add `opts.eventLog` |
| 5 | Async `publishLocal` in sync `startSession`/`endSession` | LOW | Fire-and-forget pattern: call without await, catch errors in `.catch()` handler |

## §5 — Deferrals

- Stream consumer/projection API (needed for replay-based validation in future steps, not Step 1.2)
- Event replay capability (deferred until dual-write validation period)
- Feature flag `MEMORY_EVENT_LOG_ENABLED` (REFERENCE_PLAN mentions for rollback; not in Step 1.2 scope — the dual-write is simply absent when NATS is unavailable, which is equivalent)
- Subscribe API for reading events (Step 1.2 is publish-only; consumers come in later blocks)

## §6 — Phase 4 implementation outline

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `lib/local-event-log.mjs` | new | Core module: `createLocalEventLog(nc, nodeId)` factory that ensures JetStream stream exists (`local-events-${NODE_ID}`, R=1, file storage, subjects `local.>`), returns object with `publishLocal(event)` method. `buildMemoryEvent(eventType, entityId, entityType, data, nodeId, opts)` helper for constructing envelope-conformant events with auto-generated `event_id`, `timestamp`, `idempotency_key`. Imports `MemoryEventSchema` from event-schemas for validation. |
| 2 | `lib/memory-budget.mjs` | mod | Accept optional `eventLog` in constructor opts (stored as `#eventLog` private field). In `startSession()`: after freeze + emit, fire-and-forget call `#publishEvent('memory.session_started', ...)` with session data. In `endSession()`: before clearing state, fire-and-forget call `#publishEvent('memory.session_ended', ...)`. In `addEntry()`: after successful write + emit, fire-and-forget call `#publishEvent('memory.fact_extracted', ...)`. Add private `#publishEvent(type, data)` helper that catches all errors. Add `#sessionId` field (UUID generated at startSession, used as entity_id for all session-scoped events). |
| 3 | `workspace-bin/memory-daemon.mjs` | mod | After NATS connection succeeds (line ~1054), initialize local event log: `const eventLog = await createLocalEventLog(natsConn, NODE_ID)`. Pass `eventLog` into `initMemoryBudget` → `createBudget(workspace, { ..., eventLog })`. Add `eventLog` cleanup to shutdown handler (no separate cleanup needed — NATS drain handles it). Import `createLocalEventLog` at top of file. |
| 4 | `test/local-event-log.test.mjs` | new | Tests: (a) `buildMemoryEvent` produces valid envelope fields (event_id UUID, timestamp ISO, idempotency_key); (b) `buildMemoryEvent` for session_started/session_ended/fact_extracted matches schema; (c) `MemoryBudget` with mock eventLog calls publishLocal on startSession; (d) `MemoryBudget` with mock eventLog calls publishLocal on endSession; (e) `MemoryBudget` with mock eventLog calls publishLocal on addEntry (successful add); (f) `MemoryBudget` without eventLog works unchanged (no errors); (g) publishLocal errors don't propagate to MemoryBudget callers. |
