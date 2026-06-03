# AUDIT_PRE — step 2.2 · plan-lint.sh conformance checker

## §0 Re-orient

- Where am I: Block 2 (conformance), step 2/4, 5/7 overall.
- Last step changed: §10/§11 — the conformance spec and step contract — live in every silo.
- This step contributes: the teeth. Rules without a checker are advisory; the directive says "enforceable".
- Serves the north star via: operator directive (functionally implement + enforceable verification); MASTER_PLAN §6 (forcing functions over willpower).
- Still the right next step? Yes — checker before wiring (2.3 has nothing to wire otherwise).

## §1 Needs pre-screen (contract)

- §10/§11 in PROTOCOL.md — present (68a78fe). ✓
- Four real silos as corpus — present (`legacy`, `redesign`, `repair`, `protocol`). ✓

## §4 Risks

- False FAILs on historical silos → grandfathering tiers per AUDIT_POST 2.1 §6: closed rows
  without contracts = WARN; audit-dir coverage = WARN (dir-naming variance across eras);
  ROADMAP.md naming variance (redesign's is MEMORY_REDESIGN.md) = WARN not FAIL.
- Spec drift: lint must encode the §10 table only — no invented checks.

## §6 File deltas

- `workspace-bin/plan-lint.sh` — new executable; `--summary` one-liner mode for the 2.3 wiring.
- `memory-plan/plans/protocol/{VERSION,INVENTORY.md}` — bookkeeping.
