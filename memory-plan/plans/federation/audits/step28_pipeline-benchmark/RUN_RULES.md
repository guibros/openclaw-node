# RUN_RULES — step 2.8 pipeline-mode benchmark (PREREGISTRATION DRAFT, not yet operator-locked)

**Status: DRAFT.** These rules are drafted 2026-09-19 alongside `PIPELINE_MODE_SPEC.md`. They
become binding only when the operator locks them — §0 lists the three fields that must be filled
at lock time. **Until locked, no execution may begin.** Once locked they are frozen before pair 1
and may not be changed, reinterpreted, or appended during the run.

**Authority.** D15 (the redesign door), D16 (pipeline mode is what goes through it), `BLOCKED.md`
("the block STANDS until pipeline mode passes a NEW preregistered five-task benchmark under the
committed apparatus"). This file is the "new RUN_RULES revision" that sentence names.

**Lineage.** Revision of `audits/step26_premise-benchmark/RUN_RULES.md` (D14, operator-locked
2026-08-04). Clauses 1 and 3–6 carry over verbatim in force. Clause 2 becomes vestigial. Clause 7
is new. The apparatus — `bin/fed-run-driver.mjs` + `bin/fed-benchmark.mjs` + their tests — is
reused, not rewritten (D16 consequence: "the benchmark apparatus … is now reusable infrastructure
and stays").

---

## 0. Fields the operator fills at lock time

| Field | Options | Locked value |
|---|---|---|
| **Slate** | fresh five tasks · the same five under a new frozen SHA + new run id (BLOCKED.md permits either; D15 forbids reusing run 2's artifacts as evidence) | _unlocked_ |
| **Cost bar** | recorded-metric-only (default, §6) · an explicit pass/fail ratio | _unlocked_ |
| **Frozen SHA** | the commit carrying this file's final pre-run state | _unlocked_ |

Leaving a field unlocked and running anyway is a protocol violation, not a default.

---

## 1. The forfeit rules

1. Any arm that fails to produce a contract-compliant, terminal artifact within **60 minutes**
   forfeits. *(D14 clause 1, unchanged.)*

2. ~~An unresolved human gate is an immediate forfeit.~~ **VESTIGIAL — retained as a tripwire.**
   Pipeline mode has no gate inside the flow (`PIPELINE_MODE_SPEC` §2), so this clause should
   never fire. **If a gate is nevertheless observed, that is a specification violation: the arm
   forfeits and the run is halted pending an operator ruling**, because it means the implementation
   under test is not the protocol that was preregistered. Gates are still NOT approved during
   benchmarking.

3. If **both arms fail**, record a **tie** — which counts against the grappe (D3: ties count
   against). *(D14 clause 3, unchanged.)*

4. **Usage and wall-clock costs are preserved for forfeits.** *(D14 clause 4, unchanged.)*

5. Only a **demonstrated external infrastructure failure** (NATS/daemon/host crash evidenced in
   logs) permits rerunning the same pair. Model output quality, scope violations, parse failures,
   and protocol wedges are NEVER infrastructure — they count. The run-1 regression stands: a
   **>5 minute inter-poll gap ⇒ INFRA_INVALID** (rerun-eligible, never a forfeit), as encoded in
   `bin/fed-run-driver.mjs` and its tests. *(D14 clause 5, with "non-convergence" struck — there is
   no convergence in this protocol to fail.)*

6. **One commit SHA frozen for all ten executions.** No task replacement, prompt adjustment, or
   code change after pair 1 begins. The frozen SHA is recorded in this run's RERUN_LOG at start.
   *(D14 clause 6, unchanged.)*

7. **NEW — degradation is not failure and is not infrastructure.** A missing review artifact, or a
   revision that times out and ships the draft, is *designed* behaviour under
   `PIPELINE_MODE_SPEC` §3–§4. Such a pair is a **contract-compliant delivery**: it is scored
   normally, it is not a forfeit, and it is **not rerun-eligible**. The `degraded` ledger is
   recorded alongside the score. This clause exists to close the obvious loophole — "our reviewer
   died, please rerun" — which would let the arm under test buy retries with its own unreliability.

---

## 2. Mechanical interpretation

- **Contract-compliant terminal artifact** —
  **solo:** KV task `status: completed` with non-empty result output *(unchanged from D14)*.
  **grappe:** session `status: completed` AND the strict collector accepts it per
  `PIPELINE_MODE_SPEC` §6 — a `finalArtifact` ≥400 chars, or a degraded delivery shipping
  `workArtifact` ≥400 chars. `status: failed` (the draft pass never landed) is rejected and the
  arm forfeits under clause 1. A collector rejection of a terminal session remains a grappe
  contract failure.
- **The 60-minute clock** runs per arm, from that arm's submission. *(unchanged)*
- **Sequential execution** — arms solo→grappe within a pair; pairs 1→5 in slate order, locked at
  the frozen SHA. Three agents, no concurrent pairs. *(unchanged)*
- **Forfeit recording** — the pair dir still gets `meta`-grade cost data: `forfeit.json` (which
  arm(s), reason, per-arm usage + wall-clock from KV), plus mechanical `key.json`/`score.json`
  (surviving arm wins with note `forfeit`; both-fail → `tie`). No blinding applies to a forfeit.
  *(unchanged)*
- **Gate-forfeit detection** — the driver's ≥90 s two-observation window stays wired as the
  clause-2 tripwire. It is expected to record zero gate observations across all five pairs;
  a non-zero count is the §1.2 halt condition, and is itself a reportable result.

---

## 3. Scoring — the D15 repairs are now mandatory

Run 2's scoring package had to be rebuilt twice after operator audits. Those repairs are no
longer ad-hoc; they are preregistered requirements:

1. **The key never enters the scorer's path.** `key.json` and in-dir `meta` are sealed outside
   the directory the judge reads. Run 2's package leaked its own arm mapping through per-file
   character counts — the packaging must be verified against that specific leak.
2. **Blinding is content-preserving.** Redaction may not strip the domain vocabulary a task is
   *about*; run 2's first package blinded away the very terms Task 5 concerned.
3. **Fresh, zero-context judges.** Two independent judges per pair, no benchmark context, no
   knowledge of which arm is which, scoring the **full five-dimension rubric**.
4. **Repackaging is from the immutable raw KV artifacts**, with fresh arm flips and recorded
   sha256.

Judges score only pairs where **both** arms delivered. Forfeit-derived scores enter the tally
mechanically, as in D14.

---

## 4. The verdict bar — unchanged

`tally` unblinds and applies the **D3 bar verbatim: the grappe needs ≥ max(4, 80% of scored);
ties count against.** No retroactive loosening, and no tightening either. D15's closing clause
binds: *"Any future iteration must preregister anew — no reuse of this run's artifacts as evidence
for a redesigned protocol, and no retroactive loosening of D3's bar."*

**Passing this bar is the sole condition under which `BLOCKED.md` is deleted.** Failing it does
not silently re-open the door: it returns to the operator as a second negative result on the
premise, and the D15 disposition (close the plan, or approve a further redesign) applies again.

---

## 5. What this run tests that run 2 did not

Run 2 falsified **reliability** — 3 of 5 pairs never delivered, each time at the grappe's own
finalization gate — while the two pairs that did deliver **won** their blind comparisons (21-18,
20-15). Pipeline mode removes the gate. So this run asks one question:

> With the opinion gate gone, does the grappe still deliver — and does the quality that won both
> blind comparisons survive the removal?

Two outcomes are individually informative and must be reported separately rather than collapsed
into the pass/fail verdict:

- **delivery rate** — pairs where the grappe produced a collectable artifact, out of 5. Run 2's
  figure was 2/5. This is the reliability claim under test.
- **blind score among delivered pairs** — run 2's figure was 2 wins of 2. This is the quality
  claim carried forward.

A run that delivers 5/5 but loses the blind scoring falsifies something entirely different from
run 2, and the record must be able to say so.

## 6. Cost

Per-arm usage and wall-clock are recorded for every execution, forfeits included (clause 4).
Run 2 measured **$20.07 vs $1.81 (~11×)**.

Unless the operator locks a bar in §0, **cost is a recorded metric and not a pass/fail
criterion.** Attaching a cost bar after seeing the numbers would be precisely the retroactive
bar-setting D3 forbids; attaching one before run start is the operator's prerogative.

`PIPELINE_MODE_SPEC` §3 T3 gives the session a `max_cost_usd` ceiling. If one is set for this
run, it is declared here at lock time and is identical across all five grappe executions.
