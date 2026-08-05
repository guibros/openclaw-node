# pair3-natsresolve — post-suspension contamination evidence (RUN_RULES clause 5)

Recorded both-forfeit (tie, counts against grappe) stands as the mechanical application of the
rules. The infra layer, for the operator's clause-5 assessment:

- The host suspension (see pair2-deploydoc/INFRA_EVIDENCE.md) ended ~15:07Z; pair 3 began at
  15:07:41Z into its immediate aftermath.
- **Solo**: claimed by bench-w1 at 15:17Z; its claude subprocess ran ~2 h (heartbeats until
  17:18:10Z) — through the 60-minute spawn timeout that should have killed it — then the task
  flipped `failed` after 1 attempt. A post-wake zombie/degraded call, not a normal model
  failure profile (all other solos completed in 1–5 minutes).
- **Grappe**: submitted at ~16:07Z while bench-w1 was still consumed by the zombie call; with
  only 2 of 3 agents free the session could never recruit (observed at init/arts=0 for its
  whole life) and was swept aborted at 17:18:11Z — seconds after w1 finally freed.
- Fleet self-recovered at 17:18Z: pair 4's solo claimed and executing normally (started
  17:18:17Z).

Assessment: every failure in this pair postdates and traces to the demonstrated host
suspension. Stronger clause-5 rerun case than pair 2 (whose session was hollow before the
freeze). Recorded for the operator's ruling at run end; the driver continues sequentially and
nothing was rerun unilaterally.
