# SCOPE — repair plan

**Status:** idle
**Goal:** Block 1 COMPLETE at v1.8 (8/8 steps, all runtime-proved; macro Re-Orient done — see audits/step08 + DECISIONS). Next: Block 2 step 2.1 — unify all vault writers on transparent (D7), the operator's headline block.
**Set at:** 2026-06-03 00:45 Montreal
**Expires:** no-expiry

```files
memory-plan/plans/repair/*
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
