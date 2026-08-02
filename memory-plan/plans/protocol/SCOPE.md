# SCOPE — protocol plan

**Status:** done
**Goal:** Governance recovery, operator-approved 2026-08-02: retire every expired scope,
reconcile the protocol/federation/HyperAgent plan carriers with fresh runtime evidence, correct
public status documentation, commit the recovered ledger, and push `main`. This batch changes
governance and documentation only; runtime repairs, dependency updates, benchmark execution,
and Phase-1 testing are explicitly excluded.
**Set at:** 2026-08-02T15:22:00-04:00
**Expires:** 2026-08-04T00:00:00Z

```files governance-recovery-2026-08-02 closed
memory-plan/plans/protocol/SCOPE.md
memory-plan/plans/protocol/ROADMAP.md
memory-plan/plans/protocol/INVENTORY.md
memory-plan/plans/protocol/VERSION
memory-plan/plans/protocol/COMPONENT_REGISTRY.md
memory-plan/plans/protocol/DECISIONS.md
memory-plan/plans/protocol/audits/step31_governance_recovery/*
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/COMPONENT_REGISTRY.md
memory-plan/plans/federation/DECISIONS.md
memory-plan/plans/hyperagent-evidence/SCOPE.md
memory-plan/plans/hyperagent-evidence/COMPONENT_REGISTRY.md
README.md
CLAUDE.md
AGENTS.md
```

## Retired scope history

The previous protocol scope accumulated implementation batches from 2026-06-15 through
2026-07-16, including one forgotten open `observer` block. Their durable history remains in git,
the associated audits, and DECISIONS D4-D7. They are not carried as writable file blocks here.

## Done evidence

- During execution exactly one unexpired `Status: active` scope existed; closing v3.1 leaves
  no stale active scopes.
- `plan-lint.sh protocol`, `plan-lint.sh federation`, and `plan-lint.sh hyperagent-evidence`
  report zero FAILs.
- Federation inventory names the evidence rerun before 3.5 and preserves 6.2/6.3 as unfinished.
- README/CLAUDE/AGENTS describe the probed 2026-08-02 state without improvement or recovery claims.
- The staged diff contains governance/docs only; the close commit carries a Runtime-Evidence
  trailer and is pushed to `main` without force.

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` means blocked.
- **`files` block:** one repo-relative path per line; add `closed` to the fence when shipped.
- Keep exactly one active scope and one open file block.
