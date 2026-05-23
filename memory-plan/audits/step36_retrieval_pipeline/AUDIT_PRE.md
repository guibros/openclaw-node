# AUDIT_PRE — Step 6.2: Wire 5-channel retrieval pipeline (FTS5/vector/entity/theme/activation) + RRF + rerank

**Version:** v6.2-pre
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Intent

Wire the 5-channel retrieval pipeline per Block 6 §0:

1. **FTS5 keyword** (k=10) — existing `searchSessionsFts` in `lib/mcp-knowledge/core.mjs:714`
2. **Vector / semantic** (k=10) — existing `searchSessions` in `lib/mcp-knowledge/core.mjs:673`
3. **Entity exact match** (k=10) — new: find entities whose names appear in the query → mentions → session chunks
4. **Theme/entity seed** (k=10) — new: find themes + entities from the query → direct session retrieval via mentions + decision text search
5. **Spreading activation** (top 20) — existing algorithm from `lib/spreading-activation.mjs:32`, seeded from matched entities/themes

Combine all 5 channels via weighted Reciprocal Rank Fusion (RRF, constant 60). Channel weights equal by default (`{ fts: 1, vec: 1, entity: 1, theme: 1, spread: 1 }`), configurable via `RETRIEVAL_WEIGHTS` env var.

No cross-encoder reranker — Block 6 §0 explicitly chose "RRF only, no BGE-reranker-v2-m3."

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 6 | 6.2 | v6.2 | [A] | Wire 5-channel retrieval pipeline (FTS5/vector/entity/theme/activation) + RRF + rerank |

## §3 — Design decisions (from Step 6.1 AUDIT_POST §6)

- Test baseline: 748 tests (671 pass, 77 fail — 73 pre-existing + 4 flaky).
- `spreadingActivation(seeds, graph, opts)` exported from `lib/spreading-activation.mjs:32` — pure algorithm, takes generic `edgesFrom` graph interface.
- `createGraphAdapter(graphCache)` exported from `lib/spreading-activation.mjs:73` — adapter wrapping Step 5.4's `queryNeighbors('outgoing')` into `edgesFrom` interface.
- Constants DEFAULT_STEPS (3), DEFAULT_DECAY (0.7), DEFAULT_THRESHOLD (0.1) at lines 8-10.
- Env var overrides: SPREAD_STEPS, SPREAD_DECAY, SPREAD_THRESHOLD.
- The RRF combiner from Step 2.4 (`reciprocalRankFusion` in `lib/mcp-knowledge/core.mjs:770`) combines ranked result sets by `chunk_id`.
- `searchSessions` (semantic, async) and `searchSessionsFts` (FTS5, sync) already exist in `lib/mcp-knowledge/core.mjs`.
- `slugifyName` in `lib/obsidian-summarizer.mjs:43` converts entity names to graph node IDs.
- Graph node IDs are `basename(file, '.md')` — match slugified entity names.
- Extraction store (`lib/extraction-store.mjs`) has `entities`, `themes`, `mentions`, `decisions` tables. Entities + mentions provide session-level linkage. Themes have no per-session tracking — bridge through decision text search.

## §4 — Risk register

| # | Severity | Risk | Mitigation |
|---|----------|------|------------|
| 1 | MEDIUM | Cross-database queries — entity/mention data in `state.db`, session chunks in `knowledge.db`, graph cache in `graph-cache.db`. No cross-DB joins in SQLite. | Application-level joins: query extraction DB for session_ids, then query knowledge DB for chunks. Pass three DB handles to pipeline factory. |
| 2 | LOW | Graph node IDs (slugified filenames) must map back to entity names for Channel 5 reverse lookup. | Use `slugifyName` from obsidian-summarizer for consistent slug→entity mapping. Pre-build slug→entity Map at pipeline creation. |
| 3 | LOW | Empty graph/entity store returns empty results for Channels 3-5. | Acceptable per Block 6 §0 ("returns nothing, caller falls back to other channels"). FTS5 + semantic still work. |
| 4 | LOW | Theme-to-session bridging is indirect (themes have no session_id column). | Bridge via decision text search: find decisions whose text contains the theme label. Decisions have session_id. |

## §5 — Deferrals

