# Step 1.4 — AUDIT_POST

## 1 — Promised versus landed

| Promise | Landed | Evidence |
|---|---|---|
| Reject both task-drain false-success paths | yes | Source a2f5293: error-bearing close remains exit1; drain that returns while open logs failure and explicitly exits1 before completion. |
| Owned real-process controls and mutants | yes | Exact tests6cc27c3: seven Node22/24 and staged-e57 controls pass, no skips. Early default/warn and calibrated late outage exit1 with no completion. Removing either closure check and the warn-mode throw mutant fail. Claude127 independently confirms. |
| Isolated full CI | yes | Source a2f5293 run36452030695 and exact tests6cc27c3 run36453000529: Node20/22 and Mission Control green. |
| Runtime preserves drift and unit/dependencies | yes | 1,911 tracked files compared, only task entry differs. Exact 1.4 hunk on preserved1.1 yields entry17a70c25; original e57 checkout, cwd, supervisor settings and actual module resolution unchanged. |
| Connected managed stop/restart | yes | 2026-09-28 13:23–13:26 EDT: original77486 -> candidate78967 -> replacement79423/runs2/last0. Each stop emits one drain/completion, stderr0; actual same-server oldCID absence/zero-holder gap and newCID/list readiness. |
| State and unrelated owners unchanged | yes | 537 MC task rows, Kanban bytes, all three KV counters, both Git workspaces and all core PIDs unchanged. 65s continuous guard after each ready replacement. |
| Independent closure challenge | yes | Claude141 checked the exact Verify line and accepts closure; outage proof is owned controls, connected-path deployment proof is the live run. |

## 2 — Greppable deltas

`rg -n 'shuttingDown.*err|isClosed|NATS drain did not close' bin/mesh-task-daemon.js`: both narrow failure conditions and explicit failure.
`test/task-daemon-lifecycle.test.mjs`: actual early/late loss ordering, connected TERM/INT, held real drain/repeated signals and warn-mode semantics.
`OWNED_EVIDENCE.json`, `STAGE_EVIDENCE.json`, `CI_EVIDENCE.json`, `RUNTIME_EVIDENCE.json`: immutable code/test/base, hashes, isolated CI and managed acceptance.

## 3 — Cross references

PR148 owns this separate follow-up. The original accepted1.1 release remains intact. The managed task unit consumes the new task-outage e57 release. Recovery1.2 still lacks healthy cold bus masters; no bus was stopped in this step. Parent active-handler4.1 and overall node readiness remain open. The plan tick is unloaded.

## 4 — Findings

[POSITIVE] Outage controls prove the new failure semantics with actual owned daemons and NATS. The managed live run separately proves the connected stop and deployment; it introduces no live outage.
[POSITIVE] Claim anchors precede signals; read-only observer RPCs pause only after their current check finishes. New ready holders/list replies arrive0.397s/0.296s after anchors, inside the15s worker poll. Instant action/KV subscriptions and250ms exact counters stay active through RPC pauses44/361/281ms. 39 full checks,11 null claims, zero reconnection/error events.
[POSITIVE] Actual bucket max_age0 and unlimited total caps plus per-subject history1 justify invariant counters when all mutations are prohibited. Two unreferenced timestamped terminal tasks are1.09days old, well inside14day prune; unit has no TTL override. Recompute immediately before future preservation.
[NEGATIVE] Attempt1 refused on a combined queue predicate; its failed snapshot was not saved, so stale versus busy stays unknown. Its first rollback falsely treated SIGTERMed as readiness and ignored bootstrap failure; genuine manual restoration followed. Eight exact-function negative stubs now reject false restoration.
[NEGATIVE] Attempt2 has an unlabelled guard violation, cause unknown; attempt3 has a guard-check TIMEOUT, cause unresolved. Serialized90second original-daemon pacing controls reproduce neither. Lower RPC cadence reduces observation overhead only. Incidental CONNECTION_DRAINING errors name the observer's own list/recruiting RPCs; they are not new application-handler evidence.
[NEGATIVE] Attempt4 captures a fresh same-owner busy memory queue at the signal boundary; second signal withheld and original genuinely restored. Attempt5 resumes observation and waits for a new idle/claim anchor; its first busy retry also sends no signal. Seven exact-function owned controls reject changed owner/missing/shutting-down snapshots without signaling.
[NEGATIVE] General application handler completion is unproved. MC direct task/collaboration KV writes remain parent2.3/4.1. Current-main terminal-task guards are absent from the preserved e57 runtime. Reinstallation may revert entries; primary node_modules changes alter all narrow releases. These remain parent1.5/2.2.

## 5 — Phase-8 corrections

Early controls reject eventual permanent-close fallback, discriminating explicit exit from an async throw. Runtime restoration requires prior unit unloaded, oldPID absent, new running readyPID, same-server newCID and actual list reply. Recoverable same-owner queue busy/stale can wait bounded30minutes before a signal; every signal still requires a fresh empty reading and recent actual null claim. Final observation requires fresh same-owner health, allowing unrelated memory work. These corrections change acceptance tooling only, not approved source bytes. Four refused attempts remain in REFUSED_ATTEMPTS.json; independent Claude141 closure approval applies to accepted attempt5.

## 6 — Carry forwards and Feeds landing

The existing managed task daemon consumes ~/.openclaw/releases/task-outage-a2f5293-e57f89b/bin/mesh-task-daemon.js, entry SHA17a70c25c0d0fcbd99ad83578c39923bed2cb7550026149314b69cc46289e787. Its connected stop satisfies the task part of recovery1.2's strict idle preservation gate. Block1 closes; macro re-orient returns to recovery1.2, not arbitrary application repair. Immediately reassert all three repaired entries/dependencies/prune eligibility. Carry a10s observer RPC deadline plus timeout stream-latency/event-loop-lag/request-holder diagnostics into preservation. Preserve task until worker has exited, stop observers before all-client-zero proof, and define each other client's normal stop from its actual code. Full node readiness, coordinated source recovery, active handler drain and two-machine plan execution remain open.
