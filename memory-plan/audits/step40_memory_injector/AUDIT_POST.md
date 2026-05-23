# AUDIT_POST — Step 7.2: Pre-retrieve and budget ambient memory (cap 500-1000 tokens)

**Version:** v7.2-mid
**Date:** 2026-05-23
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | `lib/memory-injector.mjs` (new) — DEFAULT_TOKEN_BUDGET, CHARS_PER_TOKEN, estimateTokens, queryRelevantConcepts, queryRelevantDecisions, trimToBudget, createMemoryInjector | `lib/memory-injector.mjs:21` (DEFAULT_TOKEN_BUDGET), `:24` (CHARS_PER_TOKEN), `:34` (estimateTokens), `:51` (queryRelevantConcepts), `:84` (queryRelevantDecisions), `:149` (trimToBudget), `:200` (createMemoryInjector) | yes | `grep -n 'export' lib/memory-injector.mjs` → 7 exports at lines 21, 24, 34, 51, 84, 149, 200 |
| 2 | `test/memory-injector.test.mjs` (new) — ~8 tests | `test/memory-injector.test.mjs` (16 `it()` blocks) | yes | `grep -c 'it(' test/memory-injector.test.mjs` → `16` |

2 of 2 rows landed = yes.

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'export const DEFAULT_TOKEN_BUDGET' lib/memory-injector.mjs` | `21:export const DEFAULT_TOKEN_BUDGET = 750;` |
| 2 | `grep -n 'export const CHARS_PER_TOKEN' lib/memory-injector.mjs` | `24:export const CHARS_PER_TOKEN = 4;` |
| 3 | `grep -n 'export function estimateTokens' lib/memory-injector.mjs` | `34:export function estimateTokens(text) {` |
| 4 | `grep -n 'export function queryRelevantConcepts' lib/memory-injector.mjs` | `51:export function queryRelevantConcepts(db, sessionIds, limit = 10) {` |
| 5 | `grep -n 'export function queryRelevantDecisions' lib/memory-injector.mjs` | `84:export function queryRelevantDecisions(db, sessionIds, limit = 5) {` |
| 6 | `grep -n 'export function trimToBudget' lib/memory-injector.mjs` | `149:export function trimToBudget(data, budget) {` |
| 7 | `grep -n 'export function createMemoryInjector' lib/memory-injector.mjs` | `200:export function createMemoryInjector(opts = {}) {` |
| 8 | `grep -c 'it(' test/memory-injector.test.mjs` | `16` |

## §3 — Cross-references still valid

- `lib/memory-injector.mjs` imports `analyzeQuery` from `./query-analysis.mjs` (Step 7.1, line 104) — verified present.
- `lib/memory-injector.mjs` imports `createRetrievalPipeline` from `./retrieval-pipeline.mjs` (Step 6.2, line 362) — verified present.
- `test/memory-injector.test.mjs` imports `DEFAULT_TOKEN_BUDGET`, `CHARS_PER_TOKEN`, `estimateTokens`, `queryRelevantConcepts`, `queryRelevantDecisions`, `trimToBudget`, `createMemoryInjector` — all 7 resolve correctly.
- No pre-existing symbols renamed or deleted.
- No existing imports modified.
- No new dependencies added to `package.json`.

## §4 — Findings

- [POSITIVE] Factory pattern (`createMemoryInjector`) mirrors `createRetrievalPipeline` — consistent API surface across pipeline stages.
- [POSITIVE] All databases optional — `createMemoryInjector({})` works with zero databases, returning empty results. Graceful degradation at every layer.
- [POSITIVE] `estimateTokens` uses `Math.ceil` for conservative budgeting — never underestimates token usage.
- [POSITIVE] `queryRelevantConcepts` uses `AVG(m.salience)` aggregation across session mentions — correctly weights entities by their relevance to the retrieved sessions, not just global mention count.
- [POSITIVE] `queryRelevantDecisions` sorts by `confidence DESC, created_at DESC` — highest-confidence decisions surface first, with recency as tiebreaker.
- [POSITIVE] `trimToBudget` uses greedy allocation with priority order (concepts → decisions → snippets) — cheapest sections allocated first to maximize information density within budget.
- [POSITIVE] 30-token overhead constant accounts for injection delimiters and section headers that Step 7.3 will add.
- [POSITIVE] `retrieve()` early-returns for null/empty prompts without calling the pipeline — avoids unnecessary work.
- [POSITIVE] Token budget is configurable via `INJECTION_TOKEN_BUDGET` env var, explicit `tokenBudget` option, or default 750 — three-tier precedence matching the pattern from other modules.
- [POSITIVE] All 16 new tests pass. Test count: 808 (731 pass, 77 fail — unchanged baseline of 77 failures). Node test runner reports +16.
- [NEGATIVE] Test count underestimate: AUDIT_PRE §6 planned ~8 tests, delivered 16 (extra tests for constants, edge cases, empty/null input, custom budget). Phase-4-correction streak remains 0 for Block 7.

10 POSITIVE, 1 NEGATIVE findings. 0 Phase 8 patches.

## §5 — Phase 8 patches

None. All landed code is correct as implemented.

## §6 — Carry-forwards to Step 7.3

- Test baseline is now 808 tests (731 pass, 77 fail — 73 pre-existing + 4 flaky). +16 `it()` blocks added this step.
- `createMemoryInjector` at `lib/memory-injector.mjs:200` — factory returning `{ retrieve(prompt, opts) }`.
- `retrieve()` returns `{ concepts: Array<{name, type, mentionCount}>, decisions: Array<{decision, confidence, date}>, snippets: Array<{sessionId, snippet, score}>, tokenCount: number, budget: number }`.
- `estimateTokens` at `lib/memory-injector.mjs:34` — useful for Step 7.3 to verify formatted output stays within budget.
- `DEFAULT_TOKEN_BUDGET` at `lib/memory-injector.mjs:21` — 750 tokens.
- `CHARS_PER_TOKEN` at `lib/memory-injector.mjs:24` — 4 chars/token heuristic.
- Step 7.3 should use `createMemoryInjector` to pre-retrieve, then format the result into the `[memory: ...]` injection block per Block 7 §0 format specification.
- `@memory` directive parsing is Step 7.4 — Step 7.3 should NOT parse directives, just format the injection block.
