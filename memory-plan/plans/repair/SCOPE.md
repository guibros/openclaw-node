# SCOPE — repair plan

**Status:** idle
**Goal:** ALL ACTIVE BLOCKS COMPLETE at v7.8 (Blocks 1–7, 49/49 steps, every Proof runtime-captured; suite 1550/0). Remaining scope: Block P (parked security R34–R38, operator-held — the 'working prototype' precondition is now met). Next action is an operator decision: open Block P, commission captured OUT_OF_SCOPE items, or close the plan. (2026-06-11: one labeled hotfix ran under this scope — hydration-mismatch skeleton widths, see git log — scope returned to idle.)

```files
services/launchd/*
test/*
packages/event-schemas/*
workspace-bin/memory-daemon.mjs
lib/pre-compression-flush.mjs
lib/memory-inject-server.mjs
bin/consolidate.mjs
bin/memory-promoter.mjs
lib/memory-budget.mjs
memory-plan/plans/repair/*
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
