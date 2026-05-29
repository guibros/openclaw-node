# AUDIT_PRE — Step 7.4: Runtime control: @memory off/deep/none

## §1 — Intent

Implement runtime control directives that let users manage memory injection behavior per-turn and per-session. Four directives per Block 7 frozen decisions: `@memory off` (disable current turn), `@memory deep` (double token budget current turn), `@memory none` (hard disable for session), `@memory only:<theme>` (constrain injection to a specific theme/entity). Directives are parsed by pure regex from the user prompt text, stripped before passing to the LLM, and handled within each SDK wrapper's injection flow.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 7 | 7.4 | v7.4 | [A] | Runtime control: @memory off/deep/none |

Last step in Block 7 (4/4). Block-close ceremony required at Phase 9.

## §3 — Design decisions (consumed from Step 7.3 AUDIT_POST §6)

- Test baseline: 836 tests (759 pass, 77 fail — 73 pre-existing + 4 flaky).
- `formatMemoryBlock` at `lib/memory-formatter.mjs:75` — main formatting entry.
- `injectIntoMessages` at `lib/memory-formatter.mjs:144` — OpenAI-compatible injection.
- `injectIntoSystemMessage` at `lib/memory-formatter.mjs:114` — Anthropic injection.
- `extractLastUserPrompt` at `lib/memory-formatter.mjs:126` — extracts user prompt text.
- All 4 SDK wrappers accept `opts.injector` for memory injection.
- Directives parsed BEFORE `extractLastUserPrompt` or injector `retrieve()` call.
- `@memory off` → wrappers skip injection entirely.
- `@memory deep` → token budget doubled (injector already accepts `tokenBudget` option at `lib/memory-injector.mjs:212`).
- `@memory only:<theme>` → theme used as retrieval query instead of full prompt.
- Directive stripped from prompt text before passing to LLM.
- Directive parser lives in new `lib/memory-directives.mjs`.

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Session-level `@memory none` requires closure state in wrapper | LOW | Wrapper factory already creates a closure scope; adding a boolean flag is trivial and matches the existing pattern |
| Gemini content replacement is format-specific | LOW | Use internal helper within gemini-wrapper (same pattern as existing `extractGeminiPrompt`) |
| Multiple directives in one prompt | LOW | First match wins; regex is non-global; spec says "a tiny regex" (singular) |

No HIGH-severity risks.

## §5 — Deferrals

- No deferrals. All four directives are in scope per Block 7 §0.

## §6 — Phase 4 implementation outline

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `lib/memory-directives.mjs` | new | `DIRECTIVE_REGEX` pattern matching `@memory (off\|deep\|none\|only:\S+)` case-insensitive. `DIRECTIVE_TYPES` Set constant. `parseMemoryDirective(text)` → `{ type, param, cleanedText }`. `replaceLastUserContent(messages, newContent)` for OpenAI-compatible message arrays. |
| 2 | `lib/publishers/openai-wrapper.mjs` | mod | Import `parseMemoryDirective`, `replaceLastUserContent` from `../memory-directives.mjs`. Import `DEFAULT_TOKEN_BUDGET` from `../memory-injector.mjs`. Add `memoryDisabledForSession` closure flag. Parse directive before injection; `none` sets session flag + skip; `off` skip; `deep` double budget; `only:<theme>` use theme as query. Strip directive from messages. |
| 3 | `lib/publishers/anthropic-wrapper.mjs` | mod | Same pattern as openai-wrapper. Uses `replaceLastUserContent` for messages and passes cleaned system content. |
| 4 | `lib/publishers/gemini-wrapper.mjs` | mod | Import `parseMemoryDirective` from `../memory-directives.mjs`. Import `DEFAULT_TOKEN_BUDGET` from `../memory-injector.mjs`. Add internal `replaceGeminiPromptText` helper. Add session flag. Parse directive, handle types, strip from content. |
| 5 | `lib/publishers/minimax-wrapper.mjs` | mod | Same pattern as openai-wrapper (OpenAI-compatible API). |
| 6 | `test/memory-directives.test.mjs` | new | ~12-15 tests: parseMemoryDirective (off/deep/none/only/no-directive/null/case-insensitive/stripping), replaceLastUserContent (replacement/no-user-message), wrapper directive handling (session disable via `none`, single-turn `off`, budget doubling via `deep`, theme constraint via `only`). |
