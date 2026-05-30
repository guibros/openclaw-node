# AUDIT_PRE — Step 4.1: Generate structured MEMORY.md from tables (emits memory.synthesized)

## §0 Re-orient

- Where am I: Block 4 (synthesis — the readable-output layer), step 1/9, 19/40 overall.
- Last step changed: 3.4 — tolerant coercion locked + verified (`d317d2d`); Block 3 complete.
- This step contributes: every synthesis (MEMORY.md regen from the entity/theme/decision tables) becomes an observable `memory.synthesized` event, so the watcher and the L1 event stream can see the synthesize stage.
- Block serves the north star via: MEMORY_REDESIGN L4 — make the already-documented synthesis execute and produce readable artifacts; L1 — the stream shows ingest→extract→synthesize.
- Still the right next step? Yes — first step of Block 4.

## 1. Intent

INVENTORY done-criterion 4.1: *"end a session → MEMORY.md updates within seconds with structured sections; memory.synthesized event logged."* The structured MEMORY.md generation already exists; this step makes it **emit an event**.

## 2. Finding (investigation before editing)

- `runFlush` LLM path (`lib/pre-compression-flush.mjs:392-394`) already calls `extractionStore.generateMemoryContent(charBudget)` and writes `MEMORY.md`. That IS the synthesis boundary.
- `MemorySynthesizedSchema` already exists (`packages/event-schemas/src/memory/synthesized.ts`): `data: { trigger: 'session_end'|'interval'|'manual', artifacts_written: string[], duration_ms: number }`.
- The daemon already emits `memory.extracted` via `emitExtractEvent` (`workspace-bin/memory-daemon.mjs:395`) at the 3 flush sites (ACTIVE→IDLE :922, IDLE→ENDED :964, NATS :1249), each guarded on `if (result.extraction)`. Mirror this for synthesis.
- The watcher already classifies `memory.synthesized` (`lib/memory-watcher.mjs:96` → ok when `artifacts_written.length > 0`). No watcher change needed.

## 3. File-delta outline

| File | Delta |
|---|---|
| `lib/pre-compression-flush.mjs` | Time `generateMemoryContent` + `writeFileSync`; add a `synthesis: { session_id, artifacts_written: [memoryMdPath], duration_ms }` block to the LLM-path return (alongside `extraction`). |
| `workspace-bin/memory-daemon.mjs` | Add `emitSynthesizeEvent(sessionId, trigger, synthesis)` (mirror `emitExtractEvent`); wire after each `emitExtractEvent` call, guarded on `if (result.synthesis)`, with trigger = `interval` (ACTIVE→IDLE), `session_end` (IDLE→ENDED), `manual` (NATS). |
| `test/event-schemas.test.mjs` | Producer test: `buildMemoryEvent('memory.synthesized', …)` validates against `MemorySynthesizedSchema`. |

(Trigger *refinement* — the dedicated session-end hook and 30-min-active interval — are steps 4.4/4.5, not 4.1. 4.1 emits at the existing boundaries with the right trigger value.)

## 4. Done-evidence (to produce in AUDIT_POST)

- Producer test green; full suite green.
- **Runtime:** drive a real synthesis through the deployed `runFlush`; the resulting `memory.synthesized` event (built by the real `buildMemoryEvent` producer from the real synthesis result) publishes to the live `local-events-daedalus` stream and is recorded + classified `ok` by the watcher. If the daemon can be driven to a real flush, confirm the daemon process itself emits it.

## 5. Risk register

| Risk | Mitigation |
|---|---|
| Emitting synthesis on every extraction is too noisy | Synthesis IS coupled to extraction in the current pipeline (extract→store→generate MEMORY.md); the event mirrors that reality. Trigger granularity (4.4/4.5) refines it later. |
| `artifacts_written` empty when tables are empty | The LLM path always writes MEMORY.md, so `[memoryMdPath]` is always truthful; classifyStatus → ok. |
| Daemon emit not exercised headless | Producer test + wiring review cover the 5-line helper; the producer→stream→watcher path is exercised for real. |
