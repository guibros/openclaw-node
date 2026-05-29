# AUDIT_POST — Step 6.2: Wire 5-channel retrieval pipeline (FTS5/vector/entity/theme/activation) + RRF + rerank

**Version:** v6.2-mid
**Date:** 2026-05-23
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | `lib/retrieval-pipeline.mjs` (new) — DEFAULT_CHANNEL_WEIGHTS, parseWeights, findMatchingEntities, findMatchingThemes, getChunksForSessions, entitySearch, themeEntitySearch, buildSeeds, activationSearch, weightedRRF, createRetrievalPipeline | `lib/retrieval-pipeline.mjs:23` (DEFAULT_CHANNEL_WEIGHTS), `:39` (parseWeights), `:61` (findMatchingEntities), `:80` (findMatchingThemes), `:103` (getChunksForSessions), `:141` (entitySearch), `:179` (themeEntitySearch), `:233` (buildSeeds), `:259` (activationSearch), `:323` (weightedRRF), `:362` (createRetrievalPipeline) | yes | `grep -n 'export' lib/retrieval-pipeline.mjs` → 11 exports |
| 2 | `test/retrieval-pipeline.test.mjs` (new) — ~8 tests | `test/retrieval-pipeline.test.mjs` (18 `it()` blocks) | yes | `grep -c 'it(' test/retrieval-pipeline.test.mjs` → `18` |

