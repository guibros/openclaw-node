# COMPONENT_REGISTRY — node-bus-lifecycle

## Family 1: Mesh task lifecycle

### ai.openclaw.mesh-task-daemon

| | |
|---|---|
| **Status** | LIVE, local-server startup registration and connected idle planned drain VERIFIED; owned outage failure semantics VERIFIED |
| **Verified** | 2026-09-29 00:41 EDT: currentPID82096/runs1/CID21565 on actual member4222 socket; prior72174 has requested/echoed NOTE_EXITSTATUS and exit0. Fully recorded restart,65s pre/post guards/31checks/zero worker requests in419ms pause, unchanged537 selected task rows/threeKV counters/9other owners. Both observer processes exit0. Claude34 closure conditions met. Prior1.4 outage evidence remains accepted. |
| **Source** | a2f5293fa0111e614682f431598c54c1757d6ad9, tests6cc27c3; both isolated full CI green. Readiness adds b190671 with tests8ab8350/CI36519414185 green. Runtime preserves live e57 base with cumulative1.1+1.4+2.1 patches. |
| **Runtime** | /usr/local/bin/node ~/.openclaw/releases/task-ready-b190671-e57f89b/bin/mesh-task-daemon.js; entry SHA22c2784052ec9dde8f8dc1ac582ecd58b2db02aaf60d05cfe3524adfbcb3bb51; unit values/cwd/dependencies preserved. |
| **Constraint** | Live connected proof introduces no bus outage; owned controls prove outage behavior. Current-main terminal-task guards and general async-handler drain remain absent/unproved. Original1.1 release remains intact; four refused attempts retained. |

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
| **Feeds** | node-readiness 1.5 deployment reconciliation and 2.2 installation. Task outage1.4 is accepted; connected idle and owned outage evidence remain distinct. Worker task-time ESM graph was statically checked in its release; idle acceptance is not task execution. |

### Task startup registration checkpoint

2026-09-29 00:31 EDT: readiness sourceb190671, tests8ab8350/isolatedCI36519414185
and independent Claude source review pass. Managed owner748 exited0; current
72174/runs1/CID19903 on member4222 answers list. Attempt3 remains unaccepted
because its read-only observer process hung after normal bus close. Separately
accepted read-only continuation65s/14checks uses the same replacement, unchanged
537 selected task rows/threeKV counters/9other ownerPIDs and normal fresh observer
process closure. The staged entry differs from live cumulative1.1/1.4 by only
await nc.flush before ready. Closure review remains pending;2.1[A]/v2.1-mid.
Local server registration is the barrier contract; cross-member routing remains
asynchronous. Primary e57 and shared dependencies stay preserved.

Current closure2026-09-29 00:41 EDT: step2.1[x]/v2.1. Fully recorded same-source
restart supersedes the provisional checkpoint above; current owner82096/runs1.
Source barrier and qualified cross-member controls pass. Review conditions and
raw record hashes are in step21_ready. Recovery1.2 resumes after149 merge and
fresh integration CI. General preservation-driver and source/deployment
reconciliation remain parent work; no new chain is enabled.
