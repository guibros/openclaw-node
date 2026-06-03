# SCOPE — repair plan

**Status:** active
**Goal:** Step 1.7 — data repair A: restore bug-archived entities (operator decisions 2026-06-03: all 941 non-colliding, salience 0.5 + fresh anchor, flag restored_at). Runtime data operation on live state.db + plan bookkeeping; no lib code edits. Proof per INVENTORY 1.7.
**Set at:** 2026-06-03 00:25 Montreal
**Expires:** 2026-06-03T18:00:00Z

```files
memory-plan/plans/repair/*
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
