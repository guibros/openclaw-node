# DECISIONS — node-bus-lifecycle (append-only)

## D1 — Distinguish planned drain from permanent loss (2026-09-28 10:05 America/Montreal)

**Decision.** Set a main-local shutdown flag before the first shutdown action. Suppress the permanent-close exit only while this requested shutdown owns the drain. Ignore repeated SIGTERM/SIGINT after the first. Keep unexpected permanent close at exit 1.

**Why.** The real idle task daemon exited through the startup closed callback during its own drain. The preservation guard refused and restored all clients before any healthy bus stopped.

**Consequences.** Modify only the existing daemon lifecycle. Verify a real process with owned authenticated NATS and isolated HOME. No claim about completion of untracked in-flight async application handlers.

## D2 — Preserve live source drift in a narrow release (2026-09-28 10:05 America/Montreal)

**Decision.** Build a private staged release from the immutable live e57f89b tree and apply only the lifecycle diff. Keep its dependencies and working directory explicit, change only the task-daemon unit entry, and preserve the old unit for rollback.

**Why.** Copying current-main's whole daemon file would also deploy terminal-task guards during a lifecycle repair. The running repo must remain untouched.

**Consequences.** Source review covers the minimal diff on main plus the same minimal diff on e57. Stage probes use launchd's actual Node. Deployment requires a fresh idle proof, clean SIGTERM completion, managed restart and read-only service probes. Existing viewer release/plan roots remain unchanged.


## D3 — Preserve the actual unset working directory (2026-09-28 10:13 America/Montreal)

**Decision.** Preserve the task unit's unset WorkingDirectory; only replace its absolute entry argument. Record the observed process cwd `/` explicitly in the release evidence. This supersedes any reading of D2 as setting the task unit cwd to the repo.

**Why.** Fresh plist inspection shows no WorkingDirectory and lsof reports PID 93906 cwd `/`. The daemon uses entry-relative role/module paths and has no process.cwd reference. The viewer's separate original-repo cwd is unaffected.

**Consequences.** Do not introduce an unrelated directory behavior change during a lifecycle repair. Preserve the existing environment/dependency paths byte-for-byte.


## D4 — Separate the remaining managed-client drain repairs (2026-09-28 10:22 America/Montreal)

**Decision.** Keep task-daemon 1.1 unchanged. Add queued atomic 1.2 bridge and 1.3 worker steps before retrying node-state-recovery 1.2. Each closes only with its own real-process and managed-runtime proof.

**Why.** The live bridge stop log confirms the same permanent-close race. Claude reproduced it in both idle current-main bridge and worker; live source has the same callbacks. The preservation guard must not be relaxed to accept vanished processes.

**Consequences.** This is a plan re-orientation, not a widened task-daemon implementation. No bridge/worker code is edited before 1.1 closes. The active-submission partial-work defect feeds node-readiness 4.1 and remains outside these idle stop contracts. Production-resource test isolation remains node-readiness 2.1; full suites stay in isolated CI.

## D5 — Bridge owns shutdown only at its drain boundary (2026-09-28 10:42 America/Montreal)

**Decision.** Set a main-local draining flag immediately before the existing bridge drain. The permanent-close callback returns only after that boundary. Preserve the signal handlers, dispatch/reconciliation loop, subscriptions and timers.

**Why.** SIGTERM only requests the polling loop to finish; loss while it is still finishing must remain an unexpected-loss exit. Fresh source inspection shows the bridge has no Mission Control HTTP dependency: the owned fixture needs its actual kanban and observability files, not an invented MC service.

**Consequences.** Test real subscriptions and a harmless wake as readiness; include unexpected loss both normally and after a stop request while the poll is still sleeping. Stage only this patch onto e57; preserve all unit values except the entry. Active event-handler/file-write completion is not established by this idle contract.

## D6 — Reject a drain that only appears to finish (2026-09-28 10:50 America/Montreal)

**Decision.** Preserve error-bearing permanent-close exit 1 during requested drain, and require the connection to actually be closed after drain resolves before emitting Bridge stopped.

**Why.** Claude found, and the exact Mac fixture reproduced, SIGTERM followed by owned server loss with the production 10s poll: the NATS client's protocol drain swallows a rejected flush. Candidate 737a713 logged completion at 10s while reconnecting, then exited 0 at 21s. A resolved drain promise alone is insufficient.

