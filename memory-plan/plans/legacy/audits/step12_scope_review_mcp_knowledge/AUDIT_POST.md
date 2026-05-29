# AUDIT_POST — Step 2.1: Scope review vs mcp-knowledge; install/verify sqlite-vec in chosen store; integration smoke test

**Version:** v2.1-mid
**Date:** 2026-05-21
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

AUDIT_PRE §6 listed 7 granular bullets across 2 files. For CHECK 5 reconciliation, §1 is one row per file (deltas grouped). All §6 bullets are accounted for within the two file rows.

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | `lib/mcp-knowledge/core.mjs` (mod): session tables in initDatabase (§6 #1), chunkSessionTurns (§6 #2), indexSessionTurns (§6 #3), searchSessions (§6 #4), getStats session counts (§6 #5), engine factory session exports (§6 #6) | `:243` session_documents, `:250` session_chunks, `:260` session_chunk_vectors, `:524` chunkSessionTurns, `:587` indexSessionTurns, `:640` searchSessions, `:497` getStats session counts, `:711-712` engine exports | yes | `grep -n 'export function chunkSessionTurns' lib/mcp-knowledge/core.mjs` → line 524 |
| 2 | `test/mcp-knowledge-sessions.test.mjs` (new): 7 `it()` blocks across 3 `describe` blocks (§6 #7; planned 6, delivered 7) | `:1` — full file | yes | `grep -c 'it(' test/mcp-knowledge-sessions.test.mjs` → 7 |

All 2 rows landed = yes. 2 non-audit non-ledger files in staged diff = 2 rows.

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'CREATE TABLE IF NOT EXISTS session_documents' lib/mcp-knowledge/core.mjs` | `243:    CREATE TABLE IF NOT EXISTS session_documents (` |
| 2 | `grep -n 'CREATE TABLE IF NOT EXISTS session_chunks' lib/mcp-knowledge/core.mjs` | `250:    CREATE TABLE IF NOT EXISTS session_chunks (` |
| 3 | `grep -n 'session_chunk_vectors' lib/mcp-knowledge/core.mjs` | `260:    CREATE VIRTUAL TABLE IF NOT EXISTS session_chunk_vectors USING vec0(` |
| 4 | `grep -n 'export function chunkSessionTurns' lib/mcp-knowledge/core.mjs` | `524:export function chunkSessionTurns(turns) {` |
| 5 | `grep -n 'export async function indexSessionTurns' lib/mcp-knowledge/core.mjs` | `587:export async function indexSessionTurns(db, sessionId, sourcePath, turns) {` |
| 6 | `grep -n 'export async function searchSessions' lib/mcp-knowledge/core.mjs` | `640:export async function searchSessions(db, query, limit = 10) {` |
| 7 | `grep -c 'it(' test/mcp-knowledge-sessions.test.mjs` | `7` |

## §3 — Cross-references still valid

- `chunkSessionTurns`, `indexSessionTurns`, `searchSessions` are defined in `lib/mcp-knowledge/core.mjs` and imported by `test/mcp-knowledge-sessions.test.mjs`. No other files reference these yet. No stale imports.
- `session_documents`, `session_chunks`, `session_chunk_vectors` table names appear only in `lib/mcp-knowledge/core.mjs` and `test/mcp-knowledge-sessions.test.mjs`. No stale references.
- Existing exports (`semanticSearch`, `findRelated`, `getStats`, `initDatabase`, `embed`, `embedBatch`, `indexWorkspace`, `createKnowledgeEngine`) are unchanged in signature. No breakage to existing consumers (server.mjs, test.mjs, bench.mjs).
- The existing mcp-knowledge test file (`lib/mcp-knowledge/test.mjs`) imports from `./core.mjs` and is unaffected — it tests the original markdown indexing path which remains unchanged.
- Zero stale references found.

## §4 — Findings

- [POSITIVE] All 7 planned deltas landed as specified in AUDIT_PRE §6. Session tables coexist with document tables in the same database.
- [POSITIVE] `chunkSessionTurns` follows a simple turn-aligned strategy with role prefix (`[user]`/`[assistant]`). Each turn is its own chunk unless oversized, matching REFERENCE_PLAN's "semantic unit = a single turn" guidance.
- [POSITIVE] `indexSessionTurns` is idempotent: content-hashing the turns array and comparing against stored hash. Same pattern as the existing `indexWorkspace` approach (content_hash comparison).
- [POSITIVE] `searchSessions` uses the same vec0 MATCH + distance pattern as existing `semanticSearch`. The score formula `1 - distance² / 2` is consistent.
- [POSITIVE] `getStats` now reports session_documents and session_chunks counts alongside existing document/chunks counts, giving visibility into both data sources.
- [POSITIVE] All 7 new tests pass. The embedding model loads correctly for the session-turn tests (same Xenova/all-MiniLM-L6-v2 pipeline used by the markdown indexer).
- [NEGATIVE] AUDIT_PRE §6 said "6 tests" but 7 were delivered (the chunking tests were split into two: normal turns + empty content handling). This is a Phase-4-correction — test count was underestimated.

6 POSITIVE findings, 1 NEGATIVE finding.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards to Step 2.2

- Test baseline is now 535 tests (462 pass, 73 fail pre-existing). +7 tests added this step.
- `lib/mcp-knowledge/core.mjs` exports `chunkSessionTurns`, `indexSessionTurns`, `searchSessions` for use by the bulk migration (Step 2.3) and hybrid search (Step 2.4).
- `createKnowledgeEngine` returns `searchSessions` and `indexSessionTurns` methods — Step 2.3's migration script can use the engine factory or import functions directly.
- The session tables (`session_documents`, `session_chunks`, `session_chunk_vectors`) use parallel schema to the document tables. Search unification (combining markdown and session results) is deferred to Step 2.4 (hybrid search via RRF).
- `chunkSessionTurns` uses a simple turn-aligned strategy. Step 2.3 may revisit to handle tool-call groups as atomic units if the chunking proves too granular.
- The `after` import was missing from the initial test file (ReferenceError caught in Phase 5). Fixed during Phase 5 — not a production code issue, test-only.
- `lib/mcp-knowledge/server.mjs` was NOT updated to expose session search as an MCP tool. This is intentional — session search is an internal API consumed by the retrieval pipeline, not a user-facing MCP tool. If needed, it can be wired into the MCP server later.
- Phase-4-correction streak: 0 (reset this step due to test count underestimate: planned 6, delivered 7).
