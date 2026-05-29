# SCOPE — redesign plan

**Status:** done
**Goal:** Chain-restart prep — fix stale pre-restructure paths in TICK_PROMPT.md so
autonomous Block 1 ticks resolve the right files. Rewrite every `memory-plan/X` →
`memory-plan/plans/redesign/X` EXCEPT `memory-plan/MASTER_PLAN.md` (the one shared doc).
Infra/automation prep only — no INVENTORY step advance.
**Set at:** 2026-05-29
**Expires:** 2026-05-30T23:59:00Z

```files
memory-plan/plans/redesign/TICK_PROMPT.md
/Users/moltymac/.claude/projects/-Users-moltymac-openclaw-nodedev/memory/*
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` → blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
