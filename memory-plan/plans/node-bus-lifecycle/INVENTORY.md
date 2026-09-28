# node-bus-lifecycle — Step Inventory

## Block 1 — Planned mesh-client drains

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 1 | 1.1 | v1.1 | [x] | Complete deliberate task-daemon shutdown normally — 2026-09-28: reviewed 0f2e148 on staged e57, real managed exit 0/completion, single-instance gap and RPC readiness pass |
| 1 | 1.2 | v1.2 | [A] | Complete deliberate idle bridge shutdown normally |
| 1 | 1.3 | v1.3 | [ ] | Complete deliberate idle worker shutdown normally |

> **1.1 — Goal:** the existing task daemon completes a requested idle shutdown with its normal exit status.
> **Needs:** live idle task daemon; owned nats-server 2.12.6 fixture; immutable live e57f89b source; D1/D2; user-authorized implementation/deployment and Claude adversarial collaboration.
> **Feeds:** node-state-recovery 1.2's shutdown gate; task-daemon launchd restart semantics.
> **Verify:** `code:` real-process tests on Node 22 and installed runtime Node: SIGTERM and SIGINT exit 0 with one completion line; repeated signals during held drain remain single-shot; unexpected permanent loss exits 1; unpatched source fails the planned-stop control. Full suite in isolated CI. `runtime:` staged e57 lifecycle-only diff matches source repair; fresh idle proof; deployed managed daemon SIGTERM emits completion and exits 0, then its managed replacement answers read-only requests. Healthy bus owners/viewer/gateway remain unchanged.


> **1.2 — Goal:** the existing bridge completes a requested idle shutdown normally.
> **Needs:** 1.1 closed; same-race source and live stop log reverified; owned authenticated NATS plus isolated kanban/observability state; original runtime unit; immutable e57 base; D4.
> **Feeds:** node-state-recovery 1.2's bridge stop gate.
> **Verify:** `code:` unpatched real idle bridge fails the completion control; patched SIGTERM/SIGINT complete once, unexpected permanent loss retains exit 1, full isolated CI green. `runtime:` lifecycle-only staged release; fresh idle proof; managed stop emits `Bridge stopped.` with normal exit, managed restart reconciles existing task IDs without changing their state; unrelated service owners unchanged.

> **1.3 — Goal:** the existing worker completes a requested idle shutdown normally.
> **Needs:** 1.2 closed; same-race source/owned worker repro reverified; owned NATS/task daemon and isolated state/MC fixture; existing worker unit; e57 base; D4.
> **Feeds:** node-state-recovery 1.2's worker stop gate.
> **Verify:** `code:` unpatched real idle worker fails the completion control; patched SIGTERM/SIGINT complete once, unexpected permanent loss retains exit 1, full isolated CI green. `runtime:` lifecycle-only staged release; fresh idle proof; managed stop emits `Agent worker stopped.` with normal exit, managed restart answers alive=false/task_id=null without claiming work; unrelated service owners and task rows unchanged.