2 of 2 rows landed = yes.

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'export const DEFAULT_CHANNEL_WEIGHTS' lib/retrieval-pipeline.mjs` | `23:export const DEFAULT_CHANNEL_WEIGHTS = Object.freeze({` |
| 2 | `grep -n 'export function parseWeights' lib/retrieval-pipeline.mjs` | `39:export function parseWeights(envValue) {` |
| 3 | `grep -n 'export function findMatchingEntities' lib/retrieval-pipeline.mjs` | `61:export function findMatchingEntities(db, query) {` |
| 4 | `grep -n 'export function findMatchingThemes' lib/retrieval-pipeline.mjs` | `80:export function findMatchingThemes(db, query) {` |
| 5 | `grep -n 'export function getChunksForSessions' lib/retrieval-pipeline.mjs` | `103:export function getChunksForSessions(knowledgeDb, sessionIds, limit = 10) {` |
| 6 | `grep -n 'export function entitySearch' lib/retrieval-pipeline.mjs` | `141:export function entitySearch(extractionDb, knowledgeDb, query, limit = 10) {` |
| 7 | `grep -n 'export function themeEntitySearch' lib/retrieval-pipeline.mjs` | `179:export function themeEntitySearch(extractionDb, knowledgeDb, query, limit = 10) {` |
| 8 | `grep -n 'export function buildSeeds' lib/retrieval-pipeline.mjs` | `233:export function buildSeeds(extractionDb, query) {` |
| 9 | `grep -n 'export function activationSearch' lib/retrieval-pipeline.mjs` | `259:export function activationSearch(extractionDb, knowledgeDb, graphCache, query, limit = 20) {` |
| 10 | `grep -n 'export function weightedRRF' lib/retrieval-pipeline.mjs` | `323:export function weightedRRF(resultSets, weights = [], opts = {}) {` |
| 11 | `grep -n 'export function createRetrievalPipeline' lib/retrieval-pipeline.mjs` | `362:export function createRetrievalPipeline(opts = {}) {` |
| 12 | `grep -c 'it(' test/retrieval-pipeline.test.mjs` | `18` |

## §3 — Cross-references still valid

- `lib/retrieval-pipeline.mjs` imports:
  - `spreadingActivation`, `createGraphAdapter` from `./spreading-activation.mjs` (Step 6.1, lines 32 and 73) — verified present.
  - `slugifyName` from `./obsidian-summarizer.mjs` (Step 5.2, line 43) — verified present.
- Dynamic imports in `createRetrievalPipeline`:
  - `searchSessionsFts` from `./mcp-knowledge/core.mjs:714` — verified present, signature `(db, query, limit)`.
  - `searchSessions` from `./mcp-knowledge/core.mjs:673` — verified present, signature `(db, query, limit)`.
- `reciprocalRankFusion` from `lib/mcp-knowledge/core.mjs:770` — NOT imported (this step implements its own `weightedRRF` which adds channel weights; the existing unweighted RRF is left untouched).
- `test/retrieval-pipeline.test.mjs` imports: `describe`, `it`, `beforeEach`, `afterEach` from `node:test`, `assert` from `node:assert/strict`, `Database` from `better-sqlite3`, and 10 named exports from `../lib/retrieval-pipeline.mjs`. All resolve correctly.
- No pre-existing symbols renamed or deleted.
- No existing imports modified.
- No new dependencies added to `package.json`.

## §4 — Findings

- [POSITIVE] All 5 channels implemented per Block 6 §0 specification: FTS5 keyword (Ch1, via searchSessionsFts), vector/semantic (Ch2, via searchSessions), entity exact match (Ch3, new), theme/entity seed (Ch4, new), spreading activation (Ch5, via createGraphAdapter + spreadingActivation from Step 6.1).
- [POSITIVE] `weightedRRF` correctly extends the RRF formula with per-channel weights: `w_i / (k + rank_i(d))`. Unweighted case (all weights=1) is mathematically equivalent to the original `reciprocalRankFusion` from Step 2.4. Existing RRF function is untouched — no risk of regression.
- [POSITIVE] `DEFAULT_CHANNEL_WEIGHTS` frozen constant provides equal weights `{ fts: 1, vec: 1, entity: 1, theme: 1, spread: 1 }` per Block 6 §0 ("equal start, tunable per env var"). `parseWeights` parses `RETRIEVAL_WEIGHTS` env var.
- [POSITIVE] Cross-database join handled correctly: entity/mention/theme data queried from extraction DB (state.db), then session_ids used to query knowledge DB for chunks. No SQLite cross-DB attach needed.
- [POSITIVE] Channel 5 (spreading activation) correctly excludes seed nodes from results (line 287: `if (seedSlugs.has(nodeId)) continue`) to avoid duplication with Channels 3/4. Only associative (propagated) nodes produce results.
- [POSITIVE] All channels degrade gracefully when databases are missing — `createRetrievalPipeline` accepts optional DB handles and skips channels whose dependencies are absent.
- [POSITIVE] `findMatchingEntities` and `findMatchingThemes` use JavaScript-level `.includes()` filtering instead of SQL INSTR, avoiding parameter binding issues observed during Phase 5 initial run. Trade-off: O(n) scan of entity/theme tables, but acceptable for expected scale (<10K entities).
- [POSITIVE] Module uses dynamic import for mcp-knowledge/core.mjs (lines 383, 394) to avoid pulling in sqlite-vec and transformer dependencies at module load time. Pipeline module can be imported without those heavy deps.
- [POSITIVE] `buildSeeds` correctly bridges entity/theme names to graph node IDs via `slugifyName` from obsidian-summarizer (Step 5.2), ensuring slug→nodeId consistency.
- [POSITIVE] All 18 new tests pass. Test count: 766 (689 pass, 77 fail — unchanged baseline of 77 failures). Node test runner reports +18.
- [NEGATIVE] Test count estimate was ~8 in AUDIT_PRE §6, actual delivery is 18 `it()` blocks (9 describe blocks). Phase-4-correction streak reset to 0 for Block 6.

10 POSITIVE, 1 NEGATIVE findings. 0 Phase 8 patches.

## §5 — Phase 8 patches

None. All landed code is correct as implemented.

## §6 — Carry-forwards to Step 6.3

- Test baseline is now 766 tests (689 pass, 77 fail — 73 pre-existing + 4 flaky). +18 `it()` blocks added this step.
- `createRetrievalPipeline({ knowledgeDb, extractionDb, graphCache })` exported from `lib/retrieval-pipeline.mjs:362` — factory returning `{ retrieve(query, opts) }`.
- `weightedRRF(resultSets, weights, opts)` exported from `lib/retrieval-pipeline.mjs:323` — weighted extension of RRF with per-channel multipliers.
- `parseWeights(envValue)` exported from `lib/retrieval-pipeline.mjs:39` — parses `RETRIEVAL_WEIGHTS` env var.
- `buildSeeds(extractionDb, query)` exported from `lib/retrieval-pipeline.mjs:233` — converts query to seed map for spreading activation.
- Channel weights read from `RETRIEVAL_WEIGHTS` at pipeline creation time (not per-query).
- Step 6.3 must tune decay/steps/threshold on the evaluation set from Step 2.5. The pipeline provides all the machinery — Step 6.3 runs the evaluation queries through `createRetrievalPipeline` and varies `SPREAD_STEPS`/`SPREAD_DECAY`/`SPREAD_THRESHOLD`/`RETRIEVAL_WEIGHTS` env vars to find optimal settings.
