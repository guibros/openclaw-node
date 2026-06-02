# AUDIT_PRE — Step 1.5: turn_index stamps the last real turn (R5)

## §0 Re-orient
- Where am I: Block 1, step 5/8, 5/48 overall. Autonomous chain.
- Last step changed: 1.4 — extraction dedup (v1.4).
- This step contributes: mention provenance points at a turn that exists — prerequisite for any turn-grain ranking/debugging (and the dormant turn-grain privacy filter, post-D7 a federation concern).
- Block serves the north star via: referential integrity of the mention → turn link.
- Still the right next step? Yes — one-line semantic fix, locked by tests.

## Intent
`runFlush` stamps `{ turnIndex: messageCount }`; turns are 0-based (`session-store` maps `turnIndex: i`, max `messageCount-1`). Every mention references a nonexistent turn (FINDINGS R5).

## Design decisions
- Stamp `messageCount - 1`. `tailMessages.length === 0` already returns earlier, so messageCount ≥ 1 — no clamp needed.
- Existing test that locked the bug (`turn_index === 3` for a 3-message session) updated to 2 — the test was asserting the defect.

## File-delta outline
- `lib/pre-compression-flush.mjs`: the stamp.
- `test/extraction-store.test.mjs`: assert `messageCount-1` + that the stamp matches a real turn.

## Done-evidence contract (INVENTORY 1.5 Proof)
New mention rows carry `turn_index == messageCount-1` matching a real turn for that session (JOIN returns rows); regression test. Runtime: deployed runFlush (real LLM) against the repair-11-verify fixture (4 messages → stamp 3), cross-checked against the messages table.
