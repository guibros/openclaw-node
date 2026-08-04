# RUN_RULES — D14 five-pair execution (PREDECLARED, operator-locked 2026-08-04)

Operator ruling (option 1: lock and run now; no smoke #6; no prompt tuning — "further sampling
risks testing until it passes"). These rules are frozen BEFORE pair 1 begins and may not be
changed, reinterpreted, or appended during the run.

## The symmetric forfeit rule (operator's clauses, verbatim intent)

1. Any arm that fails to produce a contract-compliant, terminal artifact within **60 minutes**
   forfeits.
2. An **unresolved human gate is an immediate forfeit**; gates are NOT approved during
   benchmarking.
3. If **both arms fail**, record a **tie** — which counts against the grappe (D3: ties count
   against).
4. **Usage and wall-clock costs are preserved for forfeits.**
5. Only a **demonstrated external infrastructure failure** (NATS/daemon/host crash evidenced in
   logs) permits rerunning the same pair. Model output quality, scope violations, non-convergence,
   parse failures, and protocol wedges are NEVER infrastructure — they count.
6. **One commit SHA frozen for all ten executions.** No task replacement, prompt adjustment, or
   code change after pair 1 begins. The frozen SHA is the commit that carries this file's final
   pre-run state (recorded in RERUN_LOG at run start).

## Mechanical interpretation (fixed with the rules)

- **Contract-compliant terminal artifact** — solo: KV task `status: completed` with non-empty
  result output. Grappe: session `status ∈ {completed, converged}` AND the strict collector
  accepts it (finalization pair present: workArtifact ≥400 chars + completionDiff at step0 of the
  highest sub-round). A collect() rejection of a terminal session is a grappe contract failure →
  forfeit.
- **Gate-forfeit detection** — a session observed at `phase: complete` with `status: active` on
  two consecutive polls (≥90 s apart) is an unresolved gate → immediate grappe forfeit; the
  session is then aborted with reason (cleanup, not approval).
- **The 60-minute clock** runs per arm, from that arm's submission.
- **Sequential execution** — arms solo→grappe within a pair; pairs 1→5 in slate order
  (`slate/1..5-*.md`, locked at the frozen SHA). Three agents, no concurrent pairs.
- **Forfeit recording** — the pair dir still gets `meta`-grade cost data: `forfeit.json`
  (which arm(s), reason, per-arm usage + wall-clock pulled from KV), plus mechanical
  `key.json`/`score.json` (surviving arm wins with note `forfeit`; both-fail → `tie` with note
  `both arms forfeited — counts against grappe`). No blinding is applicable to a forfeit (there
  is no content to blind); blinded A/B applies only to pairs where both arms delivered.
- **Scoring & verdict** — untouched from AUDIT_PRE/fed-benchmark: operator blind-scores the
  delivered pairs (`score.json`), `tally` unblinds and applies the D3 bar (grappe needs
  ≥ max(4, 80% of scored); ties count against). Forfeit-derived scores enter the same tally.
