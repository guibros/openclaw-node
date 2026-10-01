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

## Creation-interruption checkpoint — 2026-09-28 23:49 EDT

Claude Message28 verified all eight second-round fixes and multi-window lineage
on bbbc883; exact CI36516935187 passed Node20/22 and Mission Control. These
finite green observations do not repair the separately reproduced startup race.

The next patch durably writes and reads the initializing baseline receipt before
mkdir. Owned interruption tests stop after that receipt, after mkdir and after
the primary baseline; reopening completes setup for restoration only, restores
the prior state, resolves and permits a new window. An ENOSPC setup repair still
restores from the prepared secondary under the global lock with no durable
success. Finder's regular owned .DS_Store is ignored; other unknown entries
refuse explicitly. Existing argv script/config files and the resolved cwd now
automatically bind static identity. Directory dependency arguments refuse
cleanly; the driver supplies resolved entry files plus package metadata.

Source53 journal tests pass in20.591s after binding each creation interruption to an earlier sealed predecessor. Exact private deployed tools-v30 passes53
in20.467s. Its15 admission tests and1 real account-election control inherit
tools-v27's fresh runs only after all three relevant source hashes match v28
and v29. The checkpoint changes no production service. Exact new CI/Claude
review, real child/CID controls, driver and healthy cold masters remain pending.

Fresh physical checkpoint23:47:53 EDT: all537 selected task rows still match the post-crash worker baseline; eight checked owners retain the same PIDs/runs1; member1 remains disabled/unloaded. Primary e57 and its untracked files remain unchanged. Initial attempt to save this read-only checkpoint used the wrong audit parent and raised FileNotFoundError before evidence publication; the corrected private report retains the actual probe timestamp.

## Initializing Finder recovery — 2026-09-29 00:58 EDT

At00:46:29 EDT the new owned metadata recovery test rejects the unpatched
ab7097c source (return1, initializing journal contains unknown files). At
00:47:44 EDT private tools-v31 passes all55 journal tests in25.831s. It covers
receipt/mkdir/baseline interruption after a sealed predecessor, restoration-only
reopen on a new boot identity, unchanged ready owners, retained metadata bytes,
explicit resolve and a next window. Metadata links/directories/foreign owner
(lstat-controlled fixture)/unknown entries refuse and leave new roots fenced.

FINDER_SETUP_EVIDENCE.json pins module/test hashes and the private evidence root.
The unchanged15 admission and1 actual account-election checks inherit only
after current source/test hashes match tools-v30; those are not fresh runs.
No production window or healthy service stop occurred. Previous ab7097c exact
CI36518928261 is green; main55131b8 with PR149 is integrated before this patch's
fresh isolated CI and independent review.1.2 remains[A]/v1.2-pre.

## Actual macOS stop adapter — 2026-09-29 01:11 EDT

The private tools-v33 six-test suite passed in1.373s with actual uniquely named
launchd jobs and one authenticated owned loopback NATS server, which exited0.
Normal stop binds actual kernel argv/executable/cwd/PID and NATS CID, requests
NOTE_EXIT|NOTE_EXITSTATUS before signal, requires owner/known-descendant exit
status, closed connection, absent listener, unloaded unit and exactly one
completion. A crash after that marker and a surviving detached child each
refuse. An idle timer unload leaves log bytes unchanged; starting it between
preparation and unload refuses before stopping it. Wrong argv refuses before
any stop. Private owned files/proofs remain; no production connection or stop.
Eleven actual healthy production owners also pass read-only process binding.

MANAGED_STOP_EVIDENCE.json pins this adapter and proof. It is not the detached
production orchestrator: full inventory/static identities (notably npm/Next),
late-child/physical ownership/admission checks, idle memory anchor, per-service
restoration readiness and timer deadlines remain requirements. The obsolete
private sampled-window driver now refuses immediately; its original bytes are
retained under retired/ with a hash receipt. Journal is the single restoration
implementation. No production preservation window has been created.

Previous N3 head0b96e93 exact CI36523987643 is green3/3. Claude Message38
accepts the narrow fix with its independent55-test and real-filesystem evidence.
The new adapter checkpoint requires its own CI and independent challenge.

## Complete owned placement readiness — 2026-09-29 01:21 EDT

