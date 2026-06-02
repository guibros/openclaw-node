# SCOPE — repair plan

**Status:** active
**Goal:** Autonomous chain through Block 1 hybrid/tick steps (operator directive 2026-06-02: "go autonomously in chain until you block"). Current: 1.2 time-anchored decay → 1.3 idempotent reinforcement → 1.4 extraction dedup → 1.5 turn_index → 1.6 atomic MEMORY.md. Expected BLOCK at 1.7 (operator-driven data repair). One 9-phase cycle + one commit per step; each step's Proof per INVENTORY v2.
**Set at:** 2026-06-02 15:50 Montreal
**Expires:** 2026-06-03T12:00:00Z

```files
lib/consolidation.mjs
lib/extraction-store.mjs
lib/pre-compression-flush.mjs
lib/memory-budget.mjs
test/consolidation.test.mjs
test/extraction-store.test.mjs
test/pre-compression-flush.test.mjs
test/memory-budget.test.mjs
memory-plan/plans/repair/*
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
