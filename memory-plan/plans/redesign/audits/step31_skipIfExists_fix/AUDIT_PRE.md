# AUDIT_PRE — Step 3.1: Fix skipIfExists truncation — re-import + append-delta for mid-stream sessions

## §0 Re-orient

- Where am I: Block 3 (L3 ingest/extract correctness), step 1/4, 16/40 overall.
- Last step changed: 2.6 closed Block 2 (watcher) — anomaly alerts for extraction failures, noop rate, stalls.
- This step contributes: fixes the first ingest correctness bug — mid-stream sessions silently truncated because importSession skips on re-encounter.
- Block serves the north star via: DESIGN_INPUTS §1 ("synthesize" requires raw source completeness) + §4 (memory system must not silently lose data).
- Still the right next step? Yes — the watcher (Block 2) is the verification lens; Block 3 fixes use it. 3.1 is the first ingest fix.

### Macro re-orient (Block 2→3 boundary, WORKFLOW §7.2)

- **MASTER_PLAN principles re-read**: §4.1 (code≠shipped), §4.4 (finish-before-moving), §5 (done=runtime-evidence). All honored.
- **COMPONENT_REGISTRY check**: 1.8 (watcher) LIVE at v2.6. 1.1 (ingest) still LIVE-STALE per the registry — the skipIfExists gap, tool_result drop, and deploy-gap code-age are the open issues. The deploy gap (Family 8) is CODE CLOSED — lib/ symlinked, runtime IS repo. So the "STALE" label on 1.1 is now about the logical bugs (skipIfExists, tool_result), not code drift.
- **Next block's steps still atomic?** Block 3 has 4 steps: 3.1 (skipIfExists fix), 3.2 (tool_result drop), 3.3 (turn_index), 3.4 (tolerant extraction). Each is one independently verifiable runtime outcome. Correct.
- **Drift check**: no change landed outside a step. OUT_OF_SCOPE has 5 entries (daily logs, badge render, viewer restart, canonical-sync hook, daemon boot crash) — none promoted; 3.4 (tolerant extraction) addresses the last one.
- **Course correction**: none needed.

## 1. Intent

Change `SessionStore.importSession()` from binary skip-or-full-import to append-delta semantics: when a session already exists with fewer messages than the JSONL source, insert only the new turns (turn_index >= existingCount) and update the session row. This eliminates the permanent truncation of mid-stream sessions.

## 2. Design

The current flow (lines 152–203 of `lib/session-store.mjs`):
1. `skipIfExists` defaults `true`
2. If session row exists → return `{ imported: false }` immediately
3. Otherwise parse JSONL, INSERT OR REPLACE session, INSERT all messages

The new flow:
1. Remove the `skipIfExists` early-return logic
2. Parse the JSONL first (unchanged)
3. Query existing message count: `SELECT message_count FROM sessions WHERE id = ?`
4. If existing and `parsed.length <= existingCount` → return `{ imported: false, messageCount: 0 }` (no new turns)
5. If new turns exist: `delta = messages.slice(existingCount)`, INSERT only delta messages, upsert session row (ON CONFLICT update end_time + message_count)
6. Return `{ imported: true, messageCount: delta.length }`

Key points:
- FTS stays correct via the existing after-INSERT triggers (new messages get FTS entries automatically)
- Session upsert uses `INSERT ... ON CONFLICT(id) DO UPDATE` (not INSERT OR REPLACE, which would cascade-delete)
- No behavior change for fresh sessions (existingCount = 0, full insert)
- `skipIfExists` parameter removed from the destructure; callers don't pass it explicitly (verified via grep)

Consumed carry-forwards from step 2.6 AUDIT_POST §6:
- "Block 3 (ingest + extraction correctness) will use the watcher to verify fixes." → yes, the watcher's ingest event confirms the fix.

## 3. Risk register

| Risk | Mitigation |
|------|------------|
| Duplicate messages if existingCount is stale | message_count on the sessions row is authoritative — updated in the same transaction as message inserts |
| JSONL content changed (not just appended) | Out of scope for this step — JSONL sources are append-only by design (Claude Code, gateway both append) |
| Tests break on changed skipIfExists semantics | Update the "skips already-imported sessions" test to verify append-delta instead |

## 4. File-delta outline

| File | Change |
|------|--------|
| `lib/session-store.mjs` | Replace skipIfExists early-return with append-delta logic in `importSession()` |
| `test/session-store.test.mjs` | Update skip test → append-delta test; add new tests for delta import |