**Consequences.** Add the production-interval loss regression. Retain ordinary connected idle-stop semantics, repeat signals and normal/default polling behavior. Do not deploy the superseded candidate. This is a correction to 1.2's lifecycle acceptance, not a new application-work drain claim.

## D7 — Track task-daemon outage semantics as a distinct follow-up (2026-09-28 11:13 America/Montreal)

**Decision.** Queue atomic 1.4 after worker 1.3 for actual-closed and error-bearing-close checks in the task daemon. Preserve 1.1's accepted connected, idle planned-stop contract and its runtime evidence.

**Why.** Claude independently reproduced early bus-loss/shutdown overlap reporting completion while not closed, and late request-subscription drain loss exiting 0 silently. The daemon's KV operations create the request subscription. These are separate from the original deliberate connected-close race.

**Consequences.** Do not fold the daemon fix into bridge 1.2. Reproduce and test both failure paths with owned resources before a new narrow deployment. Healthy bus preservation keeps its no-disconnect/reconnect and idle gates; never treat vanished PIDs as completion. General active async work remains node-readiness 4.1.

## D8 — Worker owns drain at the boundary and retains real closure failures (2026-09-28 11:22 America/Montreal)

**Decision.** Apply the reviewed bridge lifecycle conditions to the existing worker: main-local flag at drain, only error-free deliberate close suppressed, and actual closed state required before completion. Preserve polling, provider choice, signals and application handlers.

**Why.** The owned real worker answered alive=false/task_id=null after a real empty daemon claim, then exited 1 through the old permanent-close callback during its own SIGTERM drain. Its claim/recruiting requests create the request subscription, so both bridge failure conditions are required.

**Consequences.** Eight real owned controls cover connected TERM/INT/default 15s polling, held drain/repeated signals and early/default/late permanent-loss boundaries. The fixture explicitly chooses a provider but launches no model because the owned task service is empty. Runtime release preserves e57 drift and the original unset cwd. Live acceptance is strictly idle/no-claim; general active handlers remain parent 4.1.

## D9 — Preserve the worker's actual managed start policy (2026-09-28 11:30 America/Montreal)

**Decision.** Keep the live worker's KeepAlive=false, RunAtLoad=false and ThrottleInterval=30 unchanged. After a proven natural exit, explicitly kickstart the existing loaded unit for the managed restart acceptance. Bootstrap alone is not worker readiness.

**Why.** Fresh actual-unit inspection matches the source template: launchd does not auto-restart this worker. Its configured workspace is ~/.openclaw/mesh-workspace, not the primary code checkout. Startup reconciliation can mutate kept mesh branches, so enumerate that actual workspace before any restart; the fresh count is zero.

**Consequences.** No unrelated supervisor-policy change in the drain repair. Record exit status before kickstart, preserve both primary and actual worker-workspace HEAD/status, require zero kept mesh branches and an actual idle alive reply. General service lifecycle/reproducible installation belongs to parent 1.5/2.2.

## D10 — Prove the worker boundary and preserve old idle artifacts (2026-09-28 11:49 America/Montreal)

**Decision.** Nine owned controls include a measured-budget late loss, actual drain-start marker, explicit early ordering and claim-anchored held drain. Track preservation of the nine old runtime directories in a separate private journal; they are not an idle-stop prerequisite because the worker never enumerates the base. Before live deployment verify the actual worker workspace has only its main registered worktree, no kept branches, no leases or owned pending review, and observe queue/recruit conditions continuously.

**Why.** Fixed polling offsets can catch a different failure path, and a leftover directory is not a proof of active work or safe deletion. Seven have already lost their original Git metadata; two are clean benchmark worktrees. Fresh read-only probes found no open files.

**Consequences.** Treat old eight-control timing evidence as superseded. Leave the nine old directories unchanged during 1.3. Their preservation and the unsafe task-ID collision cleanup feed parent 4.1. A future private preservation journal must retain content, metadata, branches and primary refs, with reversible same-volume moves. Compare primary and actual worker-workspace HEAD/status during 1.3; signal only after an actual null worker claim. General active handler completion remains parent 4.1.

## D11 — Explicit task-drain failure and loss-relative controls (2026-09-28 12:27 America/Montreal)

