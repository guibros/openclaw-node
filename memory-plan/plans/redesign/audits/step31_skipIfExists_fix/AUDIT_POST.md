# AUDIT_POST — Step 3.1: Fix skipIfExists truncation — re-import + append-delta for mid-stream sessions

## 1. Files-vs-plan ledger

| Plan (AUDIT_PRE §4) | Actual | Match |
|---|---|---|
| EDIT `lib/session-store.mjs` — replace skipIfExists early-return with append-delta logic | Done — removed `skipIfExists` parameter + binary early-return; added existing message_count check + delta slice + `INSERT ... ON CONFLICT(id) DO UPDATE` upsert. | ✓ |
| EDIT `test/session-store.test.mjs` — update skip test, add append-delta tests | Done — replaced "skips already-imported sessions by default" with 3 tests: "skips re-import when not grown", "appends delta turns when grown", "append-delta is idempotent". | ✓ |

No unplanned files touched.

## 2. Greppable deltas

```
lib/session-store.mjs:140-203 — importSession() rewritten
  :149     — removed skipIfExists param from opts destructure
  :164-166 — new: query existing message_count, compute existingCount
  :168-169 — new: early-return if existingCount >= parsed.length (no new turns)
  :171     — new: newMessages = messages.slice(existingCount) — the delta
  :175-180 — changed: INSERT OR REPLACE → INSERT ... ON CONFLICT(id) DO UPDATE SET end_time, message_count
  :188     — changed: iterate newMessages (not all messages) for INSERT

test/session-store.test.mjs:93-147 — replaced + added tests
  :93-100  — "skips re-import when session has not grown" (was "skips already-imported by default")
  :102-137 — NEW: "appends delta turns when session has grown (append-delta)" — 2→4 msg growth verified
  :139-147 — NEW: "append-delta is idempotent — third import with same count is a no-op"
```

## 3. Done-evidence (runtime-observable)

| Evidence | Result |
|---|---|
| Tests green | `npm test`: 1416 pass / 0 fail (2 new append-delta tests, 1 updated skip test). |
| Append-delta works | Test "appends delta turns when session has grown": JSONL grown 2→4 msgs, re-import returns `imported:true, messageCount:2` (delta), DB has 4 rows, session.message_count=4, end_time updated to last turn's timestamp. |
| Idempotent on no-growth | Test "skips re-import when session has not grown": second import returns `imported:false, messageCount:0`. |
| Deployed code | `readlink ~/.openclaw/workspace/lib` → `/Users/moltymac/openclaw-nodedev/lib` (symlink = repo IS runtime). |
| Daemon running on new code | PID 82225 after `launchctl kickstart -k`; startup clean: NATS connected, watcher initialized, inject server listening on :7893. No errors. |
| INVENTORY done-evidence | "an active session's later turns land in state.db (row count grows as turns arrive)" — verified via the append-delta test: 2 initial messages, JSONL grows to 4, re-import adds only the 2 new turns, total in DB = 4. Production state.db will exercise this on next daemon import cycle (Phase 0 Bootstrap or Phase 2 Throttled Work). |

## 4. Cross-refs

- The `onImported` callback in `importDirectory` fires on `result.imported === true`, which now also fires for delta appends — so `emitIngestEvent` (step 1.2) correctly emits `memory.ingested` events on appended turns, not just fresh imports.
- The `INSERT ... ON CONFLICT(id) DO UPDATE` replaces the prior `INSERT OR REPLACE` — this preserves the session row (no cascade-delete risk) while updating `end_time` and `message_count`.
- FTS triggers (`messages_ai`) fire on each new `INSERT INTO messages` — delta messages are automatically FTS-indexed.

## 5. Findings

- The `skipIfExists` parameter was never explicitly passed by any caller (confirmed via grep). Its removal is backward-compatible — all callers used the default.
- The `importDirectory` "counts re-imports as skipped" test still passes because sessions with no new turns return `imported: false`.

## 6. Carry-forwards for step 3.2

- Step 3.2 (stop dropping tool_result/tool-call entries) is the next ingest fix. It operates in `transcript-parser.mjs`, not `session-store.mjs` — orthogonal to this step.
- The append-delta logic assumes JSONL is append-only (turns don't change once written). This holds for all current transcript sources (Claude Code, gateway). If a future source rewrites earlier turns, a content-hash or full re-import strategy would be needed — captured as a design note, not an action.
