# Block 2 Complete — Local semantic layer

**Date:** 2026-05-21
**Steps:** 5 (v2.1–v2.5)
**Author:** memory-plan-tick

---

## Exit-gate criteria

Block 2 closes with the delivery of the Gulf 1 evaluation tooling. The evaluation
itself (running against live session data, scoring results, go/no-go decision) is an
operator responsibility outside the automated framework.

The five steps delivered:
1. **v2.1** — Extended mcp-knowledge with session tables, chunking, indexing, and semantic search.
2. **v2.2** — Confirmed Xenova/all-MiniLM-L6-v2 (384-dim) meets <100ms/turn latency target.
3. **v2.3** — Resumable migration script for embedding existing sessions from session-store.
4. **v2.4** — FTS5 full-text search, RRF combiner, hybrid search, and CLI tool.
5. **v2.5** — Gulf 1 evaluation runner, 25-query evaluation set, and results template.

## Files touched cumulatively (Block 2)

| File | Steps | Change |
|------|-------|--------|
| `lib/mcp-knowledge/core.mjs` | 2.1, 2.4 | Session tables, chunkSessionTurns, indexSessionTurns, searchSessions, FTS5, searchSessionsFts, reciprocalRankFusion, hybridSearchSessions, engine factory |
| `test/mcp-knowledge-sessions.test.mjs` | 2.1 | 7 tests for session indexing and search |
| `test/embed-benchmark.test.mjs` | 2.2 | 5 tests for model identity and latency |
| `bin/embed-existing-sessions.mjs` | 2.3 | Resumable migration script |
| `test/embed-existing-sessions.test.mjs` | 2.3 | 5 tests for migration |
| `bin/session-search.mjs` | 2.4 | CLI tool for session search |
| `test/hybrid-search.test.mjs` | 2.4 | 7 tests for RRF, FTS5, hybrid |
| `bin/run-gulf1-eval.mjs` | 2.5 | Gulf 1 evaluation runner |
| `memory-plan/eval/gulf1-queries.json` | 2.5 | 25-query evaluation set |
| `test/gulf1-eval.test.mjs` | 2.5 | 7 tests for evaluation infrastructure |

## Test delta

- Block 2 start baseline: 528 tests (455 pass, 73 fail pre-existing)
- Block 2 end: 559 tests (486 pass, 73 fail pre-existing)
- Tests added: +31 across 5 steps

## Streaks

- Zero-Phase-4-correction: 0-of-5 (reset in Steps 2.1, 2.5)
- Zero-Phase-8-patch: 5-of-5 (all steps)

## Carry-forwards into Block 3

- The Gulf 1 evaluation must be run by the operator before Block 3 begins.
- Block 3 frozen decisions must be authored by the operator in RESUME.md §0.
- If the evaluation shows hybrid search is no better than FTS5, the plan terminates.
- Test baseline for Block 3 (if it proceeds): 559 tests (486 pass, 73 fail pre-existing).
- All semantic search infrastructure is in place: session tables, embeddings, FTS5, hybrid search, CLI tools.
