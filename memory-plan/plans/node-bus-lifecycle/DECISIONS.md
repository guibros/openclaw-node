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

## D18 — Cancellation requests do not certify local completion (2026-09-29 05:00 EDT)

3.2 owns the complete existing consolidation invocation: cycle cleanup, its
analysis request, event publications and foreground notification. Retain its
single-flight guard and the analysis queue slot until actual local settlement,
even if cancellation is ignored. Remove age-orphaning only for this scheduler;
propagate cancellation through the real summary/client/queue path and curtail
new writes/stages after abort. Stop fences new invocations and awaits existing
work before the two callers' teardown. Scheduled maintenance must let active
fires drain naturally; await does not defeat launchd's forced-stop budget.

The five-minute value is a cancellation deadline, not guaranteed wall-clock
termination for arbitrary synchronous/uncooperative work. Real HTTP controls
prove local client completion only, not remote inference cancellation. Await
existing best-effort event publication without changing reliability semantics.
Foreground failure notifications exclude detached Linux click waiters and
complete before invocation release. Other invokers and general daemon-drain
remain3.5/parent work.3.2 uses private deployed consumers; production timer
installation remains the separate3.5 acceptance contract.

D18 closure2026-09-29 05:26 EDT:source159b8dd approved as-is by Claude72/74;
Linux158 reproduced, exactCI36547696359 green3/3. Actual private Mac gate
retains ownership through cleanup and notification CLI/platform child, then
normal exit0/drain/reopen. Real staged atomic-write control stays owned through
abort, finishes sync/rename before return; accepted snapshot unchanged. Seven
old-source controls fail. Close only3.2's written private-consumer contract.
Outer notify timeout withdrawn: direct-child kill can orphan the platform
grandchild, a race can return early. Partial-result audit/duration visibility
carry forward as separate parent observability work.3.3 next; production timer
installation/general daemon/preservation proof remain open.

## D19 — Explicitly disabled Discord is successful inactivity (2026-09-29 05:34 EDT)

Strict channels.discord.enabled=false returns0 before runtime imports/token
lookup and bus/state admission. Missing-enabled legacy token behavior remains;
malformed config or enabled failures remain exit1. Conditional unsuccessful
exit restart replaces unconditional restart, preserving RunAtLoad/Throttle.
Permanent NATS close's resolved error must propagate as failure so this policy
does not silently suppress enabled recovery. No general handler-drain repair.

The actual disabled/no-token/zero-account config remains unchanged. Only the
tool entry and KeepAlive change in a narrow e57 runtime release. Acceptance
requires real private Mac supervisor controls and stable loaded/not-running
live exit0/no Discord admission. Linux Restart=on-failure is source policy,
not independently observed systemd runtime.3.3 does not enable Discord or
install production timer holds/preserve the complete node.

D19 closure2026-09-29 06:12 EDT:exact f21c6df source approved by Claude80,
Linux10/10 reproduced and CI36551411822 green3/3. Actual new-path e57 release
d1341cfa and rendered6f532574 plist ran once normally after bootout/bootstrap.
Fresh same-unit65.402s/84 samples are loaded/not-running/run1/exit0, with
configfalse/no-token unchanged and13 other owners stable. First too-broad
all-node-admission window remains refused on a later health-watch connection;
no preservation or unseen-gap certification. Claude84 accepts qualified
reasoning/source facts;85 clarifies unchanged old entry and plist rollback.
Close only3.3 disabled-inactivity. Prioritize the separately tracked false
BROKEN monitoring correction next, before journal/timer integration and any
new preservation baseline. No original source/config/dependencies overwritten.

## D20 — Surface confirmed inactivity before further preservation integration (2026-09-29 06:22 EDT)

Claude84/86 identifies the standing false-BROKEN left by3.3. Make its monitoring
correction the next independent atomic3.4, before any new production baseline.
The previously queued journal3.4 becomes3.5; timer installation3.5 becomes3.6.
Historical references in existing decisions/audits/PRs remain unchanged and
refer to that original numbering; this entry is the explicit mapping.

Read Discord's effective config from the HOME observed in its loaded launchd
environment, matching the actual tool's HOME/.openclaw/openclaw.json. Do not
use a different watcher's override to manufacture explicit-false evidence.
Only strictfalse/loaded/not-running/lastExit0 qualifies as optional OFF within
the existing mesh aggregate. Required stopped units, failed exits or a disabled
running Discord remain BROKEN; missing lifecycle/policy/observation evidence
cannot earn health. Existing unloaded role behavior remains. No new target,
daemon, integration enablement or other failure repair.

Stage only the monitor diff on its actual separate viewer-b4bbac2-e57 release,
retaining authenticated viewer discovery. Change only its managed entry path,
preserving schedules/arguments/env/cwd; prove normal managed stop/restart and
two actual reports. Record other remaining failures honestly. Full quiet-window
and healthy-store preservation still require3.5/3.6 and recovery1.2.