f3bb44f exact CI36525034891 failed in the existing Node recovery fixture before
the Mac adapter collection: NATS400/10005 no suitable peers for placement. The
old fixture captured no exact failing request phase and only waited for a
metadata leader. The replacement requires all three server identities, one
leader, its two current/non-offline peers and all confined reciprocal routes
before placing any stream. An actual two-member cohort refuses at its deadline
before member3 starts; after all three become ready, the full existing recovery
fixture passes from private tools-v36. No stream-create retries mask failure.

The first owned draft incorrectly expected replica details on followers; the
second exposed a raw HTTP timeout at the deliberate500ms negative boundary.
Both failed runs are retained with normal cleanup/no cleanup failures. The
final gate reads follower progress from the leader and normalizes only a
deadline timeout to its own refusal. Unexpected earlier errors still fail.
PLACEMENT_EVIDENCE.json pins sources, readiness summaries and full owned
recovery outcomes. Runtime CLI/server/library sources remain unchanged. This
is isolated fixture readiness, not production placement or cold-copy proof.
Fresh exact integration CI and independent challenge remain required.

## Managed controls checkpoint — 2026-09-29 01:44 EDT

Claude Message40 found six adapter limitations. Private tools-v40 passes13
actual Mac controls with1 explicitly unavailable cross-domain test; tools-v39
passes the complete owned recovery fixture and four single-predicate negatives.
A real two-of-three metadata cohort fails peer, cluster-size and route checks.
All owned servers exit normally; no production stop/cold copy was attempted.
Running entry/executable/plist files, text inode/start time and declared
environment hashes now bind13 owners in read-only probes. Discord was skipped
because its known-broken loop had no root PID; the deploy listener is bound
but remains unready. Actual NATS configs contain inline authorization, not
the previously assumed auth include; those refused probe attempts are retained.
Full dependency/build inventory remains open. All loaded units probed reported
exit timeout5; the adapter reads that value instead of imposing10/15second
action/verification deadlines. Forced-kill status is captured and refused.
Idle timer observations without complete independent spawn evidence refuse
full verification. Prior17680fa CI36525847542 is green3/3; this new source
requires fresh CI/review. See MANAGED_CONTROL_REVIEW.json and D15.1.2 stays active.

## Loaded provenance checkpoint — 2026-09-29 02:09 EDT

Private tools-v44 passes17 actual Mac controls/1 explicit unavailable
cross-domain control; all18 owned jobs are unloaded in both domains and
the owned server exited0. Copied loaded plists, fake completion logs,
rewritten/replaced/chmod identity files refuse before stop. Expensive
re-binding now precedes intent and vnode watches continue through exit.
A pure ATTRIB event is ignored only with unchanged current/opened inode,
device and ctime; real chmod remains a negative. Prior v43 event details
were not retained, so its exact cause is unproved. v41 readiness publication
race is fixed by atomic private Ready files. Both refused drafts are retained.
Thirteen live owners pass new loaded-path/log provenance read-only with
unchanged PIDs. tools-v42 passes recovery plus all eight independent
placement negatives and normal owned server cleanup.8286c96 exactCI
36527770223 is green3/3; Claude Message44 accepts its six controls and
independently passes recovery twice. This newer source requires fresh CI/review.
Producer tick gaps, stop-time measurements and Discord/timer gates remain
open with the driver and healthy cold masters. See D16 and
LOADED_PROVENANCE_EVIDENCE.json. No production service was changed.

## Kernel refusal evidence and owned stop sizing —2026-09-29 02:33 EDT

Private tools-v46 passes20 real Mac launchd controls with one explicit user-
domain skip. A real invalid-fd EV_RECEIPT retains EV_ERROR/errno; a real user
event is retained before unknown-event refusal. The restored startup test
rejects an identical file rewrite between process launch and watch preparation.
All21 owned jobs are unloaded in both queried domains; no cross-domain runtime
pass is inferred. v45 exposed a missing Refused import in the new error path
(19pass/1error/1skip); that draft and its normal owned-server exit remain private.