**Decision.** Keep 1.1 intact; in separate1.4 suppress only error-free requested close and explicitly log/exit1 when drain returns without actual closure. Calibrate the late outage test from actual daemon disconnect/permanent-close timestamps; require drain before permanent close and no earlier open-drain failure.

**Why.** Owned Mac controls reproduce both false completion and silent exit0. The daemon’s shutdown is an async signal callback outside main’s catch; a throw would depend on unhandled-rejection policy. Claude message123 requires explicit failure and loss-relative timing.

**Consequences.** New e57 release, never edit the running 1.1 release. Managed idle signal follows a real worker null claim; refuse handler-error lines, permit healthy pingTimer, preserve dependency/unit values and startup-prune/task state. Task service remains available until worker exits during preservation. Active application drain stays parent4.1.

## D12 — Lifecycle block closure and preservation re-orientation (2026-09-28 13:31 America/Montreal)

**Decision.** Close1.4 only on exact owned negative controls and accepted connected managed deployment. Return to recovery1.2 with all three actual entry/dependency assertions, fresh prune eligibility, checked natural client stops, observers closed and continuous65s zero connections before healthy NATS stops.

**Why.** Attempt5 meets the written contract and Claude141 accepts. Four previous refusals reveal verification risks, not license to relax state preservation. Attempt2/3 timeout/guard causes stay unresolved; no queue-overload explanation is adopted.

**Consequences.** Preserve the primary e57 tree and prior releases. Carry10s observer deadlines plus latency/lag/holder diagnostics into the next preservation harness. Define normal stop evidence for each other client from code; worker must exit before task service stops. Parent coordinated recovery, source/dependency reconciliation, direct-KV authorization, active handlers and actual two-machine acceptance remain open. No new autonomous tick is enabled.

## D13 — Task readiness includes server registration (2026-09-28 23:27 EDT)

CI36514681814 failed the main-merge worker fixture at its first task-list RPC,
line113, with503. The task daemon subscribes and logs ready without flushing;
its prune invocation is deliberately unawaited. Claude's owned stand-in
reproduced8/100 no-responders and0/100 with flush, not yet the real daemon.
Open separate2.1, preserve drain1.1/1.4, and verify real startup before adding
one flush barrier immediately before the ready declaration. The request test
must not retry away this contract. Stage the same narrow diff onto the accepted
e57 cumulative task-outage release. Full tests run only in isolated CI; managed
deployment still needs its own idle guard and state-preserving evidence.

D13 evidence update (2026-09-28 23:48 EDT): the real dad1e7b daemon, not a
stand-in, got66/100 immediate503 and34/100 success. The one-line candidate got
100/100 success;200 normal daemon stops, no retained connections or cleanup
failures. New regression holds the return of a real flush and injects its
rejection. It proves awaiting/failure behavior, not delayed wire propagation
or actual server loss. Existing1.4 controls retain real outage coverage.

## D14 — Separate installed-runtime continuation from a refused verifier (2026-09-29 00:31 EDT)

Attempt3 installed the narrow readiness layer and passed real exit/RPC plus
65s state checks, then failed only owned observer-process cleanup. Preserve
that attempt as unaccepted. An isolated cleanup control confirms stdin's open
handle; a corrected read-only continuation, without another production restart,
binds the same process/CID, compares the original selected task rows and KV
sequence counters across the gap, and closes both fresh observers normally.
The continuation is distinct evidence of the installed runtime. It does not
turn the failed orchestration into success or prove a general preservation
driver. Real staged controls prove awaiting the final flush; log-tail RPC is
health only. Registration acknowledgment belongs to the connected server;
remote route interest is asynchronous. Independent closure challenge is still
required, with main-merge integration CI before the recovery baseline.

D14 closure(2026-09-29 00:41 EDT): Claude34 accepts the narrow outcome with
raw transition hashes, explicit EXITSTATUS request/echo and local-gap/worker
counts. A final SAME-source restart saves all transition checkpoints before
observer cleanup and meets those conditions: owner72174 exit0, current82096,
65s pre/post guards,31checks,zero worker requests during419ms pause, unchanged
selected task/KV/other-owner state, both observers exit0. Its local4222-only
scope is explicit. Earlier failed runs stay unaccepted. Close2.1; merge149
before recovery144's new main-integration CI. Block2 is complete; re-orient to
recovery1.2, with no production baseline yet and managed cold-copy proof open.

## D15 — Use a durable scheduled-application hold (2026-09-29 03:11:58 EDT)

