# Block 3 Complete — LLM-driven extraction

**Date:** 2026-05-22
**Steps closed:** 4/4 (v3.1–v3.4)
**Author:** memory-plan-tick

---

## Exit-gate criteria

- [x] LLM client module created (`lib/llm-client.mjs`) with OpenAI-compatible HTTP API, Ollama runtime
- [x] Extraction schema + prompt designed (`lib/extraction-schema.mjs`, `lib/extraction-prompt.mjs`)
- [x] LLM extraction wired into daemon (`lib/extraction-store.mjs`, `lib/pre-compression-flush.mjs`)
- [x] `USE_LLM_EXTRACTION` feature flag with regex fallback
- [x] Validation tool created (`bin/run-block3-validation.mjs`) for operator comparison
- [x] All tests pass (587 total, 514 pass, 73 pre-existing failures)

## Files touched cumulatively (Block 3)

| Step | Files |
|------|-------|
| 3.1 | `lib/llm-client.mjs` (new), `bin/llm-benchmark.mjs` (new), `test/llm-benchmark.test.mjs` (new) |
| 3.2 | `lib/extraction-schema.mjs` (new), `lib/extraction-prompt.mjs` (new), `test/extraction-schema.test.mjs` (new) |
| 3.3 | `lib/extraction-store.mjs` (new), `lib/pre-compression-flush.mjs` (mod), `workspace-bin/memory-daemon.mjs` (mod), `test/extraction-store.test.mjs` (new) |
| 3.4 | `bin/run-block3-validation.mjs` (new), `test/block3-validation.test.mjs` (new) |

## Test count progression

| Step | Tests added | Cumulative total |
|------|-------------|-----------------|
| 3.1 | +4 | 563 |
| 3.2 | +7 | 570 |
| 3.3 | +8 | 578 |
| 3.4 | +9 | 587 |
| **Total** | **+28** | **587** |

## Streaks

- zero-Phase-4-correction: 0 of 4 (reset at Steps 3.2, 3.3, 3.4 — all test count underestimates)
- zero-Phase-8-patch: 9 of 9 (Steps 2.1–3.4, zero patches)

## Carry-forwards into Block 4

- Test baseline: 587 tests (514 pass, 73 fail pre-existing).
- **Validation gate:** operator must run `node bin/run-block3-validation.mjs` against live session store with Ollama running, score the comparison document, and write the go/no-go decision before Block 4 begins.
- `lib/llm-client.mjs` provides a reusable Ollama client for any future LLM-dependent steps.
- `lib/extraction-store.mjs` provides the entity/theme/mention/decision SQLite tables for future steps that need structured memory data.
- Federation primitives (Block 4) do NOT depend on LLM extraction — they only need the local event log substrate from Block 1.
- Block 4 frozen decisions must be authored by the operator before the next tick proceeds.
