# SCOPE — repair plan

**Status:** idle
**Goal:** Plan silo stood up 2026-06-02 (findings baseline R1-R42, 30-step inventory, D7 vault-transparency, D8 LLM-audit-first). Next action: step 1.1 (tick re-entrancy guard) — set a scope for it with the operator, or build the repair tick chain first (INVENTORY "Work infrastructure").
**Set at:** 2026-06-02 14:05 Montreal
**Expires:** no-expiry

```files
memory-plan/plans/repair/*
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
