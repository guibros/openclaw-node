# Step 1.2 — Runtime evidence (in flight)

2026-09-28 09:16 EDT. No production NATS unit has been stopped, no physical
production store copied, and no topology/configuration changed at this point.

## Deployed mechanism

The source tools were copied privately to
`~/.openclaw/backups/node-readiness/jetstream-20260928-1/tools-v2/` and executed
there with installed Node 24.13.0, NATS CLI 0.3.1 and server 2.12.6. SHA256:

- recovery.mjs: 6b9f9c81d10ede1a4cf3a12dbc5170fa071110c61b01804a32ea50374b41e370
- test_recovery.mjs: 25f44e0a302d88b74df81bca2d72850379227145d37fbc6451fa705eec332163
- take_snapshots.mjs: 067c538f2bc0ca3a8971bc84db270b00c2de31c8a796d93a762674afeaa36e8a

The deployed test creates only owned scratch servers. Observed successful run:
`/var/folders/52/24gckfjn2vd3yyz5smhmwhx00000gn/T/openclaw-jetstream-fixture-4kk2O0/acceptance.json`.
All owned servers stopped gracefully before the final success report.

- Ten binary records restore with holes 3/8, duplicate headers and exact timestamps.
- Message digest 779cd996a56cd7cc1d5a62e9aee822eeb59e2fa9741a73ebfcbcdbfde71d26aa.
- Changed subject/nanosecond timestamp/raw headers/payload independently change
  the digest; both durable consumer positions match; unacked sequence redelivers.
- Health TTL expires: zero messages, last sequence 1. No revived liveness claim.
- Snapshot driver runs against the owned source and produces checked manifests.
- Stopped standalone working copy recovers matching contents; master unchanged.
- R3 snapshot restores to isolated R1 using the explicit replicas flag.
- Offline R1 seven-message history restores in a remapped three-member clone;
  master hashes unchanged; peer IDs/loopback boundaries pass.
- Unexpected peer allowlist is rejected. An offline member's separate working
  store also reads correctly without cluster routing on this installed version.

Initial fixture failures were test timing/readiness assumptions, then an actual
upstream CLI --config bug. They are preserved privately; the final driver uses
--replicas only. No production replica override or software upgrade occurred.

## Read-only production preflight

At 09:12 EDT: mesh agent alive=false/task_id=null; no child executor under it or
the task daemon; 395/397 task subjects are tombstones, other two failed/completed;
221/227 collaboration subjects are tombstones, other six aborted/completed.
All enumerated standalone consumers have ack-pending 0. These are observations,
not a drain lock; reverify immediately before any shutdown.

MC has three local, unlinked running rows last updated 2026-03-05, and no mesh
node/task link. No row was changed. Their owner provenance needs independent
challenge before interpreting the stale statuses as idle execution.

At 09:15 EDT standalone has six clients, no routes/leaves. Members 2/3 have no
clients and only local peer routes. Member 1 fails at monitoring bind on 8222,
before JetStream. Private preflight-owners.json and idle-preflight.json record
actual evidence. Quiescence, all four production masters, isolated production
restores and service resumption are outstanding. VERSION remains v1.2-pre;
child 1.3 and parent node-readiness 1.3 remain open.

## Final fixture correction and deployed rerun

2026-09-28 09:17:45 EDT: tools-v4 ran the complete fixture successfully from the
private runtime backup directory. It adds explicit state/config comparisons,
consumer-position checks after cold clone boot and idle waiting, hole digest
sensitivity, binary provenance and bounded health expiry. The copied directory's
parent is fsynced too. All owned servers stopped before publishing acceptance.

