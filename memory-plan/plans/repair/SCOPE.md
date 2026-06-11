# SCOPE — repair plan

**Status:** idle
**Goal:** Block 4 COMPLETE at v4.6 (6/6 incl. block-open-defined 4.6; macro Re-Orient in audits/step24; suite 1533/0; four consecutive exit-0 daemon restarts). Next: Block 5 step 5.1 — knowledge index re-indexes grown sessions (the search-quality fix).
**Set at:** 2026-06-10 (Montreal)
**Expires:** no-expiry

```files
workspace-bin/memory-daemon.mjs
lib/extraction-trigger.mjs
lib/memory-watcher.mjs
test/*
memory-plan/plans/repair/*
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
