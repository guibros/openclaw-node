# SCOPE — repair plan

**Status:** active
**Goal:** Step 3.1 — LLM infrastructure audit (D8, operator go 2026-06-10). READ-ONLY on code + runtime: map every call site, the full timeout chain, measured cold/warm latencies, model-selection reality, queue semantics. Deliverable: plans/repair/LLM_INFRA.md + findings R43+. Zero code changes in this step.
**Set at:** 2026-06-10 (Montreal)
**Expires:** 2026-06-11T12:00:00Z

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
