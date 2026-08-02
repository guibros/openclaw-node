# AUDIT_PRE — step 4.1 · Memory cadence and event spine

## §0 Re-orient

- Where am I: Block 4, step 4.1, immediately after governance recovery v3.1.
- Last step changed: plan carriers and public status now point to runtime repair before evidence work.
- This step contributes: one live scheduled path from an idle daemon queue to consolidation/event emission.
- Serves the north star via: a functioning offline memory cadence with observable boundaries.
- Still the right next step? Yes; 359 false-busy skips make every later evidence window less trustworthy.

## §1 Needs pre-screen

- Operator approval: received 2026-08-02 (`gogogogogogog`).
- Canonical MASTER_PLAN and PROTOCOL: reread before scope/implementation.
- Git: clean `main`, synchronized with `origin/main` at `758a86d`.
- Memory daemon: live PID 56266; fresh queue snapshot exported with `current_job`/`queue_depth`.
- Consolidation scheduler: launchd loaded, one-shot log reproduces repeated `/api/ps` false-busy skips.
- NATS: R=3 cluster live; shared resolver can read the one configured token without exposing it.
- Event stream: deployed canonical stream `local-events-moltymacs-virtual-machine` exists; manual
  watcher fallback uses dotted `os.hostname()` and fails before lookup.

## §4 Risks

- A missing/stale queue snapshot must fail closed; treating unknown as idle could race active inference.
- Canonicalizing a valid deployed node id must be identity-preserving so existing streams are reused.
- A new stream with overlapping `local.>` subjects would fail; this step must resolve the existing name.
- Runtime cycle execution can legitimately hit the five-minute hard cap; idle-gate proof and complete-cycle
  proof must be reported separately rather than conflated.

## §6 File deltas

- Scheduler/daemon: consume fresh exported queue state; wire the in-process queue getter correctly.
- Standalone consolidation CLIs: use `nats-resolve` connection options with bearer token.
- Event spine: one canonical local-stream-name helper consumed by producer, watcher, promoter, and probe.
- Tests: queue-snapshot fail-closed/idle/busy cases; stream-name regression; consumer name consistency.
- Plan ledger: Block 4 rows, D9, registry, close audit/version/scope lifecycle.

## Mid-Implementation Findings

- The daemon exported queue state only on its coarse main-loop tick. Short analysis jobs could start
  and finish between exports, letting a nominally fresh idle snapshot overlap real inference. Added
  queue transition observation to the same step: current-job/pending transitions trigger an atomic
  daemon snapshot export. This is required to make the chosen authority current, not scope growth.
