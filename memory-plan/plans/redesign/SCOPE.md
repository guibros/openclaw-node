# SCOPE — redesign plan

**Status:** done
**Goal:** Step 6.4 closed — WAL checkpoint (TRUNCATE) on graceful shutdown. All stores checkpoint+close in daemon shutdown. Pre-existing scoping bug fixed.
**Set at:** 2026-06-01
**Expires:** 2026-06-02T06:00:00Z

```files
lib/sqlite-store.mjs
lib/session-store.mjs
lib/extraction-store.mjs
lib/hyperagent-store.mjs
bin/obsidian-graph-cache.mjs
workspace-bin/memory-daemon.mjs
test/sqlite-store.test.mjs
memory-plan/plans/redesign/VERSION
memory-plan/plans/redesign/INVENTORY.md
memory-plan/plans/redesign/COMPONENT_REGISTRY.md
memory-plan/plans/redesign/DECISIONS.md
memory-plan/plans/redesign/audits/step64_wal_checkpoint_shutdown/AUDIT_PRE.md
memory-plan/plans/redesign/audits/step64_wal_checkpoint_shutdown/AUDIT_POST.md
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
