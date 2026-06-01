# SCOPE — redesign plan

**Status:** done
**Goal:** Step 4.9 — Retire the lossy hourly daily-log writer (last Block-4 step; macro re-orient follows). BLOCK 4 COMPLETE.
**Set at:** 2026-06-01
**Expires:** 2026-06-02T06:00:00Z

```files
workspace-bin/memory-daemon.mjs
workspace-bin/memory-maintenance.mjs
workspace-bin/daily-log-writer.mjs
memory-plan/plans/redesign/INVENTORY.md
memory-plan/plans/redesign/VERSION
memory-plan/plans/redesign/COMPONENT_REGISTRY.md
memory-plan/plans/redesign/DECISIONS.md
memory-plan/plans/redesign/audits/step49_retire_daily_log/AUDIT_PRE.md
memory-plan/plans/redesign/audits/step49_retire_daily_log/AUDIT_POST.md
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
