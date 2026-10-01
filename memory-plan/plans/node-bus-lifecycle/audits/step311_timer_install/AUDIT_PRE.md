# Step 3.11 — Install the reviewed execution hold on five Mac timers

## Micro Re-Orient

Block 3 needs the five scheduled applications inert under a durable hold.
Step 3.10 merged the first-transition proof and exact private rollback material.
The actual five jobs still use their old ungated loaded entries.
The full-node preservation controller and complete baseline are still open in recovery 1.2.
This step commissions the five timers without claiming a whole-node quiet window.

## Intent and pre-screen

The 3.8 Node24 consolidation graph, 3.9 protected five-entry candidate and
3.10 source-fence candidate exist under owner-private roots and verify by saved
hash. The loaded old plists, actual source identities, launch environment,
schedules and other invokers were captured and challenged in those steps.
`service_gate.py`, the sole Journal/node lock, JournaledHold and bounded owned
restore-only command are merged; no production timer adapter exists yet. That
fixed adapter and a narrowly scoped journal baseline are implementation deltas
of this step. No live source or timer may change until they pass owned Mac
crash/recovery controls and an independent adversarial review.

## Design

The first ungated-to-gated installation precedes any certifying hold. It must
never call `JournaledHold.close_and_drain()` while an old ungated timer can
still run. For each job, the installer classifies physical source, plist and
loaded state against the saved originals, fence and candidate. It publishes
the source-specific fence atomically on the old path, checks the resulting
hash, makes the fence owner-immutable for the wait, and writes the candidate
plist durably. Old executions already started finish without a forced stop.
New old-label fires execute only the inert fence. Once the old job is observed
idle, it is unloaded; a possible concurrent fenced invocation may be killed
but cannot have entered application work. While unloaded, restore the exact
old source/link path, then bootstrap the reviewed candidate and verify its
loaded settings. Each intermediate physical state has a deterministic retry
or a fail-closed refusal. A partial cohort is not a certified hold.

Ordinary installation must be coordinated during this short handoff. The
source-path fence is made immutable immediately after publication so the
workspace installer cannot silently replace it during the wait. Pre-publication
and post-publication checks detect source drift. The real installer must also
refuse while a transition is active. Neither a single idle sample nor
`launchctl disable` is the admission argument; the fence is.

Only after all five new entries are loaded and source/launch pins verify may
the same sole Journal create a timer-commissioning baseline. D28 makes this
an explicit scope containing exactly these five timers, on the existing
persistent node lock and journal lineage. It permits a hold-close and
restore-only recovery but no service stop/copy or `seal`. Existing full-node
baseline validation stays unchanged. A fixed, protected production timer
adapter observes actual loaded/disabled/idle state, source and candidate
identity and final physical gate state. The original uninterrupted session
closes and drains, proves closed fires application-inert, then runs Journal
recovery and resolves only after complete timer readiness and the fast
in-lock recheck. A crash reopens this same journal restore-only; it cannot
certify lost history. The full-node preservation controller remains 1.2.

## Risks and acceptance

- An old process can open its source just before fence publication. It must
  finish naturally; an old parent or application child is never force-stopped
  to manufacture the handoff.
- A partial source/plist handoff after interruption may skip some timer fires
  while other old jobs run normally. Retry must recognize only exact saved
  states; unknown bytes, jobs or source flags refuse with the saved artifacts.
- A deploy racing the few operations before the immutable fence is a material
  boundary. No live mutation proceeds without an observed no-deploy window and
  a tested guard on the ordinary installer.
- The old consolidation notification child is unawaited and may die on its
  own parent exit; this pre-existing delivery defect is reported, not cured
  retroactively. The accepted replacement awaits the child.
- The timer-only journal cannot authorize a whole-node quiet window, history
  copy or full service restoration. It shares the node lock, so unresolved
  timer recovery blocks later full-node windows rather than running beside
  them.
- Source/pin drift, an unresolved journal, a busy or unaccounted old run,
  nonprivate artifact, mismatched loaded setting, write failure or readiness
  failure refuses further mutation. Report physical gate and loaded state.

Runtime acceptance requires exact saved candidate verification before live
mutation; owned Mac crash tests at every file/launchd boundary; a fixed live
adapter tested against owned launchd fixtures; and independent review of the
exact source. The live result must show all five loaded candidate settings,
closed marker and inert scheduled starts without application/log writes, then
durably resolved journal, open marker and preserved prior scheduling state.
Do not equate CI or owned fixtures with live acceptance.

## §6 file deltas

1. A narrow timer-commissioning scope on the sole Journal, with full-node
   default invariants unchanged and no seal/copy path for the scoped mode.
2. A fixed production timer readiness/recovery adapter in the existing
   bounded restore-only command, staged as pinned private code; no generic
   caller-supplied readiness callback.
3. A resumable five-job installer using the staged 3.8/3.9/3.10 artifacts,
   exact source/plist states, atomic fence and durable rollback material.
   Guard the ordinary workspace installer during a live transition.
4. Owned Mac crash, source substitution, child, fence/deploy and journal
   close/recovery tests, followed by actual five-job runtime evidence.
5. This silo's decision, inventory, version, component registry and post-audit.

## Mid-Implementation Findings

The reviewed transition receipt must precede the first source fence. A crash
after clearing a fence's immutable flag but before restoring the original
source leaves a recognizable unflagged fence; retry re-protects it before
continuing. RunAtLoad jobs must show at least one completed candidate run,
not merely a momentary idle sample after bootstrap. The controller also waits
for the two 60-second jobs to fire naturally under the closed marker in
addition to explicit label kicks. These checks were added to owned Mac tests.

The first full-controller integration control initially exercised only timers
already loaded on recovery. The interrupted run now makes one timer absent
and verifies restore-only bootstrap through the real Gate/Journal composition.
Recovery cannot kick a missing timer before its journaled restoration. It
therefore resolves the interrupted window restore-only, durably invalidates
its commissioning proof, then creates a fresh timer-scoped journal window to
close, prove inert scheduled starts, and reopen. The active transition receipt
advances atomically to that fresh window; only a resolved, non-invalidated
proof may become the installed receipt.
Claude's adversarial passes found no source blocker after the corrected
reopen identity check, sync durability and cohort consistency checks. The
repo-wide suite requires the installed Node 22 ABI for the existing native
SQLite dependency; the default Node 24 binary cannot load that dependency.
The first full Node 22 Mac run reported three failures in the older owned
restore-only suite. All three cases pass individually on both unchanged HEAD
and the current tree; a bounded-concurrency full rerun is needed before close.

The first live transition refused after four candidate jobs had loaded: the
transcript-archive plist has no explicit PATH, so launchctl's printed
per-service environment omits the inherited value. The old verifier compared
that omission to the captured effective process PATH and refused. The durable
active transition receipt remains, the execution gate is open and no scoped
journal exists. A fresh owned launchd process using the same plist environment
measured the inherited PATH hash equal to the pinned manifest. The corrected
verifier uses that narrow launchd probe when PATH is inherited, while retaining
the printed-environment check for explicitly configured PATH. The probe's
positive and negative cases now run in an owned Mac test. A new immutable
controller bundle is required; the earlier bundle must never resume the live
transition.