Private owned-stop-sizing-v2 restores11 individual archives (80,156 non-expiring
messages) to four owned NATS servers with original replica policies, closes its
clients, then observes four normal managed exits in34–45ms. Its v1 startup
wait refusal is retained; both runs unload their owned jobs. This uses the
previously accepted v44 adapter and historical archive points, not new live
archives or accepted healthy cold masters.

Private owned-memory-stop-sizing-v1 uses identical installed entry bytes with
a separate HOME/workspace/bus/injection port, empty transcript sources, disabled
notifications and an unused isolated LLM URL. Three copied SQLite stores total
253,943,808bytes. Actual process file inventory confirms all three open under
the owned HOME; knowledge/extraction/graph initialization and first maintenance
complete, queue is idle. Managed normal exit takes65ms, former CID closes
normally and injection listener disappears. Both owned units unload. This is
one idle stop; active extraction, subprocesses and workers are not covered.

Serving NATS configs omit log_file. Discord is enabled:false with no token;
no config/credential/integration change occurs. Exact9deef65 CI36530037917 is
green3/3 and Claude Message46 finds no blocker in that revision. Current source
still requires new CI/review. Timer/Discord proof, producer tick gaps, complete
static inventory, detached controller/restoration and healthy cold masters
remain open. KERNEL_EVENT_EVIDENCE.json records pins, paths and these limits.

### Durable kernel correction — 2026-09-29 02:50 EDT

Private tools-v49 passes21 real Mac controls/1 explicit domain skip; all22
owned job labels are unloaded in both domains and the owned NATS server exits0.
The new control injects actual EVFILT_USER with the bound owner PID, refuses
without stopping it and reads its raw event back from a durable failed record
after journal reopen.56 journal controls pass, including failure-evidence
reopen. v47/v48 fixture-layout mistakes are retained as refused, not accepted.
Both predecessor19243eb CI runs green3/3 and Claude Message48 finds no blocker.
New exact CI/review required. No production quiet window or cold copy occurred.

### Stable process-evidence keys — 2026-09-29 03:09:24 EDT

Private pid-key-regression-v1 reproduces old2c0b7b6 verified/failed mixed-width
PID hashes failing after reopen, while same-width control retains three
records. New strict encoding rejects nested non-string keys before writes;
string-PID verified/failed chains re-open all records, restore and resolve.
58 journal tests pass; private tools-v50 passes21 real Mac controls/1 explicit
domain skip, owned NATS exits0 and all22 owned labels are unloaded in both
domains. Public sanitized pins/limits are in PID_KEY_EVIDENCE.json.
No production journal exists or was repaired. No cold-copy acceptance.

### Full-node baseline class check — 2026-10-01 00:01 EDT

Read-only launchd/plist inspection after the VM restart observed all 20 fixed
units. The original schema refused a truthful baseline because mesh-agent was
loaded, not running and not disabled. Standalone NATS and members 2/3 were
running on their existing 4222/8222, 4223/8223 and 4224/8224 listeners;
member 1 remained unloaded and disabled. The standalone bus had five open
clients, so no quiet window was inferred. With D21's on-demand class the same
structural capture passed `valid_prior`: 20 units and 54 directly hashed files.
These hashes do not cover transitive source/dependency closure or loaded
process provenance. The production preservation controller and restoration
adapter remain absent, and no service, stream or backup state changed.

Focused positive/negative class and running-worker recovery tests pass. The
full Journal suite passes 65/65; the owned Mac restore-only suite passes
27/27. A disposable journal showed the frozen 3.11 parser renaming a newer
full-node receipt before refusing; the revised current parser refuses an
intact unsupported baseline without moving the receipt. On the live node,
`timer-transition-active` is absent and `timer-entry-installed` is present;
that protects only the current timer receipt. Claude's exact-head scratch
emulation showed the frozen controller can rename a later full-node receipt in
`restored` state if `--commission` is rerun. Replacing or retiring every
invocable old bundle with a compatible protected controller is a hard prerequisite before
the first full-node journal. The current frozen controller was not invoked.
The two Mac timer-controller suites pass 16/16 at PR #167's initial code head;
the only existing journal baseline is timer-scoped and has no `known-broken`
class. CI unit tests passed on Node 20 and 22 at the earlier code and
documentation heads. The first run on the runtime-evidence head hit an
unrelated mesh-collaboration test failure on Node 20 and canceled Node 22;
its rerun and the subsequent 7d6b10f run passed Node 20 and 22. Their Mission
Control jobs failed on the old Next.js lockfile. PR #168 merged the patched
Next.js 16.3.8 lockfile as a794c26; the recovery branch then merged that main
commit, and its Mission Control job passed.
No actual full-node recovery or cold-copy acceptance is claimed.

