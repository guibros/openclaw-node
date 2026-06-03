# AUDIT_PRE — step 1.3 · Template set + new-plan.sh scaffolder

## §0 Re-orient

- Where am I: Block 1 (protocol base), step 3/3, 3/3 overall — closing the block and the plan's first iteration.
- Last step changed: plan-tick.sh, the one generic chain engine, verified against all 4 silo states.
- This step contributes: instantiation — one command turns the base (1.1 docs + 1.2 engine) into a new working silo. Without it the base is rules with no birth path.
- Serves the north star via: COWORK_MODEL §2 (the plan dir as portable agent bundle) — scaffolding makes the bundle reproducible instead of hand-copied.
- Still the right next step? Yes — last dependency in the chain; also carries the CLAUDE.md pointer refresh (bootstrap must name the base or nobody finds it).

## §1 Intent

`canonical/templates/` with 8 templates (`INVENTORY`, `ROADMAP`, `SCOPE`, `OUT_OF_SCOPE`,
`DECISIONS`, `COMPONENT_REGISTRY`, `TICK_PROMPT`, `automation.json`) carrying
`{{PLAN_ID}}/{{GOAL}}/{{DATE}}/{{REPO}}/{{HOME}}` placeholders. `workspace-bin/new-plan.sh <id>
["goal"]`: validate kebab id, refuse existing, render templates, write `VERSION=v0.0`, create
`audits/` + `tick-logs/`, generate the `<id>-tick.sh` shim (carry-forward: `exec ... "$@"` so
`--preflight` passes through), run sync-canonical. Update CLAUDE.md (stale "next action 1.1"
section + protocol-base pointers).

## §4 Risks

- Template INVENTORY must match the engine's `next_step()` grep — format rule placed next to the
  table header (1.2 carry-forward).
- Demo silo must be fully removed after evidence (silo + shim) or it pollutes the viewer index.
- sync-canonical must keep skipping `templates/` (it does: `[[ -f ]]` guard on dir).

## §6 File deltas

- `memory-plan/canonical/templates/{INVENTORY,ROADMAP,SCOPE,OUT_OF_SCOPE,DECISIONS,COMPONENT_REGISTRY,TICK_PROMPT}.template.md` — new.
- `memory-plan/canonical/templates/automation.template.json` — new.
- `workspace-bin/new-plan.sh` — new executable.
- `CLAUDE.md` — silo list + reading order + "Where we are" refresh.
- `memory-plan/plans/protocol/{VERSION,INVENTORY.md,SCOPE.md,DECISIONS.md}` — close bookkeeping.
