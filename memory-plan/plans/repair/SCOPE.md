# SCOPE — repair plan

**Status:** idle
**Goal:** Chain run 2026-06-02 CLOSED 1.1–1.6 at v1.6 (all runtime-proved, suite 1499/0, daemon on v1.6). BLOCKED at 1.7/1.8 — operator-driven data repair; see BLOCKED.md (precondition: one live post-fix scheduler cycle).
**Set at:** 2026-06-02 16:17 Montreal
**Expires:** no-expiry

```files
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
