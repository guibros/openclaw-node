# SCOPE — redesign plan

**Status:** active
**Goal:** Step 4.5 — 30-min-while-active synthesis trigger. Synthesis fires on a 30-min interval during long active sessions (visible in watcher).
**Set at:** 2026-05-31T23:10
**Expires:** 2026-06-01T06:00

```files
workspace-bin/memory-daemon.mjs
memory-plan/plans/redesign/SCOPE.md
memory-plan/plans/redesign/OUT_OF_SCOPE.md
memory-plan/plans/redesign/INVENTORY.md
memory-plan/plans/redesign/VERSION
memory-plan/plans/redesign/COMPONENT_REGISTRY.md
memory-plan/plans/redesign/DECISIONS.md
memory-plan/plans/redesign/audits/step45_30min_synthesis/AUDIT_PRE.md
memory-plan/plans/redesign/audits/step45_30min_synthesis/AUDIT_POST.md
memory-plan/plans/redesign/BLOCKED.md
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
