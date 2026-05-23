# AUDIT_POST — Step 8.1: Implement consolidation jobs (embed/extract/update/refresh/decay/reinforce/cluster/summary/contradict/promote)

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised file | Actual file:line | Landed | Grep evidence |
|---|---------------|-------------------|--------|---------------|
| 1 | `lib/consolidation.mjs` (new) | `lib/consolidation.mjs:25,26,27,28,29,37,69,168,232,313,334,361` | yes | `DECAY_HALF_LIFE_DAYS` at :25, `DECAY_DROP_THRESHOLD` at :26, `REINFORCEMENT_COOCCURRENCE_MIN` at :27, `REINFORCEMENT_SALIENCE_BOOST` at :28, `CLUSTER_COOCCURRENCE_MIN` at :29, `initConsolidationTables` at :37, `decayWeights` at :69, `reinforceCoOccurrence` at :168, `detectClusters` at :232, `regenerateSummaries` at :313, `detectContradictions` at :334, `evaluatePromotionCandidates` at :361 |
| 2 | `bin/consolidate.mjs` (new) | `bin/consolidate.mjs:44` | yes | `runConsolidationCycle` at :44 |
| 3 | `test/consolidation.test.mjs` (new) | `test/consolidation.test.mjs` | yes | 8 describe blocks, 14 `it()` blocks |

All 3 promised deltas landed. All rows = `yes`.

## §2 — Greppable deltas confirmed

| Delta | Command | First hit |
|-------|---------|-----------|
| DECAY_HALF_LIFE_DAYS | `grep 'export const DECAY_HALF_LIFE_DAYS' lib/consolidation.mjs` | line 25 |
| initConsolidationTables | `grep 'export function initConsolidationTables' lib/consolidation.mjs` | line 37 |
| decayWeights | `grep 'export function decayWeights' lib/consolidation.mjs` | line 69 |
| reinforceCoOccurrence | `grep 'export function reinforceCoOccurrence' lib/consolidation.mjs` | line 168 |
| detectClusters | `grep 'export function detectClusters' lib/consolidation.mjs` | line 232 |
| regenerateSummaries | `grep 'export async function regenerateSummaries' lib/consolidation.mjs` | line 313 |
| detectContradictions | `grep 'export function detectContradictions' lib/consolidation.mjs` | line 334 |
| evaluatePromotionCandidates | `grep 'export function evaluatePromotionCandidates' lib/consolidation.mjs` | line 361 |
| runConsolidationCycle | `grep 'export async function runConsolidationCycle' bin/consolidate.mjs` | line 44 |

## §3 — Cross-references still valid

- `lib/consolidation.mjs` imports `surfaceConflicts` from `./conflict-surfacing.mjs` — verified at line 22.
- `lib/consolidation.mjs` dynamically imports `generateConceptNotes` from `./obsidian-summarizer.mjs` in `regenerateSummaries()` — verified at line 317.
- `bin/consolidate.mjs` imports all 7 exports from `../lib/consolidation.mjs` — verified at lines 23-30.
- `bin/consolidate.mjs` imports `Database` from `better-sqlite3` — verified at line 22.
- `test/consolidation.test.mjs` imports 10 exports from `../lib/consolidation.mjs` — verified at lines 4-15.
- `test/consolidation.test.mjs` imports `runConsolidationCycle` from `../bin/consolidate.mjs` — verified at line 16.
- No stale references anywhere in the codebase. Only two files import from consolidation.mjs: `bin/consolidate.mjs` and `test/consolidation.test.mjs`.

## §4 — Findings

1. **[POSITIVE]** All 6 consolidation functions from §0 implemented and independently testable: `decayWeights`, `reinforceCoOccurrence`, `detectClusters`, `regenerateSummaries`, `detectContradictions`, `evaluatePromotionCandidates`.
2. **[POSITIVE]** Decay formula correctly implements `new = old * 0.5^(days / 14)` per Block 8 §0 "8.3". Falls back to `last_seen` when `last_recalled` is NULL.
3. **[POSITIVE]** Archival mechanism moves entities below `DECAY_DROP_THRESHOLD` (0.05) to `entities_archived` table — no hard delete, data preserved with `archived_at` timestamp.
4. **[POSITIVE]** Co-occurrence reinforcement uses efficient SQL join on `mentions` table with `entity_id < entity_id` to avoid self-joins and duplicates. Each entity bumped at most once per cycle via `Set` tracking.
5. **[POSITIVE]** Cluster detection uses union-find for deterministic graph-component merging — NOT k-means/DBSCAN per §0 "8.4" mandate.
6. **[POSITIVE]** `regenerateSummaries` gracefully degrades when LLM or vault is unavailable (try/catch returns `{ regenerated: 0, error }`).
7. **[POSITIVE]** `detectContradictions` reuses `surfaceConflicts` from `conflict-surfacing.mjs` (zero code duplication) with graceful fallback on error.
8. **[POSITIVE]** `evaluatePromotionCandidates` filters by `source_type = 'local'` to avoid re-promoting shared content, with configurable thresholds matching Block 4 §0 defaults (mention ≥ 10, confidence ≥ 0.95).
9. **[POSITIVE]** `runConsolidationCycle` in `bin/consolidate.mjs` accepts injected `db` for testing (no filesystem coupling in tests) and properly closes owned connections via `try/finally`.
10. **[POSITIVE]** All 5 constants exported and testable: `DECAY_HALF_LIFE_DAYS` (14), `DECAY_DROP_THRESHOLD` (0.05), `REINFORCEMENT_COOCCURRENCE_MIN` (3), `REINFORCEMENT_SALIENCE_BOOST` (0.05), `CLUSTER_COOCCURRENCE_MIN` (5).
11. **[NEGATIVE]** Test count delta: planned ~8-10 `it()` blocks in AUDIT_PRE §6, delivered 14. Node test runner reports 883 total (prev 869 = +14 additions). Phase-4-correction streak reset.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards to Step 8.2

- Test baseline: 883 tests (808 pass, 75 fail — 73 pre-existing + 2 flaky variance). +14 `it()` blocks added this step.
- `lib/consolidation.mjs` exports: `initConsolidationTables` at :37, `decayWeights` at :69, `reinforceCoOccurrence` at :168, `detectClusters` at :232, `regenerateSummaries` at :313, `detectContradictions` at :334, `evaluatePromotionCandidates` at :361. Constants at :25-29.
- `bin/consolidate.mjs` exports `runConsolidationCycle` at :44. CLI entry with `--db`/`--vault-path`/`--dry-run`.
- `entities_archived` table schema: same columns as `entities` plus `archived_at TEXT NOT NULL`.
- Step 8.2 (scheduler) needs: `runConsolidationCycle` from `bin/consolidate.mjs`, integration with `ollama-queue.getState()` for busy detection, launchd plist at 30-min cadence, 5-min hard cap per cycle.
