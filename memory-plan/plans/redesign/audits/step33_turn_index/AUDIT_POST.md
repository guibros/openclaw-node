# AUDIT_POST — Step 3.3: Populate mentions.turn_index (last-turn-of-tail stamp)

**Closed:** 2026-05-30 · **Version:** v3.3

## 1. Files-vs-plan ledger

| Plan (AUDIT_PRE §4) | Actual | Match |
|---|---|---|
| EDIT `lib/extraction-store.mjs` — `storeExtractionResult` gains optional `opts`; use `opts.turnIndex ?? null` in `insertMention` | Done — signature `storeExtractionResult(sessionId, result, provenance, opts = {})` (`extraction-store.mjs:252`); mention row writes `turn_index: opts.turnIndex ?? null` (`:274`) | ✓ |
| EDIT `lib/pre-compression-flush.mjs` — destructure `messageCount` from `estimateSessionTokens`; pass `{ turnIndex: messageCount }` | Done — `const { tailMessages, messageCount } = await estimateSessionTokens(...)` (`pre-compression-flush.mjs:372`); LLM path calls `storeExtractionResult(sessionId, result, undefined, { turnIndex: messageCount })` (`:390`) | ✓ |
| EDIT `test/extraction-store.test.mjs` — test that `turnIndex` populates `turn_index` | Done — 3 cases: populates `turn_index=42` when provided; leaves NULL when absent (back-compat); end-to-end `runFlush` pipeline stamps `turn_index=3` on a 3-message session | ✓ |

No schema change (column `mentions.turn_index INTEGER` pre-existed). No unplanned files touched. No existing caller of `storeExtractionResult` passes `opts`, so the `null` default preserves prior behavior.

## 2. Greppable deltas

```
lib/extraction-store.mjs:252        — storeExtractionResult(sessionId, result, provenance, opts = {})
lib/extraction-store.mjs:274        — turn_index: opts.turnIndex ?? null
lib/pre-compression-flush.mjs:372   — const { tailMessages, messageCount } = await estimateSessionTokens(...)
lib/pre-compression-flush.mjs:390   — storeExtractionResult(sessionId, result, undefined, { turnIndex: messageCount })
test/extraction-store.test.mjs      — 3 turn_index cases (provided / absent / runFlush end-to-end)
```

## 3. Done-evidence (runtime-observable)

| Evidence | Result |
|---|---|
| Unit tests | `node --test test/extraction-store.test.mjs` → pass, 0 fail. Full suite green (1425/0). |
| INVENTORY done-criterion: `SELECT COUNT(turn_index) FROM mentions WHERE created_at > now-1h > 0` after a real extraction | **MET.** A real extraction was driven through the deployed `runFlush` (LLM path, `qwen3:8b`) against a real 198-message gateway session (`833ea9cf`), writing to production `~/.openclaw/state.db`: 14 entities → 14 mentions stamped `turn_index = 198` (the session's message count = last-turn-of-tail), all within the hour. Query returned 14 (was 0 before the step). |
| Persistence | `SELECT COUNT(turn_index) FROM mentions` = 14 non-null of 2088 total — the stamp persists; prior to 3.3 all 2088 were NULL. |

**Note on the trigger:** the runtime evidence was produced by invoking the deployed `runFlush` directly (the exact code path the daemon calls at its ACTIVE→IDLE / IDLE→ENDED / NATS-flush boundaries), pointed at the production store, since the daemon was idle (ENDED, no active session) and could not fire an extraction on its own. The code exercised is identical to the daemon's; only the trigger differed. This is real daemon-grade evidence, not a synthetic publish.

## 4. Carry-forwards for 3.4

- `turn_index` is now the **session message count at flush time** (last-turn-of-tail), not a per-mention citation. Per-turn LLM citation remains deferred (MEMORY_REDESIGN L3 §4) — not in scope here.
- 3.4 (tolerant extraction coercion) is the next step; it operates on the same extraction pipeline. The `tool` role introduced in 3.2 should be confirmed to flow through extraction correctly there.
