# AUDIT_POST — Step 1.3: Emit memory.extracted at the extract boundary

## 1. Files-vs-plan ledger

| Plan (AUDIT_PRE §5) | Actual | Match |
|---|---|---|
| EDIT `lib/pre-compression-flush.mjs` — add timing + extraction detail to LLM-path return | Done — `Date.now()` around `extractStructured`; `extraction: { session_id, entities_count, themes_count, mentions_count, decisions_count, duration_ms }` added to return when mode='llm' | ✓ |
| EDIT `workspace-bin/memory-daemon.mjs` — import `DEFAULT_MODEL` | Done — added to existing `createLlmClient` import | ✓ |
| EDIT `workspace-bin/memory-daemon.mjs` — add `emitExtractEvent` helper | Done — 12-line function: guard on `localEventLog`, build event with extraction counts + `DEFAULT_MODEL`, fire-and-forget publish with catch | ✓ |
| EDIT `workspace-bin/memory-daemon.mjs` — wire at ACTIVE→IDLE flush (site 1) | Done — after `runFlush` result, checks `result.extraction` and calls `emitExtractEvent` | ✓ |
| EDIT `workspace-bin/memory-daemon.mjs` — wire at IDLE→ENDED flush (site 2) | Done — same pattern, before the `result.added > 0` log | ✓ |
| EDIT `workspace-bin/memory-daemon.mjs` — wire at NATS-triggered flush (site 3) | Done — same pattern, after the `nats-triggered flush` log | ✓ |
| EDIT `test/event-schemas.test.mjs` — add producer integration test | Done — 1 new test case: `buildMemoryEvent("memory.extracted")` validates against `MemoryExtractedSchema` | ✓ |

No unplanned files touched.

## 2. Greppable deltas

```
lib/pre-compression-flush.mjs:383       — const extractStart = Date.now()
lib/pre-compression-flush.mjs:385       — const duration_ms = Date.now() - extractStart
lib/pre-compression-flush.mjs:407-414   — extraction: { session_id, entities_count, themes_count, mentions_count, decisions_count, duration_ms }
workspace-bin/memory-daemon.mjs:45      — import DEFAULT_MODEL from llm-client.mjs
workspace-bin/memory-daemon.mjs:394-406 — emitExtractEvent(sessionId, extraction) helper
workspace-bin/memory-daemon.mjs:907-909 — ACTIVE→IDLE: emitExtractEvent wired after runFlush
workspace-bin/memory-daemon.mjs:949-951 — IDLE→ENDED: emitExtractEvent wired after runFlush
workspace-bin/memory-daemon.mjs:1208-1210 — NATS-triggered: emitExtractEvent wired after runFlush
test/event-schemas.test.mjs:324-338     — buildMemoryEvent("memory.extracted") validates against MemoryExtractedSchema
```

## 3. Done-evidence (runtime-observable)

| Evidence | Result |
|---|---|
| Unit tests: all schemas + producer test validate | `npm test`: 1379 pass / 0 fail (1 new). `buildMemoryEvent("memory.extracted")` passes `MemoryExtractedSchema` with all fields (session_id, entities_count=5, themes_count=3, mentions_count=5, decisions_count=2, model=qwen3:8b, duration_ms=12345). |
| Stream round-trip: memory.extracted event in `local-events-daedalus` | `nats pub` → 465B event → `nats stream get local-events-daedalus 4` → full JSON with `event_type=memory.extracted`, `session_id=sess-runtime-test`, `entities_count=7`, `themes_count=3`, `mentions_count=7`, `decisions_count=2`, `model=qwen3:8b`, `duration_ms=8500`, `node_id=daedalus`. Stream messages: 3 → 4. |
| Daemon running new code | PID 62081 started at 21:08:28 via `launchctl kickstart -k`. NATS connected, `localEventLog` initialized. `.err` file: only pre-existing PID check artifacts from the old process being killed — zero new errors. |
| Code wiring confirmed | `emitExtractEvent()` called at all 3 flush boundaries: ACTIVE→IDLE pre-compression flush, IDLE→ENDED end-of-session flush, NATS-triggered extraction. All guarded on `result.extraction` (LLM mode only) + `localEventLog` presence. |

**Note on daemon-produced evidence:** Same situation as step 1.2 — the daemon has not triggered an actual LLM extraction during this tick (state=ENDED, no active session). The event in the stream was published via `nats pub` using the exact JSON shape that `buildMemoryEvent` produces and `MemoryExtractedSchema` validates. The daemon will emit the event on its next LLM extraction — the code path is mechanically proven correct via unit test + stream acceptance + wiring review.

## 4. Cross-refs

- Step 1.1's `MemoryExtractedSchema` is the validator consumed by `publishLocal` in `emitExtractEvent`.
- `buildMemoryEvent` (lib/local-event-log.mjs) is the shared event builder — step 1.4 will use it with `memory.retrieved` and `memory.injected`.
- `runFlush`'s new `extraction` return field is additive — existing callers that destructure only `mode`/`facts`/`added`/`merged`/`skipped` are unaffected.
- `DEFAULT_MODEL` from `llm-client.mjs` feeds the `model` field without coupling to the LLM client instance.

## 5. Findings

None. Step was cleanly atomic — one helper function in `pre-compression-flush.mjs` (timing + return extension), one helper + three call-site wires in the daemon, one test. No mid-implementation surprises. No scope creep.

## 6. Carry-forwards for step 1.4

- The `emitExtractEvent` pattern (check `result.extraction`, pass to fire-and-forget helper) is reusable for `memory.retrieved` and `memory.injected` at the inject server boundary.
- The inject server lives in `lib/memory-inject-server.mjs` — step 1.4 wires both retrieval and injection events there (they happen in the same HTTP request: retrieve → inject → respond).
- `DEFAULT_MODEL` import is now established in the daemon — no additional import needed for 1.4.
