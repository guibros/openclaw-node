# PIPELINE_MODE_SPEC — the deterministic federation work unit

**Status:** DESIGN. Specified 2026-09-19 under the federation `pipeline-mode-spec-2026-09-19`
scope. Not implemented (step 2.7), not benchmarked (step 2.8). The plan remains BLOCKED — per
D15/D16 `BLOCKED.md` comes down only when the step-2.8 benchmark passes, never on this document.

**Authority.** D16 (operator ruling, 2026-08-05) defines the redesign door D15 left open:

> the eventual federation will work by itself as an automated prompt-response-ingestion-response
> system — not a "do you think it's good."

This document is the mechanical binding of that sentence. Where it disagrees with
`docs/circling-strategy-implementationV2.md` / `V3.md`, those are history (D16 consequence 1) and
this governs.

---

## 1. The law

A federation work unit is a **fixed-pass deterministic pipeline**. Passes are counted, not
judged. The result **ships unconditionally** when the last pass ends.

```
pass 1  DRAFT     worker   task                        → workArtifact
pass 2  REVIEW    reviewA  task + workArtifact         → reviewArtifact.A   ┐ parallel
                  reviewB  task + workArtifact         → reviewArtifact.B   ┘
pass 3  REVISE    worker   task + workArtifact + {any
                           reviewArtifacts that landed} → finalArtifact
                                                        → status: completed
```

Three passes is the default (`passes: 3`), matching D16's "draft → reviews ingested → revision".
`passes` is fixed at session creation and never changes during the run.

**The load-bearing invariant:**

> **No participant's output is a precondition for the session reaching a terminal state.**

Every pass has a deadline and a defined behaviour on absence. A reviewer that dies, wedges,
loops on a parse failure, or simply says nothing **degrades the artifact's quality and never its
availability**. This single invariant is what D15 falsified in circling, and it is the one thing
step 2.8 exists to test.

---

## 2. What is removed, and why each one could hang

D15's failure was reliability: **3 of 5 run-2 pairs produced no grappe artifact at all**. The
circling path in `lib/mesh-collab.js` carries **three independent ways to hang**, all of which
the collector and driver observe as the same symptom. Pipeline mode removes all three.

| # | Mechanism | Where | How it hangs |
|---|---|---|---|
| 1 | **All-nodes barrier** | `isCirclingStepComplete()` — advances only when `stepReflections.length >= activeNodes.length` | One silent node that is not marked `dead` stalls the step forever. Liveness depends on every participant. |
| 2 | **Unanimity vote** | `checkConvergence()` + `CONVERGENCE.UNANIMOUS` (default) — requires `convergedCount === reflections.length`; **any** parse failure makes unanimity unreachable | The session can run its full sub-round budget and still hold, because agreement is a precondition for advancing. |
| 3 | **Automation-tier gate** | `advanceCirclingStep()` — sets `needsGate = true` on finalization entry when `automation_tier >= 2`, and on sub-round advance at tier 3 | A human gate inside the flow. RUN_RULES clause 2 makes it an immediate forfeit, and no human approves during a benchmark. |

Removed from the forward design, in full:

- `session.convergence` — the whole block (`type`, `threshold`, `metric`, `min_quorum`).
- `CONVERGENCE.UNANIMOUS` / `.MAJORITY` as flow control.
- the `vote` field on reflections — **a review carries findings, not a verdict**.
- `current_subround` / `max_subrounds` and the conditional sub-round loop — passes are counted,
  never re-entered on disagreement.
- `needsGate` and every `automation_tier` branch **inside** the pipeline.

An operator gate on the *delivered* artifact is still permitted, and belongs downstream of
`status: completed`, where it cannot withhold the artifact from the collector.

Existing circling code and tests stay as history (D16 consequence 1). Nothing new builds on them.

---

## 3. Termination — three counted terminators

Borrowed, deliberately, from the shape MetaGPT's `Team.run()` has used since 2023 (§8).

**T1 — passes exhausted (primary).** The loop is `for pass in 1..passes`. When the last pass
ends the session goes terminal. This is the normal exit and it is unconditional.

