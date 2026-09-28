# COMPONENT_REGISTRY — node-bus-lifecycle

## Family 1: Mesh task lifecycle

### ai.openclaw.mesh-task-daemon

| | |
|---|---|
| **Status** | LIVE, idle planned drain VERIFIED |
| **Verified** | 2026-09-28 10:31 America/Montreal: PID 10490, runs 2, last exit 0; one Shutdown complete, actual read-only RPC before signal/after restart, no disconnect/reconnect in window; separate subscription gap 1→0→1. |
| **Source** | Live e57f89b264a30892389cabe573786fb516a6a208; main 88c7ad058589a60a566fa902d81d6dc0a6b88bed includes the accepted repair; runtime preserves the e57 base with the reviewed lifecycle patch. |
| **Runtime** | /usr/local/bin/node /Users/moltymac/.openclaw/releases/task-drain-0f2e148-e57f89b/bin/mesh-task-daemon.js; other unit values/cwd preserved. |
| **Constraint** | The live file lacks current-main terminal-task guards. Preserve this drift in the narrow lifecycle release; reconcile it in node-readiness 1.5. |

### Managed NATS preservation prerequisite

| | |
|---|---|
| **Status** | REFUSED safely; services restored |
| **Verified** | 2026-09-28 10:03 America/Montreal: standalone PID 874, member 2 PID 887, member 3 PID 858 unchanged; resumption has zero errors; MC health reports 537 tasks, scheduler ready/overdue/scheduled all zero. |
| **Evidence** | Private journal ~/.openclaw/backups/node-readiness/jetstream-20260928-1/managed-cold-window-2/; no healthy-store cold copy occurred. |


### ai.openclaw.mesh-bridge

| | |
|---|---|
| **Status** | LIVE, connected idle planned drain VERIFIED |
| **Verified** | 2026-09-28 11:11 America/Montreal: deployed PID 26682 exits 0 after one completion; managed replacement 26822/runs 2; subscriptions 1→0→1, fresh idle reconcile/wake, task rows and Kanban bytes unchanged. Claude message 100 accepts closure. |
| **Consumer** | /usr/local/bin/node /Users/moltymac/.openclaw/releases/bridge-drain-9056e59-e57f89b/bin/mesh-bridge.js; bridge-only patch on e57, entry SHA f894fc1813cdb0fa40d73f6ba81c97cb1c10b8b18ba76204c0f4aae5a74deaeb. |

### ai.openclaw.mesh-agent

| | |
|---|---|
| **Status** | LIVE, connected idle planned drain VERIFIED |
| **Verified** | 2026-09-28 12:12 America/Montreal: two natural managed stops, exit 0/one completion; replacement PID 50887, runs 3. Old CID292231 closed normally, zero-holder gap, replacement CID292648 idle. 537 task rows/Kanban/core owners unchanged. Claude message 121 accepts closure. |
| **Consumer** | /usr/local/bin/node ~/.openclaw/releases/worker-drain-69b7f37-e57f89b/bin/mesh-agent.js; entry SHA 1304cb310551cec27739852686bafcd356641d6c4e993011fb74fba5ed14666c. |
| **Constraint** | KeepAlive=false/RunAtLoad=false preserved: permanent-loss exit does not automatically restart despite existing log wording; restoration needs explicit kickstart. Default poll can leave 15s before drain versus launchd’s 20s stop limit; keep task service available until worker exits. Current-main terminal-task handling absent from live e57. |

### Narrow lifecycle release durability

| | |
|---|---|
| **Constraint** | Service installation or mesh-deploy --include-services re-renders primary entry paths and can revert task/bridge repairs. Ordinary restart keeps current entries. |
| **Dependencies** | All three lifecycle releases intentionally link primary node_modules. npm install/ci/rebuild there changes their runtime dependencies. |
| **Gate** | Before preservation, assert repaired clients' unit entry/runtime SHA, then createRequire real paths and package versions under their exact unit environment. Bridge packages are in step12_bridge/RUNTIME_EVIDENCE.json. |
| **Feeds** | node-readiness 1.5 deployment reconciliation and 2.2 installation. Task outage semantics remain queued atomic 1.4; 1.1 connected-idle proof stands. Worker task-time ESM graph was statically checked in its release; idle acceptance is not task execution. |
