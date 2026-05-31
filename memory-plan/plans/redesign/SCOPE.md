# SCOPE — redesign plan

**Status:** done
**Goal:** Step 4.4 — Session-end synthesis trigger. Synthesis fires on session end (all paths to ENDED), visible in watcher.
**Set at:** 2026-05-31T17:40
**Expires:** 2026-05-31T23:59

```files
workspace-bin/memory-daemon.mjs
memory-plan/plans/redesign/SCOPE.md
memory-plan/plans/redesign/OUT_OF_SCOPE.md
memory-plan/plans/redesign/INVENTORY.md
memory-plan/plans/redesign/VERSION
memory-plan/plans/redesign/COMPONENT_REGISTRY.md
memory-plan/plans/redesign/DECISIONS.md
memory-plan/plans/redesign/audits/step44_session_end_trigger/AUDIT_PRE.md
memory-plan/plans/redesign/audits/step44_session_end_trigger/AUDIT_POST.md
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
