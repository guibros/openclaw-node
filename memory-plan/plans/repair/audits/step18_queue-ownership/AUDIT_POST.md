# AUDIT_POST — Step 3.2: Queue wait-timeout abandons only its OWN job (R11)

## Files-vs-plan ledger

| Planned | Actual | Notes |
|---|---|---|
| `lib/ollama-queue.mjs` | ✓ | Per-call `ticket` threaded opts → pending entry (`_ticket`) → running job (`myJob.ticket`). Timeout path: removes its own never-started pending entry (settled into the void — the race already resolved); abandons the slot ONLY when `currentJob.ticket === ticket` (the case where its abort signal actually cancels the fetch). `drainPending` drops cancelled entries before firing. |
| `test/ollama-queue.test.mjs` | ✓ | +2 regressions: the exact R11 scenario (B times out while A executes → A keeps the slot, A completes `mode=llm`, B's run never fires, max-concurrency stays 1, queue empty after drain); own-job abandonment still releases the slot. |

## Verification (Phase 5 — the Proof)

- **Tests:** queue file 27/27; full suite **1523/1523**.
- **Runtime:** daemon restarted onto the symlinked fix (PID 57880); live analysis through the deployed path post-restart: inject `mode=llm`, items 7/5/3 — the lane works under the new ownership semantics. (The overlap scenario itself requires synthetic timing control — covered by the regression tests, per the Proof as written.)

## Findings
- None new. R43 (the queue-side 1s default knob) deliberately left for 3.4 — separate concern, defined at block-open.

## Carry-forwards
- 3.3 can rely on `getState()`'s shape as-is (the snapshot the daemon will export cross-process).
