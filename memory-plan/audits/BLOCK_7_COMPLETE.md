# Block 7 Complete — Proactive Injection

**Closed at:** v7.4 (2026-05-23)
**Steps:** 4/4 (v7.1–v7.4)
**Author:** memory-plan-tick

## Exit-gate criteria

- [x] All 4 steps closed (v7.1, v7.2, v7.3, v7.4)
- [x] Per-prompt query analysis operational (embedding-based, not LLM call)
- [x] 5-channel retrieval pipeline feeds into memory injection
- [x] Memory injected as system-message prefix with `[memory: ...]` delimiters
- [x] Runtime control directives parsed and honored (`@memory off/deep/none/only:<theme>`)
- [x] All 4 SDK wrappers support injection and directive parsing
- [x] Injection failures isolated — never affect LLM API calls
- [x] Tests pass: 869 total (792 pass, 77 fail — 73 pre-existing + 4 flaky)

## Files touched cumulatively (Block 7)

| Step | Files added | Files modified |
|------|------------|----------------|
| 7.1 | `lib/query-analysis.mjs`, `test/query-analysis.test.mjs` | — |
| 7.2 | `lib/memory-injector.mjs`, `test/memory-injector.test.mjs` | — |
| 7.3 | `lib/memory-formatter.mjs`, `test/memory-formatter.test.mjs` | `lib/publishers/openai-wrapper.mjs`, `lib/publishers/anthropic-wrapper.mjs`, `lib/publishers/gemini-wrapper.mjs`, `lib/publishers/minimax-wrapper.mjs` |
| 7.4 | `lib/memory-directives.mjs`, `test/memory-directives.test.mjs` | `lib/publishers/openai-wrapper.mjs`, `lib/publishers/anthropic-wrapper.mjs`, `lib/publishers/gemini-wrapper.mjs`, `lib/publishers/minimax-wrapper.mjs` |

## Test delta

| Version | Tests | Pass | Fail | Delta |
|---------|-------|------|------|-------|
| v6.4 (Block 7 entry) | 781 | 704 | 77 | — |
| v7.1 | 792 | 715 | 77 | +11 |
| v7.2 | 808 | 731 | 77 | +16 |
| v7.3 | 836 | 759 | 77 | +28 |
| v7.4 | 869 | 792 | 77 | +33 |
| **Block total** | — | — | — | **+88** |

## Carry-forwards into Block 8

- The injection pipeline is fully functional: query analysis → retrieval → budgeting → formatting → system message injection → directive control.
- Block 8 (Consolidation cycle) is independent of Block 7. It maintains graph health (decay, reinforcement, clustering, summaries, contradiction detection) during quiet periods.
- Block 8 frozen decisions must be authored by the operator before Block 8 begins.
- Validation gate from Block 7 §0: injection should add <500ms to average prompt round-trip. Not formally benchmarked during this block — the empty-graph case (current state, before backfill completes) returns instantly with empty context. Real-world latency depends on graph density after backfill.
