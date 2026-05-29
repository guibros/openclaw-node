# AUDIT_PRE — Step 2.1: Scope review vs mcp-knowledge; install/verify sqlite-vec in chosen store; integration smoke test

**Version:** v2.1-pre
**Date:** 2026-05-21
**Author:** memory-plan-tick

---

## §1 — Intent

Step 2.1 is the first step of Block 2 (Local semantic layer). It establishes the foundation
for session-turn embedding by extending the existing `lib/mcp-knowledge/core.mjs` stack.

Three deliverables:
1. **Scope review** — document the scoping decision (extend mcp-knowledge vs. parallel stack).
2. **Verify sqlite-vec** — confirm the chosen store already has working sqlite-vec + embeddings.
3. **Integration smoke test** — prove session turns can be embedded, stored, and searched
   in the same database alongside markdown chunks.

This step does NOT do bulk migration of existing sessions (Step 2.3) or hybrid search (Step 2.4).
It proves the stack works end-to-end with synthetic test data.

---

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 2 | 2.1 | v2.1 | [A] | Scope review vs mcp-knowledge; install/verify sqlite-vec in chosen store; integration smoke test |

---

## §3 — Design decisions (consumed from prior carry-forwards)

From **AUDIT_POST §6 (Step 1.4 / Block 1 close):**
- Test baseline is 528 tests (455 pass, 73 fail pre-existing).
- `lib/shared-event-stream.mjs` is standalone, no caller wiring yet.
- `npm install` may still be blocked. No new dependencies.
- Block 2 frozen decisions must be populated in RESUME.md §0 before proceeding.

From **RESUME.md §0 Block 2 frozen decisions:**
- **Extend `lib/mcp-knowledge/core.mjs`** — the scoping decision is made. mcp-knowledge already
  implements sqlite-vec + `@huggingface/transformers` (Xenova/all-MiniLM-L6-v2, 384-dim) and is
  the registered "knowledge" MCP server. Step 2.1 adds session-JSONL-turn embedding to this
  existing stack. **One embedding stack, two data sources** (markdown files + session messages).
  No Ollama, no BGE-M3, no parallel vec table in session-store.
- **Embedding model:** Xenova/all-MiniLM-L6-v2 (384-dim). Already in the repo.
- **Test baseline:** 73 pre-existing failures are expected; do not chase them.

**Scope review conclusion (deliverable #1):** The decision is to extend mcp-knowledge with
parallel tables for session data (`session_documents`, `session_chunks`, `session_chunk_vectors`)
rather than mixing session chunks into the existing `chunks`/`chunk_vectors` tables. This keeps
the two data sources cleanly separated while sharing the embedding pipeline and database file.
Search unification happens at query time (Step 2.4 via RRF).

---

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | mcp-knowledge test.mjs runs outside `npm test` (standalone) — new tests in `test/` may not exercise the same code paths | LOW | New tests import from `lib/mcp-knowledge/core.mjs` directly; same code paths. |
| 2 | `@huggingface/transformers` model download required for first test run | LOW | Model is already cached on the system from prior mcp-knowledge usage. Tests use the same `embed()` function. |
| 3 | Session chunk format may need revision in later steps (2.3, 2.4) | LOW | Keep the chunking strategy simple (turn-aligned) and defer sophistication. The schema is additive. |

No HIGH-severity risks.

---

## §5 — Deferrals

- Bulk migration of existing session JSONL files → Step 2.3
- Hybrid search (FTS5 + semantic via RRF) → Step 2.4
- CLI `--semantic`/`--hybrid` flags → Step 2.4
- Embedding model benchmarking on real data → Step 2.2
- JSONL file discovery and scanning pipeline → Step 2.3

---

## §6 — Phase 4 implementation outline

| # | Delta | File | Action |
|---|-------|------|--------|
| 1 | Add session tables to `initDatabase()` | `lib/mcp-knowledge/core.mjs` | mod — add `session_documents`, `session_chunks`, `session_chunk_vectors` tables + index |
| 2 | Add `chunkSessionTurns(turns)` function | `lib/mcp-knowledge/core.mjs` | mod — new exported function, turn-aligned chunking with role prefix |
| 3 | Add `indexSessionTurns(db, sessionId, sourcePath, turns)` function | `lib/mcp-knowledge/core.mjs` | mod — content-hash, skip-if-unchanged, chunk, embed, store |
| 4 | Add `searchSessions(db, query, limit)` function | `lib/mcp-knowledge/core.mjs` | mod — semantic search over session_chunk_vectors, same pattern as existing `semanticSearch` |
| 5 | Update `getStats()` to include session counts | `lib/mcp-knowledge/core.mjs` | mod — add session_documents and session_chunks counts |
| 6 | Update `createKnowledgeEngine()` to expose session functions | `lib/mcp-knowledge/core.mjs` | mod — add `searchSessions` and `indexSessionTurns` to returned engine object |
| 7 | Integration smoke tests | `test/mcp-knowledge-sessions.test.mjs` | new — 6 tests: tables created, chunking, indexing, idempotency, search, stats |
