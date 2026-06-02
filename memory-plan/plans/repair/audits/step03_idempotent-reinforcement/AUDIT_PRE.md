# AUDIT_PRE — Step 1.3: Idempotent reinforcement (R2)

## §0 Re-orient
- Where am I: Block 1, step 3/8, 3/48 overall. Autonomous chain.
- Last step changed: 1.2 — decay time-anchored (v1.2).
- This step contributes: stops the other half of the salience/mention_count pump — the +1/+0.05 every-30-min reinforcement that pinned top entities at mention_count≈148.
- Block serves the north star via: mention_count must count mentions before D7's vault renders "mentioned N×".
- Still the right next step? Yes — with 1.2+1.3 landed, the bug equilibrium is fully gone; 1.7/1.8 can rebaseline on stable dynamics.

## Intent
`reinforceCoOccurrence` re-bumps every qualifying pair every cycle with no already-credited record (FINDINGS R2). Fix: per-pair state — credit once on first qualification, then once per cycle in which shared-session evidence GREW.

## Design decisions
- New table `cooccurrence_state(id_a, id_b, sessions_seen, last_reinforced_at, PK(id_a,id_b))`, created lazily inside `reinforceCoOccurrence` (existing tests call it without initConsolidationTables; lazy creation keeps every caller safe). Pair identity matches the query's `entity_id <` ordering.
- Credit rule: `shared_sessions > sessions_seen` → bump each member once (+1 mention_count, +0.05 salience, existing per-entity per-cycle dedup kept) and record the new count. Equal → skip. Lower (30-day window aging) → track the shrink without touching the timestamp so future growth credits from the new floor.
- A multi-session jump between cycles still credits +1 that cycle (the bonus is qualification evidence, not a recount — extraction already counts real mentions).
- `pairs` in the return now lists only pairs credited THIS cycle (what happened, not what exists).

## Risk register
- First post-fix cycle credits every currently-qualifying pair once (state table empty) — one-time, then silent. 1.8 rebaselines mention_count afterward anyway.
- Window-aging shrink tracking trades a possible missed +1 (shrink then regrow to the old count) against re-crediting old evidence — chose under-credit; logged here.

## File-delta outline
- `lib/consolidation.mjs`: state table + credit logic in reinforceCoOccurrence; JSDoc updated.
- `test/consolidation.test.mjs`: second-cycle-is-zero; new-shared-session credits exactly +1; shrink does not re-credit on regrowth to the same count.

## Done-evidence contract (INVENTORY 1.3 Proof)
SQL snapshot diff across 2 consecutive cycles with no new sessions = zero change; one new shared session credits each member exactly +1; regression tests.
