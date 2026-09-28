# Step 1.4 — AUDIT_PRE

## 0 — Micro Re-Orient

Worker 1.3 has actual two-stop runtime proof and independent closure approval. Task 1.1 proves connected idle stop only. This separate follow-up rejects bus-loss false success before preservation. The north star requires observable lifecycle truth, not vanished PIDs.

## 1 — Intent and fresh evidence

2026-09-28 12:25 EDT, actual owned daemon with private HOME/authenticated random-port NATS2.12.6 and empty task store: loss then SIGTERM at disconnect+3s emits Shutdown complete and exit0 while reconnecting. Calibrated late signal at approximately disconnect+budget−1s exits0 silently during request-subscription drain. Both new rejection assertions fail on the unchanged 1.1 source. No live outage is introduced.

## 2 — Needs pre-screen

1.3 closed; accepted 1.1 source/runtime intact; fresh two-path owned repro; installed Node22/24 and owned NATS available. D7 separates this follow-up. Runtime still has 537 unchanged task rows, idle worker and connected daemon. Original task release is preserved and must not be edited in place. Full suites stay in isolated CI until parent2.1 test isolation lands.

## 3 — Design and adversarial contract

Pass the closure error to the existing callback; suppress only requested error-free close. After existing await nc.drain, if nc.isClosed is false, emit one distinct failure line and explicitly exit1 before completion. The task shutdown is an async signal callback, so throwing alone would depend on the global unhandled-rejection policy. Preserve existing signal/idempotence/timer/subscription/application logic. Late regression measures actual reconnect budget and requires drain before permanent-close line with no earlier drain-open failure. Only bounded timing misses retry; false success fails immediately. Retain connected TERM/INT/held repeated-signal/unexpected-loss controls and reject both condition-removal mutants. An early warn-mode control checks explicit failure semantics.

## 4 — Runtime acceptance

Stage a new private e57 release with cumulative 1.1+1.4 lifecycle-only diff; compare its entry against deployed 1.1 and require exactly the reviewed 1.4 hunk. Preserve unit values/environment/dependency real paths and versions. Anchor managed SIGTERM immediately after a real worker null-claim; keep NATS/worker/bridge healthy. Reject ERROR handling or connection/reconnect/error statuses, permit healthy pingTimer, compare stderr baseline. Observe one completion, natural exit0, old connection absence/zero single-instance gap then managed replacement read-only list[] and all expected same-server subscriptions. Account for startup prune and require task rows/Kanban unchanged. Original release/unit remain rollback artifacts.

## 5 — Risks and bounds

This is still connected idle runtime acceptance. Owned tests exercise outages; never kill or disconnect live NATS for this test. General pending async handler/timer application drain remains parent4.1. Task service must remain available until worker exit in preservation. Regular connector sources must be identified and unloaded before all-client-zero evidence. Existing deployment/template/dependency drift remains parent1.5/2.2.

## 6 — Intended deltas

bin/mesh-task-daemon.js: error-aware callback and actual-closed failure before completion only. test/task-daemon-lifecycle.test.mjs: owned early/late loss controls and readiness/clock proof. Silo audit/evidence/carriers/decision. Private staged release and task unit entry only for runtime. No unrelated daemon/harness/topology change.

## Mid-Implementation Findings

Claude’s throw mutant passes the initial warn-mode control because the daemon eventually exits through the error-bearing close callback. Add absence of the permanent-close line to both early controls: early failure must come from the explicit actual-open guard. Focused current controls pass Node22/24; the warn-mode throw mutant now fails. Source bytes are unchanged. Mission Control can write MESH_TASKS KV directly, so queue-RPC pause alone is insufficient for runtime admission observation. The private guard observes mutations on all three actual $KV bucket subjects continuously, including its bounded RPC pause; read-only preflight still changes no service.

Claude message127 verifies exact head7/7 and corrected throw/condition mutants. Before any service mutation, read-only preflight4 confirms max_age=0 and unlimited total messages/bytes on all three buckets; per-subject history1 changes only upon a detected write. Exact live-source prune predicate finds two timestamped terminal/unreferenced tasks, oldest age1.07days, safely inside14days; unit has no TTL override. The guard observes65seconds after each ready replacement. This changes acceptance tooling only. Direct Mission Control KV mutation still feeds parent2.3/4.1.

Attempt1 refused after the65second startup window on the combined memory queue predicate. Its failed snapshot was not captured, so stale versus busy remains unknown. Same memoryPID93840/runs1/never-exited and the interval log do not prove the cause. The private rollback initially ignored bootstrap failure and treated SIGTERMed as readiness; original unit was manually restored to a genuinely ready newPID67801. No acceptance is inferred. Corrected exact rollback rejects eight owned stub failures (old PID alive, loaded unit, bootstrap failure, absent/unready newPID, unanswered RPC, reused CID, foreign holder); normal restoration alone records success. Per Claude131, stale same-owner/busy queue may wait bounded60s with continuous task guard; missing/shutting-down/changed-owner fail. Require empty immediately before each signal; final acceptance requires fresh same-owner health without requiring unrelated memory work to be idle. No daemon source bytes changed.

Attempt3 labels an own guard-check TIMEOUT before the second signal; original runtime restored with actual readiness. No task mutation is recorded. A90second original-daemon latency profile (250ms then2500ms pacing) has no reproduced timeout; cause remains unresolved. The monitor already awaited replies and never overlapped requests per subject. It now waits5s after a full check, retains instant mutation observation and250ms exact stream counters, and labels operation-specific timeouts as liveness failures that still refuse. Gap proof includes the claim subject; anchored replacement readiness (same server/newCID/list reply) must arrive within10s of a null claim, under15s worker sleep. Incidental rollback errors specifically name the guard’s own list/recruiting requests, so they are observation-induced read handlers, not additional evidence about application-task drain4.1.

Attempt4 captured a fresh same-owner but busy memory queue at the final signal boundary. The second signal was withheld; actual original readiness was restored. Attempt5 re-enters monitoring and takes a new idle/null-claim boundary instead of rolling back for a recoverable busy/stale reading. Seven owned exact-function controls prove resume-before-retry and no signal on changed owner, missing snapshot or shutdown. The overall stop-boundary idle wait is bounded30minutes, accommodating existing memory jobs without weakening continuous task-state observation. Attempt5 accepted at2026-09-28 13:26:17 EDT: two actual connected stops with one completion each, exact single-instance gaps, replacement79423/runs2/exit0,65seconds after each ready replacement, all task/Git/unrelated-owner state unchanged. Independent closure review is pending. Prior timeout cause stays unresolved; lower RPC cadence is observation-overhead reduction only.
