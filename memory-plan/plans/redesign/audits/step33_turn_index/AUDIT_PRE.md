# AUDIT_PRE — Step 3.3: Populate mentions.turn_index (last-turn-of-tail stamp)

## §0 Re-orient

- Where am I: Block 3 (ingest/extract correctness), step 3/4, 17/40 overall.
- Last step changed: 3.2 — gateway adapter preserves tool_result/tool-call entries in state.db.
- This step contributes: makes `mentions.turn_index` structurally populated so the privacy filter can work at chunk grain instead of session-grain.
- Block serves the north star via: DESIGN_INPUTS §1 — turning raw history into navigable structure (turn-level provenance on mention data).
- Still the right next step? Yes — orthogonal to 3.2 (extraction pipeline, not transcript parser).

## 1. Intent

`mentions.turn_index` is always NULL (2074 rows, 0 with a value). The privacy filter falls back to session-grain because it can't filter at turn level. The "cheap" fix (MEMORY_REDESIGN L3, §4): stamp each mention with the total message count of the session at extraction time. This isn't per-turn LLM citation (expensive, later) — it's a structural stamp saying "this mention was extracted from a session tail that contained N messages."

## 2. Design

Two-layer change, both additive:

1. **`lib/extraction-store.mjs`** — `storeExtractionResult(sessionId, result, provenance)` gains an optional 4th parameter `opts = {}` with `opts.turnIndex`. When provided, `insertMention` uses it instead of `null`. No existing callers break (they pass nothing and get the current `null` behavior).

2. **`lib/pre-compression-flush.mjs`** — `runFlush` already calls `estimateSessionTokens` which returns `messageCount`. Destructure it, pass it as `turnIndex` in the `storeExtractionResult` call. This stamps every mention from this extraction with the total message count.

No schema changes — `mentions.turn_index INTEGER` already exists.

## 3. Carry-forwards consumed

From step 3.2 AUDIT_POST §6:
- "Step 3.3 is orthogonal — operates in the extraction pipeline, not the transcript parser." Confirmed.
- "The extraction prompt should be checked to confirm it handles tool-role messages appropriately." — That's 3.4's concern, not 3.3's.

## 4. File-delta outline

| File | Delta |
|---|---|
| `lib/extraction-store.mjs` | `storeExtractionResult` signature: add optional `opts` param; use `opts.turnIndex ?? null` for `turn_index` in `insertMention.run()`. |
| `lib/pre-compression-flush.mjs` | In `runFlush`, destructure `messageCount` from `estimateSessionTokens`; pass `{ turnIndex: messageCount }` to `storeExtractionResult`. |
| `test/extraction-store.test.mjs` | Add test: `storeExtractionResult` with `turnIndex` option populates `turn_index` in mentions table. |

## 5. Risk register

| Risk | Mitigation |
|---|---|
| Existing callers of `storeExtractionResult` break | 4th param is optional with default `{}`; no existing callers pass it. |
| `messageCount` doesn't reflect the right value | `estimateSessionTokens` parses the full JSONL and returns `messages.length` — this is the total message count at flush time. |
