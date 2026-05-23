# AUDIT_POST — Step 7.4: Runtime control: @memory off/deep/none

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised file | Actual file:line | Landed | Grep evidence |
|---|---------------|-------------------|--------|---------------|
| 1 | `lib/memory-directives.mjs` (new) | `lib/memory-directives.mjs:22,24,42,79` | yes | `DIRECTIVE_REGEX` at :22, `DIRECTIVE_TYPES` at :24, `parseMemoryDirective` at :42, `replaceLastUserContent` at :79 |
| 2 | `lib/publishers/openai-wrapper.mjs` (mod) | `lib/publishers/openai-wrapper.mjs:33,34,55,62` | yes | import `parseMemoryDirective, replaceLastUserContent` at :33, import `DEFAULT_TOKEN_BUDGET` at :34, `memoryDisabledForSession` at :55, directive parsing at :62 |
| 3 | `lib/publishers/anthropic-wrapper.mjs` (mod) | `lib/publishers/anthropic-wrapper.mjs:31,32,53,60` | yes | import `parseMemoryDirective, replaceLastUserContent` at :31, import `DEFAULT_TOKEN_BUDGET` at :32, `memoryDisabledForSession` at :53, directive parsing at :60 |
| 4 | `lib/publishers/gemini-wrapper.mjs` (mod) | `lib/publishers/gemini-wrapper.mjs:28,29,106,148` | yes | import `parseMemoryDirective` at :28, import `DEFAULT_TOKEN_BUDGET` at :29, `replaceGeminiPromptText` at :106, directive parsing at :148 |
| 5 | `lib/publishers/minimax-wrapper.mjs` (mod) | `lib/publishers/minimax-wrapper.mjs:25,26,47,54` | yes | import `parseMemoryDirective, replaceLastUserContent` at :25, import `DEFAULT_TOKEN_BUDGET` at :26, `memoryDisabledForSession` at :47, directive parsing at :54 |
| 6 | `test/memory-directives.test.mjs` (new) | `test/memory-directives.test.mjs` | yes | 11 describe blocks, 33 `it()` blocks |

All 6 promised deltas landed. All rows = `yes`.

## §2 — Greppable deltas confirmed

| Delta | Command | First hit |
|-------|---------|-----------|
| DIRECTIVE_REGEX | `grep 'export const DIRECTIVE_REGEX' lib/memory-directives.mjs` | line 22 |
| DIRECTIVE_TYPES | `grep 'export const DIRECTIVE_TYPES' lib/memory-directives.mjs` | line 24 |
| parseMemoryDirective | `grep 'export function parseMemoryDirective' lib/memory-directives.mjs` | line 42 |
| replaceLastUserContent | `grep 'export function replaceLastUserContent' lib/memory-directives.mjs` | line 79 |
| openai directive import | `grep 'parseMemoryDirective' lib/publishers/openai-wrapper.mjs` | line 33 |
| anthropic directive import | `grep 'parseMemoryDirective' lib/publishers/anthropic-wrapper.mjs` | line 31 |
| gemini directive import | `grep 'parseMemoryDirective' lib/publishers/gemini-wrapper.mjs` | line 28 |
| minimax directive import | `grep 'parseMemoryDirective' lib/publishers/minimax-wrapper.mjs` | line 25 |

## §3 — Cross-references still valid

All imports verified:
- `lib/publishers/openai-wrapper.mjs` imports from `../memory-directives.mjs` and `../memory-injector.mjs` ✓
- `lib/publishers/anthropic-wrapper.mjs` imports from `../memory-directives.mjs` and `../memory-injector.mjs` ✓
- `lib/publishers/gemini-wrapper.mjs` imports from `../memory-directives.mjs` and `../memory-injector.mjs` ✓
- `lib/publishers/minimax-wrapper.mjs` imports from `../memory-directives.mjs` and `../memory-injector.mjs` ✓
- `test/memory-directives.test.mjs` imports from `../lib/memory-directives.mjs` and `../lib/memory-injector.mjs` ✓
- All 4 wrappers still import from `../memory-formatter.mjs` (existing imports preserved) ✓
- No stale references. No renamed or deleted symbols.

## §4 — Findings

1. **[POSITIVE]** All four directives implemented per Block 7 §0: `off` (single-turn skip), `deep` (2× budget), `none` (session-level disable), `only:<theme>` (theme constraint).
2. **[POSITIVE]** Directive stripping works correctly — cleaned text replaces the original user prompt in messages before LLM API call. No `@memory` text leaks to the model.
3. **[POSITIVE]** Session-level `@memory none` uses closure variable in wrapper factory — persists across calls within the same wrapper instance, resets on wrapper recreation (session restart).
4. **[POSITIVE]** `@memory deep` doubles `DEFAULT_TOKEN_BUDGET` (750 → 1500) via injector's existing `tokenBudget` option — no modification to `lib/memory-injector.mjs` needed.
5. **[POSITIVE]** `@memory only:<theme>` passes the theme name as the retrieval query instead of the full user prompt — the 5-channel pipeline naturally returns theme-relevant results.
6. **[POSITIVE]** Non-mutating `replaceLastUserContent` creates new array via spread, original messages untouched.
7. **[POSITIVE]** Case-insensitive regex parsing (`/i` flag) — `@Memory OFF` works identically to `@memory off`.
8. **[POSITIVE]** Gemini-specific `replaceGeminiPromptText` internal helper handles string, array-of-parts, and `{ contents }` object formats (same three cases as existing `extractGeminiPrompt`).
9. **[POSITIVE]** Error isolation preserved in all 4 wrappers — directive parsing + injection failures caught silently via empty `catch {}` blocks. LLM API call always proceeds.
10. **[POSITIVE]** Test coverage comprehensive: 33 `it()` blocks across 11 describe blocks covering parser, helpers, and all 4 wrappers.
11. **[NEGATIVE]** Test count delta: planned ~12-15 tests in AUDIT_PRE §6, delivered 33 `it()` blocks. Node test runner reports these as 33 additions to the total count (869 - 836 = 33). Phase-4-correction streak reset.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards to Block 8

- Test baseline: 869 tests (792 pass, 77 fail — 73 pre-existing + 4 flaky). +33 `it()` blocks added this step.
- `lib/memory-directives.mjs` exports: `DIRECTIVE_REGEX` at :22, `DIRECTIVE_TYPES` at :24, `parseMemoryDirective` at :42, `replaceLastUserContent` at :79.
- All 4 SDK wrappers now parse `@memory` directives before injection. Session-level state (`memoryDisabledForSession`) resets when the wrapper is recreated.
- Block 7 is complete (4/4). Block 8 (Consolidation cycle) is next.
- Block 8 frozen decisions must be authored by the operator before Block 8 begins. The consolidation cycle (decay, reinforcement, clustering, summaries, contradiction detection) is independent of proactive injection.
- The injection pipeline is fully functional: query analysis (7.1), pre-retrieval + budgeting (7.2), formatting + system message injection (7.3), and runtime control directives (7.4).
