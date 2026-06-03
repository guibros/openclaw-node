# SCOPE — repair plan

**Status:** idle
**Goal:** Block 2 COMPLETE at v2.9 (11/11 steps; macro Re-Orient in audits/step16). The referential system is delivered: 4 surfaces, 100% coverage on all dimensions, 867/867 links resolving, integrity measured per flush. Next: Block 3 step 3.1 — LLM infrastructure audit (D8, operator-driven).
**Set at:** 2026-06-03 03:25 Montreal
**Expires:** no-expiry

```files
lib/obsidian-summarizer.mjs
lib/obsidian-promoter.mjs
lib/obsidian-session-notes.mjs
lib/obsidian-digest.mjs
lib/obsidian-link-checker.mjs
lib/obsidian-decision-notes.mjs
lib/obsidian-theme-notes.mjs
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
