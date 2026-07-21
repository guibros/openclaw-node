# HyperAgent Evidence Program — remastered pre-inscription plan (2026-07-20)

**Status:** proposal; operator approval required before creating a plan silo or changing INVENTORY.
**Basis:** [DEEP_REVIEW.md](DEEP_REVIEW.md), federation decisions D11 and D13, and the live
Phase-1 contract in `IMPLEMENTATION_PHASES.md`.

## 1. Decision requested

Approve HyperAgent as a **mesh-only, evidence-driven, human-gated strategy loop** for its first
operational iteration, implemented in a dedicated `hyperagent-evidence` plan silo.

Approval means:

1. Real mesh completions are the only production telemetry source.
2. Global companion-session HyperAgent rules are removed; local task outcomes are not inferred.
3. Reflection synthesis is explicitly human-triggered and LLM-assisted.
4. Every strategy proposal remains inert until an operator approves it through the CLI.
5. The first evidence cohort validates mechanics and proposal usefulness only. It cannot establish
   improvement, calibrate thresholds, or support causal language.

This plan does **not** extend federation Block 5. HyperAgent is node-local strategy infrastructure;
Block 5 is the later federation-wide savant grappe. Appending steps after 5.5 would also place work
after the gate that closes the whole federation plan.

## 2. Relationship to federation 3.5

The HyperAgent cohort may be **co-scheduled** with the Phase-1 operational window, but its evidence
is separately accounted:

- Federation T3, T5, and T6 use mock or injected workloads. Their telemetry is labelled and excluded
  from HyperAgent's real-work cohort.
- The HyperAgent cohort is a separate set of paid D11 executions by advanced-LLM OpenClaws.
- Federation 3.5 does not depend on HyperAgent passing. HyperAgent depends on the worker runtime being
  available during the 3.5 window.
- One execution window may therefore produce two audit packages, but no row or cost is silently
  counted as both mock operational evidence and real-agent evidence.

## 3. Claims permitted after this program

If every required gate passes, the strongest permitted claim is:

> HyperAgent mechanically captured a preregistered real mesh cohort, produced identity-scoped
> reflections, surfaced any resulting strategy proposals through a human-only gate, and preserved
> an auditable evidence trail.

The following claims remain prohibited:

- HyperAgent improves task quality, speed, cost, or reliability.
- A proposal caused an observed outcome.
- The observation window is an A/B test.
- HyperAgent autonomously learns, self-modifies, or applies changes.

## 4. Proposed plan shape

After approval, instantiate `memory-plan/plans/hyperagent-evidence/` and derive its INVENTORY from
the candidate rows below. Step numbers belong to that new silo, not federation Block 5.

| Block | Step | Status | Outcome |
|---|---|---|---|
| 0 | 0.1 | `[ ]` | Enforce the mesh-only product boundary and replace global prompt rules with an explicit synthesis runbook |
| 0 | 0.2 | `[ ]` | Add structured cohort provenance to telemetry and its mechanical mesh producer |
| 0 | 0.3 | `[ ]` | Add an evidence query/report surface with honest task, row, and strategy-coverage semantics |
| 1 | 1.1 | `[ ]` | Make pending-proposal notification durable and ledger-idempotent |
| 1 | 1.2 | `[ ]` | Add a read-only Mission Control evidence/proposals page with no decision mutations |
| 2 | 2.1 | `[ ]` | Preregister the real D11 cohort, eligibility rules, outcome rubric, and spend ceiling |
| 2 | 2.2 | `[ ]` | Execute the cohort and observe the complete telemetry-to-proposal path without tuning |
| 2 | 2.3 | `[ ]` | Publish the evidence report and record the operator's continue, revise, or park decision |
| 3 | 3.1 | `[D]` | Design a causal treatment trial if a proposal passes the usefulness gate |
| 3 | 3.2 | `[D]` | Introduce a controlled taxonomy if the fragmentation trigger fires |
| 3 | 3.3 | `[D]` | Introduce archival after measured production growth reaches the retention trigger |

## 5. Step contracts

### 0.1 — Mesh-only boundary

**Goal:** HyperAgent has one honest production lane: mechanically recorded mesh work.

**Needs:** D13; operator approval of this plan; existing mechanical strategy consultation and
telemetry writer in `bin/mesh-agent.js`.

**Feeds:** 0.2's provenance contract; 2.2's uncontaminated cohort; lower prompt cost for ordinary
companion sessions.

**Implementation boundary:**

- Remove `hyperagent-task-close`, `hyperagent-task-start`, and `hyperagent-reflection-ready` from
  the global harness rule set.
- Do not add a session-stop heuristic. A deterministic stop event does not make its inferred outcome
  trustworthy.
- Document one explicit operator workflow for obtaining a pending reflection, asking an advanced LLM
  for synthesis, and writing the result through `reflect --write-synthesis --stdin`.

**Verify:** `code:` no global harness rule asks local sessions to log, consult, or synthesize;
mesh-agent still consults approved strategies and records completion mechanically; tests cover both
conditions. `runtime:` one mesh completion writes telemetry without an LLM-issued logging command.