D20 closure clarification (2026-09-29 06:57 EDT): net.mesh is the single
graded aggregate; DiscordOFF lives in its detail/evidence, not a new cell.
The actual source change moves20W/7B/3OFF/6U→21W/6B/3OFF/6U. Additional
paired current full36-target observations show only net.meshBROKEN→WORKING;
a historical full pre-swap matrix was not captured and is not asserted.
The qualified current OFF neither reads loaded KeepAlive policy nor certifies
arbitrary source identity/perpetual terminal state. Disabled-running remains
BROKEN when observed; polling need not catch every short restart. Those
stronger preservation/static-identity contracts remain3.5/3.6/recovery1.2.

## D21 — Journal-owned interrupted holds restore without certifying lost history (2026-09-29 07:51 EDT)

Claude101–104 and the controller implementer agree: one existing Journal,
with a complete immutable baseline carrying the hold descriptor inside the
heartbeat state. Its declared timer cohort, external root/lock pins, metadata
identity/hash and path mappings are saved before any mutation. New recovery
observers validate those saved pins; there is no autonomous installation or
pin recapture. Each durable close intent has a unique random nonce window.
Publication records the full receipt before exclusive foreground drain. Only
the original native closed observer may bracket every forward stop/copy.
The guard constructors live inside actual exclusive drain blocks, not an
un-drained reusable factory. Restoration guards carry neither verified nor
watch-session certification fields.

An intent without marker or receipt is ambiguous: absence cannot prove the
hold was never published. Full baseline service plus physical readiness may
leave that already-open gate open and resolve only. Any incomplete readiness
or later need to mutate a dependency requires a durably journaled protective
restoration-only close/drain first. An owned matching marker with a receipt
gap is adopted only against one unique durable live intent and all unchanged
immutable pins; a persisted receipt whose marker vanished always forces a
new protective close. Any interrupted/adopted/reclosed window can only
restore/resolve, never seal copies.

A durable failed-window record and protective/reopen intents precede their
actions. Write failure aborts hold-coupled recovery before further dependency
mutation, unlike the existing generic journal's deliberately degraded recovery
for baselines without a hold. Supersede the prior live hold intent durably
before creating a protective nonce: repeated controller deaths retain at most
one live intent, with historical records preserved. Before every dependency
restoration, validate its drained hold; this also covers readiness loss after
the ambiguous-open classification.

Full baseline readiness (including unmutated services and held member1), final
physical readiness and durable recording must pass before the mandatory hold
completion hook, recovery-finished and restored receipt. Heavy checks occur
outside the exclusive lock. A required fast full-baseline recheck runs inside
Gate.reopen before unlink, followed by receipt revalidation. This excludes
gated application execution during that final check; it cannot freeze unrelated
services after an observation. A failure before unlink retains the hold; a
crash or record failure after unlink remains unresolved and re-closes on retry,
without pretending that the marker stayed physically present.

3.5 is confined to real owned private Gate/Journal/controller/foreground
controls plus exact CI and independent source review. It does not deploy a
production hold, complete the preservation controller, prove VM power-loss
durability, or supply native continuous-watch certification on Linux. The
actual five Mac timers/install/import graph remain3.6; healthy cold masters
and complete preservation remain recovery1.2.

D21 closure (2026-09-29 08:14 EDT): source dbffa1a8e0021731003bdd50ea3e75eeac18ad5d
approved without blocker by Claude106; exactCI36564796549 green3/3. Private
Mac copied runtime passes33 hold+47 gate+58 Journal controls, including
real killed controllers, foreground lifetime and actual owned launchd timer.
Independent Linux31pass/2native skips, Journal58pass and gate42pass/5Mac skips
confirm only the portable controls. Positive native certification remains
locally observed; process interruption/fsync faults do not prove power loss.
Close3.5's owned contract only. Changed merged Gate/Journal deltas were directly
reviewed, so prior foundation hash approval is not substituted for this review.
Node22 CI also runs all four Python preservation suites with explicit runtime
overrides; platform skips do not establish actual Linux launchd behavior.
Actual timer3.6 and full recovery1.2 remain open. Closure ledger contains no
source changes; require exact closure-head CI before merge.

## D22 — Split first timer installation into observable prerequisites (2026-09-29 08:42 EDT)

The original broad3.6 has multiple missing Needs, so it does not enter production
implementation. Map that unchanged commissioning outcome to3.11. New3.6 captures
the exact existing archive body/hourly Mac unit;3.7 exposes bounded restore-only
recovery through the existing Journal/node_lock;3.8 stages the complete reachable
consolidation graph;3.9 pins launch environment content and protected entries;
3.10 proves the actual ungated first transition;3.11 commissions all five.
Historical3.6 references identify the original installation outcome, now3.11.
This splits the already-authorized work; it introduces no parallel journal,
daemon, production preservation controller or source/dependency rewrite.

