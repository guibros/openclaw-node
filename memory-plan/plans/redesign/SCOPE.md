# SCOPE — redesign plan

**Status:** done
**Goal:** Step 2.3 — Store-health probes: row counts, last-write, WAL size, repo↔runtime drift. Add `runStoreHealthProbes(opts)` to the watcher module. Wire into daemon on a periodic timer. Output written to watcher.jsonl as `op: 'health.probe'` records. Done when probe output matches a direct SQL count and WAL size is shown.
**Set at:** 2026-05-30
**Expires:** 2026-05-30T12:00:00Z

```files
lib/memory-watcher.mjs
test/memory-watcher.test.mjs
workspace-bin/memory-daemon.mjs
memory-plan/plans/redesign/audits/step23_store_health_probes/AUDIT_PRE.md
memory-plan/plans/redesign/audits/step23_store_health_probes/AUDIT_POST.md
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
