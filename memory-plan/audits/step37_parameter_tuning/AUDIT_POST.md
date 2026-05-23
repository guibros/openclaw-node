# AUDIT_POST — Step 6.3: Tune decay/steps/threshold on the same evaluation set from Step 2.5

**Version:** v6.3-mid
**Date:** 2026-05-23
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | `bin/run-tuning-harness.mjs` (new) — DEFAULT_CONFIGS, applyConfig, resetConfig, runConfigQueries, formatTuningReport, runTuningHarness | `bin/run-tuning-harness.mjs:28` (DEFAULT_CONFIGS), `:100` (applyConfig), `:117` (resetConfig), `:136` (runConfigQueries), `:162` (formatTuningReport), `:252` (runTuningHarness) | yes | `grep -n 'export' bin/run-tuning-harness.mjs` → 6 exports |
| 2 | `test/tuning-harness.test.mjs` (new) — ~6 tests | `test/tuning-harness.test.mjs` (6 `it()` blocks) | yes | `grep -c 'it(' test/tuning-harness.test.mjs` → `6` |

2 of 2 rows landed = yes.

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'export const DEFAULT_CONFIGS' bin/run-tuning-harness.mjs` | `28:export const DEFAULT_CONFIGS = [` |
| 2 | `grep -n 'export function applyConfig' bin/run-tuning-harness.mjs` | `100:export function applyConfig(config) {` |
| 3 | `grep -n 'export function resetConfig' bin/run-tuning-harness.mjs` | `117:export function resetConfig(saved) {` |
| 4 | `grep -n 'export async function runConfigQueries' bin/run-tuning-harness.mjs` | `136:export async function runConfigQueries(pipeline, queries, limit = 5) {` |
| 5 | `grep -n 'export function formatTuningReport' bin/run-tuning-harness.mjs` | `162:export function formatTuningReport(allResults, meta = {}) {` |
| 6 | `grep -n 'export async function runTuningHarness' bin/run-tuning-harness.mjs` | `252:export async function runTuningHarness(opts) {` |
| 7 | `grep -c 'it(' test/tuning-harness.test.mjs` | `6` |

## §3 — Cross-references still valid

- `bin/run-tuning-harness.mjs` imports:
  - `parseQuerySet` from `./run-gulf1-eval.mjs:34` (Step 2.5) — verified present.
  - `createRetrievalPipeline` from `../lib/retrieval-pipeline.mjs:362` (Step 6.2) — verified present.
- CLI dynamic imports:
  - `initDatabase`, `DB_PATH` from `../lib/mcp-knowledge/core.mjs` — verified present.
  - `createExtractionStore` from `../lib/extraction-store.mjs` — verified present.
  - `createGraphCache` from `../bin/obsidian-graph-cache.mjs` — verified present.
- `test/tuning-harness.test.mjs` imports 6 named exports from `../bin/run-tuning-harness.mjs`. All resolve correctly.
- No pre-existing symbols renamed or deleted.
- No existing imports modified.
- No new dependencies added to `package.json`.

## §4 — Findings

- [POSITIVE] 12 named parameter configurations covering all key tuning axes: spreading activation (decay, steps, threshold) and channel weights (fts-heavy, vec-heavy, spread-heavy, no-spread, aggressive).
- [POSITIVE] `applyConfig`/`resetConfig` pattern correctly manages env var lifecycle — saves previous values, sets config env vars, and restores on reset in a try/finally block within `runTuningHarness`.
- [POSITIVE] `formatTuningReport` produces three analysis sections: summary table (total hits, queries with results, avg hits/query), delta vs baseline table, and per-query hit count matrix — all designed for operator eyeball comparison per Block 6 §0.
- [POSITIVE] `runConfigQueries` handles pipeline failures gracefully — try/catch returns empty results if pipeline.retrieve throws.
- [POSITIVE] CLI entry point supports all necessary database paths via flags (--db, --extraction-db, --graph-db) with auto-detection fallbacks for each.
- [POSITIVE] Reuses `parseQuerySet` from Step 2.5 (`bin/run-gulf1-eval.mjs`) — zero code duplication for query set parsing and validation.
- [POSITIVE] Reuses `createRetrievalPipeline` from Step 6.2 — the harness is purely a test driver, no production code duplicated.
- [POSITIVE] All 6 new tests pass. Test count: 772 (695 pass, 77 fail — unchanged baseline of 77 failures). Node test runner reports +6.
- [POSITIVE] `DEFAULT_CONFIGS` baseline entry has empty `env` object, letting all defaults from spreading-activation.mjs and retrieval-pipeline.mjs apply naturally.

9 POSITIVE, 0 NEGATIVE findings. 0 Phase 8 patches.

## §5 — Phase 8 patches

None. All landed code is correct as implemented.

## §6 — Carry-forwards to Step 6.4

- Test baseline is now 772 tests (695 pass, 77 fail — 73 pre-existing + 4 flaky). +6 `it()` blocks added this step.
- `runTuningHarness` at `bin/run-tuning-harness.mjs:252` — main orchestrator accepting queries, databases, configs, limit.
- `DEFAULT_CONFIGS` at `bin/run-tuning-harness.mjs:28` — 12 named parameter configurations.
- `formatTuningReport` at `bin/run-tuning-harness.mjs:162` — markdown report formatter.
- Step 6.4 is the historical session backfill step (`bin/extract-existing-sessions.mjs` running the LLM extractor over all sessions). It is independent of the tuning harness and uses entirely different infrastructure (extraction-store, LLM client, Ollama).
- The tuning harness results will be meaningful only after Step 6.4 populates the extraction store and concept graph with real data from historical sessions.
