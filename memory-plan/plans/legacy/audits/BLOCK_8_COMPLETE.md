# Block 8 Complete — Consolidation Cycle

## Exit-gate criteria

- [x] Step 8.1: Consolidation jobs library (`lib/consolidation.mjs`) with 7 functions + CLI orchestrator (`bin/consolidate.mjs`)
- [x] Step 8.2: Consolidation scheduler (`bin/consolidation-scheduler.mjs`) with dual idle detection, 5-min hard cap, launchd plist

## Files touched cumulatively (Block 8)

| Step | New files | Modified files |
|------|-----------|----------------|
| 8.1 | `lib/consolidation.mjs`, `bin/consolidate.mjs`, `test/consolidation.test.mjs` | — |
| 8.2 | `bin/consolidation-scheduler.mjs`, `services/launchd/ai.openclaw.consolidation-scheduler.plist`, `test/consolidation-scheduler.test.mjs` | — |

## Test delta

- Block 8 entry baseline: 869 (v7.4)
- Block 8 exit total: 893 (818 pass, 75 fail)
- Block 8 tests added: +28 `it()` blocks (14 in 8.1, 14 in 8.2)

## Streaks

- zero-Phase-4-correction: 0 (reset in Step 8.1 — test count underestimate)
- zero-Phase-8-patch: 16 (Block 5 all 5 + Block 6 all 4 + Block 7 all 4 + Block 8 both 2 + 1 from Block 4)

## Carry-forwards into Block 9

- Consolidation cycle is now schedulable. `runConsolidationCycle` from `bin/consolidate.mjs` is the entry point; `createConsolidationScheduler` from `bin/consolidation-scheduler.mjs` wraps it with idle detection and hard cap.
- Block 9 frozen decisions must be authored in RESUME.md §0 before Step 9.1 can start. Per RESUME.md next-tick checklist: if Block 9 §0 is absent, write BLOCKED.md.
- Validation gate from Block 8 §0: "consolidation cycle runs cleanly 3 times on the operator's machine without errors, AND a measurable change in graph state (≥10 items decayed OR ≥1 cluster detected) is verified." This gate is for the operator to evaluate post-close.
