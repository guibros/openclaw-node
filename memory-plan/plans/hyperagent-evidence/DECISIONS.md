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

## D2 — The notification outbox lives in state.db, dedup lives in the ledger (2026-07-21, step 1.1 Phase-1 decision)

**Decision.** The durable operator-signal obligation is a `ha_notify_outbox` table in the same
SQLite DB as the ha_* rows — enqueued inside the creating transaction — and exactly-once is
enforced at the LEDGER via notify()'s new stable-id dedup, not by the outbox alone.

**Why.** Atomicity with row creation is free only in the same DB (one transaction). The outbox
alone cannot give exactly-once (crash between dispatch and mark ⇒ redelivery); the ledger is the
observable end-state, so identity belongs there. Composing both makes every crash/retry
interleaving land exactly one ledger identity — proven by forced full redelivery in the 1.1
runtime verification.

**Consequences.** Deliveries are at-least-once popups but exactly-once ledger identities; any
future signal source can reuse the same pattern (enqueue-in-transaction + stable id). The ledger
scan cost for dedup is linear per drained event — bounded by log-rotate; revisit at 3.3 if ha_*
retention ever matters.

## D3 — Evidence is lane-stratified and graded; D1's mesh-only boundary is superseded (operator-approved 2026-07-22)

**Decision.** HyperAgent evidence gains two orthogonal dimensions — `lane` (`mesh|companion`) and
`evidence_grade` (`attested|operational|derived`) — realized as three storage surfaces so
contamination is structurally impossible: `ha_telemetry` stays the attested-task-outcome ledger
(CHECK-constrained to `evidence_grade='attested'`, `unit_kind='task'`), new `ha_lane_metrics`
holds mechanical transport facts with NO outcome column, new `ha_observations` holds LLM-derived
session signals (themes, friction) with NO outcome column. Only attested rows feed success rates,
reflection thresholds, and cohort claims; reflections become lane-scoped `(node, soul, lane)`.
Companion attested outcomes come ONLY from an explicit task-open/close signal; session end and
friction are never outcomes. Full contracts: `LOCAL_LANE_DESIGN.md` (step 2.0). This supersedes
**D1 boundary 1 only** (mesh-only production lane). D1 boundaries 2–4 and federation D13 are
reaffirmed unchanged.

**Why.** A 2026-07-22 local-integration pivot proposal was rejected after a four-review
verification chain, but its diagnosis held: the loop is starved (live: 1 telemetry / 0 / 0 / 0),
the daemon schedules reflections no producer feeds, and the only permitted lane (mesh) has no
running workers. The rejection reasons became this design's constraints: friction measures
difficulty, not success (no mapping to `success|partial|failure`); the flush hook lacks the
claimed data; extraction is LLM judgment with a regex fallback, not attestation; and
`execution_class` is workload realness (`real|mock|chaos|synthetic`, throws on `companion`), so
lane must be its own field. Grading evidence honestly lets local work in without letting inference
masquerade as outcome.

**Consequences.** Step 2.0 amends 2.1/2.2/2.3 to lane-stratified reporting (mesh = primary
cohort; companion = separate stratum, attested-only, own floor; no pooling). Implementation is
queued as five atomic steps (I1–I5, design §7) that open individually — nothing ships with 2.0.
Bridge lifecycle ownership is decided (launchd unit, canonical Documents repo, Downloads stray
archived; unit precedes lane activation). The mesh-runtime prerequisite for 2.2 is unchanged and
now recorded. The plan's strongest-claim language is unchanged — D13's ceiling still governs.
