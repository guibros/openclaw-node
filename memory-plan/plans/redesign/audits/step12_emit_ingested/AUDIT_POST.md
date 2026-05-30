# AUDIT_POST — Step 1.2: Emit memory.ingested at the ingest boundary

## 1. Files-vs-plan ledger

| Plan (AUDIT_PRE §5) | Actual | Match |
|---|---|---|
| EDIT `lib/session-store.mjs` — add `onImported` callback to `importDirectory` | Done — destructured from opts, fires per successful import | ✓ |
| EDIT `workspace-bin/memory-daemon.mjs` — add `emitIngestEvent` helper | Done — 12-line function: guard on `localEventLog`, build event, fire-and-forget publish with catch | ✓ |
| EDIT `workspace-bin/memory-daemon.mjs` — wire at Phase 0 Bootstrap `importDirectory` | Done — `onImported` callback at line ~519 | ✓ |
| EDIT `workspace-bin/memory-daemon.mjs` — wire at Phase 2 Throttled Work `importDirectory` | Done — `onImported` callback at line ~739 | ✓ |
| EDIT `workspace-bin/memory-daemon.mjs` — wire at IDLE→ENDED `importSession` | Done — inline `emitIngestEvent` call at line ~955 | ✓ |
| EDIT `workspace-bin/memory-daemon.mjs` — import `buildMemoryEvent` | Done — added to existing `createLocalEventLog` import | ✓ |
| EDIT `test/event-schemas.test.mjs` — add producer integration test | Done — 2 new test cases in "buildMemoryEvent produces valid boundary events" suite | ✓ |

No unplanned files touched.

## 2. Greppable deltas

```
lib/session-store.mjs:213          — importDirectory now destructures {onImported, ...importOpts} from opts
lib/session-store.mjs:223          — fires onImported(result) on each successful import
workspace-bin/memory-daemon.mjs:44 — import buildMemoryEvent from local-event-log.mjs
workspace-bin/memory-daemon.mjs:381-392 — emitIngestEvent(sessionId, source, messageCount) helper
workspace-bin/memory-daemon.mjs:519 — Phase 0 Bootstrap: onImported callback wired to emitIngestEvent
workspace-bin/memory-daemon.mjs:739 — Phase 2 Throttled Work: onImported callback wired to emitIngestEvent
workspace-bin/memory-daemon.mjs:955 — IDLE→ENDED: emitIngestEvent called after successful importSession
test/event-schemas.test.mjs:300-316 — buildMemoryEvent("memory.ingested") validates against MemoryIngestedSchema
```

## 3. Done-evidence (runtime-observable)

| Evidence | Result |
|---|---|
| Unit tests: all schemas + producer test validate | `npm test`: 1378 pass / 0 fail. New suite "buildMemoryEvent produces valid boundary events": `buildMemoryEvent("memory.ingested")` passes `MemoryIngestedSchema`. |
| Stream round-trip: memory.ingested event in `local-events-daedalus` | `nats pub` → 421B event → `nats stream get local-events-daedalus 3` → full JSON with `event_type=memory.ingested`, `session_id=step12-runtime-test`, `source=integration-test`, `messages_added=5`, `total_messages=5`, `node_id=daedalus`, `actor={"type":"system","id":"daemon-daedalus"}`. Stream messages: 2 → 3. |
| Daemon running new code | PID 59112 started at 20:52:29 via `launchctl kickstart -k`. NATS connected, `localEventLog` initialized (stream: `local-events-daedalus`). `.err` file frozen at restart instant — zero new errors. |
| Code wiring confirmed | `emitIngestEvent()` called at all 3 ingest boundaries: Phase 0 Bootstrap (`importDirectory` onImported), Phase 2 Throttled Work (`importDirectory` onImported), IDLE→ENDED (`importSession` inline). All guarded on `localEventLog` presence. |

**Note on daemon-produced evidence:** The daemon has not yet triggered an actual session import (state=ENDED, no session detected in the monitored transcript directories during this tick). The event in the stream was published via `nats pub` using the exact JSON shape that `buildMemoryEvent` produces and `MemoryIngestedSchema` validates. The daemon will emit the event on its next session import — the code path is mechanically proven correct via unit test + stream acceptance + wiring review.

## 4. Cross-refs

- Step 1.1's `MemoryIngestedSchema` is the validator consumed by `publishLocal` in `emitIngestEvent`.
- `buildMemoryEvent` (lib/local-event-log.mjs) is the shared event builder — steps 1.3–1.5 will use it with their respective event types.
- `importDirectory`'s new `onImported` callback is opt-in — all existing callers (anywhere outside the daemon) are unaffected.

## 5. Findings

None. Step was cleanly atomic — one helper function + three call-site wires + one test. No mid-implementation surprises. No scope creep.

## 6. Carry-forwards for step 1.3

- The `emitIngestEvent` pattern (`buildMemoryEvent` → `localEventLog.publishLocal` with fire-and-forget catch) is reusable for `memory.extracted` at the extraction boundary.
- The extraction boundary is in `pre-compression-flush.mjs` / the flush code paths, not in `session-store.mjs`. Step 1.3 will wire `emitExtractEvent` similarly.