### 0.2 — Cohort provenance

**Goal:** every telemetry row can be assigned to or excluded from an evidence cohort mechanically.

**Needs:** 0.1; existing additive SQLite migration pattern; stable mesh task/session identifiers.

**Feeds:** 0.3 filtering; 2.2 cohort accounting; future trial stratification without retroactive
guessing.

**Required structured fields:**

- `run_id`: the evidence or operational run identifier;
- `logical_task_id`: the preregistered top-level task, distinct from worker/subtask rows;
- `session_id`: the mesh session that produced the row;
- `execution_class`: `real`, `mock`, `chaos`, or `synthetic`;
- `collaboration_mode`: adversarial, cooperative, or collaborative;
- `provider` and `model`: the D11 worker identity at execution time.

Do not hide these values in `meta_notes`. Existing historical rows remain queryable as
`execution_class=unknown` and are ineligible for the cohort.

**Verify:** `runtime:` one real and one mock task create rows that a SQL query separates without
interpreting free text; both rows retain task, session, node, soul, provider, model, and mode.
`code:` invalid execution classes fail loudly and migration tests preserve existing data.

### 0.3 — Honest evidence report

**Goal:** one reproducible command emits the cohort accounting used by the final report.

**Needs:** 0.2; a declared `run_id`.

**Feeds:** 2.2's runtime gate; 2.3's audit tables; MC's read-only evidence view.

The report distinguishes:

- logical tasks, sessions, and worker telemetry rows;
- real, mock, chaos, synthetic, and unknown execution classes;
- natural task failures from induced operational failures;
- per-domain, per-mode, and per-node/soul counts;
- telemetry completeness and reflection eligibility;
- strategy **coverage**: rows carrying an approved `strategy_id`.

`strategyHitRate` must not be presented as effectiveness. With no approved strategy, zero coverage is
the expected baseline rather than a failure.

**Verify:** `code:` a fixture containing duplicated worker rows, mock rows, and chaos failures reports
the correct distinct-task count and exclusions. `runtime:` the command reproduces identical JSON from
the same database snapshot and run ID.

### 1.1 — Proposal notification integrity

**Goal:** every newly pending proposal produces one durable notification identity without duplicate
ledger entries.

**Needs:** existing `ha_proposals`; openclaw-notify ledger; a chosen durable outbox location.

**Feeds:** 1.2 operator surface; 2.2's first real proposal path.

Creation of a pending proposal and creation of its notification obligation must be atomic. Delivery is
at-least-once; the notification ledger deduplicates on `hyperagent-proposal:<proposal_id>`. A crash
between proposal creation and desktop delivery must leave retriable state, not lose or duplicate the
operator signal.

**Verify:** `runtime:` create one proposal, interrupt delivery once, retry twice, and observe one
ledger event with source `hyperagent` and a click-through URL. `code:` concurrent retries retain the
same event identity.

### 1.2 — Read-only Mission Control surface

**Goal:** the operator can inspect HyperAgent evidence and pending proposals without gaining a second
approval path.

**Needs:** 0.3; 1.1; the open Mission Control frontend batch; runtime `ha_*` schema.

Drop the mismatched `hyperagent_proposals` Drizzle stub or replace it with a read-only mapping to the
runtime schema. The page shows cohort accounting, reflections, proposals, status, and evidence links.
It contains no approve/reject control, mutation route, or writable database handle.

**Verify:** `runtime:` a proposal seeded in a disposable database renders and its notification opens
the page. `code:` route inventory contains GET only; POST/PATCH/PUT/DELETE are absent; the page's DB
connection is opened read-only. `visual:` operator confirms evidence and proposal detail are legible.

### 2.1 — Cohort preregistration

**Goal:** inclusion, labels, judging, and spend are fixed before outcomes are visible.

**Needs:** steps 0.1–1.2 closed; D11 worker path available; operator-selected domains and spend limit.

**Feeds:** 2.2's executable manifest and 2.3's decision rules.

The preregistration records:

- a start timestamp and one `run_id`;
- a consecutive-enrollment rule: include every eligible real task after that timestamp until at
  least 20 are enrolled and the domain-floor rule is satisfied;
- at least two domains with at least five logical tasks in each;
- operator-assigned domain labels and task acceptance criteria before execution;
- allowed advanced-LLM providers/models, maximum tokens or currency spend, and stop conditions;
- outcome meanings: `success` meets the declared acceptance criterion, `partial` meets part, and
  `failure` does not;
- every exclusion reason, declared before the run; excluded tasks remain visible in accounting;
- one named node/soul identity scheduled for at least five eligible rows so the mechanical reflection
  threshold is reachable.

Mode distribution is reported but not forced: tasks use the mode their shape calls for. No conclusion
may compare modes from this cohort.

**Verify:** `visual:` operator signs the manifest and spend ceiling before the first eligible task.
`code:` the manifest validates and its run ID is accepted by the telemetry producer.

