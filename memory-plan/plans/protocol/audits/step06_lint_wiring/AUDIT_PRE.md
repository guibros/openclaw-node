# AUDIT_PRE — step 2.3 · Lint wired into scaffolder + engine preflight

## §0 Re-orient

- Where am I: Block 2 (conformance), step 3/4, 6/7 overall.
- Last step changed: plan-lint.sh exists and grades all four silos truthfully.
- This step contributes: unavoidability — conformance shows up where plans are born (scaffold) and where they run (preflight), no operator memory required.
- Serves the north star via: MASTER_PLAN §6 (enforcement is structural, never voluntary).
- Still the right next step? Yes — wiring before self-conformance so 2.4 can use the wired report as evidence.

## §1 Needs pre-screen (contract)

- plan-lint.sh exists + executable — ✓ (09babba).
- new-plan.sh + plan-tick.sh — ✓ (Block 1).

## §6 File deltas

- `workspace-bin/new-plan.sh` — full lint report after sync (the new plan's to-do list).
- `workspace-bin/plan-tick.sh` — `--summary` conformance line in preflight output.
- `memory-plan/plans/protocol/{VERSION,INVENTORY.md}` — bookkeeping.