### Compatible timer-controller bundle — 2026-10-01 00:21 EDT

The current source was staged as a private, protected bundle at
`~/.openclaw/backups/node-readiness/timer-hold-controller-20261001-4/` and its
manifest verified in place (SHA256
`eb09340de6284e7f65cbc648c4ca5205b7bcca94fa3388fecff42e43346d7258`).
The manifest pins `preservation_journal.py` at
`005087222475d7556e4c54f03cf1a1245847a5b8ca3a6bd7adebf9203f62d378`,
the PR's compatible parser. Its other file hashes are
`timer-hold-control.py` `032f33f01e83c8b6b8fcbd121cfe38aa063a4d353ed206ebd058d5714c33cef1`,
`install-timer-hold.py` `637137129e7d40373040d92db5a80fc3e7afe6cc14e6f54bb7a4a4fd8663e939`,
`preservation_checks.py` `bf7e1466c4be5fe3a7ad1eaa3771b84f6e7a424d2ab4144e4b1068b45ca4259c`,
and `journal_hold.py` `713c680231847d22a913e510e4f2de5caf7080ae0d72eafdd1dee12983e43337`.
The three earlier controller bundles were moved intact to sibling
`.retired-timer-hold-controller-20261001-{1,2,3}` directories, each mode 000;
their original paths are absent. Their retained manifest hashes are
`624ba9cd7568e246ff74e3422f5026f08b45cf457bfa9895a0ddef6976550295`,
`4193b948ab307994ca92e23c63b6f30be7eabfa2b4f5aa22ab22724b5f3d0fa2`
and `bec1e5af6a9db7c6b2c0230d494471c4f211e74c6488bbf7ca356fb801a404e6`.
No running controller or LaunchAgent/bin/preservation reference to those paths
was found before retirement. Afterward the new bundle still verifies; the
live receipt remains `restored` on timer window
`timer-88ee57ba9644fff17f253319c70f63f4`, transition-active remains absent,
and timer-entry-installed remains present. No controller commission/recover
operation or service mutation occurred. This removes the known frozen parser
entry points, but it does not establish production preservation readiness.

### Multi-domain entrypoint refusal — 2026-10-01 01:29 EDT

Read-only inventory across the user LaunchAgents, system LaunchAgents and
LaunchDaemons, and the GUI/user/system launchd domains found 25 installed
OpenClaw-labelled jobs: the proposed 23-unit user cohort plus
`com.openclaw.agent` and `com.openclaw.tailscale-up` in the system domain.
Twenty-one approved jobs were GUI-loaded, none user-loaded, and the two system
jobs were loaded. Eleven old `.plist.disabled` artifacts were hashed separately;
they are not loaded entries. The widened code preflight returned an explicit
refusal, not a preservation baseline.
The owner-private, fsynced hash-only record is
`~/.openclaw/backups/node-readiness/entrypoint-preflight-20261001-1/evidence.json`
(SHA-256 `5366a167ddcfe222b0a33dbaa7907b1db943b0134710de6f26959af0efae8502`).

`com.openclaw.agent` is a root-owned KeepAlive job whose plist points to the
missing legacy `~/openclaw/agent.js` and declares a NATS URL. Its system
launchd record advanced from 1,762 to 1,789 runs during this read-only review,
last exit code 1, with matching module-not-found diagnostics. It has no current
PID, but an absent source today is not a durable exclusion if a deployment can
recreate it. The root-owned `com.openclaw.tailscale-up` one-shot is loaded,
not running, run count 1, last exit 0; a static exclusion and unchanged-state
check remain unimplemented. Noninteractive administrator access was unavailable
(`sudo -n` required a password), and no attempt was made to change either job.

