# SCOPE — protocol plan

**Status:** active
**Goal:** Block 2 — conformance: every plan functionally wires all six viewer surfaces (master-plan, steps, automation, block, documents, history), the 9-phase protocol, and the Goal/Needs/Feeds/Verify step contract under extreme atomization. Steps 2.1–2.4. (Block 1 closed at v1.3, commits 519be08/5a15329/5fdf278.)
**Set at:** 2026-06-03 (operator-directed, interactive session)
**Expires:** 2026-06-04T23:59:00Z

```files
memory-plan/canonical/PROTOCOL.md
memory-plan/canonical/templates/*
workspace-bin/plan-lint.sh
workspace-bin/new-plan.sh
workspace-bin/plan-tick.sh
workspace-bin/protocol-tick.sh
memory-plan/plans/protocol/*
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
