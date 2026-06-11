# SCOPE — repair plan

**Status:** active
**Goal:** Block 5 chain (operator "go", 2026-06-10): 5.1 knowledge re-index on growth → 5.2 channel errors surface → 5.3 promotion emit-on-change → 5.4 stall detector pipeline-ops-only → 5.5 readonly busy_timeout → 5.6 integrity_check scoping. One 9-phase cycle + commit per step; Proofs per INVENTORY.
**Set at:** 2026-06-10 (Montreal)
**Expires:** no-expiry

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
