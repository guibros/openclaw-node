# AUDIT_PRE — step 2.1 · Conformance + step contracts in PROTOCOL.md and templates

## §0 Re-orient

- Where am I: Block 2 (conformance), step 1/4, 4/7 overall.
- Last step changed: 1.3 closed Block 1 — the base exists (docs, engine, scaffolder).
- This step contributes: the written law Block 2 enforces — what "functionally implements each surface" means + the Goal/Needs/Feeds/Verify step contract. Lint (2.2) can only check rules that exist.
- Serves the north star via: operator directive 2026-06-03 (each plan must functionally implement all six surfaces + 9-phase + extreme atomization); MASTER_PLAN §4.10 (framework slot before framework work).
- Still the right next step? Yes — spec before checker before wiring before self-conformance.

## §1 Intent

PROTOCOL.md gains §10 (six-surface conformance: per-surface files + functional bar, graded by
plan-lint.sh) and §11 (the four-field step contract + tightened atomicity); §3 Phase 1/5/9 rows
reference Needs/Verify/Feeds. INVENTORY.template.md example switches to the contract format.
TICK_PROMPT.template.md lifecycle enforces Needs-check (Phase 1), Verify-modality incl.
visual→BLOCK (Phase 5), Feeds-landing record (Phase 9). Sync to all silos. Also label Block 1's
trailing done-evidence notes in this plan's INVENTORY as historical (layout clarity).

## §4 Risks

- §10 must match what the viewer actually renders (verified live in Block 1) — no aspirational
  surface definitions.
- Grandfathering: closed historical rows without contracts must grade WARN not FAIL, or every
  pre-existing silo becomes permanently red — decided here, encoded in 2.2.

## §6 File deltas

- `memory-plan/canonical/PROTOCOL.md` — +§10, +§11, §3 row touches.
- `memory-plan/canonical/templates/INVENTORY.template.md` — contract-format example.
- `memory-plan/canonical/templates/TICK_PROMPT.template.md` — Phase 1/5/9 contract enforcement.
- `memory-plan/plans/protocol/{VERSION,INVENTORY.md}` — bookkeeping + historical label.
- `memory-plan/plans/*/` — resynced copies.
