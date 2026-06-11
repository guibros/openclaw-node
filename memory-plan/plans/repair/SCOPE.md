# SCOPE — repair plan

**Status:** active
**Goal:** Block 4 chain (operator "go", 2026-06-10): 4.1 shutdown fencing → 4.2 probes decoupled from NATS init → 4.3 NATS re-init → 4.4 session-switch flushes the right JSONL → 4.5 idle-timer self-ping loop → 4.6 (triaged from OUT_OF_SCOPE at block open) the 50KB session floor. One 9-phase cycle + commit per step; Proofs per INVENTORY.
**Set at:** 2026-06-10 (Montreal)
**Expires:** 2026-06-11T12:00:00Z

```files
workspace-bin/memory-daemon.mjs
lib/extraction-trigger.mjs
lib/memory-watcher.mjs
test/*
memory-plan/plans/repair/*
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
