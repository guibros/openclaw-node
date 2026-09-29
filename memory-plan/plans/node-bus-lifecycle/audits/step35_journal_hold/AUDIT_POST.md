# Step3.5 candidate — Interrupted hold restoration

Local candidate validation, 2026-09-29 07:56 EDT. Exact commit CI and independent
candidate review remain pending; INVENTORY is [A] and VERSION v3.5-pre.

The one Journal now requires its JournaledHold facade for both forward
mutations and recovery whenever the complete baseline declares an execution
hold. Legacy baselines retain the previously reviewed recovery behavior.
Unique nonce intents, receipt-before-drain recording and saved immutable pins
bind marker ownership. Restoration never supplies a certifying observer.
Every dependency restoration checks a drained hold, including readiness loss
after an initially all-ready ambiguous-open classification. Full service and
physical readiness plus durable records precede the mandatory completion hook;
a fast final baseline check runs under Gate.reopen's exclusive lock before
receipt revalidation/unlink. Post-unlink record failure remains unresolved;
the next controller re-closes instead of claiming physical closure persisted.

## Private copied runtime

The candidate's seven source/test files were copied byte-for-byte to a separate
0700 runtime under ~/.openclaw/backups/node-readiness/journal-hold-20260929-1/.
RUNTIME_EVIDENCE.json records every source and raw-output SHA256. All controls
used /usr/bin/python3 and private owned data/processes, without shared Node
dependencies or changes to live entrypoints, launchd units or configuration.

| Suite | Actual Mac result | Duration |
|---|---|---|
| Combined JournaledHold | 33/33 pass | 24.548s |
| Execution gate | 47/47 pass | 17.520s |
| Existing Journal | 58/58 pass | 36.660s |

Combined controls exercise killed controllers before protective intent, after
intent, after publication/before receipt, after receipt/before drain, after
drain, before reopen and after unlink. A real foreground process retains its
lock across controller death, refuses premature recovery, then exits normally
before restoration proceeds. Additional controls cover a real straggler,
receipt gaps, mismatched/unowned markers, duplicate nonce/competing intents,
pin/metadata changes, unmutated-worker/physical readiness failures, fast-check
refusal under exclusive lock, and real fsync failure injection at mark-failed,
supersession, protective intent/publication, restoration intent, final readiness,
reopen intent and post-unlink recording. Zero dependency mutations are asserted
at write failures. Repeated kills retain at most one live nonce intent.

The gate suite also runs an actual private launchd timer: configured interval2s,
runs1→3 while application count1→1; exit0, zero stdout/stderr log bytes and the
closed marker survives controller exit. Native positive forward certification
and in-operation mutation refusal are actual Mac controls. On Linux those two
combined native-certification controls explicitly skip; restoration logic runs
there. The root Node wrapper prints that Python census for CI visibility.

The service inventory/readiness fixtures are logical complete baselines, not
a production20-service restart. Real production timer installation/import
graphs are step3.6, and full healthy-store preservation remains recovery1.2.
Neither process-kill controls nor journal fsync injection prove VM power-loss
durability. No original interval is certified after interruption; it resolves
only, with no interrupted-copy acceptance. Primary checkout and live services
were not deployed or stopped by these controls.

Initial unaccepted draft output is retained privately: its killed-controller
fixture incorrectly supplied fully ready state on the protective-close path,
so the intended checkpoint was unreachable. Correcting that fixture produced
the seven actual killed-boundary controls; that first run is not acceptance.

## Carry-forward

- Close3.5 only after exact candidate CI and Claude's independent challenge.
- Keep recovery1.2 [A]; no full controller or healthy cold masters shipped here.
- Install and prove the actual five timer contracts in3.6 before production
  coordinated preservation.
- No automatic pin recapture, production hold, topology change or new journal.
