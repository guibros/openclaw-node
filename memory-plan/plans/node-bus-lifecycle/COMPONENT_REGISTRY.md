# COMPONENT_REGISTRY — node-bus-lifecycle

## Family 1: Mesh task lifecycle

### ai.openclaw.mesh-task-daemon

| | |
|---|---|
| **Status** | LIVE, planned drain DEGRADED |
| **Verified** | 2026-09-28 10:03 America/Montreal: launchctl reports PID 93906, runs 1; planned stop at 09:54 emitted `Draining NATS...` then the permanent-close restart line without `Shutdown complete.` |
| **Source** | Live e57f89b264a30892389cabe573786fb516a6a208; current-main 5e088cc85af46391efab5286970525ebd5f3a0f4 has the same unconditional closed callback. |
| **Runtime** | /usr/local/bin/node /Users/moltymac/openclaw-nodedev/bin/mesh-task-daemon.js |
| **Constraint** | The live file lacks current-main terminal-task guards. Preserve this drift in the narrow lifecycle release; reconcile it in node-readiness 2.2. |

### Managed NATS preservation prerequisite

| | |
|---|---|
| **Status** | REFUSED safely; services restored |
| **Verified** | 2026-09-28 10:03 America/Montreal: standalone PID 874, member 2 PID 887, member 3 PID 858 unchanged; resumption has zero errors; MC health reports 537 tasks, scheduler ready/overdue/scheduled all zero. |
| **Evidence** | Private journal ~/.openclaw/backups/node-readiness/jetstream-20260928-1/managed-cold-window-2/; no healthy-store cold copy occurred. |
