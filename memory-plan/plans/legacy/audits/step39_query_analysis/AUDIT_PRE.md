# AUDIT_PRE — Step 7.1: Implement query analysis (per-prompt theme/entity extraction, ~50ms)

**Version:** v7.1-pre
**Date:** 2026-05-23
**Author:** memory-plan-tick

---

## §1 — Intent

Step 7.1 implements `lib/query-analysis.mjs` — the per-prompt analysis module that prepares
user prompts for the 5-channel retrieval pipeline (Block 6). Per Block 7 frozen decisions,
this uses embedding-based analysis (BGE-M3, one pass) plus a regex fallback for structured
cues, replacing the REFERENCE_PLAN's "small LLM call" approach. No per-prompt LLM call.

The module produces an analysis result containing:
1. The raw query string (unchanged, for pass-through to the pipeline's text-based channels)
2. The prompt embedding (Float32Array from BGE-M3, for direct semantic search without re-embedding)
3. Extracted structured cues (file paths, version/step references, code identifiers) from regex

Step 7.2 will consume this analysis to pre-retrieve and budget ambient memory.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 7 | 7.1 | v7.1 | [A] | Implement query analysis (per-prompt theme/entity extraction, ~50ms) |

## §3 — Design decisions (consume prior carry-forwards)

**From Step 6.4 AUDIT_POST §6:**
- Test baseline is 781 tests (704 pass, 77 fail — 73 pre-existing + 4 flaky).
- Block 7 does not depend on a populated extraction store — retrieval pipeline degrades gracefully on empty data.
- Block 6 complete (4/4).

**From RESUME.md §0 Block 7 frozen decisions:**
- Query analysis is embedding-based, NOT a per-prompt LLM call.
- Embed via existing BGE-M3 stack (~50-150ms on M4, ~250-400ms on CPU).
- Simple regex fallback for structured cues (file paths, step/version refs, code identifiers).
- Lives in `lib/query-analysis.mjs`.

**Design — `analyzeQuery(prompt, opts)` main entry:**
- Accepts user prompt string and optional `opts` object with `embedFn` for dependency injection.
- Calls `embedPrompt(prompt, embedFn)` to produce Float32Array via BGE-M3.
- Calls `extractStructuredCues(prompt)` for regex-based extraction.
- Returns `{ rawQuery, embedding, structuredCues }`.

**Design — `embedPrompt(prompt, embedFn)` wrapper:**
- Thin async wrapper around mcp-knowledge's `embed()` function.
- Returns Float32Array on success, null on failure (embedder unavailable, model not cached).
- No re-throw — caller always gets a result, just with potentially null embedding.

**Design — `extractStructuredCues(text)` pure regex extraction:**
- File paths: `/[\w.-]+\/[\w.-]+\.\w+/g` — matches `lib/foo.mjs`, `src/bar.ts`, etc.
- Version/step refs: `/\bv\d+\.\d+(-pre|-mid)?\b/gi` and `/\bStep\s+\d+\.\d+\b/gi`.
- Code refs: backtick-delimited identifiers from the prompt.
- Returns `{ filePaths: string[], versionRefs: string[], codeRefs: string[] }`.

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| BGE-M3 model not cached on first run → embed fails | LOW | `embedPrompt` returns null; caller degrades to text-only retrieval. Same graceful pattern as Channel 2 in retrieval pipeline. |
| Regex false positives on file paths in prose | LOW | Acceptable — false positives in structured cues just add minor noise to retrieval. Pipeline already handles irrelevant results via RRF ranking. |
| Embedding latency >150ms on slower hardware | LOW | Per Block 7 §0: ~250-400ms on CPU-only is acceptable. Measured in Step 2.2 benchmark. |

No HIGH-severity risks.

## §5 — Deferrals

- `@memory` directive parsing deferred to Step 7.4.
- Token budgeting deferred to Step 7.2.
- System message injection deferred to Step 7.3.

## §6 — Phase 4 implementation outline

| # | File | Op | Delta description |
|---|------|----|-------------------|
| 1 | `lib/query-analysis.mjs` | new | `analyzeQuery(prompt, opts)` main entry, `embedPrompt(prompt, embedFn)` wrapper with null-on-failure, `extractStructuredCues(text)` pure regex (filePaths, versionRefs, codeRefs). Imports `embed` from `./mcp-knowledge/core.mjs`. Exports all 3 functions. |
| 2 | `test/query-analysis.test.mjs` | new | ~6 tests: extractStructuredCues with file paths, version refs, code refs, no matches; embedPrompt success with mock; analyzeQuery integration with mock embedFn. |
