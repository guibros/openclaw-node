# AUDIT_PRE — Step 2.4: Implement semanticSearch + hybridSearch (RRF) + CLI --semantic/--hybrid flags

**Version:** v2.4-pre
**Date:** 2026-05-21
**Author:** memory-plan-tick

---

## §1 — Intent

Implement hybrid search over indexed session turns by combining the existing semantic vector
search (`searchSessions`) with a new FTS5 full-text keyword search via Reciprocal Rank Fusion
(RRF). Expose all three search modes (semantic, FTS5, hybrid) through a new CLI tool
`bin/session-search.mjs` with `--semantic`, `--hybrid`, and `--fts` flags.

This is the last functional step before Step 2.5's manual evaluation gate — the major decision
point for the entire memory plan. The hybrid search path must be ready for side-by-side
comparison against FTS5-only and semantic-only on real queries.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 2 | 2.4 | v2.4 | [A] | Implement semanticSearch + hybridSearch (RRF) + CLI --semantic/--hybrid flags |

## §3 — Design decisions (consumed from Step 2.3 AUDIT_POST §6)

- **Test baseline is now 545 tests** (472 pass, 73 fail pre-existing). +5 tests added in Step 2.3.
- `bin/embed-existing-sessions.mjs` is standalone, not wired into any automated process.
- `searchSessions()` already functional from Step 2.1 — the semantic search path over
  `session_chunk_vectors` is ready. Step 2.4 adds the FTS5 text search and RRF combination.
- `sourcePath` for migrated sessions uses `session-store://<session-id>` format.
- Phase-4-correction streak: 2 (test count matched plan in Steps 2.2 and 2.3).

**Block 2 frozen decisions (from RESUME §0):**
- Extend `lib/mcp-knowledge/core.mjs` — one embedding stack, two data sources.
- Embedding model: Xenova/all-MiniLM-L6-v2 (384-dim).
- No Ollama, no BGE-M3 — contradicts REFERENCE_PLAN §2.2 intentionally.

**FTS5 integration design (new for this step):**
- Add `session_chunks_fts` as FTS5 virtual table with `content='session_chunks'` and
  `content_rowid='id'` (external content mode — no text duplication).
- Sync via SQLite triggers (AFTER INSERT, AFTER DELETE on `session_chunks`).
- One-time rebuild for pre-existing indexed sessions via meta key `session_fts_built`.
- `searchSessionsFts(db, query, limit)` uses BM25 ranking from FTS5.

**RRF design:**
- Standard Reciprocal Rank Fusion: `RRF(d) = Σ 1/(k + rank_i(d))` with `k=60`.
- Deduplication key: chunk rowid (`chunk_id`).
- `searchSessions()` updated to include `chunk_id` in results for RRF keying.

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| FTS5 external content triggers may not fire inside `indexSessionTurns` transaction | LOW | Triggers fire within transactions in SQLite; tested in Phase 5 |
| FTS5 `MATCH` syntax may reject certain query strings (operators, special chars) | LOW | Wrap query in double quotes for literal matching; catch and return empty |
| BM25 scores not directly comparable to cosine similarity scores | N/A | RRF uses only rank position, not scores — no cross-scoring needed |

## §5 — Deferrals

- CLI output formatting (colors, tables) — plain text is sufficient for Step 2.5 evaluation.
- Session-store FTS5 (the `~/.openclaw/state.db` messages table) — not touched; we use
  mcp-knowledge's own FTS5 over session_chunks for consistency.
- MCP server integration of hybrid search — deferred; CLI is sufficient for evaluation.

## §6 — Phase 4 implementation outline

| # | Delta | File | Kind |
|---|-------|------|------|
| 1 | Add `session_chunks_fts` FTS5 virtual table + triggers + one-time rebuild in `initDatabase()` | `lib/mcp-knowledge/core.mjs` | mod |
| 2 | Add `searchSessionsFts(db, query, limit)` — FTS5 keyword search over session turns | `lib/mcp-knowledge/core.mjs` | mod |
| 3 | Add `reciprocalRankFusion(resultSets, opts)` — generic RRF combiner | `lib/mcp-knowledge/core.mjs` | mod |
| 4 | Add `hybridSearchSessions(db, query, limit)` — FTS5 + semantic via RRF | `lib/mcp-knowledge/core.mjs` | mod |
| 5 | Update `searchSessions()` to include `chunk_id` field in results | `lib/mcp-knowledge/core.mjs` | mod |
| 6 | Update `createKnowledgeEngine()` to expose `searchSessionsFts`, `hybridSearchSessions` | `lib/mcp-knowledge/core.mjs` | mod |
| 7 | Create CLI tool with `--semantic`/`--hybrid`/`--fts` flags, `--limit`, `--db` options | `bin/session-search.mjs` | new |
| 8 | 7 tests: RRF (3), FTS5 search (2), hybrid search (2) | `test/hybrid-search.test.mjs` | new |
