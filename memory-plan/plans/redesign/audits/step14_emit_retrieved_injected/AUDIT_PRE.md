# AUDIT_PRE — Step 1.4: Emit memory.retrieved + memory.injected in the inject server

## §0 Re-orient

- Where am I: Block 1 (event log spine), step 4/5, 8/40 overall.
- Last step changed: 1.3 wired `memory.extracted` at all 3 flush boundaries in the daemon.
- This step contributes: wires the remaining two boundary events (retrieved + injected) at the inject server HTTP handler — completing the existing-ops event coverage in Block 1.
- Block serves the north star via: MASTER_PLAN §3.1 — "every memory operation publishes a structured, signed event to the per-node JetStream stream."
- Still the right next step? Yes — 1.4 is the next `[ ]` in INVENTORY.md.

## §1 Intent

Emit `memory.retrieved` and `memory.injected` events in the `/memory/inject` HTTP handler (`lib/memory-inject-server.mjs`). Both events happen per request: retrieval is the fetch phase, injection is the full response. The daemon must pass `localEventLog` and `NODE_ID` to the inject server so it can publish.

## §2 Design

Carry-forwards from step 1.3 AUDIT_POST §6:
- The `emitExtractEvent` pattern (guard on eventLog, buildMemoryEvent, fire-and-forget publish with catch) is reused.
- The inject server lives in `lib/memory-inject-server.mjs`.
- Both events happen in the same HTTP request: retrieve → format → respond.
- `DEFAULT_MODEL` import is established in the daemon (not needed here — inject server doesn't do LLM calls).

Event schema fields (defined in step 1.1):
- `MemoryRetrievedSchema.data`: `{ query_hash, channels_hit, results_count, duration_ms }`
- `MemoryInjectedSchema.data`: `{ request_id, token_count, blocks_count, duration_ms }`

Design:
1. `startInjectionServer(deps, opts)` gains `deps.eventLog` + `deps.nodeId` (optional, graceful no-op when absent).
2. `buildHandler` receives `eventLog` + `nodeId` in its closure.
3. In the POST /memory/inject handler, after `injector.retrieve()` completes: emit `memory.retrieved` with SHA-256 hash of prompt (first 16 chars), count of non-empty item categories as channels_hit, total items as results_count, retrieval elapsed_ms.
4. After `formatMemoryBlock()` and before `sendJson`: emit `memory.injected` with a per-request UUID, token count, items count, total elapsed_ms.
5. Both emissions are fire-and-forget with `.catch()`.
6. Import `buildMemoryEvent` from `local-event-log.mjs` and `crypto` (already imported).

## §3 Risk register

| Risk | Mitigation |
|---|---|
| Inject server latency increased by event emission | Fire-and-forget; publish is non-blocking |
| eventLog null at server start (NATS not yet connected) | Guard on presence; no-op when absent |
| crypto.createHash adds overhead | SHA-256 of prompt is <1ms even for 64KB |

## §4 File-delta outline

| File | Change |
|---|---|
| `lib/memory-inject-server.mjs` | Import `buildMemoryEvent`; accept `eventLog`+`nodeId` in deps; emit both events in handler |
| `workspace-bin/memory-daemon.mjs` | Pass `localEventLog` + `NODE_ID` to `startInjectionServer` deps |
| `test/event-schemas.test.mjs` | Add producer tests for `buildMemoryEvent("memory.retrieved")` and `buildMemoryEvent("memory.injected")` |
