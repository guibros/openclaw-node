# SCOPE — repair plan

**Status:** idle
**Goal:** Block 5 COMPLETE at v5.6 (6/6; suite 1539/0; backlog of frozen sessions draining live). Next: Block 6 step 6.1 — watcher detail panel survives polls (event_id through toWatcherRecord).

```files
workspace-bin/memory-daemon.mjs
lib/retrieval-pipeline.mjs
lib/memory-injector.mjs
lib/memory-inject-server.mjs
lib/memory-watcher.mjs
lib/consolidation.mjs
lib/sqlite-store.mjs
lib/health-check.mjs
bin/consolidate.mjs
test/*
memory-plan/plans/repair/*
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