- recovery.mjs: 18a956bfcb483256ec93a3d2a95657993a243a45711ed4d531a297808ea11dfe
- test_recovery.mjs: 9d46f283e65667fe5eeea42da447a757d9d8bb6b6eacc597a6049291611c2d76
- take_snapshots.mjs: 067c538f2bc0ca3a8971bc84db270b00c2de31c8a796d93a762674afeaa36e8a
- CLI real path: /opt/homebrew/Cellar/nats/0.3.1/bin/nats;
  SHA256 6be41e7097aac6278c3b9e4f394fc1536996608e921aa14fceae1bf0e800da0f
- Server real path: /opt/homebrew/Cellar/nats-server/2.12.6/bin/nats-server;
  SHA256 c3a71e72f6fc5dd008988f34b57fd2ab1fe69ab18d409f0a0aeebc51160e76e1
- Fixture root: openclaw-jetstream-fixture-V2OvXG under the private macOS temp root;
  ten-message digest 20b9cf54d1bc5e2e390986dd4b6ea4dd515a0f5b17f7089a8033b43535e847b5.

The expiry fixture initially queried before the restored timer had aged out the
old health point. A bounded three-second poll now requires the expected empty
state; it does not alter TTL or restore timestamps. Readiness waits require an
actual known metadata leader rather than the truthy unknown sentinel. No source
history or production service was touched by these fixture corrections.

## Independent challenge and actual online restores

2026-09-28 09:40 EDT: Claude Messages 74/76 passed the pinned Linux fixture,
independently exercised the offline driver and demonstrated assignment deletion
wiping an unprotected R1 working copy on rejoin. D6/runbook now require durable
member-1 disable, assignment preservation and exact MC scheduler restart gates.
No live unit has been stopped yet. MC status is scheduled at/cron=0/0, ready=0,
running=3, overdue=0; the exact dispatchable and dependency-eligible sets are both
empty. Running owners are null/null/Gui; no rows were edited.

Actual online archives were taken 09:24:13–09:24:16 EDT into separate private
standalone-online and cluster-online directories. Eleven reachable stream
archives restored on two isolated empty loopback servers at online-restore-3.
80,156 non-expiring messages, detailed sequence/deletion state, exact configs
against matching source queries and durable consumer positions match. Original
health TTLs apply; expired points remain expired. R3-to-R1 affects only the
isolated OPENCLAW_SHARED restore. Masters unchanged and both owned servers
stopped gracefully before acceptance. This is not a common recovery point.

Earlier isolated attempts refused on serializer/query representation differences
and are retained. backup.json omits zero defaults and server metadata; restored
config matches the full live before/after config exactly apart from the recorded
replica override. Detailed STREAM.INFO reports a sequence-zero deleted marker on
a never-used empty stream; backup.json's non-detailed state omits it. Identical
API options agree. No production configuration or payload was changed.

The final deployed tools-v8 with spaces fixture passed at 09:40:34 EDT, root
openclaw-jetstream-fixture-zaASTh. It adds holes/deleted-list negative control,
empty-directory detection, paths with spaces, KV revision/delete/purge/TTL round
trip, empty R3 restore, exact non-default stream/consumer config, offline driver
and assignment-deletion refusal. All owned servers stopped. Bounded source TTL
polling removed an immediate-expiry test assumption without changing TTL.


## Member 1 hold and isolated offline recovery

2026-09-28 09:42 EDT: member 1 was persistently disabled and unloaded. No assignment
was deleted. Standalone alone owns 4222/8222; 6222 has no listener. Its stopped
jetstream-1 store was copied into private cold-member1: 82 files, 6,346,296 bytes;
source-before/source-after/copy hashes agree. Original config/unit preserved.
Files are 0400, directories 0500, all 133 entries have uchg. Master hashes remain
unchanged after isolated restoration.

An owned nonclustered working copy restored member 1's offline R1 histories:
COLLAB 40 messages, first 7, last 1740, raw digest
`d3f510de4498c396e729a7776a520d72fdb302cd34642bb01bfd1d05cfe3039e`;
PLANS empty, first/last 0. Config/deleted-state evidence is private. Its physical
R3 OPENCLAW_SHARED replica remains preserved (4 files, 734 bytes); the nonclustered
server rejects replicas>1, so this is not proof of that replica's clustered restore.
All owned servers stopped. Claude Message 80 accepted the offline/master proof.

