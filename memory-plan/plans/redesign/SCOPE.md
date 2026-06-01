# SCOPE — redesign plan

**Status:** idle
**Goal:** At v6.3 (Block 6: 6.1–6.3 closed; next 6.4 — WAL checkpoint TRUNCATE on graceful shutdown). No human driver active. Tick runs hybrid.
**Set at:** 2026-06-01
**Expires:** no-expiry

```files
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
