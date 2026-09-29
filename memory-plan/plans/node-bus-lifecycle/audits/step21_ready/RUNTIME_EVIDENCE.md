# Task readiness — owned evidence

At 2026-09-28 23:28:42 EDT, a preconnected, flushed client made mesh.tasks.list
in the real daemon stdout ready callback, without retry or delay. Both code
copies were private archives of dad1e7b; candidate adds only await nc.flush()
immediately before ready. One authenticated, isolated loopback NATS2.12.6
server served empty owned stores and per-start isolated HOME/identity.

- Unpatched:66/100 no-responders503;34/100 successful; no other errors.
- Candidate:100/100 successful; no other errors.
- All200 daemons and the owned server stopped normally; each former daemon
  connection was absent before the next start. Cleanup failures:0.

OWNED_STARTUP.json is the sanitized result. Private evidence lives under
~/.openclaw/backups/node-readiness/task-ready-20260928-1/. No production
service, bus policy or task changed.

The focused three-test fixture uses real daemon/server connections and sends
its request at ready without retry. A daemon-only preloader wraps the real
NatsConnectionImpl.connect and final nc.flush: it first awaits the actual
flush, then holds its return. No ready is permitted during that hold; release
permits ready and the immediate RPC. A separate injected rejection after
real flush requires exit1 and no ready. These tests verify control-flow
ordering/failure semantics, not a wire-delay or real-server-loss scenario.

The first fixture run failed two controls because its preloader inferred
the NATS internal module path from index.js incorrectly; the normal startup
control passed. Resolving relative to nats/package.json corrected the fixture.
All3 then passed on actualNode24.13.0,3.954s, normal owned cleanup.
The same final-flush controls fail on the unpatched real dad1e7b source:
held-return publishes ready before the barrier; injected failure publishes
ready and stays alive until the test deadline. Both owned controls clean up
without force. Private unpatched-barrier-control.json/log retain that run.
Latest isolated full CI, independent exact-source review and managed
cumulative-release deployment remain pending. Step2.1[A]/v2.1-pre.

## CI fixture resolution correction — 2026-09-28 23:57 EDT

Exact source b190671 CI36518998603: Node20 root failed only the two preloader
controls with Cannot find module nats/package.json; the immediate request
control passed. Node22 was cancelled, Mission Control passed. The temporary
preloader could not discover repository dependencies from its own /tmp path
without NODE_PATH. It now pins NATS's implementation from createRequire of
the actual daemon entry before generating the preloader. Production source
remains the exact one-line b190671 barrier. A private archived candidate with
node_modules linked but NODE_PATH unset passes all3 controls. New exact CI
and independent review remain pending.

Staged private task-ready-b190671-e57f89b has only one changed file compared
with the accepted task-outage release: bin/mesh-task-daemon.js, entry hash
22c2784052ec9dde8f8dc1ac582ecd58b2db02aaf60d05cfe3524adfbcb3bb51. The original
unit and runtime remain unchanged. All3 staged owned controls passed,3.363s.

Exact8ab8350 CI36519414185 is green on Node20/22 and Mission Control. Current
production still uses the accepted prior release. The new private release's
provenance now records its readiness layer and embeds the old baseLayer, rather
than leaving an old runtime-entry hash as the current descriptor. One application
file changes; its provenance metadata also updates. Both remain private staged
files. The live65s preflight at2026-09-29 00:03:03 EDT passed14 full checks and
five null worker claims, unchanged task/KV state and normal observer close.
It made no service mutation. Managed deployment and Claude's exact challenge
remain pending. The deployment probe is already connected before the swap and
requests once when its10ms file watcher observes the replacement ready line;
that is bounded log observation, not an instantaneous stdout-callback claim.

## Independent source review — 2026-09-29 00:14 EDT

Claude Message30 finds no blocker at8ab8350. Its owned3-member cluster has
33/50 same-member and41/50 cross-member unpatched503; candidate0/50 for each.
Focused tests pass3/3 and the two held/failure controls reject unpatched code.
Message32 accepts the six staged deployment checks, with the caution that a
claim probe could take work. This tool never publishes a claim: its guard
observes the running worker's actual null replies, and the preconnected probe
uses only mesh.tasks.list. REVIEW_EVIDENCE.json records source/runtime limits.
The first deployment invocation refused before its guard or any service
mutation because actual unit PATH excludes /usr/sbin/lsof. Private refusal
retained; inspection commands now use absolute system paths. The fresh managed
attempt remains unaccepted until its result and independent challenge.

