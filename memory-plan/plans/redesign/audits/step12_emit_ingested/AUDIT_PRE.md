# AUDIT_PRE — Step 1.2: Emit memory.ingested at the ingest boundary

## §0 Re-orient

- Where am I: Block 1 (L1 event log spine), step 2/5, 6/40 overall.
- Last step changed: 1.1 defined 8 boundary-event Zod schemas in `packages/event-schemas`.
- This step contributes: wires the first producer — `memory.ingested` emitted at every session import, giving the watcher (L2) real ingest telemetry.
- Block serves the north star via: DESIGN_INPUTS §1 (Karpathy wiki) — the event log is the substrate the watcher + synthesis observe.
- Still the right next step? Yes — schemas exist, producers are next; ingest is the pipeline entry point.

## 1. Intent

Every time the daemon imports a session into state.db (via `SessionStore.importSession`), a `memory.ingested` event is published to the local NATS stream `local-events-daedalus`. The event carries `session_id`, `source`, `messages_added`, `total_messages` per the schema defined in step 1.1.

## 2. Design

Three ingest call sites in the daemon need wiring:

1. **Phase 0 Bootstrap** (`runPhase0Bootstrap`, line ~504): `store.importDirectory()` per transcript source.
2. **Phase 2 Throttled Work** (`runPhase2ThrottledWork`, line ~721): periodic `store.importDirectory()`.
3. **IDLE→ENDED transition** (`handleTransitions`, line ~928): `store.importSession()` for the current session.

Approach: add an optional `onImported` callback to `SessionStore.importDirectory()`. When a session is successfully imported, the callback fires with the import result (`{sessionId, messageCount, imported}`). The daemon passes a callback that builds and publishes the `memory.ingested` event. For the direct `importSession` call in IDLE→ENDED, emit inline after a successful import.

A helper function `emitIngestEvent(sessionId, source, messageCount)` in the daemon avoids duplication across the 3 sites.

Carry-forwards consumed from step 1.1 AUDIT_POST §6:
- The `memory.ingested` schema is ready.
- `buildMemoryEvent` + `publishLocal` are the emission API.

## 3. Risk register

| Risk | Mitigation |
|---|---|
| `localEventLog` is null (NATS unavailable) | Guard with `if (localEventLog)` — fire-and-forget pattern, same as existing `publishLocal` usage in memory-budget |
| `publishLocal` throws on malformed event | Catch + log; do not let event emission break the import path |
| `importDirectory` callback changes the return contract | It doesn't — the callback is additive (opt-in), existing callers unaffected |

## 4. Done-evidence (from INVENTORY)

> trigger the op; the matching event appears in `local-events-<nodeId>` with who/op/session/ts.

Concretely: restart the daemon, wait for a session import cycle, then `nats stream view local-events-daedalus` shows a `memory.ingested` event with the session fields populated.

## 5. File-delta outline

| File | Change |
|---|---|
| `lib/session-store.mjs` | Add `onImported` callback option to `importDirectory` |
| `workspace-bin/memory-daemon.mjs` | Add `emitIngestEvent` helper; wire it at the 3 ingest call sites |
| `test/event-schemas.test.mjs` | Add test: `emitIngestEvent` builds a valid `memory.ingested` event |