The viewer's `run-once` route detaches plan ticks, and its load/unblock/config
routes can alter launchd jobs. The gateway still has a live task SQLite handle;
its configured token field is empty and its companion listener on :8787 was
absent at observation time. These observations do not prove a quiet window.
The new 23-unit Journal scope and multi-domain preflight are source work only;
the protected timer controller `-4` serves the existing timer receipt and
safely refuses a future 23-unit full-node receipt. No service was stopped,
started or reconfigured; no JetStream cold master was taken.

### PR #169 adversarial correction — 2026-10-01 01:55 EDT

Claude's exact-head review of b0669c7 reproduced a scope omission and three
inventory counterexamples in scratch. It also verified the protected timer
controller `-4` leaves a full-node receipt intact when refusing it. Source now
requires an explicit scope for each new journal, captures the multi-domain
entrypoint evidence into a full-node baseline before publishing it, and checks
the inventory before mutations/recovery and at final restoration/sealing. The
scanner inspects neutral-label loaded jobs and additional plist entry forms;
the deploy listener is stopped first and resumed last. Owned journal and
inventory tests pass on the corrected source; exact CI and another Claude
review remain pending. A read-only scan with the tightened scanner still
reports 25 installed, 21 GUI-loaded, zero user-loaded and two system-loaded
jobs, and refuses the same two unmanaged system jobs. No live hold, service
stop or cold master was attempted.

### Scanner and sealing follow-up — 2026-10-01 02:29:15 EDT

Claude's d7fc991 review found three plain-plist scanner bypasses: a wrapper
with a relative script argument, a versioned Python interpreter, and a
hard-linked script in a wrapper argument. Owned regressions reproduce all
three and the corrected scanner detects them. It resolves relative arguments
against `WorkingDirectory` and checks every existing path token for a hard
link. System-library jobs and dynamically registered app-bundle executables
are exempt from the hard-link heuristic; otherwise unrelated macOS jobs were
false positives. A read-only scan inspected the installed plist directories
and GUI/user/system loaded domains in 4.75 seconds: 25 installed (23 approved
plus the two root jobs), 21 relevant GUI-loaded, zero user-loaded, and the two
root jobs system-loaded. No additional job was classified after those bounded
exemptions. The preflight still refuses a new full-node journal.

The same review showed that point-in-time scans can miss a stopped writer
which restarts during a copy and exits before the next scan. Full-node sealing
now refuses until a continuous launchd/process watch supplies continuity
evidence. Restore-only resolution still rechecks the original installed and
loaded inventory. The listener's child check narrows deployment risk but does
not prove its asynchronous `deploying` flag is false; the full driver must
obtain that proof and rule out pending catch-up before restoration completes.
No production service was stopped or modified, and no cold master was taken.

### Closed-world launchd scan in source — 2026-10-01 02:58:37 EDT

The next source branch reverses the scanner's default for standard non-system
plist directories and loaded GUI/user/system jobs: an ordinary job is now
included unless its resolved launchd source and executable are root-owned,
non-group-writable files in an Apple-managed system tree.
Empty `{}` legacy plists are recorded separately by path and hash; nonempty
unlabeled plists refuse. Neutral wrappers and self-declared `com.apple.*` or
`application.*` labels no longer escape solely because their executable is
outside known OpenClaw roots.

The read-only host scan found 28 installed labeled jobs: 23 proposed cohort
members and five extras (`com.google.GoogleUpdater.wake`,
`com.openclaw.agent`, `com.openclaw.tailscale-up`, `com.tailscale.autostart`,
`meshagent`). Two empty Google Keystone plists are inert artifacts. It found
25 GUI-loaded labels (21 cohort, four extras), zero user-loaded, and five
system-loaded extras. The extras are not accepted exclusions; a full-node
baseline still refuses. Ninety-one focused scanner/journal tests pass on this
source. No live hold, job mutation, or cold NATS master was attempted.

The same branch now binds launchd's explicit `Program` executable in the
static file hash and compares the loaded program with the plist before a
managed stop. A scratch plist with a custom `ProgramArguments[0]` and a
different `Program` exercises the precedence case. The managed Mac and
journal suites pass 97 tests with one explicit domain-specific skip; their
owned NATS server reports no production connections.

