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

### Scheduled execution hold prototype

2026-09-29 03:11:58 EDT: workspace-bin/service_gate.py deployed only to private
owned consumers under timer-gate-20260929-1/primitive-v2.18 actual Mac controls
pass; a real scheduled job goes runs1→3 while application runs remain1, with
zero job/error log bytes after controller exit. Four exec inheritance controls
pass including negative variants. No production gate, changed live entrypoint,
installer behavior or preservation window. Exact CI/review and3.2 integration
remain open. See audits/step31_service_gate/PRIMITIVE_EVIDENCE.json.

Scheduled hold correction2026-09-29 04:01 EDT:38 real Mac controls pass
against private primitive-v4, mandatory external lock pins, full receipts,
original watch-session certification and separate restoration-only type.
Actual owned timer c4b56ca3b2181eed goes runs1→3/app1→1/exit0/log0/err0
and bootout verifies absence.6000 rapid APFS checks have zero observed events;
marker rename changes ctime and saved receipt recovery refuses. No production
hold or controller. Corrected exact CI/review remain pending;3.1 stays active.
Primary e57 remains untouched and task owner82096/runs1 remains running.

Root+lock-pin correction 2026-09-29 04:09:49 EDT:40 actual Mac controls on source26e9278
pass in private primitive-v5; all40 include a verified unloaded owned timer.
CI36540391512 passes3/3 at preceding e788e1c. Corrected exact CI/review
still required.3.1[A]/v3.1-mid;3.2 and production preservation remain open.
Fresh08:05:29UTC read confirms13 exact live targets all loaded, same PID/runs
as the earlier accepted snapshot, and primarye57 unchanged. An initial read
with duplicated target prefixes is separately retained as invalid.


Owned primitive closure2026-09-29 04:38 EDT:source0f0dcc2/26e9278 approved by
Claude62, exact CI36541071531 green3/3;Claude64 hashes source/test identity.
Actual copied runtime run08:30:00–08:36:07UTC waits for kernel normal exit of
owned Node68265 before drain return, observes159 individually exit0 closed
fires over365s/app1/log0/err0,3202 native checks and19269 independent reads
with zero events, then receipt reopen yields actual app2/exit0. Owned bootout0
and absence verified.3.1[x]/v3.1;3.2/3.3/3.4/3.5 queued. No production
installation, preservation, Linux continuous-watch or VM durability claim.
Fresh resume snapshot08:23UTC confirms13 exact ownerPID/runs unchanged and
primarye57 preserved; this is continuity, not all-service health.


Local consolidation completion candidate2026-09-29 05:13 EDT:private
source-equivalent Node24 consumer passes158 focused controls/no skips;five
new regressions fail old0f source. Actual owned gate retains its foreground
Node through delayed abort cleanup, then the real default notification CLI
and private platform child, exits0 only after both finish; drain and clean
reopen pass. No production unit/source/dependency change. Profile on a copy
of accepted51.9MB snapshot completes12 local stages; source snapshot hash
unchanged. Remote LLM time and live-vault scale excluded.3.2[A]/v3.2-mid:
exact CI and independent source challenge pending, no production gate claim.

Local consolidation closure2026-09-29 05:26 EDT:source159b8dd approved as-is
by Claude72/74, Linux158 independently reproduced, exactCI36547696359 green
3/3. Private Mac owned gate+default notification and admitted atomic-write
controls pass with normal exit0, source/snapshot unchanged.3.2[x]/v3.2 only
closes the written private-consumer contract; production installation3.5 and
delegated-memory/general-daemon/preservation acceptance remain open. Seven
old-source controls fail as expected. Partial-result audit and long-wait
visibility are separate parent follow-ups. Fresh09:20UTC13 ownerPID/runs same;
primarye57/shared modules/live units preserved.3.3 disabled Discord is next.

Disabled Discord candidate2026-09-29 05:44 EDT:actual explicit-false/no-token
config still preserved; old loaded unit was runs3015/exit1/crash-looping.
Private e57-based entryd1341cfa passes10 real process controls: false±token
normal0/no runtime libraries/bus/state; missing/malformed config failure;
enabled/legacy real registration+planned0; permanent loss1. Actual private
Mac conditional unit remains loaded/not-running/runs1/exit0 for65s/245samples;
enabled missing-token failures restart; both owned units bootout0/absence.
No production change yet;3.3[A]/v3.3-mid awaits immutable CI/source review
and its separate narrow live deployment. Linux policy has no systemd runtime
acceptance. First fixture-key failure remains retained/unaccepted.

Disabled Discord closure2026-09-29 06:12 EDT: sourcef21c6df approved/CI3of3;
actual new-path release d1341cfa + rendered plist6f532574 ran once normally.
Fresh same-unit65.402s/84 samples remain loaded/not-running/run1/exit0;
configfalse/no-token/zeroaccounts and13 other ownerPID/runs unchanged.
First whole-node zero-admission window remains unaccepted; health-watch
connected after the Discord exit. Other work continues, not preservation.
HTTP registry bucket absent/actual read-only MC module count0; no global OS
network claim. New plist dev16777233/ino58975700/mode0644 feeds a new baseline.
Old entry/plist remain available; primarye57/shared dependencies preserved.
3.3[x]/v3.3; monitoring's false BROKEN is the next separately bounded repair,
before journal/timer integration/new preservation baseline. Source and Mac
measurement attribution remain distinct; qualified Claude84 challenge passes.
