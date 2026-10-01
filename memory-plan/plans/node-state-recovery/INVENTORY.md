# Node state recovery — inventory

| Block | Step | Version | Status | Description |
|---|---|---|---|---|
| 1 | 1.1 | v1.1 | [x] | Establish verified application SQLite recovery snapshots |
| 1 | 1.2 | v1.2 | [A] | Establish verified JetStream history recovery snapshots |
| 1 | 1.3 | v1.3 | [ ] | Establish a coordinated application and bus recovery point |

> **1.1 — Goal:** Establish verified application SQLite recovery snapshots.
> **Needs:** Twelve application stores enumerated; SQLite backup API and installed sqlite-vec available; private backup storage with sufficient space.
> **Feeds:** Node-readiness 1.3 and later storage/capture repair.
> **Verify:** runtime/code: Read-only source transactions feed SQLite's backup API; offline restores pass integrity_check with identical schema, user_version, per-table row counts and content digests. Services stay running; no application initialization or source repair. Backup/restore directories 0700 and files 0600.

Closed 2026-09-28: twelve stores / 116 physical tables restored with matching fingerprints, six native FTS checks and eight vector probes; private deployed tools; unchanged service PIDs/runs; green isolated CI and Claude Message 68 acceptance. See step11_sqlite/AUDIT_POST.md. Individual points only; parent 1.3 remains open.

> **1.2 — Goal:** Establish verified JetStream history recovery snapshots.
> **Needs:** Four distinct store directories and four configurations inventoried; offline R=1 directories intact; installed NATS CLI/server available; independent review of snapshot/restore sequence.
> **Feeds:** Node-readiness 1.3 and topology 1.4.
> **Verify:** runtime/code: Reachable streams snapshot/restore on isolated loopback servers; stopped-server copies preserve all four stores including unavailable R=1 streams. Restored counts, messages and last sequences match captured originals, with explicit treatment of expiring health streams. No isolated server routes to production; histories remain separate.

In flight 2026-09-28 21:33 EDT: offline member-1 master/restore and eleven online archives accepted; revised owned recovery/admission tests pass after a retained refused run. Lifecycle prerequisite repairs are merged. Crash recovery did not close this step. Durable intent and account-group observations now have owned fault/election evidence. A managed driver with real stop gates, the three healthy cold masters, their isolated restores and truthful service resumption are still required. Full-baseline restoration, a shared node lock/unresolved fence and an immutable sealing mechanism now have owned evidence. The detached managed driver, actual unit/process identity bindings, real stop controls and degraded-history resolution procedure remain pending. A fixed persistent parent, complete explicit inventory and recoverable receipts now have owned fault evidence; Claude review of the new patch is pending. See step12_jetstream/RUNTIME_EVIDENCE.md and D7–D10.

Third-round checkpoint 2026-09-28 23:49 EDT: Claude accepted bbbc883's eight fixes and lineage; exact CI36516935187 is green. Its new creation-interruption and static-identity findings have source/deployed53-test evidence. Setup now prepares the full receipt before mkdir and reopens restore-only; Finder metadata is explicit. Exact new CI/review and the managed driver/healthy cold masters remain pending. See D11.

Fourth-round checkpoint 2026-09-29 00:58 EDT: ab7097c exact CI36518928261
is green; Claude accepted N1/N2 and identified owned regular Finder metadata
inside an initializing root. tools-v31 passes55 fresh tests, old source fails
the added recovery regression, and invalid metadata remains fenced. Main
55131b8's verified readiness prerequisite is integrated before fresh CI. This
checkpoint remains1.2[A]/v1.2-pre; managed driver/cold masters still pending.
See D12 and FINDER_SETUP_EVIDENCE.json.

Managed-stop checkpoint 2026-09-29 01:11 EDT: tools-v33 passes six actual
owned Mac controls and eleven read-only owner bindings. The obsolete private
driver is retired without service operations. Source N3 checkpoint0b96e93
has green exact CI and Claude Message38 acceptance. Stop-adapter CI/review
and the complete detached production orchestration remain pending;1.2 stays[A].
See D13 and MANAGED_STOP_EVIDENCE.json.

