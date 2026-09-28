# DECISIONS — node-bus-lifecycle (append-only)

## D1 — Distinguish planned drain from permanent loss (2026-09-28 10:05 America/Montreal)

**Decision.** Set a main-local shutdown flag before the first shutdown action. Suppress the permanent-close exit only while this requested shutdown owns the drain. Ignore repeated SIGTERM/SIGINT after the first. Keep unexpected permanent close at exit 1.

**Why.** The real idle task daemon exited through the startup closed callback during its own drain. The preservation guard refused and restored all clients before any healthy bus stopped.

**Consequences.** Modify only the existing daemon lifecycle. Verify a real process with owned authenticated NATS and isolated HOME. No claim about completion of untracked in-flight async application handlers.

## D2 — Preserve live source drift in a narrow release (2026-09-28 10:05 America/Montreal)

**Decision.** Build a private staged release from the immutable live e57f89b tree and apply only the lifecycle diff. Keep its dependencies and working directory explicit, change only the task-daemon unit entry, and preserve the old unit for rollback.

**Why.** Copying current-main's whole daemon file would also deploy terminal-task guards during a lifecycle repair. The running repo must remain untouched.

**Consequences.** Source review covers the minimal diff on main plus the same minimal diff on e57. Stage probes use launchd's actual Node. Deployment requires a fresh idle proof, clean SIGTERM completion, managed restart and read-only service probes. Existing viewer release/plan roots remain unchanged.
