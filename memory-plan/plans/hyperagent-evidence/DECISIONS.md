# DECISIONS — hyperagent-evidence plan (append-only)

Architectural decisions for this plan. Newest at bottom. Never rewrite an entry; supersede with
a new one.

Entry shape: **Decision** (what was chosen) · **Why** (the constraint or evidence that forced it)
· **Consequences** (what this commits us to / rules out).

---

## D1 — Mesh-only, evidence-first, dedicated silo (operator-approved 2026-07-20)

**Decision.** HyperAgent's first operational iteration runs in THIS dedicated silo (not federation
Block 5) under four boundaries, per the approved
`../federation/audits/hyperagent_review/IMPLEMENTATION_PLAN.md`:

1. **Mesh-only production lane.** Real mesh completions are the only production telemetry source.
   The three global harness rules (`hyperagent-task-close`, `hyperagent-task-start`,
   `hyperagent-reflection-ready`) are REMOVED — local session outcomes are not inferred, not
   prompted, not logged. No session-stop heuristic: a deterministic stop event does not make its
   inferred outcome trustworthy. Synthesis becomes an explicit operator-triggered workflow
   (documented runbook), assisted by an advanced LLM, written via `reflect --write-synthesis`.
2. **Human-gated everything** (federation D13 inherited): every strategy proposal is inert until
   CLI-approved by the operator; the MC surface is read-only; observation windows are descriptive,
   never called A/B.
3. **Preregistered evidence, no tuning.** The first cohort (Block 2) validates mechanics and
   proposal usefulness ONLY. Thresholds, taxonomy, and prompts are frozen mid-cohort; calibration
   is explicitly deferred (≥3 reflection windows + ≥50 real logical tasks — Block 3 note).
4. **Amendment folded in:** pending REFLECTIONS notify the operator with the same durability and
   idempotency as pending proposals (step 1.1) — removing the prompt rule removed the only
   synthesis signal, and 2.2's 24h expiry would otherwise pass silently.

**Why.** The deep review (federation audits/hyperagent_deep_review) proved the prompt-driven
loop starved for six weeks: soft entry points produced 1 telemetry row and zero downstream
artifacts. The 07-20 remediation made the mesh path mechanical; local remains guesswork. A
Block-5 placement would put work after the federation plan's closing gate and conflate node-local
infrastructure with the federation-wide savant. Cohort provenance (execution_class) exists
precisely because the federation 3.5 window runs mock/chaos workloads on the same substrate —
co-scheduling without label separation would contaminate the evidence.

**Consequences.** Companion sessions stop carrying HyperAgent prompt text (token savings; no
local telemetry). The mesh producer's provenance fields (0.2) become the cohort's ground truth.
Blocks 2's ends are `visual:` hard gates — headless ticks BLOCK there (federation D6 precedent).
Block 3 items stay [D] behind measured triggers; opening them early is a plan violation. The
strongest claim this plan can ever produce: "mechanically captured a preregistered real cohort,
produced identity-scoped reflections, surfaced proposals through a human-only gate, preserved an
auditable trail."
