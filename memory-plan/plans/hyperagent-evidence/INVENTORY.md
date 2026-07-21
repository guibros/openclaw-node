# hyperagent-evidence — Step Inventory

Mesh-only, evidence-driven, human-gated HyperAgent strategy loop — first operational iteration
(cohort → evidence report → operator gate). Source contract:
`../federation/audits/hyperagent_review/IMPLEMENTATION_PLAN.md` (approved 2026-07-20); claims
discipline per federation D13; workers per D11.

**One step = one independently-verifiable runtime outcome = one 9-phase cycle = one commit**
(PROTOCOL §3). Done-evidence is runtime-observable (MASTER_PLAN §5), never just tests-green.

**Status:** `[ ]` queued · `[A]` in-flight · `[x]` closed · `[D]` deferred (deliberate; never a next step, never blocks completion).
**Version:** `v<block>.<step>`; carrier starts at `v0.0`.
**Table format is load-bearing:** the tick engine greps rows shaped exactly
`| <block> | <b>.<s> | v<b>.<s> | [ ] | <description> |` — five columns, one row per step.

---

## Block 0 — Honest substrate boundaries

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 0 | 0.1 | v0.1 | [x] | Mesh-only boundary — closed 2026-07-20: retirement semantics in harness-sync (report+apply+fresh-deploy; 2 apply-path gaps caught live), 3 rules retired, deployed 13→10 with hyperagent NONE + user edits preserved, prompt-side retired guard, synthesis runbook; suites 28/0 |
| 0 | 0.2 | v0.2 | [x] | Cohort provenance — closed 2026-07-21: 7 additive columns + validation (invalid class throws; NULL=unknown, cohort-ineligible), mechanical derivation in the single producer funnel (6 sites), scratch-DB override for real-funnel tests, CLI Class/Run columns; production migration observed live (1|unknown); suites 46/0 |
| 0 | 0.3 | v0.3 | [x] | Honest evidence report — closed 2026-07-21: cohortReport(runId) deterministic aggregation + CLI `report --run` (JSON artifact); fixture proves distinct-logical-task counting, exclusions, induced-vs-natural split, byte-identical reruns; deployed-CLI production run sha-identical twice; suites 47/0 |

> **0.1 — Goal:** HyperAgent has exactly one production telemetry lane — mechanically recorded mesh work; local sessions are no longer prompted to log, consult, or synthesize.
> **Needs:** operator approval (recorded 2026-07-20, D1); federation D13; the mechanical consultation+telemetry writer in bin/mesh-agent.js (live since the 07-20 remediation); config/harness-rules.json carrying the 3 hyperagent-* rules; bin/harness-sync.js managed-rule update path.
> **Feeds:** 0.2's uncontaminated producer; 2.2's cohort purity; token savings on every companion prompt; the synthesis runbook 2.2's execution rule 5 depends on.
> **Verify:** `code:` no global harness rule references hyperagent log/consult/synthesize (grep + harness-sync test); mesh-agent still consults approved strategies and records completion mechanically (existing integration tests green). `runtime:` one mesh completion (mock provider under MESH_ALLOW_MOCK_WORKERS is acceptable — this proves the WRITE PATH is mechanical, not worker quality) writes a telemetry row with no LLM-issued logging command; the DEPLOYED harness-rules.json on this node carries no hyperagent rules after sync.

> **0.2 — Goal:** every telemetry row is mechanically assignable to or excludable from an evidence cohort — no free-text interpretation.
> **Needs:** 0.1; the additive #ensureColumn migration pattern in lib/hyperagent-store.mjs; stable mesh task/session ids in bin/mesh-agent.js + bin/mesh-task-daemon.js.
> **Feeds:** 0.3 filtering; 2.2 cohort accounting; 3.1's future stratification.
> **Verify:** `runtime:` one real-class and one mock-class task produce rows a single SQL query separates without reading meta_notes; both retain task/session/node/soul/provider/model/mode. `code:` invalid execution_class fails loudly; migration test preserves existing rows (queryable as execution_class=unknown, ineligible for cohorts).

> **0.3 — Goal:** one command reproduces the exact cohort accounting the final report will use.
> **Needs:** 0.2 fields; a declared run_id convention.
> **Feeds:** 2.2's runtime gate; 2.3's audit tables; 1.2's read-only page data.
> **Verify:** `code:` fixture with duplicated worker rows + mock rows + chaos failures reports correct distinct-logical-task count and exclusions. `runtime:` the command emits byte-identical JSON from the same DB snapshot + run_id, twice.

## Block 1 — Operator surfaces (the gate stays CLI-only)

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 1 | 1.1 | v1.1 | [ ] | Durable idempotent notifications for BOTH pending reflections (amendment — replaces the removed prompt rule as the synthesis signal) and pending proposals; ledger-deduped, atomic with row creation |
| 1 | 1.2 | v1.2 | [ ] | Read-only MC evidence/proposals page — cohort accounting + reflections + proposals; zero mutation routes; drizzle stub reconciled or dropped |

