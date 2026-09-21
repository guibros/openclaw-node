# AUDIT_POST — step 2.1 · Enforce STOP and ESCALATE

## §1 Promised vs landed
| §6 delta | Landed | Evidence |
|---|---|---|
| supervisor: `terminate` / `stopActiveWorker` / `assessNow` / `escalation` + `last_stop` / enforce default | yes | `grep -n "stopActiveWorker\|assessNow\|escalation\|stop_grace_ms" lib/foreman/supervisor.mjs` |
| agent: `detached: true`; foremanStop + escalation in the attempt loop; release reason | yes | `grep -n "detached: true\|foremanStop\|Foreman escalated" bin/mesh-agent.js` |
| tests against real detached children | yes | `node --test test/foreman-enforcement.test.mjs` → STOP (SIGTERM), SIGKILL fallback, ESCALATE, shadow leaves the worker alone |

## §2 Greppable deltas
- `node --test test/foreman-*.test.mjs` → all green (count in the closing commit).
- `npm test` → green (count in the closing commit).

## §4 Findings
- [POSITIVE] Real process-group termination is tested with a child that ignores SIGTERM — the SIGKILL fallback is proven, not assumed.
- [NEGATIVE] First cut of that test signalled the child during Node's startup, before its handler existed, and read as SIGTERM; the test now waits for the worker's first output. Same class of race a real stop could hit in the first ~50 ms of a worker's life — harmless there (the worker just dies faster).
- [NEGATIVE] The attempt loop's stop/escalation handling in `bin/mesh-agent.js` is still verified by `node --check` and greps only (no NATS in this container). Carry-forward to the integration test named in 1.1's §6.

## §6 Carry-forwards
- Watch the first enforced timelines on the operator's node for false STOPs; `MESH_FOREMAN_ENFORCE=0` is the one-switch retreat.
