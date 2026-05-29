# SCOPE — Today's Work Contract

**Status:** dormant
**Goal:** (COMPLETE) RESTRUCTURE to a fully siloed `plans/` tree. Each plan becomes self-contained
(its own SCOPE/DECISIONS/COMPONENT_REGISTRY/OUT_OF_SCOPE/INVENTORY/WORKFLOW/VERSION/
tick-logs/audits/automation). Only `MASTER_PLAN.md` is shared, at `memory-plan/`.
Rebuild the scope-check hook to be per-plan-aware, rewire CLAUDE.md bootstrap paths,
and update the workplan-viewer roots + shared-doc resolution.
**Set at:** 2026-05-28
**Expires:** 2026-05-29T23:59:00Z

## Target layout

```
memory-plan/
  MASTER_PLAN.md                  # the ONE shared doc
  plans/
    legacy/                       # the completed 58-step plan (was the "memory-plan" plan)
    redesign/                     # the active plan (was memory-plan/redesign)
```
Each plan dir owns: INVENTORY.md, VERSION, WORKFLOW.md, TICK_PROMPT.md, SCOPE.md,
DECISIONS.md, COMPONENT_REGISTRY.md, OUT_OF_SCOPE.md, tick-logs/, audits/, automation.json.

## Hook redesign (per-plan)

`scope-check.sh`: scan `memory-plan/plans/*/SCOPE.md` for `Status: active` (not expired);
the active plan's `files` block governs the edit. Escape valves: each plan's own
`SCOPE.md` and `OUT_OF_SCOPE.md` always writeable. Exactly one plan should be active
at a time (one-scope-per-session discipline preserved).

## Plan

1. `git mv` redesign → `memory-plan/plans/redesign/`; create `memory-plan/plans/legacy/`
   and `git mv` the legacy plan's files into it. Keep `MASTER_PLAN.md` at `memory-plan/`.
2. Seed `redesign/`'s own SCOPE/DECISIONS/COMPONENT_REGISTRY/OUT_OF_SCOPE (copies from
   current shared docs as starting point; legacy keeps the originals).
3. Rewrite `.claude/hooks/scope-check.sh` per-plan.
4. Update `CLAUDE.md` bootstrap paths.
5. Update `workspace-bin/workplan-viewer.mjs` (WORKPLAN_ROOTS → `memory-plan/plans`;
   shared-doc resolution → walk up to `memory-plan/` for MASTER_PLAN only).
6. Restart viewer; verify both plans siloed and discovered.

```files
memory-plan/*
.claude/hooks/scope-check.sh
CLAUDE.md
workspace-bin/workplan-viewer.mjs
workspace-bin/redesign-tick.sh
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` → blocked.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