## Guarded managed window refused; all services restored

2026-09-28 09:54 EDT: after fresh idle/scheduler preflight, the managed-client stop
was refused when the task daemon failed its clean-completion log gate. It emitted
`Draining NATS...` then `NATS connection permanently closed — exiting for launchd
restart`, without `Shutdown complete.`. Its unconditional startup closed callback
races its own requested drain. No healthy NATS server stopped and none of the three
healthy stores was copied. The guard was not weakened.

The finally path restored all 16 previously managed jobs with zero resumption
errors. At 10:03 EDT memory and Mission Control are healthy; healthy NATS PIDs
874/887/858 and viewer PID 35823 remain unchanged. At 10:07 EDT all 537 task rows
and scheduler dispatch/recur/trigger counts and highwaters exactly match the
private pre-stop snapshot (13/160, 2/161, 2/159). No task row was changed.

A separate bounded node-bus-lifecycle step 1.1 / draft PR #145 repairs planned
idle shutdown semantics. Recovery 1.2 remains in flight until that deployed fix,
a fresh quiet window, the remaining protected cold masters, isolated production
restores and resumption acceptance have all passed. This evidence does not close
child 1.3 or establish a common recovery point.

## VM crash recovery — 2026-09-28 21:06 EDT

The VM rebooted around 20:55 EDT before the next healthy-store preservation
window. No healthy NATS unit had been intentionally stopped for that window.
PR #148 is confirmed merged at dad1e7b, not inferred from an interrupted tool
call. Task/bridge/worker deployed entry hashes remain 17a70c25 / f894fc18 /
1304cb31. All three serving buses pass JetStream health on new boot owners;
member1 remains persistently disabled and unloaded. Memory and Mission Control
authenticated health return200. Temporary /tmp helpers were cleared; durable
private journals and helper copies survive.

The worker remained loaded but stopped under preserved RunAtLoad=false and
KeepAlive=false. Explicit restoration completed at 21:06:07 EDT: PID5086, run1,
CID644; actual null claims and alive=false/task_id=null, followed by65seconds
of continuous application-idle guard observation (15 full checks,5 null claims).
All537 selected task-row fields match the accepted1.4 pre-crash baseline;
task/collaboration/plan message counts and sequence bounds match too. Across
worker start, these rows, Kanban bytes, units, primary/worker Git state and
other service PIDs/runs remain unchanged; new worker stderr0. This checks
selected task state and stream counters, not all application-store content
through the crash. Private evidence: postcrash-20260928-worker/acceptance.json.

Claude's preservation challenge requires cumulative admissions and producer-first
stops. The old preserve-managed.py is superseded and must not run. Healthy
cold masters remain pending. On installed2.12.6 varz has start but no pid field;
resumption must bind actual listener owners with lsof and managed process state.

## Post-crash comparison and revised owned checks — 2026-09-28 21:33 EDT

At 21:22 EDT, all thirteen known stream assignments were compared to the
individual 09:24 EDT online manifests. Nine reachable non-expiring streams
have matching state/config and durable positions; the two unavailable cluster
assignments still return 500/10118. Expiring health streams are separate.
Cluster local-events-node has 55,173 messages and durable delivered/ack 55,137,
with 36 pending and zero ack-pending, unchanged from that older snapshot.
The stopped member-1 master content hashes and all private/immutable flags
match. This does not prove every acknowledgement immediately before the crash.

Installed varz provides start/config_digest but not pid. All servers report
sync_interval=120 seconds; no recent Server Exiting or definitive OS shutdown
cause was found. Classify this as crash-recovered history with an unknown
shutdown cause, not a clean shutdown. Server listener ownership remains a
separate physical check. Scheduler activity counts/highwaters exactly match
the pre-crash snapshot: dispatch 13/160, recur 2/161, trigger 2/159.

