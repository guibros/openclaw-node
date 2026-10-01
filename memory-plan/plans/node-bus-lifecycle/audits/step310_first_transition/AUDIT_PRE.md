# Step 3.10 — First ungated timer transition

## Micro Re-Orient

Block 3 needs a real quiet interval from the five scheduled applications.
Step 3.9 merged an owner-private candidate but changed no loaded timer.
The old loaded entries can still run while a replacement plist is prepared.
This step proves a non-root first handoff without cutting off old writes.
Step 3.11 alone may install the five reviewed gated entries.

## Intent and pre-screen

Step 3.9 is merged as PR 164 and its candidate `timer-entry-candidate-20260930-5`
still represents the five loaded jobs. The actual old programs, rather than
the newer repository scheduler, govern this handoff. The loaded consolidation
scheduler calls a notification child without awaiting it, and its script is
also imported by the memory daemon. The old observer entry is a symlink into
the checkout. The three other jobs are a Node heartbeat and two foreground
shell scripts. All five installed plists leave `AbandonProcessGroup` unset.

Owned Mac controls established that `launchctl disable` can be followed by a
timer fire, while `bootout` of a running fixture killed its parent and child
before their planned fsynced writes. Atomically replacing a fixture's source
path while its old parent and child ran preserved their completed writes;
a later forced start loaded only the replacement. This is admission evidence,
not yet a complete child-drain proof. No production unit or source is changed
in 3.10.

## Design and acceptance

Prepare durable exact original plist and source/link artifacts before any
possible live fence. A source-specific replacement must exit successfully
without application work for only the matching launchd service invocation.
For consolidation, it must retain the original module exports and manual CLI
behavior so a memory-daemon restart does not lose its import. For observer,
the original symlink target and non-timer CLI use must remain reachable.
The shell jobs and heartbeat also retain non-timer invocation behavior.

The intended handoff is: verify the saved 3.9 candidate and old sources;
atomically publish each prepared source fence; observe old parent and child
completion without forcing a stop; unload only a drained old job; restore
its exact old source path while unloaded; load the reviewed gated plist.
The fence must make any late old-label fire application-inert throughout the
wait. Refuse and leave the job fenced if a child cannot be accounted for or
any source, loaded setting, or rollback artifact drifts. Step 3.11 owns the
live mutation and post-install proof.

Owned replicas must cover a Node and shell source swap during active writes,
same-group and reparented child behavior, a late fire after the fence,
observer symlink/manual behavior, consolidation import compatibility, a
fenced-to-gated closed run, and clean unload. Completed output must be
byte-complete. Process snapshots alone do not certify a child drain.

## Risks and boundaries

- A pre-fence process can start just before the atomic replacement; a single
  pre-swap PID census does not cover it or a later child spawn.
- The deployed scheduler's notification child is unawaited; repository-main
  source has a newer foreground contract and cannot substitute as evidence.
- A pure stub at the shared consolidation path would break the memory daemon;
  changing the observer symlink target in the checkout would cross scope.
- Sequential fences have a temporary mixed cohort. Each job must be handled
  independently until the complete gated cohort is installed.
- Ordinary installer replacement during a fence would reopen old admission.
  The live step needs a concrete coordination or protection mechanism.
- In-Python or process-table observations do not prove VM/power-loss
  durability. Exact rollback artifacts and their persistence are separate.

## §6 file deltas

1. A staged, source-specific old-entry fence and exact rollback-artifact
   preparer under `workspace-bin/`, with no command that mutates the live jobs
   in this step.
2. Focused owned Mac launchd transition tests and private runtime evidence in
   `audits/step310_first_transition/`.
3. This silo's `INVENTORY.md`, `VERSION`, `COMPONENT_REGISTRY.md`, an
   append-only decision, and the post-audit after verification.

## Mid-Implementation Findings

- Claude initially analyzed the newer repository scheduler and incorrectly
  treated the loaded notification child as awaited. Correcting it with the
  deployed source exposed the old unawaited child. Its later suggestion to
  use `bootout` as a drain contradicts the owned kill-before-fsync control;
  that suggestion is rejected.
- The local macOS `launchd.plist(5)` description says launchd kills
  same-process-group children when a job dies unless `AbandonProcessGroup`
  is true. All five old plists leave it unset. An owned same-group child
  control reproduces the old scheduler's natural notification-loss case;
  a foreground awaited child and detached active child have separate controls.
- Claude's source review found a missing standalone heartbeat fence check.
  That check and a monotonic old-run counter now make post-fence behavior
  discriminating. Ten focused controls pass after the correction.
- The first staging run left an output root before all checks completed.
  Preparation now builds and fsyncs in a private temporary directory, then
  atomically publishes the whole artifact. Verification rejects altered
  content and any non-private artifact mode.
