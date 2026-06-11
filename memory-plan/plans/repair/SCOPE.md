# SCOPE — repair plan

**Status:** idle
**Goal:** Block 6 COMPLETE at v6.6 (6/6; suite 1541/0; UI deployed). Next: Block 7 step 7.1 — repo plist template carries the live env (the project's named nemesis).

```files
lib/memory-watcher.mjs
workspace-bin/memory-daemon.mjs
mission-control/src/app/watcher/page.tsx
mission-control/src/app/api/watcher/route.ts
mission-control/src/lib/hooks.ts
test/*
memory-plan/plans/repair/*
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
