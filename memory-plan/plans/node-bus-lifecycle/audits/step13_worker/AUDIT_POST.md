# Step 1.3 — AUDIT_POST

## 1 — Promised versus landed

| Promise | Landed | Evidence |
|---|---|---|
| Existing worker lifecycle repair | yes | Source 69b7f37: own the drain at its boundary, suppress only error-free deliberate close, require actual closure before completion. |
| Owned real-process regressions | yes | Nine controls on Node 22/24 and staged e57; unmodified planned stop fails, removal of either closure condition fails its negative control. |
| Isolated full CI | yes | Exact source 69b7f37, run 36447265256 attempt 2: Node 20/22 and Mission Control green. First attempt's unrelated setup collision is retained in CI_EVIDENCE.json. |
| Independent source challenge | yes | Claude message 114: exact source 9/9, late and early repeated controls, both weakened mutants rejected. |
| Preserve runtime drift | yes | 1,911 tracked files compared; only worker entry differs. Actual unit module resolutions unchanged. KeepAlive=false, RunAtLoad=false, unset cwd and actual worker workspace preserved. |
| Actual managed stop/restart | yes | 2026-09-28 12:09 and 12:12 EDT: each natural exit 0 with one completion and explicit managed restart. Supplemental check follows old CID292231 to absence, rejects any foreign node holder, and verifies replacement CID292648. |
| Preserve state and unrelated owners | yes | 537 Mission Control task rows and Kanban bytes unchanged; core service PIDs, primary checkout and actual worker workspace HEAD/status unchanged. |

## 2 — Greppable deltas

`rg -n 'draining|isClosed|Draining NATS' bin/mesh-agent.js`: the drain boundary, error-free deliberate close, actual closure and observable start.
`test/mesh-agent-lifecycle.test.mjs`: actual null-claim readiness, held real drain, production 15s polling, calibrated late permanent loss and early ordering.
`STAGE_EVIDENCE.json`, `CI_EVIDENCE.json`, `RUNTIME_EVIDENCE.json`: immutable source/base, staged hashes, isolated CI and actual managed runtime.

## 3 — Cross references

PR #147 owns this worker change. The existing unit consumes the worker-only e57 release. Recovery 1.2 remains in flight without healthy cold bus masters. Separate task-daemon outage 1.4 remains queued. The plan tick remains unloaded.

## 4 — Findings

[POSITIVE] Both real managed stops exit normally without forced termination; each has one completion and a loaded/no-PID/last-exit-0 gap before explicit kickstart. Fresh actual null worker claims, idle alive RPC, queue/recruit/lease/kept-branch checks and continuous passive admission monitoring establish the idle precondition.
[POSITIVE] Supplemental stop proves the old connection disappeared, no foreign holder was admitted and the replacement holds all worker subscriptions on one connection. Direct closed-CID monitoring independently records Client Closed at 12:12:00.385071 EDT. The observer also closed normally.
[NEGATIVE] Attempts 1/2 refused because the passive observer itself held approved/rejected subscriptions. Their rollback journals remain private. Exact server-assigned observer CID exclusion corrects only verification tooling. No source acceptance is inferred from either attempt.
[NEGATIVE] The earlier claim that closed records were unavailable was a limited-page filtering error. Direct CID lookup returns them. A separate read-only check proves observer INFO and connz server IDs agree. With reconnect disabled, connection/error events abort the guard; healthy pingTimer is allowed. Total connections changed 13505→13514 over 134 seconds on the standalone; other two servers stayed at 10/2. This is not 10,000-entry eviction during the stop.
[NEGATIVE] Agent-state is absent by existing design on startup/null claims; stale state is not idle proof. Nine old runtime directories are unchanged. Future task-ID collision cleanup can delete unowned directories and remains parent 4.1.
[NEGATIVE] General application-handler drain is unproven. Current-main terminal-task handling remains absent from the e57 release. Service reinstallation can replace its entry; primary dependency operations change linked modules. These feed parent 4.1, 1.5 and 2.2.

## 5 — Phase-8 corrections

Calibrated loss uses actual disconnect/permanent-close timestamps, bounded timing-miss retries and immediate failure on false success. Held repeated signals follow the actual drain marker. The corrected runtime harness excludes only the named owned observer's exact CID; the supplemental gap immediately rejects foreign holders and follows the prior worker connection directly. These corrections changed no approved source bytes. Claude message 121 approves runtime closure. Static inspection of the actual staged e57 task-time Foreman/HyperAgent ESM graph finds 14 files and no missing relative modules. Unlike current-main, e57 imports better-sqlite3 through sqlite-store; actual ESM resolution reaches the same primary node_modules package (TASK_IMPORT_EVIDENCE.json). This does not execute a task.

## 6 — Carry forwards and Feeds landing

The managed worker consumes ~/.openclaw/releases/worker-drain-69b7f37-e57f89b/bin/mesh-agent.js. Its idle connected stop satisfies the worker portion of recovery's strict gate. Task outage 1.4 precedes the preservation retry. Read-only observers must bind INFO client/server IDs to the monitored server and abort on reconnect/error; future preservation requires observers themselves closed before all-client-zero proof. Full node readiness, active handlers, retained worktree ownership, revision/dependency reconciliation and two-machine execution remain open. Exercise foreign-holder refusal on an owned server before reusing the guard for preservation. Keep the task daemon available until the worker exits: anchored idle stop can take 15s against launchd’s default 20s timeout. KeepAlive=false means the permanent-loss log does not imply automatic restart; restoration needs explicit kickstart.
