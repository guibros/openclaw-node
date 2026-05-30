# AUDIT_POST — Step 1.5: Emit memory.error on caught failures across the wired boundaries

## 1. Files-vs-plan ledger

| Plan (AUDIT_PRE §4) | Actual | Match |
|---|---|---|
| EDIT `workspace-bin/memory-daemon.mjs` — add `emitErrorEvent` helper; wire at 6 catch blocks (3 ingest, 3 extract) | Done — `emitErrorEvent(boundary, err, sessionId)` added at line 410; wired at lines 554, 773, 991 (ingest) and 928, 972, 1228 (extract) | ✓ |
| EDIT `lib/memory-inject-server.mjs` — emit `memory.error` in HTTP 500 catch block | Done — `buildMemoryEvent('memory.error', ...)` + `publishLocal` in the catch block at line 245; uses closure `eventLog`/`nodeId`; `retrieveOpts.sessionId` passed when available | ✓ |
| EDIT `test/event-schemas.test.mjs` — add producer test for `memory.error` | Done — 2 new test cases: with session_id (boundary=extract) and without session_id (boundary=ingest); both validate against `MemoryErrorSchema` | ✓ |

No unplanned files touched.

## 2. Greppable deltas

```
workspace-bin/memory-daemon.mjs:410-421    — emitErrorEvent(boundary, err, sessionId) helper
workspace-bin/memory-daemon.mjs:554        — emitErrorEvent('ingest', e) at Phase 0 bootstrap catch
workspace-bin/memory-daemon.mjs:773        — emitErrorEvent('ingest', e) at Phase 2 throttled catch
workspace-bin/memory-daemon.mjs:928        — emitErrorEvent('extract', e, ...) at ACTIVE→IDLE flush catch
workspace-bin/memory-daemon.mjs:972        — emitErrorEvent('extract', e, ...) at IDLE→ENDED flush catch
workspace-bin/memory-daemon.mjs:991        — emitErrorEvent('ingest', e) at end-of-session archive catch
workspace-bin/memory-daemon.mjs:1228       — emitErrorEvent('extract', e, ...) at NATS-triggered flush catch
lib/memory-inject-server.mjs:245-256       — memory.error emission in HTTP 500 catch block
test/event-schemas.test.mjs:377-401        — 2 new producer tests (error with/without session_id)
```

## 3. Done-evidence (runtime-observable)

| Evidence | Result |
|---|---|
| Unit tests: all schemas + producer tests validate | `npm test`: 1383 pass / 0 fail (2 new). `buildMemoryEvent("memory.error")` passes `MemoryErrorSchema` with both extract+session_id and ingest+no-session_id variants. |
| Daemon running new code | PID 66385, restarted via `launchctl kickstart -k`. Binary symlinked to repo (`readlink` → `workspace-bin/memory-daemon.mjs`). NATS connected, `localEventLog` initialized, inject server listening on :7893. |
| memory.error event in stream | `nats stream get local-events-daedalus 9` → 432B event with `event_type=memory.error`, `boundary=ingest`, `error_code=TEST_INDUCED`, `error_message=Step 1.5 runtime verification`, `session_id=test-1-5`, `node_id=daedalus`. |
| Stream messages increased | 6 → 9 (2 from curl inject probe: retrieved+injected, 1 from test memory.error publish). |
| Code inspection: 7 emitErrorEvent wires | `grep emitErrorEvent workspace-bin/memory-daemon.mjs` → 1 definition + 6 catch-block wires. `grep memory.error lib/memory-inject-server.mjs` → 2 lines (emit + catch). |

## 4. Cross-refs

- Step 1.1's `MemoryErrorSchema` (packages/event-schemas/src/memory/error.ts) defines the boundary enum + data fields consumed here.
- `buildMemoryEvent` (lib/local-event-log.mjs:104) is the shared event builder — same as steps 1.2–1.4.
- `emitErrorEvent` follows the same fire-and-forget `.catch()` pattern as `emitIngestEvent` (line 381) and `emitExtractEvent` (line 394).
- The inject server uses the closure `eventLog`/`nodeId` wired in step 1.4.

## 5. Findings

None. Step was cleanly atomic — one helper function, 7 catch-block wires (6 daemon + 1 inject server), 2 test cases. No mid-implementation surprises. No scope creep.

## 6. Carry-forwards for Block 2 (memory-watcher)

- The memory-watcher (step 2.2) classifies each op as ok/noop/error. It can now consume `memory.error` events from the stream to classify error outcomes, rather than inferring failures from the absence of success events.
- The `error_code` field (constructor name or 'UNKNOWN') is a string, not an enum — the watcher should group by this field for rate monitoring but not enforce a fixed set.
- The 5 pre-existing event schemas with no producer (`turn_recorded`, `concept_mentioned`, `snapshot_taken`, `artifact_attached`, `compaction_triggered`) remain — their fate is a Block 2 or later decision.
- This step closes Block 1. A macro re-orient (WORKFLOW §7.2) is required before Block 2.
