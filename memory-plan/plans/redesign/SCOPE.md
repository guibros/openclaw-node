# SCOPE — redesign plan

**Status:** done
**Goal:** Step 2.4 — Mission-control API endpoint serving watcher records + health. Add a Next.js API route at `mission-control/src/app/api/watcher/route.ts` that reads `~/.openclaw/watcher.jsonl` and returns recent event records + latest health probe as JSON. Done when `curl` the endpoint → current watcher records as JSON.
**Set at:** 2026-05-29
**Expires:** 2026-05-30T06:00:00Z

```files
mission-control/src/app/api/watcher/route.ts
memory-plan/plans/redesign/audits/step24_mc_watcher_api/AUDIT_PRE.md
memory-plan/plans/redesign/audits/step24_mc_watcher_api/AUDIT_POST.md
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
