# AUDIT_POST — Step 2.4: Implement semanticSearch + hybridSearch (RRF) + CLI --semantic/--hybrid flags

**Version:** v2.4-mid
**Date:** 2026-05-21
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | Add `session_chunks_fts` FTS5 virtual table + triggers + one-time rebuild in `initDatabase()` | `lib/mcp-knowledge/core.mjs:270` (FTS5 table), `:278` (ins trigger), `:283` (del trigger), `:289` (rebuild) | yes | `grep -n 'session_chunks_fts USING fts5' lib/mcp-knowledge/core.mjs` → `270` |
| 2 | Add `searchSessionsFts(db, query, limit)` — FTS5 keyword search | `lib/mcp-knowledge/core.mjs:712` | yes | `grep -n 'export function searchSessionsFts' lib/mcp-knowledge/core.mjs` → `712` |
| 3 | Add `reciprocalRankFusion(resultSets, opts)` — generic RRF combiner | `lib/mcp-knowledge/core.mjs:768` | yes | `grep -n 'export function reciprocalRankFusion' lib/mcp-knowledge/core.mjs` → `768` |
| 4 | Add `hybridSearchSessions(db, query, limit)` — FTS5 + semantic via RRF | `lib/mcp-knowledge/core.mjs:804` | yes | `grep -n 'export async function hybridSearchSessions' lib/mcp-knowledge/core.mjs` → `804` |
| 5 | Update `searchSessions()` to include `chunk_id` field in results | `lib/mcp-knowledge/core.mjs:693` | yes | `grep -n 'chunk_id: r.rowid' lib/mcp-knowledge/core.mjs` → `693` |
| 6 | Update `createKnowledgeEngine()` to expose `searchSessionsFts`, `hybridSearchSessions` | `lib/mcp-knowledge/core.mjs:857-858` | yes | `grep -n 'hybridSearchSessions:' lib/mcp-knowledge/core.mjs` → `858` |
| 7 | Create CLI tool with `--semantic`/`--hybrid`/`--fts` flags | `bin/session-search.mjs:1` (full file) | yes | `grep -n '\-\-semantic.*\-\-hybrid.*\-\-fts' bin/session-search.mjs` → line 7 |
| 8 | 7 tests: RRF (3), FTS5 search (2), hybrid search (2) | `test/hybrid-search.test.mjs:1` (full file, 7 `it()` blocks) | yes | `grep -c 'it(' test/hybrid-search.test.mjs` → `7` |

