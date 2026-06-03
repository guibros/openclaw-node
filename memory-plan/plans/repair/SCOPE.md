# SCOPE — repair plan

**Status:** idle
**Goal:** Block 2 chain CLOSED 2.1–2.8 + 2.10/2.11 at v2.11 (coverage 100%, link resolution 100% — was 39.8% —, integrity live per flush, events attributed + truthfully labeled). BLOCKED at 2.9 (defined; awaiting operator shape confirmation — see BLOCKED.md). Then Block-2 macro Re-Orient → Block 3 (D8 LLM audit).
**Set at:** 2026-06-03 02:30 Montreal
**Expires:** no-expiry

```files
lib/obsidian-summarizer.mjs
lib/obsidian-promoter.mjs
lib/obsidian-session-notes.mjs
lib/obsidian-digest.mjs
lib/obsidian-link-checker.mjs
lib/obsidian-vault.mjs
lib/consolidation.mjs
lib/pre-compression-flush.mjs
bin/vault-check.mjs
bin/consolidate.mjs
workspace-bin/memory-daemon.mjs
packages/event-schemas/*
mission-control/src/app/api/memory-content/route.ts
test/*
memory-plan/plans/repair/*
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
