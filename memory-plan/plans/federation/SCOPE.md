# SCOPE — federation plan

**Status:** active
**Goal (operator "go" 2026-09-19 — pipeline-mode design batch):** discharge the D16 redesign
door on paper, and only on paper. Produce (a) `PIPELINE_MODE_SPEC.md` — the deterministic
fixed-pass protocol D16 ordered: draft → reviews ingested → revision → ships unconditionally,
with the vote / sub-round / gate machinery explicitly removed and three counted terminators in
its place; (b) the NEW preregistered `RUN_RULES.md` for the benchmark that BLOCKED.md makes the
sole unblock condition, carried over from the D14 rules with the gate-forfeit clause marked
vestigial; (c) a DECISIONS entry recording the design and its prior art; (d) INVENTORY rows 2.7
and 2.8 (open, with §11 contracts) plus the ROADMAP amendment that gives them a basis — Block 2's
exit criterion still reads "a converged finalization vote", which D16 killed.

**This batch ships NO code and runs NO executions.** Pipeline mode is specified here, implemented
in 2.7, and benchmarked in 2.8. `BLOCKED.md` STAYS — per D15/D16 it comes down only when the new
benchmark passes, never on a design document. VERSION is not carried, no `audits/step27*` or
`step28*` AUDIT_PRE/POST is opened, and no INVENTORY row is closed: the 9-phase lifecycle is not
being run on a blocked plan. The `step28_pipeline-benchmark/RUN_RULES.md` path follows the D14
precedent, where the rules were predeclared into the audit dir BEFORE the run.

**Set at:** 2026-09-19T20:30:00Z
**Expires:** 2026-09-26T00:00:00Z

```files pipeline-mode-spec-2026-09-19
memory-plan/plans/federation/PIPELINE_MODE_SPEC.md
memory-plan/plans/federation/DECISIONS.md
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/ROADMAP.md
memory-plan/plans/federation/audits/step28_pipeline-benchmark/RUN_RULES.md
```

## Prior scope (closed)

**Closed at:** 2026-08-24 — the 2.6 disposition batch below completed and its window expired
2026-08-09; the header was left reading `active` while `Expires` had passed, which blocks every
write rather than allowing any. Returned to `idle` so it reflects reality and one-scope-per-session
discipline holds. Federation itself remains BLOCKED per D15/BLOCKED.md — this changes scope
bookkeeping only, not the plan's blocked status.
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
Set at (historical, 2026-08-03): operator "gogo"; prior idle header set 2026-08-02 during
governance recovery; refreshed 2026-08-05 for the disposition batch — the run-scope expired at
00:00Z. Expired 2026-08-09T00:00:00Z.
(De-bolded 2026-09-19: `plan-lint.sh:64` reads the **last** `**Set at:**` line in the file, so a
retained historical one masks the live scope's date and grades the fresh scope 47 days old.)

```files 26-disposition closed
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/DECISIONS.md
memory-plan/plans/federation/BLOCKED.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/ROADMAP.md
memory-plan/plans/federation/COMPONENT_REGISTRY.md
memory-plan/plans/federation/audits/step26_premise-benchmark/*
CLAUDE.md
```

```files 26-rerun closed
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