Fixture checkpoint 2026-09-29 01:21 EDT: tools-v36 passes the complete owned
recovery suite after tightening its placement cohort gate; an actual missing
member refuses. Prior f3bb44f CI failed before the Mac adapter ran; exact new
CI/review required.1.2 remains[A]; no production cold-copy acceptance.

> **1.3 — Goal:** Establish a coordinated application and bus recovery point.
> **Needs:** 1.1 and 1.2 recovery mechanisms verified; all writers and their service ownership identified; inventory ENOENT robustness addressed; primary/derived file sources, configs and browser-profile policy enumerated; quiescence/restart sequence independently challenged.
> **Feeds:** Node-readiness 1.3, then topology repair 1.4.
> **Verify:** runtime/code: With application and bus writers quiesced, take one final application/JetStream recovery set, including or explicitly excluding each non-SQLite canonical source; record its common quiet window, cursor/consumer states and hashes. Prove isolated recovery while keeping original owners/configuration/history intact; all services resume their prior state. Do not resume task execution from a mismatched set.

Managed-controls checkpoint 2026-09-29 01:44 EDT: private tools-v40 passes13
actual Mac controls/1 explicit cross-domain skip, tools-v39 passes recovery
with actual peer/route negatives. Thirteen owners have read-only entry/code/
environment bindings; Discord has no current root PID and deploy listener
remains unready. Timer idle/log observations alone refuse complete unload
verification. New exact CI/review pending; no production quiet window or
healthy cold-copy acceptance. See D15 and MANAGED_CONTROL_REVIEW.json.

Loaded-provenance checkpoint 2026-09-29 02:09 EDT: tools-v44 passes17
actual Mac controls/1 skip, v42 passes full recovery/all8 placement negatives.
Thirteen live owners retain the same PIDs and pass actual loaded plist/log
provenance. New exact CI/review pending. Producer tick gaps, stop margins,
Discord/timer proof, detached orchestration and healthy cold masters remain
open at1.2-pre. See D16 and LOADED_PROVENANCE_EVIDENCE.json.

Checkpoint2026-09-29 02:33 EDT: tools-v46 passes20 actual Mac controls/1
explicit domain skip, including real kernel errno and unexpected-event
retention plus the pre-watch startup rewrite. Owned historical-size NATS
and idle memory stops measure34–65ms, with normal exits and cleanup; no
worst-case or production preservation claim. 9deef65 CI36530037917 green3/3
and Claude Message46 has no blocker. New exact CI/review pending;1.2 remains[A].

Checkpoint2026-09-29 02:50 EDT: tools-v49 passes21 actual Mac controls/1
explicit domain skip, including bound-PID foreign-filter refusal with durable
raw evidence after reopen.56 journal controls pass.19243eb exact CI runs
36531518336/36531517977 green3/3; Claude Message48 has no blocker. Two
fixture layout refusals are retained; no production preservation started.
New exact CI/review pending;1.2 remains[A]. See DURABLE_KERNEL_EVIDENCE.json.

Checkpoint 2026-09-29 03:09:24 EDT: integer-PID ordering bug reproduced on owned old
source before any production journal. String PID exports plus strict
recursive string-key encoding pass58 journal tests and21 actual Mac controls/1
domain skip; verified/failed mixed-width chains reopen, restore and resolve.
New exact CI/review pending.1.2 remains[A]; see PID_KEY_EVIDENCE.json.

### Source foundation checkpoint — 2026-09-29 07:12:37 EDT

PR144 now targets the reviewed recovery tools, not completion of1.2. The
1.2 row remains[A] and VERSION remainsv1.2-pre. Exact integration CI and
Claude review are pending at this checkpoint. All existing forensic evidence
is retained as tool-development history; merging source enables no live hold.

