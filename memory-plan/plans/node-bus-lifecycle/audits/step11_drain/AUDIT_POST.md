# Step 1.1 — AUDIT_POST

## 1 — Promised versus landed

| Promise | Landed | Evidence |
|---|---|---|
| Main-local planned-shutdown ownership | yes | Source 0f2e148: four added lines in the existing daemon. |
| Real owned-process regression controls | yes | Node 22.22.0 and 24.13.0: 4/4 each; old SIGTERM fails, unexpected loss remains exit 1. Staged e57: 4/4. |
| Isolated full CI | yes | Run 36433715708: Node 20, Node 22, MC all green. |
| Preserve source/dependency/unit drift | yes | 1,911 files compared to e57; only daemon differs. Same real nats/js-yaml/better-sqlite3 resolution under unit env. Cwd unset (`/`) and other unit values preserved. |
| Actual managed planned drain | yes | 2026-09-28 10:27 EDT deployment; completion with last exit 0 and managed replacement. Separate bootout observed subscription 1→0→1. Final actual-RPC-before-signal run accepted 10:31 EDT. |
| No unrelated service owner change | yes | NATS 874/887/858, viewer 35823, gateway 2902, memory 93840 retained in deployment journal. Primary checkout unchanged. |

## 2 — Greppable deltas

`rg -n 'shuttingDown' bin/mesh-task-daemon.js`: main-local flag, closed-callback return, first-signal guard/set.
`node --test test/task-daemon-lifecycle.test.mjs`: four real-process controls.
`RUNTIME_EVIDENCE.json`: immutable source/base, release hash, managed PIDs, dependency paths and exact acceptance outcomes.

## 3 — Cross references

Draft PR #145 carries the reviewed source; the running entry is the private staged e57 release.
Node-state-recovery 1.2 stays in flight. Original healthy stores have not yet received cold copies.
The existing plan-engine shim remains unloaded. D3 corrects actual cwd; D4 queues distinct bridge/worker steps.

## 4 — Findings

[POSITIVE] Claude independently passed 4/4 and rejected six mutants, then approved the idle contract with no blocker.
[POSITIVE] Real managed exit 0, completion line, read-only daemon reply before signal and after restart, and single-instance gap proof passed. No disconnect/reconnect status occurred in accepted shutdown windows; no forced kill.
[POSITIVE] Startup PID presence was correctly distinguished from RPC readiness: one immediate post-restart request hit the subscription startup gap, then bounded read-only readiness succeeded. No production work was triggered by that probe.
[NEGATIVE] Active async handlers remain untracked: Claude reproduced partial collab submission 9/11 times during an active burst, including one silent run. Clean NATS drain is not application-work drain. Preserve idle/producers/ack gates; this feeds node-readiness 4.1.
[NEGATIVE] Bridge and worker have the same separate planned-close race; steps 1.2/1.3 must close before preservation retry.

## 5 — Phase-8 corrections

No source changes after the approved four-line patch. Runtime acceptance incorporated single-instance, read-only readiness, connected-window and dependency checks. Operational fallback uses a bounded supervisor deadline and SIGKILL if required; any forced stop must fail clean-drain acceptance.

## 6 — Carry forwards and Feeds landing

The existing task-daemon unit now consumes `~/.openclaw/releases/task-drain-0f2e148-e57f89b/bin/mesh-task-daemon.js`. Its normal idle completion satisfies the task-daemon portion of recovery's gate. Bridge/worker lifecycle steps are next; the guard is not weakened. General async-handler drain belongs to node-readiness 4.1; deployment revision reconciliation belongs to 1.5. Common SQLite/bus/file recovery point and credential fencing remain child recovery 1.3.
