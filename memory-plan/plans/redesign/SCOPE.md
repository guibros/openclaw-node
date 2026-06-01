# SCOPE — redesign plan

**Status:** done
**Goal:** Step 6.1 — Build lib/sqlite-store.mjs (WAL + foreign_keys + busy_timeout + integrity_check + user_version)
**Set at:** 2026-06-01T22:00:00-04:00
**Expires:** 2026-06-02T04:00:00-04:00

```files
lib/sqlite-store.mjs
test/sqlite-store.test.mjs
memory-plan/plans/redesign/audits/step61_sqlite_store_helper/AUDIT_PRE.md
memory-plan/plans/redesign/audits/step61_sqlite_store_helper/AUDIT_POST.md
memory-plan/plans/redesign/INVENTORY.md
memory-plan/plans/redesign/VERSION
memory-plan/plans/redesign/COMPONENT_REGISTRY.md
memory-plan/plans/redesign/DECISIONS.md
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