| Component / remaining outcome | Status | Evidence / consumer |
|---|---|---|
| Sole Journal and failure/lineage primitives | Verified private tools | Unchanged5fabf6e hashes; fresh copied58/58 controls; FOUNDATION_EVIDENCE.json |
| Managed stop and admission/restore primitives | Verified bounded private controls | Prior21 actual Mac controls/1 explicit cross-domain skip, unchanged source; historical evidence |
| Restore-only interrupted execution-hold integration | Open | bus3.5; original-session continuity must not be reconstructed |
| Five actual Mac scheduled-job holds | Open | bus3.6; no production gate installation yet |
| Complete production preservation controller and new static baseline | Open | recovery1.2; all owners/invokers/dependencies and hold restoration readiness |
| Three healthy cold masters and isolated restores | Open | recovery1.2; no accepted common healthy cold-copy window |
| Complete live restoration / step1.2 closure | Open | Runtime evidence required after all prerequisites; source merge does not close it |

Checkpoint 2026-10-01 00:01 EDT: the actual on-demand mesh-agent state exposed
a full-node baseline refusal. D21 records the strict class correction and the
known-broken classification fence. A read-only 20-unit structural capture now
passes with 54 direct file pins; 65 Journal and 27 owned Mac recovery tests
pass. Complete dependency/provenance pins, production controller, three healthy
cold masters, isolated restores and truthful resumption remain open at
1.2[A]/v1.2-pre. See step12_jetstream/RUNTIME_EVIDENCE.md.

Checkpoint 2026-10-01 01:29 EDT: D22 widens the draft full-node source cohort
to 23 and adds a strict durable scope plus a multi-domain entrypoint preflight.
The live read-only preflight refuses two additional loaded system jobs; the
legacy root agent is crash-looping and cannot be retired without administrator
access. The gateway/viewer stop and detached-process fence, passive network
helper exclusion, complete dependency pins, protected-controller handoff,
healthy cold masters, isolated restores and truthful service resumption remain
open. No production preservation window started; 1.2 remains [A] at v1.2-pre.

Checkpoint 2026-10-01 01:55 EDT: Claude's exact b0669c7 challenge found an
unscoped 23-unit journal and neutral-label loaded-job omissions. D23's source
correction requires explicit new-window scope, binds the multi-domain inventory
to the full-node journal, and restores the deploy listener last. Owned tests and
new exact CI/review are required. The live widened scan still refuses the two
system jobs; the driver, cold masters and production restoration remain open.

Checkpoint 2026-10-01 02:29:15 EDT: the bounded PR #169 source now carries
Claude's d7fc991 follow-up corrections. Relative/wrapper and hard-linked
argument jobs are classified, recovery continues restoring known units after
inventory drift without certifying, and full-node sealing refuses until a
continuous launchd/process watch exists. The current read-only scan takes
4.75 seconds and still refuses the same two root-managed system jobs. The
controller, privileged job disposition, healthy cold masters, isolated
restores and verified production resumption remain open at 1.2[A]/v1.2-pre.

Checkpoint 2026-10-01 02:58:37 EDT: after PR #169 merged, the next source
branch inverted launchd discovery toward a closed-world preflight. The
read-only host scan now sees five additional installed jobs and nine loaded
third-party/root jobs beyond the proposed cohort; none is implicitly
approved. Empty legacy plists are recorded by hash. The 91 focused
scanner/journal tests pass. Explicit safe exclusions, disposition of the
root-managed agent and remote management job, a continuous writer fence,
the controller, healthy cold masters, isolated restores and runtime service
resumption remain open. Step 1.2 remains [A] at v1.2-pre.

Checkpoint 2026-10-01 03:11:15 EDT: Claude's closed-world review identified
`Program` precedence, undeclared loader variables and untrusted path-prefix
classification. Draft PR #170 binds the effective program, refuses undeclared
code-loading environment, parses launchd rows strictly, and counts dynamic
GUI jobs unless proven safe. The 120 scanner/journal/managed Mac tests pass
with one domain-specific skip. The live preflight remains closed; process
activity and copy-input continuity are still unproved, and no production
service was changed.

D24 records the remaining copy-integrity boundary: a user-level FSEvents
stream cannot certify an uninterrupted cold copy, and an owned Mac control
showed a pre-opened descriptor can write through `UF_IMMUTABLE`. The full-node
seal stays refused until a privileged open-handle check, durable immutable
freeze/undo and crash recovery are proved; the root jobs and explicit outside
job exclusions also remain open.

