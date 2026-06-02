# SCOPE — repair plan

**Status:** idle
**Goal:** Inventory v2 landed (48 atomic steps, Goal+Proof gates, 9-phase binding, WORKFLOW repointed). Next action: step 1.1 (tick re-entrancy guard) — set its scope with the operator, or build the repair tick chain first (INVENTORY "Work infrastructure").
**Set at:** 2026-06-02 14:30 Montreal
**Expires:** no-expiry

```files
memory-plan/plans/repair/*
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
