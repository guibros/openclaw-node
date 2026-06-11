# SCOPE — repair plan

**Status:** idle
**Goal:** Block 3 COMPLETE at v3.4 (4/4: audit, queue ownership, cross-process introspection, remediations; macro Re-Orient in audits/step20; suite 1529/0). Next: Block 4 step 4.1 — shutdown fencing (the -9/-6 exits), with the 50KB-floor capture triaged into its scope-setting.
**Set at:** 2026-06-10 (Montreal)
**Expires:** 2026-06-11T12:00:00Z

```files
lib/ollama-queue.mjs
lib/extraction-prompt.mjs
memory-plan/canonical/MASTER_PLAN.md
memory-plan/plans/*/MASTER_PLAN.md
test/*
memory-plan/plans/repair/*
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