**T2 — per-pass deadline.** Each pass carries `pass_budget_ms`. When it expires the pass closes
with whatever artifacts arrived, and the pipeline advances. Per-pass behaviour on absence:

| Pass | Artifact missing at deadline | Behaviour |
|---|---|---|
| DRAFT | `workArtifact` absent | **Terminal FAILED** — there is nothing to review or revise. The arm produced no artifact; this is an honest failure, not a hang. |
| REVIEW | one or both `reviewArtifact`s absent | **Advance.** REVISE ingests what landed. Zero reviews is legal — the pipeline degenerates to draft-then-revise. |
| REVISE | `finalArtifact` absent | **Terminal, shipping `workArtifact`** as the result, flagged `degraded`. The draft is a real artifact; withholding it because the revision timed out would reintroduce exactly the availability coupling D16 forbids. |

**T3 — cost ceiling.** `max_cost_usd` on the session. Cumulative usage crossing it closes the
current pass immediately (T2 path for whoever has not spoken) **and completes the session — no
further pass opens.** A ceiling that only closed one pass and let the next one spend would not be
a ceiling; this is MetaGPT's `NoMoneyException` shape (§8): the loop stops, what exists ships.
D15 measured **$20.07 vs $1.81 (~11×)** *after the fact*; a ceiling makes cost a first-class
terminator instead of a post-mortem observation. *(Sharpened 2026-09-21 at step 2.7 — the
implementation made the "closes and completes" reading explicit; recorded in
`audits/step27_pipeline-mode/AUDIT_PRE.md` §7.)*

There is no fourth terminator. In particular there is no "converged", no "approved", no
"finalized" — nothing whose truth depends on a participant's opinion.

---

## 4. The degradation ledger

Because passes ship with holes, the session records every hole:

```
degraded: [ { pass, node_id, reason, observed_at } ]
```

`reason` ∈ `timeout` · `parse_failure` · `node_dead` · `cost_ceiling` · `never_submitted`.

This is how D16's closing clause is honoured — *"Quality is judged downstream by use and by
evidence programs (blind scoring, telemetry), never by polling the participants."* The ledger
lets 2.8 correlate blind score against degradation, which is the question that actually matters:
**does a pipeline that never blocks still produce the artifact quality the grappe demonstrably
had?** D15's honest counter-evidence says the quality was real — the grappe won both blind
comparisons it reached, 21-18 and 20-15. The ledger is what will prove or refute that it survives
the removal of the gate.

A session with a non-empty `degraded` ledger is **still a contract-compliant delivery.** It is
not a forfeit, not an infra failure, and not rerun-eligible (§7, new clause 7).

---

## 5. Session schema delta

Against the current `createSession` shape in `lib/mesh-collab.js`:

```
+ architecture: 'pipeline'            // → COLLAB_MODE.PIPELINE, a fourth entry in ARCHITECTURE_MODE
+ pipeline: {
+   passes: 3,                        // fixed at creation
+   current_pass: 0,                  // 0=init, 1=draft, 2=review, 3=revise
+   pass_budget_ms: <int>,
+   max_cost_usd: <float|null>,
+   worker_node_id, reviewerA_node_id, reviewerB_node_id,   // stable identity, as circling
+   artifacts: { workArtifact, reviewArtifacts: {}, finalArtifact },
+   degraded: []
+ }
- convergence: { … }                  // removed entirely
- circling: { current_subround, max_subrounds, … }          // not populated for this mode
```

`pipeline` is populated only when `architecture === 'pipeline'`, null otherwise — the same
conditional-population pattern `cooperative` and `collaborative` already use.

Role assignment reuses circling's 1-worker + 2-reviewer shape and its stable
`reviewerA_node_id` / `reviewerB_node_id` identities, assigned at recruiting close. Pipeline mode
changes the *protocol*, not the grappe topology.

---

## 6. Collector contract

