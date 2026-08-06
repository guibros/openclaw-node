# SCOPE — federation plan

**Status:** active
**Goal:** Operator "gogo" 2026-08-03: execute the reopened 2.6 premise benchmark per D14 —
resume from the v2.6-pre design (five comparable tasks, same advanced LLM/tools per arm, blind
scoring, cost recorded). Phase 1 of the step is the D11 worker-readiness pre-screen: 3
claude-provider mesh-agents up and observable, wedge-risk smoked on a THROWAWAY task (never one
of the five — D14 forbids substitution during the rerun). Task slate confirmation and blind
scoring remain operator gates. Harness/agent/CLI fixes allowed ONLY where the pre-screen proves
them broken. Steps 6.2/6.3 gates unaffected.
**Addendum 2026-08-05 (operator "go" — 2.6 disposition):** close step 2.6 with the final
two-run verdict (PREMISE NOT EVIDENCED), place the D3 block on the plan (BLOCKED.md), record
the verdict + redesign-door decision (D15), and carry VERSION to v2.6. Governance/docs only —
no code, no further executions. Files under "26-disposition".
**Set at:** 2026-08-03 (operator "gogo"; prior idle header set 2026-08-02 during governance
recovery; refreshed 2026-08-05 for the disposition batch — the run-scope expired at 00:00Z)
**Expires:** 2026-08-07T00:00:00Z

```files 26-disposition
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/DECISIONS.md
memory-plan/plans/federation/BLOCKED.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/ROADMAP.md
memory-plan/plans/federation/COMPONENT_REGISTRY.md
memory-plan/plans/federation/audits/step26_premise-benchmark/*
CLAUDE.md
```

```files 26-rerun
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/DECISIONS.md
memory-plan/plans/federation/COMPONENT_REGISTRY.md
memory-plan/plans/federation/audits/step26_premise-benchmark/*
bin/grappe-benchmark.mjs
bin/fed-benchmark.mjs
bin/fed-run-driver.mjs
test/fed-run-driver.test.mjs
test/fed-benchmark-blind.test.mjs
bin/mesh-agent.js
bin/mesh-task-daemon.js
bin/mesh.js
lib/mesh-collab.js
lib/agent-activity.js
test/agent-activity.test.js
docs/PREMISE_BENCHMARK.md
```

## Retired scope history

The former 2026-07-16 scope carried 85 open allow-list entries across abandoned and unfinished
batches. Those writable blocks are retired, not represented as shipped. Their history remains in
git and `audits/`; unfinished outcomes are represented by INVENTORY statuses and contracts.

## Reopen rule

Open exactly one new labeled `files` block only after operator approval. The next recommended
scope is 2.6 evidence execution, not management Block 4.
