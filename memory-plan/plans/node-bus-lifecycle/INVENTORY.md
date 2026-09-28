# node-bus-lifecycle — Step Inventory

## Block 1 — Planned task-daemon drain

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 1 | 1.1 | v1.1 | [A] | Complete deliberate task-daemon shutdown normally |

> **1.1 — Goal:** the existing task daemon completes a requested idle shutdown with its normal exit status.
> **Needs:** live idle task daemon; owned nats-server 2.12.6 fixture; immutable live e57f89b source; D1/D2; user-authorized implementation/deployment and Claude adversarial collaboration.
> **Feeds:** node-state-recovery 1.2's shutdown gate; task-daemon launchd restart semantics.
> **Verify:** `code:` real-process tests on Node 22 and installed runtime Node: SIGTERM and SIGINT exit 0 with one completion line; repeated signals during held drain remain single-shot; unexpected permanent loss exits 1; unpatched source fails the planned-stop control. Full suite in isolated CI. `runtime:` staged e57 lifecycle-only diff matches source repair; fresh idle proof; deployed managed daemon SIGTERM emits completion and exits 0, then its managed replacement answers read-only requests. Healthy bus owners/viewer/gateway remain unchanged.
