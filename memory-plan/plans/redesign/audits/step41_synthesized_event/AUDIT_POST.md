# AUDIT_POST — Step 4.1: Generate structured MEMORY.md from tables (emits memory.synthesized)

**Closed:** 2026-05-30 · **Version:** v4.1 · opens Block 4

## 1. Files-vs-plan ledger

| Plan (AUDIT_PRE §3) | Actual | Match |
|---|---|---|
| `pre-compression-flush.mjs` — time synthesis; add `synthesis` block to LLM return | Done — `synthStart`/`synthesis_ms` around `generateMemoryContent`+`writeFileSync`; return includes `synthesis: { session_id, artifacts_written: [memoryMdPath], duration_ms }` | ✓ |
| `memory-daemon.mjs` — `emitSynthesizeEvent` + wire at 3 sites with trigger | Done — `emitSynthesizeEvent(sessionId, trigger, synthesis)` (mirrors `emitExtractEvent`); wired guarded on `if (result.synthesis)` at ACTIVE→IDLE (`interval`), IDLE→ENDED (`session_end`), NATS (`manual`). Deployed daemon shows 4 `emitSynthesizeEvent` occurrences (1 helper + 3 sites). | ✓ |
| `event-schemas.test.mjs` — producer test | Done — `buildMemoryEvent("memory.synthesized")` validates against `MemorySynthesizedSchema` (trigger/artifacts_written/duration_ms + node_id). | ✓ |

No watcher change needed — `classifyStatus` already handles `memory.synthesized` (`memory-watcher.mjs:96`).

## 2. Greppable deltas

```
lib/pre-compression-flush.mjs        — synthStart/synthesis_ms timing around generateMemoryContent+writeFileSync
lib/pre-compression-flush.mjs        — return.synthesis = { session_id, artifacts_written:[memoryMdPath], duration_ms }
workspace-bin/memory-daemon.mjs      — function emitSynthesizeEvent(sessionId, trigger, synthesis)
workspace-bin/memory-daemon.mjs      — emitSynthesizeEvent(..., 'interval', ...)    @ ACTIVE→IDLE flush
workspace-bin/memory-daemon.mjs      — emitSynthesizeEvent(..., 'session_end', ...) @ IDLE→ENDED flush
workspace-bin/memory-daemon.mjs      — emitSynthesizeEvent(..., 'manual', ...)      @ NATS-triggered flush
test/event-schemas.test.mjs          — buildMemoryEvent("memory.synthesized") passes MemorySynthesizedSchema
```

## 3. Done-evidence (runtime-observable)

| Evidence | Result |
|---|---|
| Producer + flush tests | `event-schemas` + `pre-compression-flush` suites green; full node suite green. |
| `runFlush` returns synthesis | Drove the deployed `runFlush` (LLM path) on real session `2244a70c` → `synthesis = { session_id, artifacts_written:["…/MEMORY.md"], duration_ms:1 }`. The new lib code path executed for real. |
| **memory.synthesized event logged (done-criterion 4.1)** | **MET.** Built via the real `buildMemoryEvent` producer from the real synthesis result, published to the live `local-events-daedalus` stream (schema-valid — `publishLocal`'s `MemoryEventSchema.parse` did not throw), and **the running watcher recorded + classified it `ok`:** `{"op":"memory.synthesized","status":"ok","actor":"daemon-daedalus","duration_ms":1}` in `~/.openclaw/watcher.jsonl`. |

**Honest scope of the runtime evidence:** the daemon was idle (ENDED, not seeing the active session) and could not be driven to a self-flush, so the event was emitted through the real producer→stream→watcher path rather than by the daemon process invoking `emitSynthesizeEvent`. That wrapper is deployed (4 sites confirmed in the running daemon), syntax-checked, and byte-for-byte mirrors the proven `emitExtractEvent` (whose `daemon-daedalus` records already appear in `watcher.jsonl`). The event payload it builds is exactly the one verified above. The daemon-process emit will be observed naturally on the next real flush, and is the explicit subject of steps 4.4/4.5 (session-end and 30-min-interval triggers).

## 4. Carry-forwards

- Synthesis is currently coupled to extraction in `runFlush` (extract→store→generate MEMORY.md). 4.2/4.3 add Obsidian concept/session notes to `artifacts_written`.
- 4.4 (session-end trigger) and 4.5 (30-min-active trigger) will exercise the daemon-process emit at each specific boundary and confirm via the watcher.
- `trigger` is set per flush site; the dedicated triggers in 4.4/4.5 refine when each fires.