The first tools-v9 full fixture refused a shutdown exceeding its unchanged
ten-second deadline. At the same time, production logs report API processing
of 12–51 seconds, an 80-second route stall and a temporary missing cluster
leader. The cause is unestablished. By 21:18:52 EDT the leader/routes recovered
without PID changes. Private fixture-v9-refused retains the failed run; four
owned logs lack normal exit evidence, so that run is not accepted as graceful.

Tools-v10 was deployed under the private recovery directory. Eight focused
checks passed on three actual owned 2.12.6 servers: brief writer and failed auth
admissions between zero-client samples, HTTP-only observation, content/durable
mutation refusal, plus synthetic queue/timer/descendant/order/rollback gates.
The synthetic gates do not prove a production orchestration sequence. Every
owned process is checked during teardown; forced cleanup records failure.

At 21:31:56 EDT the complete revised snapshot/cold-clone/offline-R1/TTL fixture
passed with all owned servers stopped normally and no cleanup failures.
Private root: tools-v10/openclaw-jetstream-fixture-9EOgqi. Three admission-test
servers also stopped normally, root openclaw-preservation-owned-cfr3e4vo.
Production server IDs/start/config digests and route counts remain unchanged
across these tests. Both surviving cluster members report member 2 as leader.

The preserved KeepAlive=false/RunAtLoad=false worker policy required explicit
post-reboot restoration. That is a parent readiness 1.5/2.2 boot-policy finding,
not evidence that unattended node startup works. The deploy listener has not
reached Ready on this boot; its connection-retry loop precedes signal-handler
registration. Its historical MODULE_NOT_FOUND tail is not a current-process
diagnosis. No healthy production message server has been stopped for this new
window. A durable managed journal, realistic stop/resume negative controls,
independent review and the three remaining cold-copy/restore proofs are pending.

Final exhaustive-cleanup revision deployed as tools-v11; full owned recovery
fixture passed at 2026-09-29T01:35:03.458Z, root openclaw-jetstream-fixture-UrLcfK.
Already-exited children are checked for normal exit too; connection-close
failures cannot skip remaining server cleanup. All owned exits are verified.

Tools-v12 admission checks passed nine tests on three owned servers, with
zero cleanup failures. Capture binds start/config digest, route rid/start and
Raft leader/term/applied/committed identity; a recovered route count alone
cannot hide a flap. A two-second observation deadline refuses monitoring
stalls. Captures are JSON-serializable for a durable journal. Synthetic identity
and Raft mutations are negative controls, not a real cluster-flap proof. Actual
HTTP captures from all three live monitors succeed, preserve their identity
and create no NATS client. The serving node still has connected clients, so
these are preflight observations, not quiet-window acceptance.

## Post-stall owner checks — 2026-09-28 21:45:15 EDT

Worker PID 5086/runs 1 still holds its exact CID644 alive/approve/reject
subscriptions and answers alive=false/task_id=null. Task, bridge, memory,
Mission Control and the three NATS PIDs/runs remain unchanged. All537 selected
task fields still match the pre-crash acceptance. One worker ERROR: TIMEOUT
was logged at 21:18:53 EDT during the long stall; no task was claimed. A fresh
read-only idle request succeeded at21:45:15 EDT. This is recovery from a timeout,
not a claim that the stall had no client impact. Both cluster members report
meta leader sNVEpm4n (member2), term7042, applied/committed1742174.

No kernel shutdown-cause event or panic/watchdog diagnostic was found. The
hypervisor's host logs are unavailable from the guest; the operator was asked
which layer crashed. At21:41 EDT the guest reported 2.1GiB swap in use and59GiB
free disk space. Five iostat samples showed busy CPU and13–92MB/s disk traffic;
these measurements were taken without a recovery fixture running. The model
runner later used about900–1034% CPU and4.9GB RSS. The observed local Ollama
caller PID747 is the existing node-watch unit; recent chat/generate requests
returned500 after8/30seconds. Its inference is not registered in the memory
daemon's empty queue. These are current resource/monitoring findings, not a
causal explanation of the earlier crash or stalls. No healthy stop is accepted
on that basis. Deeper monitoring/boot-policy repair feeds parent1.5/2.2.

