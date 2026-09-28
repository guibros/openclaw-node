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
