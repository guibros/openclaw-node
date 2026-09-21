# AUDIT_PRE — step 2.1 · Enforce STOP and ESCALATE

## §0 Micro Re-Orient
- **Where:** foreman plan, Block 2 (enforcement), step 2.1 of 2; plan at v1.1.
- **Last step changed:** 1.1 landed the supervisor loop in shadow mode with the `onIntervention` seam.
- **This step contributes:** the supervisor's decisions act on the worker process; the agent's attempt loop consumes stops and escalations.
- **North-star line served:** federation D16 (deterministic pipeline) — the management layer that stops, retries and escalates workers without votes.
- **Still the right next step?** Yes — operator instruction 2026-09-21; D2 records the ruling that replaces the shadow-evidence pre-screen.

## §1 Intent
A stuck or off-track worker is stopped by the supervisor the moment the policy says so, retried with the reason and guidance in its prompt, and a task the supervisor escalates is released for human triage instead of burning attempts.

## §2 Design (D2)
`supervisor.stopActiveWorker()` — SIGTERM the attached child's process group, SIGKILL after `stop_grace_ms`; the cycle calls it for STOP_WORKER and ESCALATE (the latter also sets `state.escalation`). `runLLM` spawns `detached: true`. The attempt loop reads `state.last_stop` for the current attempt: stop → `stopped by Foreman — <reason>` attempt record (result = guidance) and the existing backoff/retry; escalation → break to the release path, reason prefixed.

## §3 Risk register
| Risk | Mitigation |
|---|---|
| False STOP on a healthy worker | thresholds 0.80; one attempt lost, retried with guidance; ceiling + `max_retries` from `MESH_MAX_ATTEMPTS`; release (not loss) at the end |
| Killing the wrong process | only the attached child's group (`-pid`), never the agent's own |
| `detached` changes signal semantics | the `timeout` option still kills the leader; grandchildren orphaned exactly as before |
| Assessor junk | passthrough on failure unchanged |

## §6 File-delta outline
- `lib/foreman/supervisor.mjs`: `terminate`, `stopActiveWorker`, `assessNow`, `escalation`/`last_stop` state, enforce default
- `bin/mesh-agent.js`: `detached: true`; foremanStop / escalation handling in the attempt loop; release reason
- `test/foreman-enforcement.test.mjs` (real detached children); `test/foreman-supervisor.test.mjs` updates
- docs, silo ledgers