Tools-v15 adds real owned-server restart, more closed connections than a first
page, a frozen monitor, and writes/durable acknowledgements through a persistent
existing CID. Capture checks the entire non-truncated connection inventory;
cumulative total must be exactly unchanged. Every HTTP request shares the
two-second observation deadline. Route/term identity controls remain synthetic
locally; Claude independently exercised actual route flaps/elections. Real
managed stop/resume controls and the durable preservation journal remain pending.

All12 tools-v15 focused checks passed in3.443seconds on three owned servers,
including one real restart. Cleanup reports no failures; each owned server
exited normally. Private root: openclaw-preservation-owned-smav2tcz.

## Account Raft scope and durable intent checkpoint — 2026-09-28 22:08 EDT

Claude's independent review of35e56ff found that plain `/raftz` returns only
the management group. The replacement also requests `/raftz?acc=<id>` for
every JetStream account and includes stream/consumer groups in the same
two-second observation deadline. Truncated/non-HTTP responses now become an
explicit refusal. A retained owned three-member cluster test observes both
stream and durable consumer groups, changes an actual stream leader and
refuses its changed Raft state while the management group remains unchanged.
The unpatched35e56ff control fails because the account group is absent; all
owned children still exit normally. A first fixture attempt refused because
its readiness test expected replica fields omitted from default jsz; it is
retained separately, not accepted. Actual peer identities and known metadata
leader plus acknowledged R3 creation establish the owned fixture readiness.

Deployed tools-v18 pass14 preservation checks, one actual cluster election
regression and ten durable-journal checks. Journal fault tests include failed
file/directory fsync, a killed owned helper after a simulated unit change,
boot-identity change, concurrent writer, corrupt/missing record and false
readiness. No macOS reboot or production service change occurs in these tests.
The first intermittent Linux helper failure seen by Claude remains unexplained;
the helper now retains sanitized errors and closes its own connection, and an
intentional failure checks that diagnostic path. It is not hidden with retries.

A10-minute passive production monitor recorded121 samples, maximum0.215s
for its HTTP batch, unchanged server/start/config identity, routes and management
leader/term. There were two route-connect errors per surviving cluster member,
each targeting the intentionally disabled member1 on6222; no new slow-read or
quorum warning. This older sampler did not include account Raft groups and is
not a quiet-window acceptance. A later full capture finds management plus one
account group on each survivor, within0.014s per server. All healthy owners
remain running. Model load has subsided between deep probes; crash cause remains
unknown. The replacement managed driver, persistent service holds, real stop
negatives, three healthy cold masters, clone checks and verified resumption
remain pending. Step1.2 staysv1.2-pre; child1.3 needs post-crash SQLite integrity
and a common application/bus/file-source recovery point.

Final protocol-error fixture extension: tools-v19 passes the14-check suite with
both a truncated HTTP body and an actual non-HTTP response. Journal/cluster
source hashes remain those already passed in tools-v18; unchanged complete
recovery source retains tools-v11's full fixture evidence. No extra production
LLM probe or service operation was introduced.

## Reviewed stop/restoration contracts — 2026-09-28 22:21 EDT

Deployed tools-v21 pass16 preservation checks, twelve journal checks and one
real cluster election test. The never-Ready deploy listener explicitly requires
default signal15, absent bus clients and no surviving child/socket; a Ready
listener still requires its completion marker. Recovery re-observes service
state, skips already-restored owners without restarting them, and requires a
final physical ownership/member1 hold callback. The deploy listener resumes
last. TTL expiry follows each unchanged originalmax_age, including other
expiring buckets; it never permits a new last sequence.

