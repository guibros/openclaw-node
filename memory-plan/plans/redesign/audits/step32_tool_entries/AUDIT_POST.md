# AUDIT_POST — Step 3.2: Stop dropping tool_result / tool-call entries in the gateway transcript adapter

## 1. Files-vs-plan ledger

| Plan (AUDIT_PRE §4) | Actual | Match |
|---|---|---|
| EDIT `lib/transcript-parser.mjs` — remove `tool_result` from GATEWAY_SKIP_TYPES; extend gateway `extractMessage` to handle toolCall blocks and map toolResult role | Done — removed `tool_result` from skip set; gateway adapter now: (a) scans `message.content[]` for `toolCall` blocks and renders them as `[tool_call: name(args)]` text, (b) maps `role: "toolResult"` → `"tool"` with toolName/toolCallId/isError metadata, (c) skips noise-stripping for tool-role messages. | ✓ |
| EDIT `test/transcript-parser.test.mjs` — remove `tool_result` from skip test; add 3 new tool entry tests | Done — removed `tool_result` from the skip-types loop (line 155); added 3 tests: toolResult→tool role with metadata, assistant+toolCall content, toolCall-only assistant not dropped. | ✓ |

No unplanned files touched.

## 2. Greppable deltas

```
lib/transcript-parser.mjs:82-85 — GATEWAY_SKIP_TYPES
  :82     — comment updated: removed "tool_result" from the list
  :83-84  — removed 'tool_result' from the Set

lib/transcript-parser.mjs:93-127 — gateway extractMessage rewritten
  :94-95  — metadata + role declared as let (was inline return)
  :98-104 — NEW: scan message.content[] for toolCall blocks, render as [tool_call: name(args)]
  :107-112 — NEW: map role "toolResult" → "tool", extract toolName/toolCallId/isError into metadata
  :114    — null check moved after tool handling (so toolCall-only messages aren't dropped)
  :117-120 — noise-stripping gated on role !== 'tool' (tool results don't have gateway headers)

test/transcript-parser.test.mjs:154-159 — skip-types test updated
  :155    — removed 'tool_result' from the skipType loop

test/transcript-parser.test.mjs:161-196 — 3 NEW tests
  :161-175 — "parses gateway toolResult entry as role 'tool' with metadata"
  :177-191 — "parses gateway assistant message with toolCall content blocks"
  :193-201 — "preserves gateway assistant message with ONLY toolCall content (no text)"
```

## 3. Done-evidence (runtime-observable)

| Evidence | Result |
|---|---|
| Tests green | `npm test`: 1419 pass / 0 fail (3 new tool-entry tests). |
| toolResult preserved | Verification import: `turn=2 role=tool content=file content here` — toolResult entry stored as role "tool" with content extracted from content blocks. |
| toolCall preserved | Verification import: `turn=1 role=assistant content=[tool_call: read({"file_path":"/tmp/test.md"})]` — assistant message with only a toolCall content block is NOT dropped; tool call rendered as searchable text. |
| 4 messages total | Import result: `{"sessionId":"tool-test-session","messageCount":4,"imported":true}`. Role counts: `[{"role":"assistant","n":2},{"role":"tool","n":1},{"role":"user","n":1}]`. Before this fix, only 2 messages (user + text-assistant) would have been stored. |
| Deployed code | `readlink ~/.openclaw/workspace/lib` → repo (symlink = repo IS runtime). |
| Daemon running on new code | PID 87276 after `launchctl kickstart -k`; startup clean: NATS connected, watcher initialized, inject server listening on :7893. No errors. |
| INVENTORY done-evidence | "tool messages present in state.db for a session that had them" — verified: both `role=tool` (toolResult) and `role=assistant` with tool-call content present in state.db after importing a gateway session that contained tool interactions. |

## 4. Cross-refs

- The `auto` adapter dispatches `type: "message"` entries to the gateway adapter, so tool handling automatically applies to auto-detected gateway sessions.
- `extractContent()` (the shared function) is unchanged — it still filters to `type === "text"` only. The toolCall handling is gateway-adapter-specific, in `extractMessage`.
- The `claude-code` adapter is NOT modified — it only accepts `type: "user"|"assistant"` entries. Claude Code tool handling (if needed) is a separate concern.
- FTS triggers fire on the new tool messages — they're automatically FTS-indexed for full-text search.
- The `emitIngestEvent` callback (step 1.2) fires on `imported === true`, so tool-containing sessions that are re-imported with append-delta (step 3.1) will correctly emit `memory.ingested` events.

## 5. Findings

- The `tool_result` entry in `GATEWAY_SKIP_TYPES` was dead code — the gateway format uses `type: "message"` with `role: "toolResult"`, never a top-level `type: "tool_result"`. Removing it has no behavioral change on its own; the real fix is the `extractMessage` changes.
- The `messages` table schema comment says `role TEXT NOT NULL -- 'user', 'assistant', 'system'` but has no CHECK constraint. Adding `"tool"` as a role value is structurally safe.
- The noise-stripping regexes (gateway date headers, "Conversation info" metadata) are now correctly skipped for tool results — they only apply to user/assistant messages.

## 6. Carry-forwards for step 3.3

- Step 3.3 (populate mentions.turn_index) is orthogonal — operates in the extraction pipeline, not the transcript parser.
- The `"tool"` role messages are now in state.db and FTS-indexed. The extraction prompt (`extraction-prompt.mjs`) should be checked to confirm it handles or ignores tool-role messages appropriately. This is the extraction correctness step's concern (3.4), not 3.3's.
- Tool message content uses a text representation `[tool_call: name(args)]` — this is searchable via FTS but the extraction LLM may or may not interpret it usefully. Acceptable: the primary goal is preserving the data, not optimizing extraction of it.
