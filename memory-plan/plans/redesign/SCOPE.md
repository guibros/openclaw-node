# SCOPE — redesign plan

**Status:** done
**Goal:** Doc-consistency fix — the project `CLAUDE.md` points to the non-existent
top-level `memory-plan/MASTER_PLAN.md` (now lives in `memory-plan/canonical/` + copied
into each silo), causing every autonomous tick to waste a recovery loop. Fix the
MASTER_PLAN path refs and refresh the stale "Where we are / next action" section
(0.4 is done, Block 0 complete, next is step 1.1). Docs only.
**Set at:** 2026-05-29
**Expires:** 2026-05-30T23:59:00Z

```files
CLAUDE.md
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` → blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
