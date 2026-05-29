# AUDIT_PRE — Step 3.3: Wire LLM extraction into daemon + new entity/theme/decision/mention tables in SQLite

**Version:** v3.3-pre
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Intent

Replace the regex-based `extractFacts` in the daemon flush pipeline with LLM-driven `extractStructured`, store extraction results in four new SQLite tables (`entities`, `themes`, `mentions`, `decisions`), and generate MEMORY.md content from the structured data. A `USE_LLM_EXTRACTION` feature flag (defaults `true`) allows emergency rollback to the regex extractor.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 3 | 3.3 | v3.3 | [A] | Wire LLM extraction into daemon + new entity/theme/decision/mention tables in SQLite |

## §3 — Design decisions (consumed from Step 3.2 AUDIT_POST §6)

- Test baseline is 570 tests (497 pass, 73 fail pre-existing).
- `lib/extraction-schema.mjs` exports `ExtractionResultSchema`, `validateExtractionResult(data)`, plus sub-schemas and enum arrays.
- `lib/extraction-prompt.mjs` exports `buildExtractionPrompt(messages)` and `extractStructured(client, messages)`. This step wires `extractStructured` into the daemon behind the `USE_LLM_EXTRACTION` feature flag.
- `extractStructured` expects a client from `createLlmClient()` and an array of `{role, content}` messages. Returns a validated ExtractionResult or throws.
- The schema covers 6 categories: entities (name/type/salience), themes (label/hierarchy), actions (enum), decisions (decision/rationale/confidence), friction_signals (signal/severity), relationships (source/target/type).
- Phase-4-correction streak: 0 (reset at Step 3.2).
- Phase-8-patch streak: 7 (Steps 2.1–3.2).

Block 3 frozen decisions (RESUME §0):
- Feature flag `USE_LLM_EXTRACTION` defaults `true`; setting it `false` restores the regex extractor.
- Uses Ollama by default per the amended runtime. `lib/llm-client.mjs` already has correct defaults (port 11434, qwen3:8b model).
- New SQLite tables: `entities`, `themes`, `mentions`, `decisions` per REFERENCE_PLAN §3.3.
- MEMORY.md generated from structured tables, not raw regex fragments.

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | LLM server unavailable at flush time → extraction fails | MEDIUM | Feature flag fallback + try/catch with graceful degradation to regex path |
| 2 | better-sqlite3 connection to state.db conflicts with session-store | LOW | WAL mode supports concurrent connections; extraction-store opens its own connection |
| 3 | LLM extraction is slow (10-30s) — blocks daemon flush | MEDIUM | Extraction is async; daemon already handles slow operations. LLM timeout is configurable. |
| 4 | Empty ExtractionResult (all empty arrays) produces empty MEMORY.md | LOW | generateMemoryContent falls back to a minimal header if no structured data exists |

No HIGH-severity risks. All pre-resolved.

## §5 — Deferrals

- `embedding` column on entities table: created as nullable column, populated in future steps (Block 5/6 thematic substrate).
- Friction signals and relationships: stored in ExtractionResult but not yet written to dedicated tables (entities/themes/decisions/mentions are the priority). Friction signals and relationships are logged in audit but deferred to a future step if needed.
- `actions` from ExtractionResult: not stored in a separate table — they are transient per-extraction and reflected in MEMORY.md generation but not persisted separately.

## §6 — Phase 4 implementation outline

| # | Delta | File | Type |
|---|-------|------|------|
| 1 | Create extraction store: 4 SQLite tables (entities, themes, mentions, decisions), storeExtractionResult, generateMemoryContent, getExtractionStats | `lib/extraction-store.mjs` | new |
| 2 | Add LLM extraction path in runFlush: USE_LLM_EXTRACTION feature flag, accept llmClient + extractionStore options, call extractStructured when enabled, fall back to regex when disabled | `lib/pre-compression-flush.mjs` | mod |
| 3 | Initialize LLM client + extraction store at daemon startup, pass to runFlush calls at both flush sites (pre-compression and end-of-session) | `workspace-bin/memory-daemon.mjs` | mod |
| 4 | Tests: storeExtractionResult population, entity upsert/mention_count, generateMemoryContent format, generateMemoryContent empty, feature flag regex fallback, feature flag LLM path with mock, LLM error graceful degradation | `test/extraction-store.test.mjs` | new |
