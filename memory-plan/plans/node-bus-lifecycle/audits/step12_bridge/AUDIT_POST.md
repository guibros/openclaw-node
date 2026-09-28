# Step 1.2 — AUDIT_POST

## 1 — Promised versus landed

| Promise | Landed | Evidence |
|---|---|---|
| Narrow existing bridge lifecycle repair | yes | Source 9056e59: drain ownership at the existing boundary, error-bearing permanent close remains exit 1, actual-closed check before completion. |
| Real owned-process regression controls | yes | Ten controls on installed Node 22/24 and staged e57; unmodified TERM and both weakened completion/error conditions fail. |
| Isolated full CI | yes | Tests f2e13d2, run 36439869824: Node 20, Node 22 and Mission Control green. |
| Independent source challenge | yes | Claude message 96: 10/10, timing sweeps and weakened mutants rejected; exact source approved. |
| Preserve live source and unit drift | yes | 1,911 tracked files compared; only bridge differs. Exact unit environment resolves nats/better-sqlite3/nkeys.js identically; cwd unset and all other unit values preserved. |
| Actual managed planned stop | yes | 2026-09-28 11:11 EDT: PID 26682 exits 0 with one Bridge stopped; managed replacement 26822, runs 2. Same-connection subscribers 1→0→1, fresh wake and idle reconcile. |
| Preserve task states and unrelated services | yes | 537 task status/owner/trigger/updated rows and Kanban bytes unchanged across both attempts; eight unrelated service PIDs and primary checkout status unchanged. |

## 2 — Greppable deltas

`rg -n 'draining|isClosed' bin/mesh-bridge.js`: boundary-owned flag, clean-close condition, actual closure before completion.
`node --test test/mesh-bridge-lifecycle.test.mjs`: ten real-process controls with owned authenticated servers and state.
`RUNTIME_EVIDENCE.json`: immutable source/base, staged byte hashes, managed exit/restart, subscription connection IDs and exact acceptance checks.

## 3 — Cross references

PR #146 carries the reviewed source and tests. The live entry preserves e57's surrounding tree in the bridge-only release. Recovery 1.2 remains in flight: no healthy bus store has been cold-copied. Worker 1.3 and separate task-daemon outage follow-up 1.4 remain queued. Plan-engine shim stays unloaded.

## 4 — Findings

[POSITIVE] Permanent loss remains exit 1 even after a stop request and in late request-subscription drains. Completion requires actual closed state.
[POSITIVE] The corrected live check records actual process exit, one completion, successful managed startup/reconcile/wake, no new Fatal stderr, and no NATS status during this specific stop slice. No forced stop was needed.
[NEGATIVE] The first live harness published wake before subscriptions existed and refused readiness. Its rollback and failure journal remain separate; incidental rollback completion is not acceptance. The corrected attempt waits for one connection holding both subscriptions before publishing.
[NEGATIVE] A routine pingTimer is healthy; future connected-window checks must allow it while refusing connection/error/topology statuses. This accepted slice contained no status lines.
[NEGATIVE] Existing unawaited Kanban updates and async event handlers are not application-work drain. These remain node-readiness 4.1; the strict idle/producers/ack gates stay in force.
[NEGATIVE] Narrow staged releases can be overwritten by later general service deployment. Reproducible revision/service reconciliation remains node-readiness 1.5; recorded provenance is not a deployment reconciliation mechanism. Re-rendered service templates can revert the entry; npm operations in the primary change linked dependencies. Re-check entry hashes and createRequire paths plus package versions before preservation.

## 5 — Phase-8 corrections

Candidate 737a713 was rejected by the default-poll outage counterexample before deployment. Source 9056e59 requires error-free close and actual closure. Tests f2e13d2 cover normal prior-request, default request-subscription outage and late permanent-close cases, including both independently rejected mutants. Runtime harness fixed only its readiness ordering and added lock/reconcile, dependency, stderr and sampled subscription-gap checks. Source bytes did not change after source approval. Claude message 100 approves closure with no blocker. The idle live reconcile contains no existing mesh ID; prior-request owned fixtures alone cover that path. Stderr is zero bytes with its modification time preceding both attempts: stop-window delta 0.

## 6 — Carry forwards and Feeds landing

The existing bridge unit now consumes ~/.openclaw/releases/bridge-drain-9056e59-e57f89b/bin/mesh-bridge.js. Its connected idle planned-stop evidence satisfies the bridge portion of recovery's gate. Worker 1.3 and task-daemon outage 1.4 precede preservation retry. Active application work remains parent 4.1, source/runtime revision reconciliation parent 1.5, and common SQLite/bus/file recovery point child recovery 1.3.