CI onae5701f refused the cluster fixture with an owned startup503. All earlier
recovery/admission/journal tests passed, and owned cleanup was normal. The test
now labels error stages, requires authenticated account readiness before any
setup, waits for the stream's actual leader/current replicas before publication,
and establishes a settled Raft baseline before asserting quiet. Only a503 at
account-info is treated as bounded startup-unready evidence, retained in the
fixture; mutation errors are not retried. A subsequent local attempt correctly
refused while newly created groups were still applying creation. Both refusals
are retained; neither is a healthy-server operation or accepted recovery.

At22:16 EDT all537 selected task rows still match the worker restoration
baseline and worker/task/bridge/memory/three NATS owners retain their PIDs and
runs1. All-group, HTTP-only ten-minute measurement on the two client-free
cluster survivors is now in progress. The managed driver and real launchd
negative cases remain unimplemented; no healthy bus stop or cold master is
accepted. D8's ordinary bootout-only holds replace D7's persistent holds for
those services; member1 is still the sole persistent disable.

## Journal adversarial corrections — 2026-09-28 22:43 EDT

CI36512084210 is green on6659ef13f1546fcc40ca1e392c131fa2feddf6a2:
Node20/22 root tests, Mission Control and owned recovery fixtures. Claude's
independent Linux run reproduced the predecessor checkpoint results
(12 journal,16 preservation,1 cluster) and the old35e56ff account-scope failure.
His six additional journal probes found baseline omissions, skipped final
checks, tail-loss continuation, held-member mutation, disk-failure restoration
blocking and separate-root concurrency. These are corrected in the new source;
independent review and exact-head CI for that new source are still pending.

Deployed tools-v22 passes27 journal tests,15 preservation checks and one real
three-member election test. The restoration-stage control moved out of the
removed duplicate helper into the journal suite. New controls cover a reboot
before any worker intent, final hold checks after bus failure, deleted tail
records, ENOSPC, two roots sharing a node lock, immutable identity drift,
secondary-baseline restoration, unresolved-window fencing, busy timer/stopped
daemon baselines, known-broken running-state variation and sealed immutability.
One intermediate test failed because its fixture marked the healthy bus stopped
as well as the known-broken worker; the corrected fixture changes only that
worker. No production service operation occurred in these tests.

The owned APFS file/directory probe returns success for fsync and F_FULLFSYNC.
This proves syscall acceptance only, not survival of host/cache power loss.
At22:43:54 EDT all537 selected task records remain unchanged and the worker,
task, bridge, memory, three serving NATS and node-watch PIDs/runs remain the same.
The all-account passive sample finished at22:27:54 EDT:121 readings, no refusal,
maximum0.127057seconds per server observation, $SYS and $G groups on both
survivors, unchanged identity/admissions/API/state/durables/routes/Raft. It is
preflight only; standalone applications stayed live. Coverage of an entire
node-watch deep sweep was not established from the overwritten watch report,
so this sample does not explain or exclude the earlier stalls.

The managed driver, real launchd ownership/exit controls, pending degraded-
history resolution procedure and the three healthy cold masters remain open.
No new managed-window acceptance is published. Step1.2 remains v1.2-pre.

Prior source deployed as tools-v23:29 journal tests pass, and source hashes for
the15 preservation checks and real cluster regression exactly match their
passing tools-v22 versions. The two added controls reject a later window when
its previous restoration chain has a missing record and refuse sealing when
the node-wide restoration receipt cannot be made durable. These remain owned
mechanism checks, with no healthy production stop. The new checkpoint is not
independently accepted or green in CI until its exact commit is reviewed/run.

