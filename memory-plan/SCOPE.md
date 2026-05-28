# SCOPE — Today's Work Contract

**Status:** idle
**Goal:** (none — between tasks)
**Set at:** 2026-05-28 (handoff)
**Expires:** —

> **No active scope.** A fresh session must set one before editing anything (the
> PreToolUse hook blocks Edit/Write while Status is not `active`). To start work:
> set Status `active`, a Goal, an `Expires`, a ```files block, and the runtime
> evidence required — per `redesign/WORKFLOW.md §6`.

## Next up

**Redesign step 0.1** — close the deploy gap (symlink runtime `lib/` + daemon →
repo; then 0.2 start local NATS). See `redesign/INVENTORY.md` (Block 0) for the
step + its done-evidence, and `redesign/WORKFLOW.md` for the per-step lifecycle.
Run **interactively** (runtime-heavy — DECISIONS 2026-05-28 redesign-tick entry).

## Where the whole effort stands

This session built the discipline + planning + tooling; **no memory-pipeline code
changed yet.** Full picture: read `MASTER_PLAN.md` → `COMPONENT_REGISTRY.md` →
`DECISIONS.md` → `MEMORY_REDESIGN.md` → `redesign/WORKFLOW.md` + `redesign/INVENTORY.md`.
`git log --oneline -20` shows what landed. Everything is committed (local; not pushed).

```files
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
  `idle` / `done` / anything else → the hook blocks (forces a fresh scope).
- **Expires:** ISO-8601 UTC. Past `Expires` → blocked. Refresh before continuing.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
  Empty (as now) → nothing is editable except SCOPE.md and OUT_OF_SCOPE.md.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
