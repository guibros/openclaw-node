# AUDIT_POST — Step 1.5: turn_index stamps the last real turn (R5)

## Files-vs-plan ledger

| Planned | Actual | Notes |
|---|---|---|
| `lib/pre-compression-flush.mjs` | ✓ | stamp `messageCount` → `messageCount - 1` (one line + WHY comment). No clamp: the zero-message early-return precedes it. |
| `test/extraction-store.test.mjs` | ✓ | turn_index assertion 3 → 2 for the 3-message fixture (the old test was locking in the defect). 12/12 file-local. |

## Verification (Phase 5)

- **Tests:** 12/12.
- **Runtime (the Proof):** deployed runFlush, real qwen3 LLM, against the 4-message `repair-11-verify` fixture in production state.db: `mode=llm, facts=16`; all mention rows stamped `turn_index=3` = messageCount−1; JOIN against the messages table → **8 mentions matched to a real turn, 0 orphan stamps** (pre-fix every stamp referenced a nonexistent turn).

## Findings

- None.

## Carry-forwards

- 1.4's `extraction_state` row for the fixture now exists (hash recorded by this run) — future flushes of the unchanged fixture dedup, as designed.
- The dormant turn-grain privacy filter (`filterPrivateResults`) can now actually match turns when federation revisits it (post-D7 concern, Block P.2/P.3 context).
