# SCOPE — hyperagent-evidence plan

**Status:** active
**Goal:** Operator-approved 2026-07-20 ("so go?" on the remastered pre-inscription plan +
the reflection-notification amendment): mesh-only, evidence-driven, human-gated HyperAgent
strategy loop, first operational iteration. Source contract:
`../federation/audits/hyperagent_review/IMPLEMENTATION_PLAN.md` (§4 rows, §5 contracts,
§7 exclusions). Claims discipline per federation D13; workers per D11. Approval scope: plan-doc
instantiation + step 0.1 only; each subsequent step opens its own batch.
**Set at:** 2026-07-20 (operator "so go?")
**Expires:** 2026-07-27T00:00:00Z

```files plan-instantiation closed
memory-plan/plans/hyperagent-evidence/ROADMAP.md
memory-plan/plans/hyperagent-evidence/INVENTORY.md
memory-plan/plans/hyperagent-evidence/DECISIONS.md
memory-plan/plans/hyperagent-evidence/COMPONENT_REGISTRY.md
memory-plan/plans/hyperagent-evidence/TICK_PROMPT.md
memory-plan/plans/hyperagent-evidence/VERSION
memory-plan/plans/hyperagent-evidence/audits/*
```

```files step-0.3-evidence-report closed
lib/hyperagent-store.mjs
bin/hyperagent.mjs
test/hyperagent-store.test.js
test/hyperagent-integration.test.mjs
memory-plan/plans/hyperagent-evidence/VERSION
memory-plan/plans/hyperagent-evidence/INVENTORY.md
memory-plan/plans/hyperagent-evidence/COMPONENT_REGISTRY.md
memory-plan/plans/hyperagent-evidence/audits/step03_evidence_report/*
```

```files step-0.2-cohort-provenance closed
lib/hyperagent-store.mjs
bin/mesh-agent.js
bin/hyperagent.mjs
test/hyperagent-store.test.js
test/hyperagent-integration.test.mjs
memory-plan/plans/hyperagent-evidence/VERSION
memory-plan/plans/hyperagent-evidence/INVENTORY.md
memory-plan/plans/hyperagent-evidence/COMPONENT_REGISTRY.md
memory-plan/plans/hyperagent-evidence/DECISIONS.md
memory-plan/plans/hyperagent-evidence/audits/step02_cohort_provenance/*
```

```files step-0.1-mesh-only-boundary closed
config/harness-rules.json
bin/harness-sync.js
lib/mesh-harness.js
test/harness-sync.test.js
test/mesh-harness.test.js
test/hyperagent-integration.test.mjs
workspace-docs/RUNBOOK_HYPERAGENT_SYNTHESIS.md
memory-plan/plans/hyperagent-evidence/VERSION
memory-plan/plans/hyperagent-evidence/INVENTORY.md
memory-plan/plans/hyperagent-evidence/COMPONENT_REGISTRY.md
memory-plan/plans/hyperagent-evidence/audits/step01_mesh_only_boundary/*
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Batch lifecycle:** label each batch's block (` ```files <label> `) and, when the batch
  ships, append the word `closed` to the fence (` ```files <label> closed `) — the hook prunes
  closed blocks, so finished work re-locks while the record stays. One open block per
  in-flight batch (plan-instantiation closes with the instantiation commit).
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
