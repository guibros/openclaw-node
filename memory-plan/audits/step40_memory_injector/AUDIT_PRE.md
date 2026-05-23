# AUDIT_PRE — Step 7.2: Pre-retrieve and budget ambient memory (cap 500-1000 tokens)

**Version:** v7.2-pre
**Date:** 2026-05-23
**Author:** memory-plan-tick

---

## §1 — Intent

Implement `lib/memory-injector.mjs` — the pre-retrieval and budgeting module for ambient memory injection. Given a user prompt, this module:

1. Calls `analyzeQuery(prompt)` from Step 7.1 to get embedding + structured cues.
2. Runs `createRetrievalPipeline().retrieve(query)` from Step 6.2 to get top-k ranked chunks.
3. Queries the extraction store for entities and decisions relevant to the retrieved sessions.
4. Trims all results to fit within the `INJECTION_TOKEN_BUDGET` (default 750 tokens, ~4 chars/token heuristic).
5. Returns structured data ready for Step 7.3 to format into the `[memory: ...]` block.

This is the retrieval + budgeting layer — it does NOT format the injection block (Step 7.3) or parse `@memory` directives (Step 7.4).

## §2 — Inventory excerpt

```
| 7 | 7.2 | v7.2 | [ ] | Pre-retrieve and budget ambient memory (cap 500-1000 tokens) |
```

## §3 — Design decisions (from Step 7.1 AUDIT_POST §6 carry-forwards)

- Test baseline is 792 tests (715 pass, 77 fail — 73 pre-existing + 4 flaky).
- `analyzeQuery` at `lib/query-analysis.mjs:104` — main entry returning `{ rawQuery, embedding, structuredCues }`.
- `extractStructuredCues` at `lib/query-analysis.mjs:36` — pure regex extraction.
- `embedPrompt` at `lib/query-analysis.mjs:76` — async embedding wrapper with null-on-failure.
- Step 7.2 should call `analyzeQuery(prompt)` to get the analysis, then pass `result.rawQuery` to `createRetrievalPipeline().retrieve()`.
- `@memory` directive parsing is Step 7.4 — NOT handled here.

Block 7 frozen decisions consumed:
- `INJECTION_TOKEN_BUDGET=750` (default). Configurable via env var.
- Tokenization uses model-agnostic char-based heuristic (~4 chars/token estimate).
- `createRetrievalPipeline` from `lib/retrieval-pipeline.mjs:362` is the retrieval backend.

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Extraction DB may not be available (no LLM extraction run yet) | LOW | All extraction store queries return empty arrays on missing DB. `createMemoryInjector` accepts optional `extractionDb`. |
| Retrieval pipeline may return empty results (empty graph/databases) | LOW | Empty results → empty injection context. Graceful degradation, no errors. |
| Token budget heuristic (~4 chars/token) may be inaccurate | LOW | Acceptable for budgeting — exact tokenization is model-specific and unnecessary for a cap. |

No HIGH-severity risks identified.

## §5 — Deferrals

- Injection formatting (`[memory: ...]` block) — Step 7.3.
- `@memory off/deep/none` directive parsing — Step 7.4.
- Cross-encoder reranking (BGE-reranker-v2-m3) — deferred per Block 6 §0 (RRF only).

## §6 — Phase 4 implementation outline

| # | File | Change | Description |
|---|------|--------|-------------|
| 1 | `lib/memory-injector.mjs` | new | Main module: `DEFAULT_TOKEN_BUDGET` (750), `CHARS_PER_TOKEN` (4), `estimateTokens(text)`, `queryRelevantConcepts(db, sessionIds, limit)`, `queryRelevantDecisions(db, sessionIds, limit)`, `trimToBudget(data, budget)`, `createMemoryInjector(opts)` factory returning `{ retrieve(prompt, opts) }` |
| 2 | `test/memory-injector.test.mjs` | new | ~8 tests: estimateTokens correctness, queryRelevantConcepts with mock DB, queryRelevantDecisions with mock DB, trimToBudget within/over/empty budget, createMemoryInjector factory + retrieve with mock pipeline, DEFAULT_TOKEN_BUDGET constant |
