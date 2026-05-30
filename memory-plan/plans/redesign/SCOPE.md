# SCOPE — redesign plan

**Status:** done
**Goal:** Step 2.2 — Classify each op ok / noop / error (incl. empty-output no-op detection). Add a `status` field to watcher records with values `ok`, `noop`, or `error`. Classification: `memory.error` → `error`; ops with zero output (0 entities extracted, 0 messages ingested, 0 results retrieved, etc.) → `noop`; everything else → `ok`. Done when an induced empty extraction shows `status:noop` in watcher.jsonl.
**Set at:** 2026-05-29
**Expires:** 2026-05-30T06:00:00Z

```files
lib/memory-watcher.mjs
test/memory-watcher.test.mjs
memory-plan/plans/redesign/audits/step22_watcher_classify/AUDIT_PRE.md
memory-plan/plans/redesign/audits/step22_watcher_classify/AUDIT_POST.md
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
