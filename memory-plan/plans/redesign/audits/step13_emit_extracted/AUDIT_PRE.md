# AUDIT_PRE — Step 1.3: Emit memory.extracted at the extract boundary

## §0 Re-orient

- Where am I: Block 1 (L1 event log spine), step 3/5, 7/40 overall.
- Last step changed: v1.2 wired `emitIngestEvent` at all 3 session-import boundaries in the daemon.
- This step contributes: completes the extraction producer — every successful LLM extraction emits `memory.extracted` to the local event log.
- Block serves the north star via: MASTER_PLAN §3.1 "every memory op emits a signed local event" → the substrate the Block 2 watcher reads.
- Still the right next step? Yes — extraction is the next boundary after ingest in the pipeline flow.

## 1. Intent

Wire `memory.extracted` event emission at every code path where a successful LLM extraction completes. The existing `MemoryExtractedSchema` (step 1.1) defines the shape: `session_id`, `entities_count`, `themes_count`, `mentions_count`, `decisions_count`, `model`, `duration_ms`. Follow the step 1.2 pattern (carry-forward): `emitExtractEvent` helper in the daemon, `buildMemoryEvent` → `localEventLog.publishLocal`, fire-and-forget with catch.

## 2. Design

**Two changes, one per layer:**

1. **`lib/pre-compression-flush.mjs` — extend `runFlush` return.** The LLM extraction path inside `runFlush` calls `extractStructured()` and has access to the per-type counts (entities, themes, decisions) and can measure duration. Add timing around `extractStructured`, and return an `extraction` detail object in the result when `mode === 'llm'`:
   ```
   extraction: {
     entities_count: result.entities.length,
     themes_count: result.themes.length,
     mentions_count: result.entities.length,  // 1 mention per entity in storeExtractionResult
     decisions_count: result.decisions.length,
     duration_ms: Date.now() - extractStart,
   }
   ```
   No `extraction` key when mode is 'regex' (no schema-level extraction happens).

2. **`workspace-bin/memory-daemon.mjs` — add `emitExtractEvent` + wire at 3 call sites.** Import `DEFAULT_MODEL` from `llm-client.mjs` for the model name. The helper:
   ```
   function emitExtractEvent(sessionId, extraction) {
     if (!localEventLog) return;
     const event = buildMemoryEvent('memory.extracted', sessionId, 'memory', {
       session_id: sessionId,
       ...extraction,
       model: DEFAULT_MODEL,
     }, NODE_ID);
     localEventLog.publishLocal(event).catch(...);
   }
   ```
   Wired after each `runFlush` call where `result.extraction` exists (mode='llm'). The 3 sites:
   - ACTIVE→IDLE pre-compression flush (line ~890)
   - IDLE→ENDED end-of-session flush (line ~931)
   - NATS-triggered extraction (line ~1184)

3. **`test/event-schemas.test.mjs` — add producer test.** `buildMemoryEvent('memory.extracted', ...)` validates against `MemoryExtractedSchema`.

## 3. Carry-forward consumption (from step 1.2 §6)

- ✓ Reuse the `emitIngestEvent` pattern (`buildMemoryEvent` → `publishLocal` with fire-and-forget catch).
- ✓ The extraction boundary IS in the flush code paths, not session-store.

## 4. Risk register

| Risk | Mitigation |
|---|---|
| `runFlush` return shape change breaks callers | Additive — new `extraction` key only; existing fields unchanged. All 3 daemon callers destructure only `mode`/`facts`/`added`/`merged`/`skipped`. No external callers (lib, not exported to other packages). |
| `DEFAULT_MODEL` import adds a coupling | Already imported module (`createLlmClient` is from same file). `DEFAULT_MODEL` is a stable export. |
| Event emission adds latency to flush path | Fire-and-forget (same as 1.2). No await on publishLocal. |

## 5. File-delta outline

| File | Change |
|---|---|
| `lib/pre-compression-flush.mjs` | Add `Date.now()` timing around `extractStructured`; add `extraction` object to LLM-path return. |
| `workspace-bin/memory-daemon.mjs` | Import `DEFAULT_MODEL`; add `emitExtractEvent` helper; wire at 3 flush call sites. |
| `test/event-schemas.test.mjs` | Add `buildMemoryEvent('memory.extracted')` validation test case. |