> **1.1 — Goal:** a pending reflection or pending proposal always produces exactly one operator signal, surviving crashes between creation and delivery — reflections included because 0.1 removes the prompt rule that used to announce them and 2.2's 24h synthesis window must not expire silently.
> **Needs:** ha_reflections pending-synthesis semantics + ha_proposals (live); openclaw-notify ledger dedup; a durable outbox location decided in Phase 1 (log in DECISIONS).
> **Feeds:** 1.2 click-through; 2.2 execution rule 5 (operator triggers synthesis on the reflection notification) and rule 6 (proposals observed, never approved mid-cohort).
> **Verify:** `runtime:` create one pending reflection and one pending proposal; interrupt delivery once, retry twice → exactly one ledger event each (`hyperagent-reflection:<id>`, `hyperagent-proposal:<id>`), source `hyperagent`, click-through URL. `code:` concurrent retries keep one event identity; creation+obligation atomic (crash-window test).

> **1.2 — Goal:** the operator can inspect evidence and pending proposals in MC without gaining a second approval path.
> **Needs:** 0.3 report; 1.1 notifications; MC conventions (federation mc batch); runtime ha_* schema — the mismatched hyperagent_proposals drizzle stub reconciled to a read-only mapping or dropped.
> **Feeds:** 2.2 observation; 2.3's report links; operator follow-through once proposals exist.
> **Verify:** `runtime:` a proposal seeded in a DISPOSABLE db renders; its notification opens the page. `code:` route inventory GET-only (no POST/PATCH/PUT/DELETE); page DB handle opened readonly. `visual:` operator confirms evidence + proposal detail legible.

## Block 2 — The evidence cohort

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 2 | 2.1 | v2.1 | [ ] | ⛔ OPERATOR-GATED preregistration: cohort manifest signed BEFORE outcomes visible — consecutive enrollment ≥20 real tasks, ≥2 domains ≥5 each, D11 providers, spend ceiling, outcome rubric, exclusion rules |
| 2 | 2.2 | v2.2 | [ ] | Execute the cohort: complete telemetry→reflection→synthesis→proposal path observed with ZERO mid-cohort tuning/approvals; any gate breach fails the run (new run_id, no dataset patching) |
| 2 | 2.3 | v2.3 | [ ] | ⛔ OPERATOR-GATED evidence report + disposition: reproducible aggregates, failure taxonomy, 5-binary proposal rubric, continue/revise/park recorded |

> **2.1 — Goal:** inclusion, labels, judging, and spend fixed before any outcome is visible — the anti-cherry-pick contract.
> **Needs:** 0.1–1.2 closed; D11 worker path authenticated; operator-selected domains + spend ceiling + task acceptance criteria; one named node/soul scheduled for ≥5 eligible rows (threshold reachability). **HARD GATE: `visual:` — a headless tick MUST BLOCK here.**
> **Feeds:** 2.2's executable manifest; 2.3's decision rules; co-scheduling with federation 3.5's window (separately accounted — execution_class keeps the ledgers apart).
> **Verify:** `visual:` operator signs manifest + ceiling before the first eligible task. `code:` manifest validates; its run_id accepted by the producer.

> **2.2 — Goal:** the complete HyperAgent path observed on real work with frozen behavior — integration and usefulness evidence, NOT calibration.
> **Needs:** 2.1 signed; daemon + ops.hyperagent watcher healthy; pre-run DB snapshot; D11 workers live.
> **Feeds:** 2.3; the 3.1/3.2/3.3 un-defer triggers.
> **Verify:** `runtime:` ≥20 distinct eligible logical_task_ids with 100% telemetry accountability; ≥2 domains at the 5-task floor; every counted row execution_class=real with full provenance; ≥1 node/soul group crosses 5 rows; ≥1 daemon-created reflection synthesized inside its 24h window (operator triggered via the 1.1 notification); every proposal (if any) has one ledger identity + renders in MC; ZERO strategy approvals + zero un-gated mutations during the cohort; spend + wall-clock recorded against the ceiling. Any breach → fix substrate, new run_id.

> **2.3 — Goal:** one auditable verdict: does the observational loop merit further investment.
> **Needs:** 2.2 complete; immutable post-run snapshot; 0.3 report output. **HARD GATE: `visual:`.**
> **Feeds:** continue/revise/park; explicit 3.x un-defer triggers.
> **Verify:** `visual:` operator signs report + disposition. `code:` every aggregate reproducible from archived snapshot + manifest + report JSON. Decision rule: causal-trial design (3.1) only if ≥1 proposal scores 4/5 with evidence-traceable AND domain-bounded passing and the operator names an explicit treatment + outcome; zero qualifying proposals = park or revise, never a retroactive rubric loosening.

## Block 3 — DEFERRED (explicit un-defer triggers, IMPLEMENTATION_PLAN §6)

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 3 | 3.1 | v3.1 | [D] | Causal trial protocol — only after 2.3's usefulness rule passes; treatment application, assignment, strata, predeclared decision rule; D13 human gate before any treatment |
| 3 | 3.2 | v3.2 | [D] | Controlled taxonomy — only if >10% rows need post-run domain correction, or unknown/other >10%, or synonym labels alter a grouping |
| 3 | 3.3 | v3.3 | [D] | Retention/archival — only after 30 days production, 1000 real rows, or 100MB ha_* (archive, never delete; lineage preserved). Threshold tuning additionally deferred until ≥3 completed reflection windows + ≥50 real logical tasks |
