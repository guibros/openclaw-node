# SCOPE — redesign plan

**Status:** done
**Goal:** Step 2.1 — Watcher core: subscribe to the event log, persist one record per op to JSONL. Create lib/memory-watcher.mjs that subscribes to local-events-<nodeId> via a durable JetStream consumer and writes one {ts,op,actor,session,duration_ms} JSONL line per event to ~/.openclaw/watcher.jsonl. Wire into daemon after localEventLog init. After restart, trigger an op and verify the JSONL file gets a record.
**Set at:** 2026-05-29
**Expires:** 2026-05-30T06:00:00Z

```files
lib/memory-watcher.mjs
workspace-bin/memory-daemon.mjs
test/memory-watcher.test.mjs
memory-plan/plans/redesign/audits/step21_watcher_core/AUDIT_PRE.md
memory-plan/plans/redesign/audits/step21_watcher_core/AUDIT_POST.md
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
