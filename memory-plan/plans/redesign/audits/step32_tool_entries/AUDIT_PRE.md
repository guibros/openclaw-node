# AUDIT_PRE — Step 3.2: Stop dropping tool_result / tool-call entries in the gateway transcript adapter

## §0 Re-orient

- Where am I: Block 3 (L3 ingest/extract), step 2/4, 17/40 overall.
- Last step changed: 3.1 fixed skipIfExists truncation — importSession() now appends delta turns for mid-stream sessions.
- This step contributes: preserves tool interactions in the session archive — currently silently dropped, losing tool call/result context for extraction and retrieval.
- Block serves the north star via: DESIGN_INPUTS §1 (Karpathy LLM-Wiki layer 1 = immutable raw sources) — tool interactions are part of the raw conversation record.
- Still the right next step? Yes — orthogonal to 3.1, operates in transcript-parser.mjs (carry-forward from 3.1 §6).

## §1 Intent

The gateway transcript adapter in `lib/transcript-parser.mjs` silently drops tool interactions from session transcripts:

1. **`GATEWAY_SKIP_TYPES` includes `'tool_result'`** (line 84) — dead code since the gateway format encodes tool results as `type: "message"` with `role: "toolResult"`, never as top-level `type: "tool_result"`. But the intent was to skip them, which is wrong.

2. **`toolCall` content blocks silently lost** — assistant messages containing `{type: "toolCall", name, arguments}` in their `content[]` array are processed by `extractContent()` which filters to `type === "text"` only. If the message has no text blocks (only tool calls), `extractContent` returns `''` and the entire message is dropped.

3. **`toolResult` role entries pass through but with wrong role name** — entries with `message.role: "toolResult"` pass the `isMessage` check (they're `type: "message"`) and `extractContent` works on their `content[]`. They'd get role `"toolResult"` stored in the DB, which is non-standard. Should be `"tool"`.

## §2 Design

### Changes to `lib/transcript-parser.mjs`:

1. **Remove `'tool_result'` from `GATEWAY_SKIP_TYPES`** — it's dead code (never matches real gateway entries) and expresses wrong intent.

2. **In the gateway adapter's `extractMessage`: handle `toolCall` content blocks** — after calling `extractContent` for text, also scan `message.content[]` for `toolCall` blocks and render each as `[tool_call: <name>(<args_json>)]`. Append to the text content. This is gateway-adapter-specific, not a change to the shared `extractContent` function.

3. **In the gateway adapter's `extractMessage`: map `toolResult` role** — when `message.role === "toolResult"`, output `role: "tool"` and include `toolName`, `toolCallId`, `isError` in metadata. Skip noise-stripping regexes for tool results (they don't have gateway headers).

### Changes to `test/transcript-parser.test.mjs`:

1. Remove `'tool_result'` from the skip-types test (line 155).
2. Add test: gateway toolResult entry → parsed with role `"tool"`, content extracted, metadata has `toolName`/`toolCallId`.
3. Add test: gateway assistant entry with `toolCall` content block → content includes tool call text representation.
4. Add test: gateway assistant entry with ONLY `toolCall` content (no text) → not dropped, content is the tool call representation.

### Files NOT changed:

- `lib/session-store.mjs` — no schema change needed; `role TEXT NOT NULL` has no CHECK constraint, accepts any string. `"tool"` as a role value is fine.
- `extractContent()` function — stays text-only; the tool handling is in the gateway adapter's `extractMessage`.

## §3 Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Existing tests break from removing `tool_result` skip | Certain — test at line 155 explicitly tests this | Update the test to remove `tool_result` from the skip check |
| Tool content text representation is too verbose for FTS | Low | The `[tool_call: name(...)]` format is concise; tool results are real content |
| Downstream consumers expect only user/assistant/system roles | Low | No CHECK constraint; extraction prompt handles unknown roles gracefully (ignores them in context) |

## §4 File-delta outline

| File | Delta |
|---|---|
| `lib/transcript-parser.mjs` | Remove `'tool_result'` from GATEWAY_SKIP_TYPES; extend gateway `extractMessage` to handle toolCall blocks and map toolResult role |
| `test/transcript-parser.test.mjs` | Remove `'tool_result'` from skip test; add 3 new tests for tool entry handling |
