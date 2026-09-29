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

## Exact-source acceptance — 2026-09-29 08:14 EDT

Claude106 independently reviewed dbffa1a8e0021731003bdd50ea3e75eeac18ad5d
against23e1a02 and found no blocker in the changed primitive or facade. Linux
facade31pass/2native skips, Journal58pass, gate42pass/5Mac skips reproduce the
portable controls. The two native forward-certification controls remain the
local Mac33/33 attestation; neither reviewer nor CI independently proves them.
CI36564796549 on the exact source passes all three jobs: root Node20/22 each
2562tests/2556pass/6skip/0fail/0cancel; Mission Control lint/tests/audit/build.
Node22 JetStream fixtures also run the four Python preservation suites with
explicit NATS/runtime overrides; platform-specific skips remain visible.

### Promised versus landed

| Planned delta | Landed | Reachable result |
|---|---|---|
| Real gate publication callback and inline drained guards | yes | Copied real Gate in47 Mac controls, sole facade |
| Sole JournaledHold and immutable intent/receipt binding | yes | Copied33-control facade consumer, recovery1.2 and timer3.6 next |
| Existing Journal ordering and mandatory held-baseline facade | yes | Copied58 legacy controls plus33 hold controls |
| Root test integration and scoped negative controls | yes | Node20/22 wrapper prints portable Python census |
| Runtime evidence and plan/decision carriers | yes | Seven exact source/test hashes, raw output hashes and review record |

Greppable deltas: workspace-bin/service_gate.py contains on_publication and
before_open; journal_hold.py contains class JournaledHold and before_restore;
preservation_journal.py calls hold.prepare and hold.complete. All manifest
hashes still match the deployed private copies. Cross-references3.6/recovery1.2
remain valid. POSITIVE: explicit failure fences, one live intent, restoration-only
recovery, all-service/physical readiness, real foreground lifetime. Phase8 patches:
none after independent exact-source acceptance. Feeds: the private runtime
consumer proves3.5; the sole facade is now available for3.6 and recovery1.2.
The earlier pending checkpoint is historical; this acceptance supersedes it.

The closure changes only ledger/evidence files. Final closure-head CI remains
required before merge. Production timers and full preservation remain open.
