# AUDIT_PRE — Step 1.5: Emit memory.error on caught failures across the wired boundaries

## §0 Re-orient

- Where am I: Block 1 (L1 event log spine), step 5/5, 9/40 overall.
- Last step changed: 1.4 wired memory.retrieved + memory.injected in the inject server.
- This step contributes: the final event type — memory.error — completing the Block 1 boundary-event spine. Every wired boundary now reports both success AND failure.
- Block serves the north star via: DESIGN_INPUTS §2 one-hop observability; the watcher (L2) needs error events to classify op outcomes.
- Still the right next step? Yes — it's the last Block 1 step; closes the event vocabulary loop.

## 1. Intent

Wire `memory.error` emission at all caught-failure paths across the 3 already-wired boundaries (ingest, extract, retrieve). Currently 7 catch blocks log-only and silently swallow — after this step each emits a structured `memory.error` event to `local-events-daedalus`.

## 2. Design

**Schema (already defined in 1.1):** `MemoryErrorSchema` — `{ boundary: enum, error_code: string, error_message: string, session_id?: string }`.

**Daemon helper:** Add `emitErrorEvent(boundary, err, sessionId)` after the existing `emitExtractEvent`. Same fire-and-forget pattern. `error_code` derived from constructor name or 'UNKNOWN'. `error_message` truncated to 500 chars.

**7 catch sites wired:**

| # | File | Boundary | Context | error_code |
|---|---|---|---|---|
| 1 | memory-daemon.mjs:541 | ingest | Phase 0 bootstrap batch | IMPORT_FAILED |
| 2 | memory-daemon.mjs:760 | ingest | Phase 2 throttled batch | IMPORT_FAILED |
| 3 | memory-daemon.mjs:978 | ingest | end-of-session archive | IMPORT_FAILED |
| 4 | memory-daemon.mjs:915 | extract | ACTIVE→IDLE flush | FLUSH_FAILED |
| 5 | memory-daemon.mjs:959 | extract | IDLE→ENDED flush | FLUSH_FAILED |
| 6 | memory-daemon.mjs:1215 | extract | NATS-triggered flush | FLUSH_FAILED |
| 7 | memory-inject-server.mjs:245 | retrieve | HTTP 500 handler | RETRIEVE_FAILED |

**session_id availability:** Optional. Extract boundaries have `currentJsonl` → basename is the session UUID. Ingest batch sites have no single session. Inject server has `retrieveOpts.sessionId` (when set by caller).

**Carry-forward from 1.4 §6:** The inject server's `eventLog` and `nodeId` are already in scope at the catch block. The daemon's `emitIngestEvent` and `emitExtractEvent` helpers catch-swallow errors — step 1.5 parallels them with `emitErrorEvent`.

## 3. Risk register

- **Risk:** Event emission in catch blocks could itself throw if NATS is down. **Mitigation:** Same fire-and-forget `.catch()` pattern as existing emitters; `if (!localEventLog) return` guard.
- **Risk:** Noisy error events from pre-existing Zod validation failures. **Mitigation:** These are caught INSIDE `runFlush` (graceful degradation to regex), not at the daemon catch blocks. Daemon catch blocks only fire on catastrophic failures that escape the flush entirely.

## 4. File-delta outline

| File | Change |
|---|---|
| `workspace-bin/memory-daemon.mjs` | Add `emitErrorEvent` helper; wire at 6 catch blocks |
| `lib/memory-inject-server.mjs` | Emit `memory.error` in the HTTP 500 catch block |
| `test/event-schemas.test.mjs` | Add producer test: `buildMemoryEvent('memory.error')` validates against `MemoryErrorSchema` |
