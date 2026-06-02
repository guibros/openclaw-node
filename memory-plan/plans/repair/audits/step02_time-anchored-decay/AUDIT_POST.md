# AUDIT_POST — Step 1.2: Time-anchored decay (R1)

## Files-vs-plan ledger

| Planned | Actual | Notes |
|---|---|---|
| `lib/consolidation.mjs` | ✓ | `last_decayed_at` migration in `initConsolidationTables` (pragma-guarded ALTER on entities+decisions); both decay loops anchor at max(last_decayed_at, recall date); combined salience+anchor UPDATEs; anchor written only on applied decay (sub-threshold composes). F-P212/F-L21/F-M18/F-P211 behaviors preserved. |
| `test/consolidation.test.mjs` | ✓ | +3 frozen-clock tests (compose-not-compound incl. anchor-hold on tiny delta; recall restarts the idle clock; decisions loop anchored identically). 20/20 file-local. |

No unplanned files.

## Verification (Phase 5)

- **Tests:** consolidation 20/20 (3 new).
- **Runtime (the Proof):** `sqlite3 .backup` copy of live state.db, real `decayWeights` from the symlinked (deployed) lib, 4 cycles at the real 30-min cadence: cycle 1 anchors (109 decayed once, 0 archived); cycle 2 **decayed=0**; cycle 3 applies the accumulated hour (0.9542→0.9523, −0.2%); cycle 4 = 0. Cycles 2–4 total drift 0.19% ≤ 0.4%; `entities_archived` 961→961 (**0 new rows**, all 4 cycles). Pre-fix live baseline for contrast: "Decayed: 110" every cycle, archive growing.
- **Deploy:** lib/ is symlinked into the runtime and the consolidation scheduler spawns fresh per StartInterval — the next live cycle (≤30 min) runs this code and performs the one-time live anchoring pass automatically; no restart step exists for this service.

## Findings

- The live anchoring cycle may archive a few entities whose bug-crushed salience (≈0.158) crosses the floor at large idle gaps — they land in `entities_archived` and are restored by 1.7 like the rest. Expected, not a defect.

## Carry-forwards

- 1.7/1.8 (data repair) should run AFTER at least one live anchored cycle so rebaselined values immediately stabilize.
- The 109-decayed-once on cycle 1 confirms survivors' recall timestamps are recent (reinforcement effect) — 1.3 will stop that pump; expect post-1.3 steady-state decay counts near 0.
