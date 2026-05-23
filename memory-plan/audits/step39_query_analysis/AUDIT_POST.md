# AUDIT_POST — Step 7.1: Implement query analysis (per-prompt theme/entity extraction, ~50ms)

**Version:** v7.1-mid
**Date:** 2026-05-23
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | `lib/query-analysis.mjs` (new) — extractStructuredCues, embedPrompt, analyzeQuery | `lib/query-analysis.mjs:36` (extractStructuredCues), `:76` (embedPrompt), `:104` (analyzeQuery) | yes | `grep -n 'export' lib/query-analysis.mjs` → 3 exports at lines 36, 76, 104 |
| 2 | `test/query-analysis.test.mjs` (new) — ~6 tests | `test/query-analysis.test.mjs` (11 `it()` blocks) | yes | `grep -c 'it(' test/query-analysis.test.mjs` → `11` |

2 of 2 rows landed = yes.

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'export function extractStructuredCues' lib/query-analysis.mjs` | `36:export function extractStructuredCues(text) {` |
| 2 | `grep -n 'export async function embedPrompt' lib/query-analysis.mjs` | `76:export async function embedPrompt(prompt, embedFn) {` |
| 3 | `grep -n 'export async function analyzeQuery' lib/query-analysis.mjs` | `104:export async function analyzeQuery(prompt, opts = {}) {` |
| 4 | `grep -c 'it(' test/query-analysis.test.mjs` | `11` |

## §3 — Cross-references still valid

- `lib/query-analysis.mjs` dynamically imports `embed` from `./mcp-knowledge/core.mjs:324` — verified present.
- `test/query-analysis.test.mjs` imports `extractStructuredCues`, `embedPrompt`, `analyzeQuery` from `../lib/query-analysis.mjs`. All 3 resolve correctly (lines 36, 76, 104).
- No pre-existing symbols renamed or deleted.
- No existing imports modified.
- No new dependencies added to `package.json`.

## §4 — Findings

- [POSITIVE] Pure `extractStructuredCues` function (no async, no side effects) — easily testable, zero latency.
- [POSITIVE] `embedPrompt` returns null on any failure — callers degrade gracefully to text-only retrieval without error handling burden.
- [POSITIVE] Dynamic `import()` of mcp-knowledge at line 81 avoids loading the embedder module (and its heavyweight `@huggingface/transformers` dependency) at startup. Only loaded when `embedFn` is not injected.
- [POSITIVE] Dependency injection via `opts.embedFn` enables fully deterministic testing without mcp-knowledge or BGE-M3 model present.
- [POSITIVE] Deduplication via `new Set()` on all cue arrays prevents redundant retrieval queries from repeated references in the prompt.
- [POSITIVE] FILE_PATH_RE uses a capture group that skips leading delimiters (quotes, parentheses) — produces clean file paths without surrounding punctuation.
- [POSITIVE] `analyzeQuery` returns `rawQuery` unchanged, preserving the original prompt for downstream text-based channels (FTS5, entity search) in the retrieval pipeline.
- [POSITIVE] All 11 new tests pass. Test count: 792 (715 pass, 77 fail — unchanged baseline of 77 failures). Node test runner reports +11.
- [POSITIVE] CODE_REF_RE limits backtick matches to 80 chars and excludes newlines — prevents matching multi-line code blocks as a single "code ref."
- [NEGATIVE] Test count underestimate: AUDIT_PRE §6 planned ~6 tests, delivered 11 (extra tests for deduplication, null/empty edge cases, embed error scenarios). Phase-4-correction streak resets to 0 for Block 7.

9 POSITIVE, 1 NEGATIVE findings. 0 Phase 8 patches.

## §5 — Phase 8 patches

None. All landed code is correct as implemented.

## §6 — Carry-forwards to Step 7.2

- Test baseline is now 792 tests (715 pass, 77 fail — 73 pre-existing + 4 flaky). +11 `it()` blocks added this step.
- `analyzeQuery` at `lib/query-analysis.mjs:104` — main entry returning `{ rawQuery, embedding, structuredCues }`.
- `extractStructuredCues` at `lib/query-analysis.mjs:36` — pure regex extraction (filePaths, versionRefs, codeRefs).
- `embedPrompt` at `lib/query-analysis.mjs:76` — async embedding wrapper with null-on-failure.
- Step 7.2 should call `analyzeQuery(prompt)` to get the analysis, then pass `result.rawQuery` to `createRetrievalPipeline().retrieve()` and optionally use `result.embedding` for direct vector search (bypassing the re-embedding inside Channel 2). The `structuredCues` can enrich entity/theme channel queries or be returned as supplementary context.
- `@memory` directive parsing is Step 7.4 — NOT handled in query analysis. Step 7.2/7.3 should pass the raw prompt through; Step 7.4 will add directive stripping before analysis.
