# AUDIT_PRE — Step 6.3: Tune decay/steps/threshold on the same evaluation set from Step 2.5

**Version:** v6.3-pre
**Date:** 2026-05-23
**Author:** memory-plan-tick

---

## §1 — Intent

Create a parameter tuning harness that runs the 25-query Gulf-1 evaluation set through the 5-channel retrieval pipeline (`createRetrievalPipeline` from Step 6.2) with multiple parameter configurations. The harness varies `SPREAD_STEPS`, `SPREAD_DECAY`, `SPREAD_THRESHOLD`, and `RETRIEVAL_WEIGHTS` across a default grid of ~12 named configurations, collects per-query/per-channel result counts, and produces a structured markdown report for the operator to eyeball. No formal scoring is required per Block 6 §0.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 6 | 6.3 | v6.3 | [A] | Tune decay/steps/threshold on the same evaluation set from Step 2.5 |

## §3 — Design decisions (consumed from prior AUDIT_POST §6)

From Step 6.2 AUDIT_POST §6 carry-forwards:
- Test baseline: 766 tests (689 pass, 77 fail — 73 pre-existing + 4 flaky).
- `createRetrievalPipeline({ knowledgeDb, extractionDb, graphCache })` at `lib/retrieval-pipeline.mjs:362`.
- `weightedRRF` at `lib/retrieval-pipeline.mjs:323`.
- `parseWeights` at `lib/retrieval-pipeline.mjs:39`.
- `buildSeeds` at `lib/retrieval-pipeline.mjs:233`.
- Channel weights read from `RETRIEVAL_WEIGHTS` at pipeline creation time (not per-query).
- Step 6.3 runs evaluation queries through `createRetrievalPipeline` with varying env vars.

**Architecture decision — env-var-per-config approach:** Since `createRetrievalPipeline` reads `RETRIEVAL_WEIGHTS` at creation time, and `spreadingActivation` reads `SPREAD_STEPS`/`SPREAD_DECAY`/`SPREAD_THRESHOLD` at call time, the harness sets env vars before creating each pipeline instance and resets them afterward. Each config gets a fresh pipeline.

**Default configuration grid:** 12 named configs covering the key tuning axes:
1. `baseline` — defaults (steps=3, decay=0.7, threshold=0.1, equal weights)
2. `low-decay` — decay=0.3 (rapid falloff)
3. `high-decay` — decay=0.9 (wide propagation)
4. `short-steps` — steps=1 (direct neighbors only)
5. `long-steps` — steps=5 (deep propagation)
6. `low-threshold` — threshold=0.01 (include weak activations)
7. `high-threshold` — threshold=0.2 (only strong activations)
8. `fts-heavy` — fts weight=3, rest=1
9. `vec-heavy` — vec weight=3, rest=1
10. `spread-heavy` — spread weight=3, rest=1
11. `no-spread` — spread weight=0
12. `aggressive` — steps=5, decay=0.9, threshold=0.01 (max activation coverage)

## §4 — Risk register

- LOW: Empty graph cache (Block 5 validation gate waived). Spreading activation returns nothing → all spread-related configs behave identically. Acceptable per Block 6 §0 ("mathematically valid on empty real graphs — returns nothing").
- LOW: FTS5 query sanitization needed (same issue as Gulf-1 eval). Reuse `ftsSafeQuery` pattern.
- LOW: Test count may differ from estimate. Estimating ~6 tests.

## §5 — Deferrals

- None. This is the last functional step before the backfill step (6.4).

## §6 — Phase 4 implementation outline

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `bin/run-tuning-harness.mjs` | new | CLI tuning harness. Exports: `DEFAULT_CONFIGS` (12 named configs), `applyConfig(config)` (sets env vars), `resetConfig()` (clears env vars), `runConfigQueries(pipeline, queries, limit)` (runs all queries through a pipeline), `formatTuningReport(allResults, meta)` (markdown comparison report), `runTuningHarness(opts)` (main orchestrator). CLI with `--queries`, `--db`, `--extraction-db`, `--graph-db`, `--out`, `--limit`, `--configs` flags. |
| 2 | `test/tuning-harness.test.mjs` | new | ~6 tests covering: DEFAULT_CONFIGS shape, applyConfig/resetConfig env var management, runConfigQueries mock pipeline result collection, formatTuningReport markdown output structure, runTuningHarness orchestration with mocks. |
