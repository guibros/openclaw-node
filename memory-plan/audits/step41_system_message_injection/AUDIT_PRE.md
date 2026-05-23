# AUDIT_PRE — Step 7.3: Inject as system-message prefix with [memory: ...] delimiters

## §1 — Intent

Create the memory formatting module that takes the budgeted retrieval output from
Step 7.2's `createMemoryInjector().retrieve()` and produces the `[memory: ...]` text
block per Block 7 frozen decisions. Wire injection into each SDK wrapper so that
API calls automatically prepend the memory context block to messages.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 7 | 7.3 | v7.3 | [A] | Inject as system-message prefix with [memory: ...] delimiters |

## §3 — Design decisions (consume prior AUDIT_POST §6)

From Step 7.2 `AUDIT_POST §6` carry-forwards:
- Test baseline: 808 tests (731 pass, 77 fail).
- `createMemoryInjector` returns `{ retrieve(prompt, opts) }`.
- `retrieve()` response shape: `{ concepts, decisions, snippets, tokenCount, budget }`.
- `estimateTokens` available from `lib/memory-injector.mjs` for verification.
- Step 7.3 should use memory injector to pre-retrieve, then format injection block
  per Block 7 format spec.
- Step 7.4 handles `@memory` directive parsing — Step 7.3 should NOT parse, just format.

From Block 7 frozen decisions (RESUME §0):
- Injection format is verbatim from REFERENCE_PLAN §7.3:
  ```
  [memory: recent relevant context]
  Active concepts in this conversation: <list>
  Recent decisions:
  - <date>: <decision> (<confidence>)
  Related sessions: <links>
  [end memory]
  ```
- Token budget is handled upstream by Step 7.2's `trimToBudget()` — formatter just renders.

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Wrapper API change breaks existing consumers | MEDIUM | New `injector` parameter is optional — omitting it preserves existing behavior |
| Gemini content format differs from OpenAI messages | LOW | Separate injection logic per wrapper; Gemini uses `parts` format |
| Claude Code hook can't inject (event-only hook) | LOW | Document limitation; Claude Code gets memory through other mechanisms (Step 7.4 or daemon-level injection) |
| Empty memory block clutters prompts | LOW | formatMemoryBlock returns empty string when all arrays are empty; wrappers skip injection on empty block |

## §5 — Deferrals

- `@memory off/deep/none` directive parsing → Step 7.4.
- `.claude/hooks/pre-compact.sh` injection → not applicable (extraction trigger, not injection point). Dropped from scope per same sandbox constraint as Steps 4.7–4.9.
- Streaming API support (wrapper only handles non-streaming `create()` calls) → future enhancement.

## §6 — Phase 4 implementation outline

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `lib/memory-formatter.mjs` | new | `formatConceptList(concepts)` — comma-separated "Name (type)" list. `formatDecisionList(decisions)` — bullet list with date + confidence. `formatSnippetSummaries(snippets)` — brief related session references. `formatMemoryBlock({ concepts, decisions, snippets })` — composes full `[memory: ...]` block; returns empty string if all arrays empty. `injectIntoSystemMessage(systemContent, memoryBlock)` — prepends memory block to existing system content with double newline separator. |
| 2 | `lib/publishers/openai-wrapper.mjs` | mod | Add optional third parameter `opts` with `injector` field. If injector provided: extract last user message from `args[0].messages`, call `injector.retrieve(prompt)`, format with `formatMemoryBlock`, inject into system message via `injectIntoSystemMessage`. All injection is async, errors caught silently (never affect LLM call). |
| 3 | `lib/publishers/anthropic-wrapper.mjs` | mod | Same pattern. Anthropic uses `system` as a separate param in `args[0]` — inject into that string. |
| 4 | `lib/publishers/gemini-wrapper.mjs` | mod | Same pattern adapted for Gemini. Extract text from `args[0]` parts, inject memory as prepended text part. |
| 5 | `lib/publishers/minimax-wrapper.mjs` | mod | Same as OpenAI (OpenAI-compatible API). |
| 6 | `test/memory-formatter.test.mjs` | new | Tests for formatMemoryBlock (full, partial, empty), injectIntoSystemMessage (prepend, new system msg), formatConceptList, formatDecisionList, formatSnippetSummaries, wrapper injection tests. |
