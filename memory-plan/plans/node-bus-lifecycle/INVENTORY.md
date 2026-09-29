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

## Block 3 — Scheduled application quiescence

| Block | Step | Version | Status | Description |
|---|---|---|---|---|
| 3 | 3.1 | v3.1 | [A] | Establish the durable foreground execution-hold primitive — 2026-09-29 04:09:49 EDT:40 owned Mac controls pass; corrected exact CI/review pending |
| 3 | 3.2 | v3.2 | [ ] | Finish foreground contracts and integrate the five installed timers, installer/templates and durable journal restoration |
| 3 | 3.3 | v3.3 | [ ] | Stop the explicitly disabled Discord tool from crash-looping before a new preservation baseline |

> **3.1 — Goal:** a durable closed marker plus foreground lock excludes scheduled application execution after drain, even after controller exit.
> **Needs:** Python3/fcntl, installed Node/shell/launchd, Claude50/52 contract, D15.
> **Feeds:**3.2 and recovery1.2.
> **Verify:** code:40 real owned Mac controls, mandatory external lock/root pins, separate restoration type, permanently refused watch sessions, isolated exact CI; runtime:private deployed source pins, actual inherited-lock positive/negative controls and a scheduled Mac job that starts twice while closed with unchanged application count and no job log bytes. Independent source review. No live installation claim.

> **3.2 — Goal:** the actual five scheduled jobs cannot execute application work during the coordinated preservation interval, and verified recovery reopens their prior state.
> **Needs:**3.1 closed; all call paths inventoried, including the in-process memory scheduler; no detached/unawaited work; consolidation notification and abort/termination paths fully completed; exact source/loaded-entry/metadata identity; explicit persistent hold integration in the sole journal, including no-receipt/mismatched/broken hold interruption and dependency-first restoration.
> **Feeds:**recovery1.2/1.3 and parent node-readiness1.5/2.2.
> **Verify:** code:foreground/source/child controls, installer rendering, stale/changed gate negatives, crash/reopen journal controls. runtime:reviewed installed entrypoints preserve existing arguments/env/schedules, closed scheduled runs remain inert, delegated memory work drains separately, restoration reopens only after dependent services are ready with no false done/Ready state.

> **3.3 — Goal:** explicit channels.discord.enabled=false ends the optional tool normally before bus connections/writes, without enabling the integration.
> **Needs:**fresh disabled/no-token config observation, real owned tool controls, conditional KeepAlive contract, explicit inactive baseline state.
> **Feeds:**recovery1.2's complete inventory and parent1.5/2.2.
> **Verify:**code:disabled exits0 with no bus/writes; real enabled-path failure restarts; runtime:reviewed exact source/unit policy, one normal disabled run then loaded/not-running stable, no Discord client, original integration remains disabled.