The owned Mac disable probe disproves an admission fence: an already-loaded
timer runs1→2 after disable with normal application exits. Root-only next-start
debug refused and sudo-n requires authentication; neither changed a production
unit. Polled idle minimizes a race but cannot prove no subsequent fire. Do not
force an old production run to stop. Any alternative involving bootout must prove
the actual old application/child/durable-write behavior, not infer sampler safety
or a narrow consolidation tear window. Log rotation's gzip output is written to
the eventual .gz name before truncation/pruning, so abrupt stopping cannot be
assumed harmless. Its fresh live hash equals tracked bin/log-rotate exactly.

Controller ownership is the existing Journal node_lock, held exclusively for its
lifetime and non-blockingly acquired on reattachment. Gate LOCK_EX releases
after drain and cannot identify a dead controller. Ordinary installation refuses
an unresolved hold and hands off exact saved journal/pins; it does not recover
an active owner's hold or re-pin. The bounded command recovers/restores/resolves
only, never seals. Fresh certification requires a separate fresh session.

Python-I-S is an explicit new supervisor prefix around unchanged application
argv/env/cwd/schedule. It does not sanitize application environment or protect
Python's own loader retrospectively. Baseline content and startup vectors must
be established at the launcher boundary; unsupported preload/delegation refuses.
Actual graph preflight inventories483 files/260 parsed modules/9 packages with
0 unresolved literal requests and9 subprocess edges, but computed/native/child
resolution remains unaccepted. Against the accepted3.2 private profile,53 local
files are20 equal/9 different/24 generated schema files absent. A fixed-file
overlay or a closed-fire test cannot replace complete graph/foreground proof
before installing and reopening a changed consolidation entry. Keep shared
dependencies and primarye57 unchanged; the daemon's awaited-stop delta remains
separate. Five holds do not exclude daemon/remote/delegated writers.

3.6 preserves existing archive bytes, including swallowed rsync errors; it only
adds tracked commissioning inputs and owned consumers. No new autostart manifest
entry until commissioning. Linux service support and archive integrity/error
reporting are parent follow-ups. Source review and Mac runtime observation remain
separate; no process-kill evidence proves VM/power-loss durability.

D22 clarification/3.6 closure (2026-09-29 08:55 EDT): Claude116 approves exact
61d2d78 source capture and the split; CI36570534434 attempt2 green3/3 after
one retained upstream HTTP500 setup failure. Copied private Mac RunAtLoad and
real transcript-content controls close3.6 only.3.8 creates its own copied entry,
lib and generated-schema tree with unchanged third-party dependencies; it does
not overlay live shared application modules or change the daemon's imports.
3.10 needs durable exact original rollback artifacts and interruption controls
before a baseline exists, distinct from post-baseline sole-Journal recovery.
Actual received environment is verified privately, not printed/shared.3.11 is
the explicit actual commissioning step after3.6–3.10; bounded restore-only
recovery is its sole handoff, not an unlisted full1.2 controller. Archive update
semantics and misleading success on rsync failure remain recorded follow-ups.
Require exact closure-head CI/source identity before merging ledger-only closure.

## D23 — Owned 3.7 restoration prototype boundary (2026-09-30 10:26 EDT)

The 3.7 command reopens only an existing, complete Journal and saved execution
hold under a private, uniquely named macOS fixture root. It does not capture a
new baseline, certify the interrupted interval, seal, or touch production
labels, stores, timers or the production node lock. A fixed built-in adapter
compares saved plist, entry, argv, working-directory and environment identity
with the actual owned launchd services and local health before restoration and
reopen. No caller-supplied readiness callback can authorize reopening.

For a runnable end-to-end prototype, the adapter may bootstrap or kickstart
only its saved, private timer or daemon when that unit is missing or stopped.
It rechecks identity and both launchd domains before the action, never enables
or bootouts a service, and never kickstarts a timer. This is an owned fixture
acceptance path, not the production 1.2 resume controller. Other units are
saved as absent, including nats-1; the schema accepts that class. Any
production-shaped baseline or path, extra owned job, drift, live controller,
straggler past the drain deadline or unreadable state refuses. Partial
restoration retains the gate and unresolved journal for retry or operator
handoff. The actual marker is read for reporting; journal state alone cannot
establish whether the gate is physically open.

Read-only preflight precedes the existing Journal constructor because that
constructor repairs some missing or corrupt receipts. Receipt drift after an
unrelated gate-directory entry change is classified and refused before a new
record, preserving the accepted 3.1 full-receipt rule. That rule can strand a
closed owned hold; changing root-time binding would require its own decision,
tests and migration, so this prototype neither recaptures pins nor removes a
marker automatically. 3.7 remains active until exact-source adversarial
review, CI and its runtime evidence are accepted. Production commissioning
still depends on 3.8–3.11 and parent 1.2.