`bin/fed-benchmark.mjs`'s strict collector currently demands a finalization pair — `workArtifact`
≥400 chars **plus** a `completionDiff` at step 0 of the highest sub-round. Pipeline mode has no
sub-rounds, so 2.7 must teach the collector this mode's terminal shape:

- **accepts** `status: completed` with a non-empty `finalArtifact` ≥400 chars;
- **accepts** a `degraded` T2 delivery shipping `workArtifact` ≥400 chars, recording the ledger
  alongside the score;
- **rejects** `status: failed` (DRAFT never landed) — that is a genuine contract failure and the
  arm forfeits under RUN_RULES clause 1.

The ≥400-char floor carries over from D14 unchanged. A collector rejection of a terminal session
remains a grappe contract failure, exactly as in the D14 rules.

---

## 7. What this spec does NOT claim

Stated plainly, because this repo's whole discipline is about not confusing existence with
evidence:

1. **This is not evidence.** No line here discharges D3's ≥4-of-5 bar. D15 is explicit that a
   redesigned protocol must preregister anew, with no reuse of run-2 artifacts.
2. **Prior art is not proof.** §8's corroboration says the shape is buildable and widely built.
   It says nothing about *this* grappe's output quality.
3. **Reliability is the hypothesis, not the result.** The claim "a silent reviewer can no longer
   stall the session" is a design intent until 2.7's runtime verify observes it.
4. **Block 4's 3/5 quorum is now incoherent** and must be re-derived before anything in it is
   built — D16 consequence 4 already says this. Steps 4.1 and 4.3 name quorum approval in their
   contracts; they are wrong as written and are not this batch's to fix.

---

## 8. Prior art — MetaGPT (corroboration, not evidence)

`github.com/FoundationAgents/MetaGPT`, MIT, ~70.5k stars, default-branch tip 2026-01-21
(examined at that commit; the project has slowed — `dev` is stale since 2024 — so this is a
reference, never a dependency, and it is Python 3.9–<3.12 against our Node runtime).

It is the most-forked multi-agent framework in existence and its coordination core contains **no
agreement machinery at all**:

```
grep -rniE "\b(vote|quorum|consensus|unanimit)\b" metagpt/ --include=*.py
```

returns hits only in the Werewolf *game* simulation (voting is the game's subject), one
self-consistency retry in `actions/requirement_analysis/evaluate_action.py:58` (one LLM asked 3×,
first repeated answer wins — not inter-agent agreement), and an AFlow optimizer prompt.

Two shapes worth copying, both already reflected above:

- **`team.py:127`** — `while n_round > 0: if env.is_idle: break; n_round -= 1;
  _check_balance(); await env.run()` then `env.archive()` and return. Round count, idleness and
  budget; no convergence check; the artifact is archived on loop exit. §3's T1/T3 are this.
- **`utils/cost_manager.py:31`** — `max_budget` with `NoMoneyException` raised from the team
  loop, making spend a termination condition of equal standing to completion. §3's T3 is this.

One shape worth *avoiding*: the newer `MGXEnv` + `TeamLeader` path
(`roles/di/team_leader.py:75`) reintroduces dynamic LLM routing, where a leader decides at
runtime who works next. That is the opposite of determinism and is not borrowed.

---

## 9. Operator decisions still open

These are locked at 2.8's preregistration, not here. Listed so they are not silently defaulted:

1. **Slate** — a fresh five tasks, or the same five under a new frozen SHA and new run id.
   BLOCKED.md permits either; D15 forbids reusing run 2's *artifacts* as evidence.
2. **Cost bar** — D15 recorded ~11× as an observation with no bar attached. Whether a cost ratio
   becomes a pass/fail criterion is the operator's call. Inventing one here would be exactly the
   retroactive bar-setting D3 forbids, so `RUN_RULES.md` preregisters cost as a **recorded
   metric** only unless the operator says otherwise before run start.
3. **`passes`** — 3 is D16's literal sentence. A 5-pass variant (draft → review → revise →
   review → revise) is a legal instance of the same law, and costs roughly another LLM round per
   node. Not proposed; available.