## Deployment verifier refusals — 2026-09-29 00:24 EDT

Attempt1's later guard completed before its owner check mistook the named
forbidden-publication observer for a second task holder. It refused with
mutated=false/PID748/runs1. Attempt2 corrected that by excluding only the
recorded guard CID, then refused before bootout because hostPython3.9's
kqueue lacks a context-manager entry. A stop intent was written but no stop
occurred; its failure also has mutated=false/PID748/runs1. Both private roots
are retained. Attempt3 uses explicit descriptor closing, checked on this
host, with the same owner/state gate. No success is claimed for either
refused attempt. Private directories are task-ready-20260928-{1,2,3}.

## Installed runtime and read-only continuation — 2026-09-29 00:31 EDT

At00:24:35.616672 EDT actual launchd ownerPID748 exited normally: Darwin
rawWaitStatus0, one completion, oldCID30 Client Closed, zero service holders.
The named observer alone is excluded from the holder count. ReplacementPID72174,
runs1, ownsCID19903 on its actual socket63659->4222. Its entrySHA22c27840 is
the reviewed one-line cumulative e57 release. A preconnected probe observed
its new ready line00:24:35.788 and got a list reply00:24:35.799 without retry.
One start/ready generation and65s stable owner/unchanged537 selected task rows,
threeKV states,9other ownerPIDs, unit values, dependencies/primary and stderr
passed before observer shutdown. Attempt3 nonetheless remains unaccepted:
the probe closed its NATS connection normally but its stdin kept the process
alive. Only the owned observer process was terminated; no production owner
was killed or restarted again.

The cleanup control on an isolated owned server reproduces that hang and
proves destroying stdin after normal connection close exits0. At00:30:57.335784
EDT a separate read-only continuation passed on the SAME72174/runs1/CID19903:
65s/14full checks, selected task rows equal the pre-restart537-row baseline,
KV messages/first/last equal the original guard even across the gap, same9
other owners and member identity/start, same entry/unit/dependency bindings,
one start/ready generation. Both new observers exit0; old daemon30, earlier
guard19695/probe19858 and fresh guard20452/probe20459 all closed normally on
the bus. The current00:29:51.597 list reply is health, not startup timing.
MANAGED_EVIDENCE.json carries sanitized facts and limitations. No whole-bus,
common-backup or active-handler claim. Independent closure challenge pending.

## Fully recorded current-source restart — 2026-09-29 00:41 EDT

Claude34 accepts narrow2.1 closure with three record conditions. A new, fully
recorded restart of the SAME installed source satisfies them, instead of
reconstructing missing old records. Attempt5 finishes00:40:45.742826 EDT.
Its baseline/intent/exit/gap/start/connection/RPC and pre-cleanup checkpoints
use exclusive private files with fsync/F_FULLFSYNC; RAW_RECORDS.json pins their
hashes/timestamps. Exit watch requested0x84000000 (NOTE_EXIT plus EXITSTATUS),
and the event echoes0x84000000 with rawWaitStatus0. Owner72174's completion and
normal close precede replacement82096/runs1/CID21565; its real socket52194->4222
binds the holder to the process. The preconnected probe observes ready at
00:39:40.097 and replies00:39:40.110,13ms, without retry.

The gap scan covers member4222 only, explicitly pairing excluded guardCID21369
with that serverID; it makes no4223/4224 zero-holder claim. Guard pause419ms,
including the gap, has zero worker requests. Across65s before and after ready:
31full checks,9actual worker claims, unchanged537 selected task rows/threeKV
counters/9other ownerPIDs, same bus identity/start, primary/dependencies and
installed unit BYTES. Fresh observer processes both exit0; no forced production
termination. Attempt3 remains unaccepted; its separate continuation is retained
as CONTINUATION_EVIDENCE.json. Latest MANAGED_EVIDENCE.json is this complete run.
Runtime closure is narrow local-server readiness; recovery1.2 remains open.
