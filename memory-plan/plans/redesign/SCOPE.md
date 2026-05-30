# SCOPE — redesign plan

**Status:** done
**Goal:** Step 3.1 — Fix skipIfExists truncation: re-import + append-delta for mid-stream sessions. Change importSession() to detect existing sessions with fewer messages than the JSONL source and insert only the delta turns, instead of skipping entirely. Done when an active session's later turns land in state.db (row count grows as turns arrive).
**Set at:** 2026-05-29
**Expires:** 2026-05-30T12:00:00Z

```files
lib/session-store.mjs
test/session-store.test.mjs
memory-plan/plans/redesign/audits/step31_skipIfExists_fix/AUDIT_PRE.md
memory-plan/plans/redesign/audits/step31_skipIfExists_fix/AUDIT_POST.md
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
