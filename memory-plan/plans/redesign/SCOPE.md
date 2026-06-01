# SCOPE — redesign plan

**Status:** done
**Goal:** Step 6.2 — Route all `new Database()` sites through the helper
**Set at:** 2026-06-01T23:30:00-04:00
**Expires:** 2026-06-02T06:00:00-04:00

```files
# lib/ production sites (9 files)
lib/extraction-store.mjs
lib/memory-inject-server.mjs
lib/hyperagent-store.mjs
lib/health-check.mjs
lib/session-store.mjs
lib/kanban-store.mjs
lib/mcp-knowledge/core.mjs
lib/obsidian-summarizer.mjs
lib/memory-watcher.mjs

# bin/ production sites (7 files)
bin/extract-existing-sessions.mjs
bin/obsidian-graph-cache.mjs
bin/openclaw-memory-daemon.mjs
bin/consolidate.mjs
bin/run-tuning-harness.mjs
bin/embed-existing-sessions.mjs
bin/run-block3-validation.mjs
bin/spawn-node.mjs

# workspace-bin/ + root (2 files)
workspace-bin/memory-daemon.mjs
test-session-note-runtime.mjs

# plan files
memory-plan/plans/redesign/audits/step62_route_all_new_database/AUDIT_PRE.md
memory-plan/plans/redesign/audits/step62_route_all_new_database/AUDIT_POST.md
memory-plan/plans/redesign/INVENTORY.md
memory-plan/plans/redesign/VERSION
memory-plan/plans/redesign/COMPONENT_REGISTRY.md
memory-plan/plans/redesign/DECISIONS.md
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