**Decision.** Follow Claude50/52's foreground-only execution gate: shared lock
before marker inspection, durable closed marker before exclusive drain, keep
timers loaded and inert, reopen only through verified recovery. This specific
application-execution hold is the new documented exception to recoveryD8's
bootout-only ordinary holds. No repository write/scope approval gate returns.

**Why.** Idle logs/PID sampling cannot prove a scheduled job did not start.
A measured spawn minimum is not a hard scheduling bound. Four real exec
controls show Node/shell preserve the lock only with explicit inheritable FD.
Node child processes can close it, so arbitrary descendant coverage is false.

**Consequences.** Separate primitive3.1, full foreground/deployment/journal
integration3.2 and disabled Discord3.3. No production hold exists yet. Invalid
metadata/symlinks fail closed; owner-private lock and directory inode identity
are pinned and watched. A controller crash or deadline refusal retains the
marker for explicit recovery. Kernel events have a4096-event refusal bound.
Linux continuous-watch acceptance is separate and unproved. Consolidation's
unawaited notification must finish before installation, and delegated memory
work still needs its own idle proof. Unknown callers are inventoried writers.

## D16 — Independently pin timers and certify only the original observer interval (2026-09-29 03:57 EDT)

**Decision.** Require an external lock device/inode/ctime pin in every runner
and controller. Capture full root/marker/object identities and a pre-publication
watch-session id. Reattach is the separate restoration-only type and can never
certify across controller loss. Native mapping/file failures permanently refuse
the original session. Tolerated identity-stable ATTRIB counts are separate from
the refusal-event budget.

**Why.** Owned parent substitution can run a fresh self-described gate; ancestor
watches alone detect it only with the old observer alive. Receipt bytes can
still match after mapping restoration. Interpreter/module-path substitution
remains outside gate-file coverage. SIGKILL is not VM/power-loss proof.

**Consequences.** Correct only primitive3.1 now. Keep3.2 locked on external
loaded pins, real interpreter -I -S, protected/watched code path, foreground
completion, sole journal intent/receipt, explicit interrupted recovery and
re-closing a broken/missing hold before dependency restoration. Never install
this primitive as a standalone production safety mechanism.3.1 remains active
until corrected exact CI and independent source challenge pass. Original
D15's4096 bound now applies to refusal evidence; tolerated events use counts.

D16 clarification2026-09-29 04:09:49 EDT: both lock device/inode/ctime and root
device/inode are independent mandatory installed pins, checked by controller
and runner. Root ctime stays in the post-publication receipt, not the stable
installed pin because our own publication changes it. Claude60 accepts the
primitive shape; interval-bracketed same-session checks and deploy target
exclusion/pin recapture remain3.2 requirements. Timeout recovery must record
its straggler/refusal and retain the hold until owned completion is established;
it does not create a new certifying window. No production integration yet.

## D17 — Close the owned primitive and atomize integration (2026-09-29 04:38 EDT)

Close only3.1's written private-consumer contract. Exact source0f0dcc2 has
Claude62 source approval, Claude64 artifact-hash linkage and3/3 exact CI.
New actual Mac proof drains a genuinely active fire before return, keeps159
individually normal fires inert for365s and resumes application work on real
reopen. Kernel process-exit ordering and raw evidence are retained; this is
Codex's Mac observation, not a remote reviewer's independent runtime run.
No production gate or dependency stop is authorized by this prototype alone.

Protocol5.3/11 requires splitting the broad3.2 before implementation:
3.2 owns complete local consolidation invocation lifetime, including event
publication and non-detached foreground notification;3.3 remains disabled
Discord;3.4 owns sole-journal interrupted holds;3.5 owns actual Mac timer
installation.3.4 precedes3.5, and code/deploy pin protection is a3.5 prerequisite.
Optional `_drained_guard` hardening is recorded for3.4. Linux continuous-watch
acceptance feeds the agnostic parent installer, not this Mac evidence.

The current scheduler returns at cancellation before its cycle settles, and
max-age guarding can orphan it. Both event emissions are unawaited, as is the
notification child; Linux's CLI can also detach a click waiter. Those local
invocation lifetimes are one3.2 outcome. Remote inference, other invokers and
general memory-daemon shutdown remain separate unresolved boundaries. The
primary live tree, shared dependencies and loaded units stay preserved.
