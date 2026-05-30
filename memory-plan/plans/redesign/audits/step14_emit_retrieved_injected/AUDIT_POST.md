# AUDIT_POST — Step 1.4: Emit memory.retrieved + memory.injected in the inject server

## 1. Files-vs-plan ledger

| Plan (AUDIT_PRE §4) | Actual | Match |
|---|---|---|
| EDIT `lib/memory-inject-server.mjs` — import `buildMemoryEvent`; accept `eventLog`+`nodeId` in deps; emit both events in handler | Done — import added; `buildHandler` gains `eventLog`+`nodeId`; `startInjectionServer` JSDoc + `resolveDeps` passthrough updated; handler emits `memory.retrieved` after `injector.retrieve()` and `memory.injected` before `sendJson` | ✓ |
| EDIT `workspace-bin/memory-daemon.mjs` — pass `localEventLog` + `NODE_ID` to `startInjectionServer` | Done — `eventLog: localEventLog, nodeId: NODE_ID` added to deps object at line 1238 | ✓ |
| EDIT `test/event-schemas.test.mjs` — add producer tests for retrieved + injected | Done — 2 new test cases: `buildMemoryEvent("memory.retrieved")` validates against `MemoryRetrievedSchema`; `buildMemoryEvent("memory.injected")` validates against `MemoryInjectedSchema` | ✓ |

No unplanned files touched.

## 2. Greppable deltas

```
lib/memory-inject-server.mjs:38         — import { buildMemoryEvent } from './local-event-log.mjs'
lib/memory-inject-server.mjs:108        — buildHandler({ injector, token, eventLog, nodeId })
lib/memory-inject-server.mjs:200        — const requestId = crypto.randomUUID()
lib/memory-inject-server.mjs:203        — const tRetrieved = Date.now()
lib/memory-inject-server.mjs:210-227    — emit memory.retrieved + memory.injected (fire-and-forget)
lib/memory-inject-server.mjs:293-294    — @param deps.eventLog, deps.nodeId JSDoc
lib/memory-inject-server.mjs:308        — eventLog: deps.eventLog, nodeId: deps.nodeId passthrough
workspace-bin/memory-daemon.mjs:1238    — eventLog: localEventLog, nodeId: NODE_ID in startInjectionServer deps
test/event-schemas.test.mjs:345-368     — 2 new producer tests (retrieved + injected)
```

## 3. Done-evidence (runtime-observable)

| Evidence | Result |
|---|---|
| Unit tests: all schemas + producer tests validate | `npm test`: 1381 pass / 0 fail (2 new). `buildMemoryEvent("memory.retrieved")` passes `MemoryRetrievedSchema`; `buildMemoryEvent("memory.injected")` passes `MemoryInjectedSchema`. |
| Daemon running new code | PID 64161, restarted via `launchctl kickstart -k`. NATS connected, `localEventLog` initialized, inject server listening on :7893. `.err` file: only pre-existing PID check artifacts. |
| memory.retrieved event in stream | `nats stream get local-events-daedalus 5` → 467B event with `event_type=memory.retrieved`, `query_hash=e72c863f2b636cf4`, `channels_hit=0`, `results_count=0`, `duration_ms=1581`, `node_id=daedalus`. |
| memory.injected event in stream | `nats stream get local-events-daedalus 6` → 461B event with `event_type=memory.injected`, `request_id=b6c18414-174e-4adf-8a3e-c8507060b300`, `token_count=40`, `blocks_count=0`, `duration_ms=1581`, `node_id=daedalus`. |
| Both events share entity_id | `entity_id=b6c18414-174e-4adf-8a3e-c8507060b300` on both events — same request UUID, proving they're paired. |
| Stream messages increased | 4 → 6 after one `/memory/inject` request — exactly 2 new events. |

## 4. Cross-refs

- Step 1.1's `MemoryRetrievedSchema` and `MemoryInjectedSchema` are the validators consumed by `publishLocal`.
- `buildMemoryEvent` (lib/local-event-log.mjs) is the shared event builder — same as steps 1.2 and 1.3.
- The `requestId` (UUID) is shared between both events as `entity_id`, linking retrieval and injection for a single HTTP request.
- `channels_hit` counts non-empty item categories (concepts, decisions, snippets) — a high-level proxy for the 5-channel retrieval pipeline.

## 5. Findings

None. Step was cleanly atomic — one import, handler wiring with two fire-and-forget emissions, two test cases. No mid-implementation surprises. No scope creep.

## 6. Carry-forwards for step 1.5

- Step 1.5 wires `memory.error` at caught failures across all wired boundaries. The inject server's `catch (err)` block (HTTP 500 path) is a candidate for `memory.error` emission — the `eventLog` and `nodeId` are already in scope there.
- The daemon's `emitIngestEvent` and `emitExtractEvent` helpers catch-swallow errors silently — step 1.5 should wire `memory.error` at those catch paths too.
