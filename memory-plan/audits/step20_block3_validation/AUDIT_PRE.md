# AUDIT_PRE — Step 3.4: Validate LLM vs regex extraction on 10 sessions; document quality delta

**Version:** v3.4-pre
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Intent

Create a CLI validation tool that reads recent sessions from the session store, runs
both the regex extractor (`extractFacts` + `mergeFacts`) and the LLM extractor
(`extractStructured` + `generateMemoryContent`) on each, and produces a structured
markdown comparison document at `memory-plan/eval/block-3-validation.md` for manual
operator review. This is the Block 3 validation gate — if LLM extraction is not
visibly better than regex on real sessions, prompt iteration is required before
Block 4 begins.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 3 | 3.4 | v3.4 | [A] | Validate LLM vs regex extraction on 10 sessions; document quality delta |

## §3 — Design decisions (from Step 3.3 AUDIT_POST §6)

- Test baseline is 578 tests (505 pass, 73 fail pre-existing).
- `lib/extraction-store.mjs` exports `createExtractionStore({ dbPath })` returning `{ storeExtractionResult, generateMemoryContent, getExtractionStats, close }`. Tables: entities, themes, mentions, decisions.
- `lib/pre-compression-flush.mjs` exports `USE_LLM_EXTRACTION` feature flag. `runFlush` accepts optional `opts.llmClient`, `opts.extractionStore`, `opts.sessionId` and returns `mode` field.
- For Step 3.4 validation: run both extractors on 10 sessions, compare MEMORY.md output quality. The regex path can be tested by setting `USE_LLM_EXTRACTION=false`; the LLM path requires a running Ollama server.
- Phase-4-correction streak: 0 (reset — test count underestimate).
- Phase-8-patch streak: 8.

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | Session store may not exist during test execution | LOW | Tests use in-memory SQLite with synthetic sessions; tool gracefully exits if DB missing |
| 2 | LLM (Ollama) not available when operator runs the tool | LOW | Tool runs regex extraction unconditionally; LLM extraction is skipped with a message if healthCheck fails. Comparison doc shows regex-only results with empty LLM columns |
| 3 | Session messages table schema may differ from expected | LOW | Tool uses same query pattern as `bin/embed-existing-sessions.mjs` (proven) |

## §5 — Deferrals

- Actual LLM extraction runs (requiring Ollama) are deferred to operator runtime. The tick creates the tool infrastructure; the operator executes it against live data.
- Block 3 validation assessment (written go/no-go decision) is an operator-authored artifact after reviewing the tool's output.

## §6 — Phase 4 implementation outline

| # | Delta | File | Type |
|---|-------|------|------|
| 1 | Create validation tool: `readSessions(dbPath, limit)` reads N most recent sessions from session store; `runRegexExtraction(messages)` calls `extractFacts` and formats via `mergeFacts`; `runLlmExtraction(client, messages, sessionId)` calls `extractStructured`, stores in temp extraction store, calls `generateMemoryContent`; `computeMetrics(regexResult, llmResult)` computes per-session metrics; `formatComparison(sessions, results)` produces structured markdown; `aggregateMetrics(results)` computes summary stats. CLI entry with `--session-db`, `--out`, `--limit`, `--llm-base-url`, `--llm-model` flags. | `bin/run-block3-validation.mjs` | new |
| 2 | Tests: readSessions with mock DB, runRegexExtraction on synthetic messages, runLlmExtraction with mock client, formatComparison markdown output, aggregateMetrics correctness, empty-session handling. ~6 tests. | `test/block3-validation.test.mjs` | new |
