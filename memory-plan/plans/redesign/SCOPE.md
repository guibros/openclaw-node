# SCOPE — redesign plan

**Status:** done
**Goal:** Step 2.6 — Anomaly alerts: extraction validation-failure rate, empty-output ops, stalled jobs. Add anomaly detection to the memory-watcher that fires alert records on extraction errors, high noop rates, and stalled event streams. Surface alerts in the mission-control watcher panel and watcher.jsonl. Done when an induced Zod validation failure triggers an alert visible in both panel + log.
**Set at:** 2026-05-29
**Expires:** 2026-05-30T06:00:00Z

```files
lib/memory-watcher.mjs
test/memory-watcher.test.mjs
mission-control/src/app/api/watcher/route.ts
mission-control/src/app/watcher/page.tsx
mission-control/src/lib/hooks.ts
memory-plan/plans/redesign/audits/step26_anomaly_alerts/AUDIT_PRE.md
memory-plan/plans/redesign/audits/step26_anomaly_alerts/AUDIT_POST.md
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
