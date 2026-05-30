# SCOPE — redesign plan

**Status:** done
**Goal:** Step 2.5 — Mission-control panel UI: live op stream + dedicated silent-failures view. Add a `/watcher` page to mission-control that polls `GET /api/watcher` via SWR and renders: (1) a live event stream with status badges (ok/noop/error), (2) a dedicated silent-failures view filtering noop+error ops. Done when the page loads at `:3000/watcher` showing live events, and the silent-failures view populates on an induced no-op.
**Set at:** 2026-05-29
**Expires:** 2026-05-30T06:00:00Z

```files
mission-control/src/app/watcher/page.tsx
mission-control/src/lib/hooks.ts
memory-plan/plans/redesign/audits/step25_mc_watcher_panel/AUDIT_PRE.md
memory-plan/plans/redesign/audits/step25_mc_watcher_panel/AUDIT_POST.md
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