All 8 rows landed = yes. 3 non-audit non-ledger files in staged diff = matches §1 rows (#1-6 all in same file `core.mjs` = 1 file, plus `bin/session-search.mjs` = 1 file, plus `test/hybrid-search.test.mjs` = 1 file → 3 production files).

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'session_chunks_fts USING fts5' lib/mcp-knowledge/core.mjs` | `270:    CREATE VIRTUAL TABLE IF NOT EXISTS session_chunks_fts USING fts5(` |
| 2 | `grep -n 'export function searchSessionsFts' lib/mcp-knowledge/core.mjs` | `712:export function searchSessionsFts(db, query, limit = 10) {` |
| 3 | `grep -n 'export function reciprocalRankFusion' lib/mcp-knowledge/core.mjs` | `768:export function reciprocalRankFusion(resultSets, opts = {}) {` |
| 4 | `grep -n 'export async function hybridSearchSessions' lib/mcp-knowledge/core.mjs` | `804:export async function hybridSearchSessions(db, query, limit = 10) {` |
| 5 | `grep -n 'chunk_id: r.rowid' lib/mcp-knowledge/core.mjs` | `693:    chunk_id: r.rowid,` |
| 6 | `grep -n 'hybridSearchSessions:' lib/mcp-knowledge/core.mjs` | `858:    hybridSearchSessions: (query, limit) => hybridSearchSessions(db, query, limit),` |
| 7 | `grep -n 'searchSessionsFts:' lib/mcp-knowledge/core.mjs` | `857:    searchSessionsFts: (query, limit) => searchSessionsFts(db, query, limit),` |
| 8 | `grep -n 'parseArgs' bin/session-search.mjs` | `13:import { parseArgs } from 'node:util';` |
| 9 | `grep -c 'it(' test/hybrid-search.test.mjs` | `7` |
| 10 | `grep -n "describe(" test/hybrid-search.test.mjs` | `20:describe('reciprocalRankFusion', ...` |

## §3 — Cross-references still valid

- `searchSessions` imported by `test/hybrid-search.test.mjs` — still exported at `core.mjs:672`.
- `indexSessionTurns` imported by `test/hybrid-search.test.mjs` — still exported at `core.mjs:619`.
- `initDatabase` imported by `test/hybrid-search.test.mjs` and `bin/session-search.mjs` — still exported at `core.mjs:208`.
- `DB_PATH` imported by `bin/session-search.mjs` — still exported at `core.mjs:19`.
- `searchSessionsFts`, `reciprocalRankFusion`, `hybridSearchSessions` — new exports, imported by `test/hybrid-search.test.mjs` and `bin/session-search.mjs`. No stale refs.
- Existing test files (`test/mcp-knowledge-sessions.test.mjs`, `test/embed-benchmark.test.mjs`, `test/embed-existing-sessions.test.mjs`) — unchanged, do not import the new functions. Their existing `searchSessions` import still works (the added `chunk_id` field is additive, no breaking change).
- `createKnowledgeEngine` still returns all prior methods plus two new ones (`searchSessionsFts`, `hybridSearchSessions`). Additive change.
- No symbols renamed or deleted in this step.
- Zero stale references found.

## §4 — Findings

- [POSITIVE] FTS5 external content mode (`content='session_chunks', content_rowid='id'`) avoids text duplication. Triggers keep the FTS5 index in sync without manual management in `indexSessionTurns`.
- [POSITIVE] One-time FTS5 rebuild via `meta` key (`session_fts_built`) handles the upgrade path for databases that already have session chunks indexed before FTS5 was added. Runs once, then triggers maintain sync.
- [POSITIVE] The subquery pattern for FTS5 rank (`SELECT rowid, rank FROM session_chunks_fts WHERE ... MATCH ?`) avoids the known SQLite issue where FTS5's `rank` auxiliary column can return NULL when accessed through JOIN aliases.
- [POSITIVE] RRF implementation uses the standard formula `1/(k + rank)` with k=60. Deduplication by `chunk_id` correctly boosts items that appear in both FTS5 and semantic result sets.
- [POSITIVE] FTS5 query fallback (wrapping in double quotes on syntax error) handles special characters gracefully without crashing.
- [POSITIVE] Test count matches plan exactly: planned 7, delivered 7. Phase-4-correction streak continues (3 of 4 in Block 2). The FTS5 score precision issue required a `toFixed(6)` adjustment and additional test data (third session for non-zero BM25 IDF), but no §6 mid-implementation findings were needed — the fix was within the planned scope.
- [POSITIVE] CLI tool (`bin/session-search.mjs`) uses `node:util` parseArgs (zero dependencies) and defaults to hybrid mode. All three search modes are accessible.

7 POSITIVE findings, 0 NEGATIVE findings.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards to Step 2.5

- Test baseline is now 552 tests (479 pass, 73 fail pre-existing). +7 tests added this step.
- `searchSessions()` now returns `chunk_id` in results (additive field). Existing consumers unaffected.
- `searchSessionsFts(db, query, limit)` is synchronous (no embedding needed). Returns BM25-scored results with `chunk_id` for RRF keying.
- `reciprocalRankFusion(resultSets, opts)` is a generic utility — can be reused for any set of ranked results sharing a `chunk_id` key. Default k=60.
- `hybridSearchSessions(db, query, limit)` calls semantic (3×limit) and FTS5 (3×limit) in parallel, fuses via RRF, returns top-limit. This is the primary search function for Step 2.5's evaluation.
- `bin/session-search.mjs` is the CLI entry point. Usage: `node bin/session-search.mjs "query" --hybrid`. Default mode is `--hybrid`. Also accepts `--semantic` and `--fts`.
- `session_chunks_fts` FTS5 table is automatically populated via triggers on INSERT/DELETE. One-time rebuild for pre-existing data is handled by `initDatabase()` via the `session_fts_built` meta key.
- Step 2.5 should run the CLI tool against 20-30 real queries in all three modes (semantic, fts, hybrid) and record results in a spreadsheet. The migration script (`bin/embed-existing-sessions.mjs`) must be run first to populate the session embeddings.
- Phase-4-correction streak: 3 (test count matched in Steps 2.2, 2.3, 2.4).
