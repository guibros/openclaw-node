# node-bus-lifecycle — Step Inventory

## Block 1 — Planned mesh-client drains

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 1 | 1.1 | v1.1 | [x] | Complete deliberate task-daemon shutdown normally — 2026-09-28: reviewed 0f2e148 on staged e57, real managed exit 0/completion, single-instance gap and RPC readiness pass |
| 1 | 1.2 | v1.2 | [x] | Complete deliberate idle bridge shutdown normally — 2026-09-28: reviewed 9056e59, ten owned controls, managed exit 0/completion and restart, task states unchanged |
| 1 | 1.3 | v1.3 | [x] | Complete deliberate idle worker shutdown normally — 2026-09-28: source 69b7f37, nine owned controls, two managed exit-0 stops/restarts, task state unchanged, Claude closure accepted |
| 1 | 1.4 | v1.4 | [x] | Reject task-daemon false completion or silent success when bus loss overlaps requested drain — 2026-09-28: a2f5293 owned outage controls; managed connected stop/restart79423/exit0; unchanged state; Claude141 accepts |

> **1.1 — Goal:** the existing task daemon completes a requested idle shutdown with its normal exit status.
> **Needs:** live idle task daemon; owned nats-server 2.12.6 fixture; immutable live e57f89b source; D1/D2; user-authorized implementation/deployment and Claude adversarial collaboration.
> **Feeds:** node-state-recovery 1.2's shutdown gate; task-daemon launchd restart semantics.
> **Verify:** `code:` real-process tests on Node 22 and installed runtime Node: SIGTERM and SIGINT exit 0 with one completion line; repeated signals during held drain remain single-shot; unexpected permanent loss exits 1; unpatched source fails the planned-stop control. Full suite in isolated CI. `runtime:` staged e57 lifecycle-only diff matches source repair; fresh idle proof; deployed managed daemon SIGTERM emits completion and exits 0, then its managed replacement answers read-only requests. Healthy bus owners/viewer/gateway remain unchanged.


> **1.2 — Goal:** the existing bridge completes a requested idle shutdown normally.
> **Needs:** 1.1 closed; same-race source and live stop log reverified; owned authenticated NATS plus isolated kanban/observability state; original runtime unit; immutable e57 base; D4.
> **Feeds:** node-state-recovery 1.2's bridge stop gate.
> **Verify:** `code:` unpatched real idle bridge fails the completion control; patched SIGTERM/SIGINT complete once, unexpected permanent loss retains exit 1, full isolated CI green. `runtime:` lifecycle-only staged release; fresh idle proof; managed stop emits `Bridge stopped.` with normal exit, managed restart reports no orphaned mesh tasks under the idle precondition without changing task state; prior-request owned fixtures cover existing-ID reconciliation; unrelated service owners unchanged.

> **1.3 — Goal:** the existing worker completes a requested idle shutdown normally.
> **Needs:** 1.2 closed; same-race source/owned worker repro reverified; owned NATS/task daemon and isolated worker HOME/Git/state; existing worker unit; e57 base; D4.
> **Feeds:** node-state-recovery 1.2's worker stop gate.
> **Verify:** `code:` unpatched real idle worker fails the completion control; patched SIGTERM/SIGINT complete once, unexpected permanent loss retains exit 1, full isolated CI green. `runtime:` lifecycle-only staged release; fresh idle proof; managed stop emits `Agent worker stopped.` with normal exit, explicit kickstart of the preserved loaded unit (KeepAlive=false/RunAtLoad=false) answers alive=false/task_id=null without claiming work; unrelated service owners and task rows unchanged.

> **1.4 — Goal:** requested task-daemon drain must not report success while reconnecting or when permanent close carries an error.
> **Needs:** 1.3 closed; fresh owned reproduction of the independent task-daemon outage findings; accepted 1.1 source/runtime preserved as its narrow connected-idle contract.
> **Feeds:** node-state-recovery 1.2 strict connected stop gate; node-readiness 4.1 failure semantics.
> **Verify:** `code:` real owned-daemon early and late loss during shutdown fail with exit 1 and no completion; connected TERM/INT/repeated-signal controls retain exit 0; mutants removing either actual-closed or error-bearing-close checks fail. `runtime:` e57 lifecycle-only release, fresh idle proof, connected managed stop/restart and read-only readiness; no task-state/unrelated-owner changes. No general async-handler completion claim.

## Block 2 — Verifiable service readiness

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 2 | 2.1 | v2.1 | [x] | Publish task-daemon readiness after its subscriptions reach the bus — 2026-09-29: sourceb190671/tests8ab8350 green; Claude30/32/34 challenge; exact staged barrier; fully recorded managed exit0/restart82096 and scoped state preservation |

> **2.1 — Goal:** a task-list request made at the task daemon's ready declaration must reach its registered handler.
> **Needs:** merged main dad1e7b; exact CI failure at worker fixture113; owned authenticated NATS2.12.6; real-daemon startup controls; accepted live e57 task-outage release preserved; independent Claude challenge.
> **Feeds:** node-state-recovery1.2 readiness gates and root lifecycle CI; node-readiness1.5 restart semantics.
> **Verify:** `code:` a preconnected owned client requests immediately at the real daemon ready line; retain unpatched failure/control counts and reject readiness while the final real flush return is held; its injected failure must exit1 without ready. Patched source answers without retry. Full isolated CI passes. `runtime:` stage only the readiness barrier on the live cumulative lifecycle release, verify exact entry/dependencies, and after a fresh idle guard perform one managed stop/start with real RPC readiness and unchanged task/bus/other-owner state. Do not call source-only evidence deployment.