Claude's PR #170 exact-head review identified loaded-only environment,
inherited environment, argument-whitespace and Apple-symlink bypasses; the
source and owned regression checks now refuse them. Four source plist
templates no longer set `NODE_PATH`, but their installed live copies still
do. The source remains a draft until its new exact-head checks and adversarial
follow-up pass. Step 1.2 stays [A] at v1.2-pre.

D26 narrows the remaining source boundary: raw newlines in `launchctl print`
can spoof text structure, so loaded-but-idle jobs require pinned re-bootstrap
or structured attestation before a full-node seal. A single read-only APFS
snapshot is the target cold-copy input, with privileged owned proof and
quiescence still open. No live snapshot, root-job mutation, or full-node hold
has occurred.

Checkpoint 2026-10-01 04:17 EDT: PR #170 head `43ae5a0` passes exact CI
and 187 owned Mac Python tests (one domain skip); Claude's exact-head
challenge finds no additional fail-open source defect. D27 records two
remaining operational boundaries: ordinary Apple launchd text can make
the all-domain scanner refuse, and even a later `restored`/`resolved`
full-node receipt cannot attest an idle job from unescaped text alone.
Pinned re-bootstrap/domain environment, privileged APFS snapshot proof,
unknown/root-job disposition, continuous admission, three healthy cold
masters and verified resumption remain open. Step 1.2 stays [A] at
v1.2-pre; no production hold or copy was started.

D28's revised read-only scanner now completes across the three live launchd
domains and reports the 29 GUI and 11 system extras explicitly. Its 188-test
owned Mac suite passes with one domain skip and no production NATS contact.
The cohort still refuses, and no source change certifies idle loaded jobs,
Apple user-code dispatch, continuous admission or a cold copy. Full-node
controller, privileged job/snapshot mechanism, three healthy masters,
isolated restores and live resumption remain open at 1.2[A]/v1.2-pre.

D29 corrects two regressions Claude found at PR #170 head `79a6ff5`:
approved working directories printed after `arguments` are compared, and
Unicode line separators in identity values cannot truncate a loaded program.
The 190-test owned suite passes with one domain skip. The current read-only
three-domain scan still reports 29 extra GUI and 11 extra system jobs; 17
approved jobs match, while four installed mesh jobs correctly refuse their
live `NODE_PATH` loader. The complete cohort still refuses. Idle-job
attestation, domain-environment binding, a privileged snapshot, three cold
masters and verified resumption remain open at 1.2[A]/v1.2-pre.

D30 replaces the unavailable APFS snapshot path with an explicitly
uncertified candidate-copy experiment. The new copier verifies three owned
store trees before, during and after copying; an isolated three-server
restore recovers the seeded JetStream stream and durable consumer. The
stop-to-first-manifest writer-exclusion proof is still absent: writable
`mmap` can change bytes before ctime publication, and protected-process
mapping enumeration is inaccessible from this user session. The candidate
does not count as a cold master or a preservation receipt. Pinned idle-job
re-bootstrap, complete writer fencing, live stop/copy/resume and step closure
remain open at 1.2[A]/v1.2-pre.

An opt-in owned APFS image test now proves that a normal unmount refuses a
descriptor-free writable mapping and a descriptor in transit, and that a
read-only remount refuses writes. It does not close the stop-to-unmount
same-user writer interval or authorize a live store migration.

D31 adds an end-to-end owned-volume control: three owned NATS members run on
an ownership-enforcing APFS image, stop normally, then the image is unmounted,
remounted read-only and copied. The second source manifest equals the saved
pre-restore candidate manifest. The current live stores remain operator-owned,
so the fixture cannot certify a production cold point. A separate non-login
NATS uid, protected job and file paths, cross-uid identity evidence, and the
existing continuous full-node watch remain prerequisites. An argv-only process
dump now refuses before identity binding. Step 1.2 remains open; no cold
master, production bracket or seal was recorded.

D32 corrects the macOS argument decoder for a zero-padding layout in which
Apple auxiliary strings directly follow environment strings. Eight owned
process lengths and forged-prefix controls pass; unknown layouts refuse.
This does not supply the missing cross-uid or continuous admission proof.
