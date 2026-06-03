# SCOPE — protocol plan

**Status:** done
**Goal:** Build the protocol base: canonical PROTOCOL.md + FRAMEWORK_CANONICAL/BLOCK_TEMPLATE hoist, generic plan-tick.sh engine, templates/ + new-plan.sh scaffolder. Steps 1.1–1.3 of this plan's INVENTORY. — CLOSED 2026-06-03: all three steps committed with runtime evidence; Block 1 complete at v1.3.
**Set at:** 2026-06-03 (operator-directed, interactive session)
**Expires:** 2026-06-04T23:59:00Z

```files
CLAUDE.md
memory-plan/canonical/PROTOCOL.md
memory-plan/canonical/FRAMEWORK_CANONICAL.md
memory-plan/canonical/BLOCK_TEMPLATE.md
memory-plan/canonical/templates/*
workspace-bin/new-plan.sh
workspace-bin/plan-tick.sh
memory-plan/plans/protocol/*
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