- Cross-encoder reranking (Block 6 §0: "RRF only, no BGE-reranker-v2-m3" — deferred to Block 7+).
- Pipeline integration into the MCP knowledge server (separate step — this step creates the module; wiring into the MCP tool handler is Step 6.3 or later).
- Conflict annotation integration — `annotateWithConflicts` from `lib/conflict-surfacing.mjs` is available but not wired in this step; pipeline returns raw RRF results.

## §6 — Phase 4 implementation outline

### Delta 1: `lib/retrieval-pipeline.mjs` (new)

New module implementing the 5-channel retrieval pipeline.

**Exports:**

- `DEFAULT_CHANNEL_WEIGHTS` constant — `{ fts: 1, vec: 1, entity: 1, theme: 1, spread: 1 }`
- `parseWeights(envValue)` — parse `RETRIEVAL_WEIGHTS=fts:2,vec:1,...` CSV format; returns object with channel keys; validates keys against known channel names; falls back to defaults for missing channels
- `findMatchingEntities(db, query)` — `SELECT id, name, type, mention_count FROM entities WHERE INSTR(LOWER(?1), LOWER(name)) > 0 ORDER BY mention_count DESC LIMIT 20`; returns entity rows whose names appear as substrings in the query text
- `findMatchingThemes(db, query)` — `SELECT id, label, mention_count FROM themes WHERE INSTR(LOWER(?1), LOWER(label)) > 0 ORDER BY mention_count DESC LIMIT 20`; same approach for themes
- `getChunksForSessions(knowledgeDb, sessionIds, limit)` — helper: given session_id array, query `session_chunks` table, return `{chunk_id, session_id, turn_index, role, score, snippet}` results (score defaults to 1.0, ordering preserved)
- `entitySearch(extractionDb, knowledgeDb, query, limit)` — Channel 3: calls `findMatchingEntities` → gets session_ids from `mentions` table ranked by `MAX(salience)` → calls `getChunksForSessions`; returns RRF-compatible result array
- `themeEntitySearch(extractionDb, knowledgeDb, query, limit)` — Channel 4: calls `findMatchingEntities` + `findMatchingThemes` → for entities: session_ids via mentions; for themes: session_ids via decision text search (`INSTR(LOWER(decision), LOWER(label)) > 0 OR INSTR(LOWER(rationale), LOWER(label)) > 0`) → dedup session_ids → `getChunksForSessions`; returns RRF-compatible result array
- `buildSeeds(extractionDb, query)` — extract entity names + theme labels matched in query → return `Object<slug, 1.0>` map keyed by `slugifyName(name)` for use as spreading activation seeds
- `activationSearch(extractionDb, knowledgeDb, graphCache, query, limit)` — Channel 5: calls `buildSeeds` → `createGraphAdapter(graphCache)` → `spreadingActivation(seeds, graph)` → take top `limit` activated node IDs → reverse-map slugs to entity names → get session_ids from mentions → `getChunksForSessions`; returns RRF-compatible result array
- `weightedRRF(resultSets, weights, opts)` — weighted Reciprocal Rank Fusion: `RRF(d) = Σ w_i / (k + rank_i(d))` where `w_i` is the channel weight. Deduplicates by `chunk_id`. Returns sorted results.
- `createRetrievalPipeline(opts)` — factory accepting `{ knowledgeDb, extractionDb, graphCache }` (all optional — missing components disable their channels gracefully). Returns `{ retrieve(query, opts) }` where `retrieve` runs all available channels, combines via `weightedRRF`, returns top-k results.

**Imports:**
- `spreadingActivation`, `createGraphAdapter` from `../lib/spreading-activation.mjs`
- `slugifyName` from `../lib/obsidian-summarizer.mjs`
- No new npm dependencies.

### Delta 2: `test/retrieval-pipeline.test.mjs` (new)

~8 tests covering:

1. `parseWeights` — valid CSV parsing
2. `parseWeights` — missing/empty returns defaults
3. `findMatchingEntities` — returns matches from mock DB
4. `findMatchingThemes` — returns matches from mock DB
5. `weightedRRF` — basic combination with equal weights
6. `weightedRRF` — unequal weights change ordering
7. `entitySearch` — end-to-end with in-memory DBs
8. `createRetrievalPipeline` — factory returns object with retrieve method
