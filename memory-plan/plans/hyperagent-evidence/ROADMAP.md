# hyperagent-evidence — Roadmap

**Goal.** Mesh-only, evidence-driven, human-gated HyperAgent strategy loop — first operational
iteration (cohort → evidence report → operator gate)
**Created:** 2026-07-20 · **Approved:** operator "so go?" 2026-07-20 on
`../federation/audits/hyperagent_review/IMPLEMENTATION_PLAN.md` + the reflection-notification
amendment.

## Why this plan exists

The 2026-07-20 deep review (federation `audits/hyperagent_deep_review/`) found HyperAgent to be a
credible design that had never run: 1 telemetry row, 0 strategies/reflections/proposals, soft
LLM-prompted entry points, and a broken reflect path. The same-day remediation made the mesh
producer, strategy selection/attribution, scheduler, deployment probe, and watcher mechanical.
This plan is the disciplined first iteration ON that substrate: prove the loop on a preregistered
real cohort, surface its gate honestly, and let the operator rule on further investment.

**Not federation Block 5.** HyperAgent is node-local strategy infrastructure; Block 5 is the
federation-wide savant grappe, and 5.5 closes the whole federation plan. This silo keeps the two
apart (federation 5.1 explicitly notes the local loop does not close it).

## Standing constraints

- **D13 (federation ledger):** human approval for every strategy change; observe ≠ A/B; no
  self-modification or improvement claims. The permitted end-state claim is capture + reflection +
  human-gated proposals + auditable trail — nothing stronger.
- **D11:** cohort workers are advanced-LLM OpenClaws; qwen/local models never execute cohort tasks.
- **No mid-cohort tuning** of thresholds, taxonomy, prompts, or outcome definitions; breaches void
  the run_id.
- **Mock/chaos/synthetic telemetry** (incl. federation 3.5's operational program) is labelled and
  never counted as real evidence — co-scheduling allowed, accounting separate.

## Blocks

**Block 0 — Honest substrate boundaries.** Mesh-only lane (remove prompt-driven local rules,
document explicit operator synthesis), cohort provenance fields, reproducible evidence report.
*Exit:* a mock and a real task are mechanically separable end-to-end and the report command is
deterministic.

**Block 1 — Operator surfaces.** Durable idempotent notifications for pending reflections
(the amendment — the synthesis signal the removed rule used to provide) and pending proposals;
read-only MC evidence page. The approval gate remains CLI-only.
*Exit:* seeded reflection + proposal each produce exactly one ledgered signal and render read-only.

**Block 2 — The evidence cohort.** Operator-signed preregistration (≥20 real tasks, ≥2 domains,
spend ceiling) → frozen execution observing the full path → operator-signed report + disposition.
Both ends are `visual:` hard gates — a headless tick BLOCKS.
*Exit:* the operator's continue/revise/park decision is recorded with reproducible aggregates.

**Block 3 — Deferred.** Causal trials, controlled taxonomy, retention — each behind an explicit
un-defer trigger measured by Block 2's output, never opened speculatively.

## Done contract

The plan is done when 2.3's disposition is recorded. "Continue" spawns the next iteration's plan
(causal trial design per 3.1's trigger); "revise" or "park" closes here with the evidence archived.
