# SCOPE — federation plan

**Status:** active
**Goal (operator "review and implement" 2026-09-21 — step 2.7, pipeline mode):** implement
`PIPELINE_MODE_SPEC.md` (D18) as a fourth `architecture` in the session engine, and run step
2.7's 9-phase lifecycle as far as this environment can honestly carry it.

Phase 4 deltas (the AUDIT_PRE §6 outline is the binding list): `lib/mesh-collab.js` gains
`COLLAB_MODE.PIPELINE` + the conditional `pipeline` session block + pass-machine / artifact /
degraded-ledger / usage methods, with **no** `convergence` block for this mode;
`bin/mesh-task-daemon.js` gains the dispatch branch, `startPipelinePass`, the per-pass deadline
handler + restart-rehydration sweep, the reflect-handler branch, and a `completePipelineSession`
that ships unconditionally — plus guards so the leave/stall paths never route a pipeline session
into `evaluateRound`'s convergence branch; `bin/mesh-agent.js` gains `buildPipelinePrompt` (no
`vote:` line — D16) and the round-loop branch reusing `lib/circling-parser.js` unchanged;
`bin/fed-benchmark.mjs`'s collector learns this mode's terminal shape (SPEC §6) and its grappe
arm submits pipeline by default (`FED_GRAPPE_MODE=circling_strategy` reproduces D14);
`bin/mesh-bridge.js` materializes `pipeline_pass_started` on the kanban; `docs/FEDERATION_SPEC.md`
§3/§3.4/§5.1/§8 stop asserting "a finalization vote".

Phase 5, honestly bounded: `code:` — the §11 unreachability test and the three T2 absence
behaviours as unit tests, full `npm test` green. `runtime:` — the contract's "one reviewer
deliberately silenced still delivers" is executed against a **real nats-server 2.12.6 (the CI
pin, sha-verified) with the daemon's real handlers over real JetStream KV, in this container** —
the same class of evidence steps 2.1–2.3 closed on (mock participants, real bus, real state
machine). It is NOT the deployed fleet. VERSION therefore stops at **`v2.7-mid`**: Phase 9's close
(deploy to `~/.openclaw`, `launchctl kickstart`, a fleet log line, `[A]`→`[x]`, clean `v2.7`) is
the operator's, per MASTER_PLAN §5 items 2–3. `BLOCKED.md` STAYS — it comes down only on 2.8.
Mission Control's session card is NOT touched (falls back to the zinc badge; carried forward).

**Set at:** 2026-09-21T00:30:00Z
**Expires:** 2026-09-28T00:00:00Z

```files 2.7-pipeline-mode-2026-09-21
lib/mesh-collab.js
bin/mesh-task-daemon.js
bin/mesh-agent.js
bin/mesh-bridge.js
bin/fed-benchmark.mjs
docs/FEDERATION_SPEC.md
test/collab-mode-selection.test.mjs
test/collab-pipeline.test.js
test/daemon-pipeline-handlers.test.js
test/pipeline-runtime.test.mjs
test/fed-benchmark-pipeline.test.mjs
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/COMPONENT_REGISTRY.md
memory-plan/plans/federation/DECISIONS.md
memory-plan/plans/federation/PIPELINE_MODE_SPEC.md
memory-plan/plans/federation/audits/step27_pipeline-mode/*
```

## Design batch (closed 2026-09-21 — shipped in 46b037a / PR #24)

**Goal (operator "go" 2026-09-19 — pipeline-mode design batch):** discharge the D16 redesign
door on paper, and only on paper: `PIPELINE_MODE_SPEC.md`, the preregistered step-28
`RUN_RULES.md` (DRAFT pending the operator's three lock fields), D18, INVENTORY rows 2.7/2.8
with §11 contracts, and the ROADMAP Block-2 exit-criterion correction. No code, no executions,
no step closed, BLOCKED.md untouched.

```files pipeline-mode-spec-2026-09-19 closed
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
