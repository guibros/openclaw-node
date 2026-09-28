# COMPONENT_REGISTRY — node-bus-lifecycle

## Family 1: Mesh task lifecycle

### ai.openclaw.mesh-task-daemon

| | |
|---|---|
| **Status** | LIVE, idle planned drain VERIFIED |
| **Verified** | 2026-09-28 10:31 America/Montreal: PID 10490, runs 2, last exit 0; one Shutdown complete, actual read-only RPC before signal/after restart, no disconnect/reconnect in window; separate subscription gap 1→0→1. |
| **Source** | Live e57f89b264a30892389cabe573786fb516a6a208; current-main 5e088cc85af46391efab5286970525ebd5f3a0f4 has the same unconditional closed callback. |
| **Runtime** | /usr/local/bin/node /Users/moltymac/.openclaw/releases/task-drain-0f2e148-e57f89b/bin/mesh-task-daemon.js; other unit values/cwd preserved. |
| **Constraint** | The live file lacks current-main terminal-task guards. Preserve this drift in the narrow lifecycle release; reconcile it in node-readiness 2.2. |

### Managed NATS preservation prerequisite

| | |
|---|---|
| **Status** | REFUSED safely; services restored |
| **Verified** | 2026-09-28 10:03 America/Montreal: standalone PID 874, member 2 PID 887, member 3 PID 858 unchanged; resumption has zero errors; MC health reports 537 tasks, scheduler ready/overdue/scheduled all zero. |
| **Evidence** | Private journal ~/.openclaw/backups/node-readiness/jetstream-20260928-1/managed-cold-window-2/; no healthy-store cold copy occurred. |


### ai.openclaw.mesh-bridge

| | |
|---|---|
| **Status** | LIVE, planned drain DEGRADED |
| **Verified** | 2026-09-28 10:22 America/Montreal: private managed-window log contains permanent-close exit at 09:54:20 and no Bridge stopped. Source matches main exactly for this file. |
| **Consumer** | Original unit still uses /Users/moltymac/openclaw-nodedev/bin/mesh-bridge.js; single mesh.events.> subscription on standalone bus observed. |

### ai.openclaw.mesh-agent

| | |
|---|---|
| **Status** | LIVE, planned drain UNPROVEN |
| **Verified** | 2026-09-28 10:22 America/Montreal: one mesh.agent.moltymacs-virtual-machine.alive subscription, reply alive=false/task_id=null; same unconditional closed callback in live and main. Claude independently reproduced idle SIGTERM exit 1 without completion. |
| **Constraint** | Runtime acceptance still required; current-main has additional terminal-task handling absent from live e57. |