### 2.2 — Real evidence run

**Goal:** observe the complete HyperAgent path on real work without changing its behavior mid-cohort.

**Needs:** 2.1 signed; memory daemon and `ops.hyperagent` watcher healthy; D11 workers authenticated;
database snapshot taken before the run.

**Feeds:** 2.3 report; conditional Block 3 decisions.

**Execution rules:**

1. Include every eligible task from the preregistered start until the 20-task and domain-floor rules
   are satisfied. Do not cherry-pick successes.
2. Mock, chaos, synthetic, and unknown rows remain visible but never count toward the 20.
3. Do not seed, approve, reject, tune, or edit a strategy during the cohort.
4. Do not tune the reflection threshold, taxonomy, prompt, or outcome definitions during the cohort.
5. After the daemon creates a reflection, the operator explicitly triggers one advanced-LLM synthesis
   through the documented CLI workflow. The LLM may legitimately return no proposal.
6. No proposal is approved during this step. The notification and MC path are observed read-only.

**Verify:** `runtime:`

- at least 20 distinct eligible `logical_task_id` values with 100% telemetry accountability across
  every enrolled task;
- at least two domains meeting the five-task floor;
- every counted row has complete provenance and `execution_class=real`;
- at least one named node/soul group crosses five rows;
- at least one reflection is created by the daemon and synthesized before its 24-hour expiry;
- every created proposal, if any, has exactly one ledger identity and renders in MC;
- zero strategy approvals and zero un-gated mutations occur during the cohort;
- actual token/currency spend and wall-clock time are recorded against the ceiling.

Any missing telemetry, provenance ambiguity, gate bypass, or spend-ceiling breach fails the run. Fix
the substrate and start a new run ID; do not patch the dataset after inspection.

### 2.3 — Evidence report and operator gate

**Goal:** the operator receives one auditable verdict about whether the observational loop merits
further investment.

**Needs:** 2.2 complete; immutable post-run database snapshot; report command output.

**Feeds:** continue, revise, or park decision; explicit triggers for deferred Block 3.

The report contains:

1. Cohort manifest, exclusions, spend, task/session/row counts, and provenance completeness.
2. Descriptive outcomes by domain and mode, with no causal comparison.
3. Failure taxonomy separating agent/task failures from infrastructure and induced failures.
4. Reflection lineage from cited telemetry IDs to hypotheses and proposals.
5. Strategy coverage, never “hit rate” or effectiveness.
6. Every proposal and hypothesis scored by the operator on five binary criteria: evidence-traceable,
   domain-bounded, actionable, non-duplicative, and paired with a measurable expected outcome.
7. Operator disposition and reason: continue, revise measurement, or park HyperAgent.

**Decision rule:** a causal-trial design may be proposed only if at least one strategy proposal scores
4/5, with evidence-traceable and domain-bounded both passing, and the operator can name an explicit
treatment and outcome. Zero proposals or no qualifying proposal means park or revise; it is not a
license to loosen the rubric or threshold retroactively.

**Verify:** `visual:` operator signs the report and decision. `code:` every aggregate in the report is
reproducible from the archived snapshots, manifest, and report JSON.

## 6. Deferred triggers

### 3.1 — Causal trial protocol `[D]`

Un-defer only after 2.3's usefulness rule passes. The future plan must define treatment application,
control behavior, assignment, strata, sample size, exclusion policy, primary outcome, and a
predeclared decision rule. D13 continues to require human approval before treatment application.

### 3.2 — Controlled taxonomy `[D]`

Un-defer if more than 10% of eligible rows require post-run domain correction, an `unknown`/`other`
bucket exceeds 10%, or synonymous labels alter a report grouping. Until then, operator-assigned labels
in the preregistration are sufficient.

### 3.3 — Retention and archival `[D]`

Record database bytes before and after the cohort, but do not infer a retention policy from 20 tasks.
Un-defer after 30 days of production use, 1,000 real telemetry rows, or 100 MB of `ha_*` data, whichever
comes first. Archive rather than delete, preserving telemetry-to-reflection-to-proposal-to-strategy
lineage and every operator decision.

Threshold tuning is also deferred until at least three completed reflection windows and 50 distinct
real logical tasks exist. The 20-task cohort is an integration and usefulness gate, not a calibration
sample.

## 7. Explicit exclusions

- No federation INVENTORY or ROADMAP edits before approval.
- No extension after federation step 5.5.
- No causal trial, automatic strategy approval, automatic source/config mutation, or local outcome
  inference.
- No production seed rows for UI testing.
- No reuse of mock, chaos, or synthetic 3.5 telemetry as real-work evidence.
- No unrelated installer or embedding-benchmark work; those findings were already remediated in
  commits `3946139` and `52ee571`.

## 8. Approval outcome

If approved, the next action is to instantiate the dedicated silo, record its D1 decision and the
mesh-only boundary, derive atomic INVENTORY rows from Section 4, and open scope for step 0.1 only.
Until then, this document remains a proposal and the live plan is unchanged.