The retained tools-v24 run refused at owned fixture publication with503,
0.6seconds after startup, with normal cleanup. The server logs show the stream
leader was a different member from the fixture's publisher. Creation/API
replica readiness did not prove that publisher's route interest had propagated.
The fixture now separates creation from seeding, observes the actual leader's
local history subscription, and sends its single seed publication there after
a fresh local-leader check. No mutation is retried. The corrected owned run
passes in3.259seconds, root openclaw-preservation-cluster-03ackhxi. This is a
fixture setup correction; production servers, policies and histories are not
changed. The final journal also refuses sealing a forward-failed window even
when later baseline restoration succeeds. Exact final tools-v25 evidence is
recorded separately; no managed production stop is accepted here.

Tools-v25 final deployed mechanism checks pass:30 journal,15 preservation,1
actual three-member cluster election regression, with no forced cleanup. Source
application code and production service state remain unchanged. Exact commit
CI and Claude's revised-journal review remain pending at this checkpoint.

## Secondary receipt and terminal interruption checkpoint — 2026-09-28 23:23 EDT

Claude Message24 reproduced eight faults on exact b38933a; Message26 agreed the
bounded correction design and retained independent read-only review. New source
has48 journal fault checks: complete explicit inventory/absent units, fixed
persistent parent, intact-primary restoration after missing/corrupt receipt,
secondary retention failure/full disk degraded restoration, ambiguous roots,
content-based unloaded identities, busy timer no-restart, serialization
failure continuation, strict receipt readback, no premature restored claim,
terminal append/receipt gaps, and receipt loss after multiple terminal windows.
Hash-linked predecessors allow only the unique current journal to rebuild a
lost receipt. resolve retires an interrupted verified restoration without
accepting its copies. No new driver/window acceptance follows.

Private deployed tools-v28 has48 fresh journal checks passing. Its15 admission
checks and real three-member account-election control inherit tools-v27 only
after exact source-hash equality for all three files. tools-v27 ran all three
fresh with normal owned cleanup. Direct checkout48 passed too. Initial changed
fixture failures were retained in tool outputs: incomplete adapted fixtures,
one missing test import, and a macOS /var versus /private/var expected-path
assertion; the actual identity correctly used resolved paths. No claim that
those initial test runs passed. tools-v26 private fixtures passed45, v27 passed46;
these are older mechanism checkpoints, not latest full-suite CI or live owners.

Actual macOS owned launchd probe (private postcrash-audit/
owned-launchd-exit-probe-1/result.json,22:55:47 EDT): one uniquely named test
service, non-child ownerPID40835, registered EVFILT_PROC NOTE_EXITSTATUS before
managed bootout, raw wait status0 / normal exit0, one completion marker,0.006598s.
Unit unloaded afterwards. Entry SHA256
9c46006c43394e9ada9257d9502d1062012739e487ecedbd2da550b8669d1ac2.
This proves kernel exit-status access for that fixture only. Child/CID/order
negative controls and actual production identity bindings remain pending.

Fresh post-crash checkpoint23:06:32 EDT:537 selected task rows match the worker
baseline; eight core owners retain their PIDs and runs1; member1 remains disabled
and unloaded. The initial checkpoint23:06:02 comparison was a probe error (list
rows versus dictionary baseline; true versus macOS disabled output); retain it
and its corrected private companion rather than erase it. No healthy NATS stop.
Primary e57 checkout and its untracked plan/tick files remain untouched.

CI36514681814 on b38933a is red: Node20 root2510pass/1fail/5skip, Node22cancelled,
MCsuccess; Node22 recovery fixtures passed before cancellation. Failure is the
main-merge fixture's first mesh.tasks.list at line113, not a preservation test.
The daemon logs ready without a flush after subscribing. Claude's owned startup
stand-in observed8/100503 without flush and0/100 with it. Real-daemon reproduction
and a separate lifecycle readiness outcome are required; a green rerun would
not repair this race. PR144 comment5882998808 records that boundary. This
checkpoint keeps VERSIONv1.2-pre and1.2[A]; no claim of a green latest full suite,
complete cold masters, coordinated recovery, or full project readiness.
