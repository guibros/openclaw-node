# AUDIT_PRE — Step 1.2: Time-anchored decay (R1)

## §0 Re-orient
- Where am I: Block 1, step 2/8, 2/48 overall. Autonomous chain (operator directive).
- Last step changed: 1.1 — tick loop single-flighted (v1.1).
- This step contributes: stops the per-cycle compounding that archived 961 of ~1,070 entities — the block's core corruption.
- Block serves the north star via: salience must measure memory, not scheduler cadence, before D7's vault renders it.
- Still the right next step? Yes.

## Intent
`decayWeights` anchors decay at `last_recalled || last_seen` and overwrites salience every 30-min cycle — the full idle-duration factor re-applies each cycle (FINDINGS R1). Fix: anchor each application at the previous one.

## Design decisions
- New nullable column `last_decayed_at` on `entities` + `decisions`. Migration lives in `initConsolidationTables` (idempotent pragma-guarded ALTER, house pattern) — the consolidate CLI calls it before `decayWeights`, the only reader of the column. No extraction-store/version churn.
- Anchor = lexicographic max(`last_decayed_at`, `last_recalled || last_seen`): ISO strings sort correctly; recall after the last decay restarts the idle clock (preserves the documented "idle decay" semantics).
- `last_decayed_at` is written ONLY when decay is actually applied (the >0.001 write filter): exponential factors compose (0.5^(a/14)·0.5^(b/14)=0.5^((a+b)/14)), so sub-threshold skips accumulate exactly instead of being lost.
- F-P212 (no dates → force floor) and F-L21 (Invalid Date skip) behaviors preserved.
- Decisions decay has the identical compounding bug in the same function — fixed with the same anchor (same outcome: "decay is idempotent w.r.t. cycle frequency"; leaving decisions compounding would be a half-finish).

## Risk register
- First post-fix cycle applies the full idle-duration decay once to anchor (entities have NULL anchors) — on live data this is one more hit on already-crushed values; acceptable because 1.7/1.8 rebaseline afterward, and the Proof measures the post-anchor steady state on a COPY.
- bin/consolidate.mjs emits `archived_names` etc. — return shape unchanged.

## File-delta outline
- `lib/consolidation.mjs`: migration in initConsolidationTables; anchor logic + combined salience/anchor UPDATEs in both decay loops.
- `test/consolidation.test.mjs`: frozen-clock cases — repeated cycles compose to the single-application amount; recall resets the idle clock.

## Done-evidence contract (INVENTORY 1.2 Proof)
On a copy of state.db: 3 cycles inside 1h decay an idle entity ≤0.4% total (post-anchor), `entities_archived` gains 0 rows across those cycles; frozen-clock unit test locks the formula.
