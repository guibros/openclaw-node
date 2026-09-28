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
