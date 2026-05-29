# SCOPE — redesign plan

**Status:** active
**Goal:** INFRA REMASTER — make every workplan fully siloed/independent. (1) Introduce a
`memory-plan/canonical/` folder holding the canonical `MASTER_PLAN.md`; add
`workspace-bin/sync-canonical.sh` that recopies canonical docs into each `plans/*/`.
(2) Recopy `MASTER_PLAN.md` into each plan silo; copy `FRAMEWORK.md`+`DESIGN_INPUTS.md`
into redesign; rewrite every `../X.md` doc-pointer in plan docs to same-dir.
(3) Viewer: remove the `SHARED_DOCS`/`sharedRoot` reach-up so every tab resolves only
from `plan.dir`. (4) Plumbing: viewer launchd plist (reboot-durable); resolve the dead
`redesign-tick` automation; bump the stale redesign `VERSION`.
**Set at:** 2026-05-29
**Expires:** 2026-05-30T23:59:00Z

This is infrastructure, not a redesign execution step. Step-0.4 execution stays paused.
After this closes, reset SCOPE to the 0.4 file-deltas per `WORKFLOW.md §6`.

```files
.gitignore
workspace-bin/workplan-viewer.mjs
workspace-bin/sync-canonical.sh
memory-plan/MASTER_PLAN.md
memory-plan/canonical/*
memory-plan/plans/redesign/*
memory-plan/plans/legacy/*
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` → blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
