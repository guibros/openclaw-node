# SCOPE — federation plan

**Status:** idle
**Goal:** Step 0.1 CLOSED 2026-07-09 (v0.1) — single root cause (stale `~/openclaw/` exec path), all units class-C, triage recorded as DECISIONS D5. Next: step 0.2 (FEDERATION_SPEC).
**Set at:** 2026-07-09
**Expires:** no-expiry

```files step-0.1-crashloop-rootcause closed
memory-plan/plans/federation/audits/step01_crashloop-rootcause/AUDIT_PRE.md
memory-plan/plans/federation/audits/step01_crashloop-rootcause/AUDIT_POST.md
memory-plan/plans/federation/DECISIONS.md
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/COMPONENT_REGISTRY.md
```

```files d4-fleet-reconciliation closed
memory-plan/plans/federation/DECISIONS.md
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/GRANULAR_PHASE1.md
memory-plan/plans/federation/PHASE1_TASKS.md
memory-plan/plans/federation/IMPLEMENTATION_PHASES.md
memory-plan/plans/federation/ROADMAP.md
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Batch lifecycle:** label each batch's block (` ```files <label> `) and, when the batch
  ships, append the word `closed` to the fence (` ```files <label> closed `) — the hook prunes
  closed blocks, so finished work re-locks while the record stays. One open block per
  in-flight batch.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
