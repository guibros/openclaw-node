# AUDIT_PRE — Step 2.5: Manual evaluation against 20-30 real queries; spreadsheet of results; Gulf 1 gate

**Version:** v2.5-pre
**Date:** 2026-05-21
**Author:** memory-plan-tick

---

## §1 — Intent

Step 2.5 is the Gulf 1 evaluation gate — the most important decision gate in the entire memory
plan. The step creates evaluation tooling that runs 25 curated queries through all three search
modes (FTS5, semantic, hybrid) and produces a structured results document for operator scoring.

The autonomous worker delivers:
1. An evaluation runner script (`bin/run-gulf1-eval.mjs`) that queries all 3 modes and formats
   results into a markdown document with scoring columns.
2. A curated query set (`memory-plan/eval/gulf1-queries.json`) of 25 queries drawn from known
   codebase topics and representative usage patterns.
3. Tests for the evaluation infrastructure.

The operator's follow-up responsibility (outside the automated framework):
1. Run `bin/embed-existing-sessions.mjs` to populate session embeddings (if not already done).
2. Run `bin/run-gulf1-eval.mjs` against the live databases.
3. Manually score each retriever's top-5 results in the output document.
4. Make the go/no-go decision for Block 3 based on the scores.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 2 | 2.5 | v2.5 | [A] | Manual evaluation against 20-30 real queries; spreadsheet of results; **Gulf 1 gate** |

## §3 — Design decisions (consuming Step 2.4 AUDIT_POST §6)

Carry-forwards from Step 2.4:
- Test baseline is 552 tests (479 pass, 73 fail pre-existing).
- `hybridSearchSessions(db, query, limit)` is the primary search function for evaluation.
- `searchSessionsFts(db, query, limit)` is synchronous FTS5 search.
- `searchSessions(db, query, limit)` is async semantic search (returns `chunk_id`).
- `bin/session-search.mjs` is the CLI entry point (--hybrid, --semantic, --fts).
- Migration script (`bin/embed-existing-sessions.mjs`) must run first to populate embeddings.
- `session_chunks_fts` FTS5 table auto-populated via triggers.

Design decisions for this step:
- The evaluation runner uses the library APIs directly (not the CLI) for programmatic access
  to results and structured output.
- Query set is JSON-format with fields: `id`, `query`, `category`, `expected_topic`.
- Output is a markdown document with per-query tables showing top-5 results from each mode,
  with empty scoring columns for the operator to fill.
- The runner checks whether session data exists and warns if the database is empty.
- 25 queries covering: architecture decisions, debugging patterns, configuration,
  code structure, feature implementation, NATS/messaging, memory infrastructure,
  session management, and cross-cutting concerns.

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | No session data in test environment | LOW | Tests use in-memory DB with synthetic data; live evaluation is operator responsibility |
| 2 | Query set may not match real user queries | LOW | Queries derived from known codebase topics; operator can augment the set |
| 3 | Embedding model loading in eval may be slow | LOW | Runner reports timing; operator can adjust |

No HIGH-severity risks.

## §5 — Deferrals

- Actual live scoring is deferred to operator (outside automated framework).
- Block 3 frozen decisions are NOT authored by this step — operator must author them after
  reviewing the evaluation results (per RESUME.md §0).

## §6 — Phase 4 implementation outline

| # | Delta | File | Type |
|---|-------|------|------|
| 1 | Create evaluation runner: parseQuerySet, runEvaluation (3 modes per query), formatResults (markdown tables with scoring columns), main CLI entry point | `bin/run-gulf1-eval.mjs` | new |
| 2 | Create curated query set: 25 queries with id, query, category, expected_topic fields | `memory-plan/eval/gulf1-queries.json` | new |
| 3 | 5 tests: parseQuerySet validation, formatResults markdown output, runEvaluation with synthetic data (3 modes), empty database handling, score aggregation helper | `test/gulf1-eval.test.mjs` | new |
