# AUDIT_POST — Step 1.4: Extraction dedup at flush boundaries (R4)

## Files-vs-plan ledger

| Planned | Actual | Notes |
|---|---|---|
| `lib/pre-compression-flush.mjs` | ✓ | `extraction_state(session_id PK, content_hash, message_count, extracted_at)` lazy table; sha256 over the tail's `[role, content]` pairs; dedup gate before the LLM call returns `mode:'llm-dedup'` + zero-count `extraction` block (daemon's existing guard emits it → watcher noop); hash recorded only after successful `storeExtractionResult` (failed LLM leaves no hash → retry). Synthesis chain also skipped on dedup (identical tables ⇒ identical artifacts; concept notes cost ~10 LLM calls). One self-inflicted hiccup: duplicate `import crypto` (the file already had it) — caught by the first test run, removed. |
| `test/extraction-store.test.mjs` | ✓ | +1 integration test: unchanged tail → `llm-dedup`, 0 LLM calls, 0 new mentions; appended message → re-extracts with new mentions. |

## Verification (Phase 5)

- **Tests:** targeted 37/37; full suite **1499/1499**.
- **Runtime (the Proof), live daemon end-to-end:** synthesisMs temporarily 60s (config backed up, reverted after — step-4.5 precedent), daemon restarted onto the new code. Interval synthesis flush #1 at 16:04:17 → `[llm]: 34 facts`, watcher `memory.extracted status=ok entities=12` (session d901d15e), hash row in `extraction_state` (message_count 56). Flush #2 at 16:04:55 over the unchanged tail → `[llm-dedup]: 0 facts`, watcher `memory.extracted status=noop entities=0` — and SQL: 12 mention rows created in flush #1's window, **0 rows after 20:04:30Z** (flush #2 inserted nothing). Config reverted; daemon restarted clean (PID 16432).
- The daemon picked session d901d15e (newest JSONL) rather than the planted fixture — irrelevant to the Proof, and arguably stronger: the dedup fired on a real 712KB production session.

## Findings

- Daemon exit statuses during this step's two restarts: -6 (SIGABRT, mutex) and -9 (SIGKILL) — live R15 evidence accumulating for step 4.1; already in FINDINGS, nothing new to capture.

## Carry-forwards

- `extraction_state.message_count` is exactly what 1.5's turn_index verification can cross-check against (stamp must be message_count−1).
- Real-world dedup cadence: with the 30-min interval restored, an unchanged active session now costs one zero-count event per interval instead of a multi-minute LLM run — 3.1's latency audit should see this in the skip/duration data.
