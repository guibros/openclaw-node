# SCOPE — repair plan

**Status:** active
**Goal:** Autonomous chain through Block 2 (operator "go", 2026-06-03): 2.1 transparent writers → 2.2 shared slugify → 2.3 promoter idempotency → 2.4 link checker → 2.5 cadence+surface → 2.6 coverage report → 2.7 backfill → 2.8 resolving links → 2.10/2.11 event fields; 2.9 defined after 2.6. One 9-phase cycle + commit per step, Proofs per INVENTORY v2.
**Set at:** 2026-06-03 00:55 Montreal
**Expires:** 2026-06-04T12:00:00Z

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
