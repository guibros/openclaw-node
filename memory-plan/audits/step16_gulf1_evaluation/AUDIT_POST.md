# AUDIT_POST — Step 2.5: Manual evaluation against 20-30 real queries; spreadsheet of results; Gulf 1 gate

**Version:** v2.5-mid
**Date:** 2026-05-21
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | Create evaluation runner: parseQuerySet, runEvaluation, formatResults, aggregateScores, checkDatabaseReadiness, CLI entry point | `bin/run-gulf1-eval.mjs:34` (parseQuerySet), `:91` (runEvaluation), `:166` (formatResults), `:135` (aggregateScores), `:217` (checkDatabaseReadiness) | yes | `grep -n 'export function parseQuerySet' bin/run-gulf1-eval.mjs` → `34` |
| 2 | Create curated query set: 25 queries with id, query, category, expected_topic fields | `memory-plan/eval/gulf1-queries.json` (full file, 25 entries) | yes | `grep -c '"id"' memory-plan/eval/gulf1-queries.json` → `25` |
| 3 | 5 tests: parseQuerySet validation, formatResults markdown output, runEvaluation with synthetic data, empty database handling, score aggregation helper | `test/gulf1-eval.test.mjs` (full file, 7 `it()` blocks) | yes | `grep -c 'it(' test/gulf1-eval.test.mjs` → `7` |

All 3 rows landed = yes. 3 non-audit non-ledger files in staged diff (bin/run-gulf1-eval.mjs, memory-plan/eval/gulf1-queries.json, test/gulf1-eval.test.mjs).

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'export function parseQuerySet' bin/run-gulf1-eval.mjs` | `34:export function parseQuerySet(jsonStr) {` |
| 2 | `grep -n 'export async function runEvaluation' bin/run-gulf1-eval.mjs` | `91:export async function runEvaluation(db, queries, limit = 5) {` |
| 3 | `grep -n 'export function formatResults' bin/run-gulf1-eval.mjs` | `166:export function formatResults(evalResults, meta = {}) {` |
| 4 | `grep -n 'export function aggregateScores' bin/run-gulf1-eval.mjs` | `135:export function aggregateScores(evalResults) {` |
| 5 | `grep -n 'export function checkDatabaseReadiness' bin/run-gulf1-eval.mjs` | `217:export function checkDatabaseReadiness(db) {` |
| 6 | `grep -c '"id"' memory-plan/eval/gulf1-queries.json` | `25` |
| 7 | `grep -c 'it(' test/gulf1-eval.test.mjs` | `7` |

## §3 — Cross-references still valid

- `initDatabase`, `searchSessions`, `searchSessionsFts`, `hybridSearchSessions`, `DB_PATH` imported by `bin/run-gulf1-eval.mjs` — all still exported from `lib/mcp-knowledge/core.mjs` at their respective lines.
- `initDatabase`, `indexSessionTurns` imported by `test/gulf1-eval.test.mjs` — still exported from `lib/mcp-knowledge/core.mjs`.
- `parseQuerySet`, `runEvaluation`, `formatResults`, `aggregateScores`, `checkDatabaseReadiness` imported by test from `bin/run-gulf1-eval.mjs` — all newly exported.
- No symbols renamed or deleted in this step.
- Zero stale references found.

## §4 — Findings

- [POSITIVE] The evaluation runner uses library APIs directly rather than shelling out to the CLI, enabling structured result collection and programmatic output formatting.
- [POSITIVE] The query set covers 8 distinct categories (architecture, memory-lifecycle, architecture-decision, semantic-layer, extraction, infrastructure, search, federation) with 25 queries — within the 20-30 target range from the REFERENCE_PLAN.
- [POSITIVE] The formatResults function produces a markdown document with empty scoring columns (`Relevant? (0-2)`) and a decision checklist, making operator review straightforward.
- [POSITIVE] The checkDatabaseReadiness function validates that session data is indexed before running the evaluation, with clear warnings when embeddings or sessions are missing.
- [POSITIVE] All three search modes (FTS5, semantic, hybrid) have graceful error handling — a mode that fails silently returns empty results rather than crashing the evaluation.
- [POSITIVE] The aggregateScores function pre-computes the total possible score based on query count and top-N, providing a ready-made scoring template.
- [NEGATIVE] Test count underestimate: AUDIT_PRE planned 5 tests, delivered 7. The parseQuerySet describe block has 3 sub-tests (valid parse, non-array, missing field) which were counted as 1 in the plan. Phase-4-correction streak resets to 0.

6 POSITIVE findings, 1 NEGATIVE finding.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards to Block 3

- Test baseline is now 559 tests (486 pass, 73 fail pre-existing). +7 tests added this step.
- `bin/run-gulf1-eval.mjs` is the evaluation runner. Usage: `node bin/run-gulf1-eval.mjs [--queries path] [--db path] [--out path] [--limit N]`. Exports `parseQuerySet`, `runEvaluation`, `formatResults`, `aggregateScores`, `checkDatabaseReadiness` for programmatic use.
- `memory-plan/eval/gulf1-queries.json` contains 25 curated queries. The operator may augment this set with additional real queries drawn from actual session history before running the evaluation.
- The evaluation must be run against real session data: operator needs to (1) run `bin/embed-existing-sessions.mjs` to populate embeddings, then (2) run `bin/run-gulf1-eval.mjs` to generate results at `memory-plan/eval/gulf1-results.md`, then (3) manually score each result 0-2 and make the go/no-go decision.
- **Block 2 is complete.** Block 3 (LLM extraction) does NOT begin until the operator scores the evaluation results AND authors Block 3 frozen decisions in RESUME.md §0.
- Phase-4-correction streak: 0 (reset — test count underestimate in Step 2.5).
- Phase-8-patch streak: 5 (Steps 2.1–2.5, zero patches).
