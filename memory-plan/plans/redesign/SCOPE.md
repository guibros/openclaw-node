# SCOPE — redesign plan

**Status:** idle
**Goal:** At v5.3 (Block 5 COMPLETE; all 3 L5 steps closed; next Block 6 step 6.1 — Build lib/sqlite-store.mjs). LLM analysis timeout (1s waitTimeoutMs) is a carry-forward — channels work in embedding-fallback mode.
**Set at:** 2026-06-01
**Expires:** no-expiry

```files
memory-plan/plans/redesign/audits/step53_retrieval_checkpoint/AUDIT_PRE.md
memory-plan/plans/redesign/audits/step53_retrieval_checkpoint/AUDIT_POST.md
memory-plan/plans/redesign/INVENTORY.md
memory-plan/plans/redesign/VERSION
memory-plan/plans/redesign/COMPONENT_REGISTRY.md
memory-plan/plans/redesign/DECISIONS.md
lib/memory-inject-server.mjs
workspace-bin/memory-daemon.mjs
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