Claude's subsequent read-only challenge showed that even a runningboardd
registration does not prove a GUI app cannot run user code. The source no
longer exempts such apps: the conservative read-only scan now finds 50
GUI-loaded labels (29 beyond the cohort), zero user-loaded, and 11
system-loaded extras. The strict parser refuses unparsed or duplicated rows
and checks that a real `launchctl print` detail names the listed job. Apple
provenance now resolves actual paths and requires root-owned, non-writable
components instead of trusting a `/System/Library` text prefix. The managed
process binding parses only the real environment section, records every
effective variable hash, and refuses undeclared or code-loading variables.
None of these changes opens a preservation window; a complete exclusion
policy and a continuous or effect-based copy fence remain unproved.
The preflight now captures a hash-only environment and argument identity for
each loaded job and requires each approved loaded source path, effective
program, arguments, working directory and declared environment to match its
installed plist. The journal rechecks the identity of each still-loaded job
through forward work and final restoration. This closes same-label reloading
from a different plist without claiming that a point-in-time scan detects a
load-run-unload between scans.
The combined scanner, journal and managed Mac suites pass 120 tests with one
explicit domain-specific skip; the owned servers made no production NATS
connections. No production job was stopped or changed.

An additional private temp-file control tested the proposed copy freeze on
this Mac. After setting `UF_IMMUTABLE`, `open(O_WRONLY)` failed with EPERM,
while `pwrite()` through a descriptor opened before the flag succeeded and
changed the byte. The flag was cleared and the temp file removed in the same
control. This confirms that freeze cannot be certification unless all
pre-existing writable handles and mappings, including root processes, are
ruled out before the flag is applied. No live store flag was changed.

Claude's read-only review at PR #170 head `25d2d24` reproduced three
source-level bypasses in scratch: extra or inherited loaded environment
variables, stripped trailing argument space, and Apple provenance reached
through a writable symlink. The later local source checks the original and
resolved path ancestry, preserves printed argument bytes, parses inherited,
default and job environment blocks, and refuses undeclared or loader
variables even when a plist declares them. The real gateway's loaded
arguments matched its installed plist, and all 15 effective environment
keys passed the shared policy without exposing their values. Four installed
mesh plists still carry `NODE_PATH`; no live plist or process was changed.

An owned temporary LaunchAgent showed launchd prints literal newlines in an
environment value. A value can visually close its `environment` block before
the next variable line. The scanner now refuses any variable-shaped line
outside the parsed environment blocks. All 21 currently loaded approved GUI
jobs still parse; the owned probe was booted out and removed.

Claude's follow-up at head `1efb819` re-ran P1–P6 and found all six refused,
then raised a new raw-newline argument/cwd spoof. An owned Mac LaunchAgent
with an argument containing `a\n\t}` confirmed launchd emits those bytes
literally. The later scanner rejects unmatched section boundaries, duplicate
path/program/cwd fields, variable-shaped rows outside environment blocks,
reordered environment blocks, and the additional Python and `LD_*` loader
names. Its 21 currently loaded approved GUI jobs still parse. This is a
fail-closed text check, not a structured attestation for idle jobs. The
temporary probe was booted out; no production job was touched.

Read-only inspection of the three installed NATS plists and their config
files places `jetstream`, `jetstream-2` and `jetstream-3` on the same APFS
Data volume (`/dev/disk4s5`). This satisfies the single-volume precondition
for an APFS snapshot design but does not prove privileged creation, mounting
or a cold writer-free instant. No snapshot was created.

2026-10-01 04:17 EDT — PR #170 head `43ae5a0` passes Node 20, Node 22
and Mission Control CI. The complete owned Mac Python recovery suite passes
187 tests with one explicit domain skip, three owned cluster servers and no
production NATS connections. Its only earlier failure was a test fixture
pointing at absent `/bin/false`; the corrected `/usr/bin/false` control passes.
The tree is clean after push. Claude's exact-head scratch probes found no
source defect that defeats the fail-closed checkpoint; balanced newline
spoofs still pass the text parser, as D26 declares. The live full-domain
read-only scan refuses some honest Apple job output before classification,
so neither scan availability nor idle-job attestation is accepted. The
three live NATS store roots share device 16777233; no live store was copied,
snapshotted, stopped or changed. See D27 for the restoration and APFS
carry-forwards.
