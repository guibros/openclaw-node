# AUDIT_POST — Step 2.1: Watcher core: subscribe to the event log, persist one record per op to JSONL

## 1. Files-vs-plan ledger

| Plan (AUDIT_PRE §4) | Actual | Match |
|---|---|---|
| NEW `lib/memory-watcher.mjs` — watcher core with `createMemoryWatcher` + `toWatcherRecord` | Done — 60 lines. Durable consumer `watcher-<nodeId>` on `local-events-<nodeId>`, deliver_policy `All`, appendFileSync to `~/.openclaw/watcher.jsonl`. | ✓ |
| EDIT `workspace-bin/memory-daemon.mjs` — import + init watcher after localEventLog; shutdown cleanup | Done — import at line 50; init block at lines 1183–1191 (conditional on localEventLog); `memoryWatcher.stop()` at line 1285. | ✓ |
| NEW `test/memory-watcher.test.mjs` — unit tests for `toWatcherRecord` | Done — 4 test cases: ingested (session+no-duration), extracted (session+duration), error (no-session), retrieved (no-session+duration). | ✓ |

No unplanned files touched.

## 2. Greppable deltas

```
lib/memory-watcher.mjs:10-17          — toWatcherRecord(event) → {ts, op, actor, session, duration_ms}
lib/memory-watcher.mjs:19-59          — createMemoryWatcher(nc, nodeId, opts) → {stop()}
workspace-bin/memory-daemon.mjs:50    — import { createMemoryWatcher }
workspace-bin/memory-daemon.mjs:1183  — watcher init block (after localEventLog)
workspace-bin/memory-daemon.mjs:1285  — memoryWatcher.stop() in shutdown
test/memory-watcher.test.mjs:1-58     — 4 toWatcherRecord tests
```

## 3. Done-evidence (runtime-observable)

| Evidence | Result |
|---|---|
| Unit tests pass | `npm test`: 1387 pass / 0 fail (4 new from `test/memory-watcher.test.mjs`). |
| Daemon running new code | PID 68753 (restarted via `launchctl kickstart -k`). Binary symlinked to repo. NATS connected. |
| Watcher initialized | Log: `[watcher] Memory watcher initialized (consumer: watcher-daedalus, output: /Users/moltymac/.openclaw/watcher.jsonl)` |
| Watcher consumed all existing events | `watcher.jsonl` has 8 records from the stream's 8 valid JSON events. The 1 non-JSON test string from step 0.4 was correctly handled (acked, logged error, continued). |
| Real-time event persisted | `nats pub local.memory.events.test-2-1.memory.ingested` → watcher received and wrote record #9: `{"ts":"2026-05-30T01:42:00Z","op":"memory.ingested","actor":"tick-verify","session":"step-2-1-runtime","duration_ms":null}` |
| Record shape matches done-evidence | Every record: `{ts, op, actor, session, duration_ms}` — matches INVENTORY spec exactly. |

## 4. Cross-refs

- `createLocalEventLog` (lib/local-event-log.mjs) creates the same stream the watcher subscribes to — `local-events-<nodeId>`, subjects `local.>`.
- `buildMemoryEvent` (lib/local-event-log.mjs:104) builds the events the watcher consumes — the envelope fields `timestamp`, `event_type`, `actor`, and per-type `data` fields.
- The daemon init pattern (try/catch, log failure, continue without) matches every other NATS component (extraction trigger, shared stream, local event log).
- The watcher consumer uses the same `js.consumers.get/consume` pattern as `bin/memory-subscriber.mjs`.

## 5. Findings

- The stream contained 1 non-JSON message (a raw string "step04-ver..." from step 0.4's manual CLI test publish). The watcher correctly handled it: parse error caught, logged, acked, continued. No impact on valid event processing.
- JSONL file grows unbounded — acceptable for 2.1; rotation or size management is a Block 2.3 or later concern.

## 6. Carry-forwards for step 2.2

- Step 2.2 (classify each op ok/noop/error) can extend `toWatcherRecord` or add a classification field on top of the base record. The `op` field already distinguishes `memory.error` from others; 2.2 adds semantic classification (e.g., "noop" for extractions with 0 entities, "error" for memory.error events).
- The durable consumer `watcher-<nodeId>` with `deliver_policy: All` means the watcher processes the full event history on every daemon restart. For production, 2.2 or later may want to persist consumer sequence state or switch to `deliver_policy: New` once caught up. Not a concern at current stream size (9 messages).
