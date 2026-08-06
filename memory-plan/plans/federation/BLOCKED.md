# BLOCKED — federation plan

**Blocked at:** 2026-08-05 (operator "go" on the 2.6 disposition)
**Blocking authority:** DECISIONS **D3** (a failed premise benchmark is a plan-level BLOCK, not
a step failure) applied to the **D15** verdict.
**Trigger**: step 2.6's premise benchmark closed FAILED — run 2 final tally solo 3 · grappe 2 ·
tie 0, below the D3 ≥4-of-5 bar (D15).
**External action:** the operator makes ONE call — close the federation plan at this verdict, or
approve a redesigned convergence protocol (new DECISIONS entry) to be proven by a NEW
preregistered benchmark. Nothing downstream runs until then.

## Why

Step 2.6's premise contract — *a grappe of OpenClaws produces observably better artifacts than a
solo OpenClaw* — was tested twice under operator-predeclared rules
(`audits/step26_premise-benchmark/RUN_RULES.md`), each from a frozen SHA, with the apparatus
itself repaired, committed, and unit-tested between runs after an operator audit caught a
measurement failure (run 1 preserved as INCONCLUSIVE).

**Run 2 final tally: solo 3 · grappe 2 · tie 0 — below the ≥4-of-5 bar.**

The failure is specifically **reliability**: in 3 of 5 pairs the grappe never produced a
collectable artifact at all, each time because its own finalization vote failed to converge
within budget (the same pattern seen in every pre-run smoke). The plan may not proceed on an
unevidenced premise.

## What is blocked

Everything downstream of the premise: step **3.5** (Phase-1 gate — T3 matrix, 8-cell chaos,
≥12h soak, T7 acceptance) and, behind it, **Block 4** (management grappe) and **Block 5**
(savant grappe). Steps 6.2/6.3 remain independently in-flight as observability work.

## What is NOT blocked, and the honest counter-evidence

Both times the grappe *did* deliver, it **won** the blind comparison under five-dimension
rubric scoring by fresh independent judges with no benchmark context (21-18 on the watcher
contract audit; 20-15 on the kill protocol). The falsified component is the **finalization /
convergence protocol**, not the collaboration concept — at ~11× cost ($20.07 vs $1.81).

## How this unblocks

Exactly one of:

1. **Operator closes the federation plan** at this verdict (worker grappes remain built and
   dormant; management/savant never start), or
2. **A redesigned convergence protocol** is specified, recorded as a new DECISIONS entry, and
   passes a **new preregistered benchmark** (fresh slate or the same five tasks under a new
   frozen SHA and new run id). Delete this file only on that pass.

No partial unblocking. No retroactive loosening of the D3 bar. Evidence:
`audits/step26_premise-benchmark/` (RERUN_LOG, RUN_RULES, slate) and `benchmark/`
(run1-inconclusive-20260804/, pairs-d14/, sealed-d14/, run-d14-r2.log).
