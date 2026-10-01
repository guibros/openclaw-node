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

D33 adds explicit refusal for unreadable store subdirectories, directory-entry
coverage, and restored-message read-back. A same-length corruption negative
fails at message retrieval even when stream metadata matches. The APFS fixture
checks effective mount flags with an owners-off negative. Read-only inspection
found a system-domain Tailscale job whose invoked app has an operator-writable
ancestor; its privileged path must be classified before a root helper can
claim protected execution. These remain source and owned-fixture controls;
there is no production cold master or full-node seal.

The final Mac suite for D33 passes 204 tests with three expected skips. Two
earlier full runs exposed overly narrow restore-only event matching and an
owned NATS placement startup race; both fixtures were corrected and the exact
suite rerun. Exact-head CI and adversarial review remain open, as do protected
cross-uid ownership, continuous admission, the detached production driver,
three healthy cold masters and live restoration acceptance.

D34 corrects the routed-read overclaim: an owned restored member must become
stream leader before its message read counts as that replica's read-back.
Single-follower and all-replica corruption negatives both fail at message
retrieval; a copy-side manifest also detects a changed single replica before
restore. The publication digest is still operator-held, and the live NATS
stores remain same-uid. The production isolation and full-node gates remain
open at 1.2[A]/v1.2-pre.

D35 narrows the owned restore evidence: member-by-member leader rotation is
a cluster recovery check because healthy peers can refill a damaged copied
store before it leads. The current post-publication corruption controls and
copy-side manifest do not prove a source store was independently healthy at
the cold point. An isolated per-store content/recovery check, protected
publication digest, dedicated service identity and production restoration
remain open. PR #170 head `6868c1f` has green Node 20, Node 22 and Mission
Control CI; this does not close step 1.2 or permit full-node `seal()`.

D36 adds the independent per-member *state* check to the owned fixture:
each candidate store is inspected alone on a disposable server before any
peer can refill it, then cluster-level message reads and a catch-up-log
tripwire run. Source-side empty blocks and a missing stream that previously
passed now refuse; same-length source corruption refuses at message read.
The one-message fixture is not the production all-message content baseline.
Protected ownership, production cold masters, the controller and verified
live restoration remain open at 1.2[A]/v1.2-pre.

D37 adds the last pre-stop Raft group-name check that D36 lacked, and makes
the owned durable cursor nonzero before its isolated comparison. Source-side
missing Raft and consumer folders now refuse even if the repaired cluster
would serve the message. The four-test owned cluster suite passes. Deeper
per-group log-byte and production all-message proof, protected custody, and
the full-node driver remain open; step 1.2 stays [A].

D38 adds an offline sentinel for saved term, peers and nonempty snapshot/log
content in every observed Raft group before an owned member can be repaired
by its peers. Three new source-side damage controls refuse; the eight-mode
negative suite and stable-source 208-test Mac recovery suite pass. The
bounded fixture still does not prove every production Raft log byte or
retained message. Exact-head CI/review, the protected writer and publication
boundary, production cold masters, the full-node driver and live resumption
remain open at 1.2[A]/v1.2-pre; `seal()` stays disabled.

D39 corrects the owned fixture's same-length Raft-content false acceptance
after stop: normal shutdown changes Raft bytes, so a live pre-stop file hash
is not comparable to the stopped candidate. A full Raft file/directory view
saved immediately after normal owned shutdown now detects later source-side
junk snapshots, logs, peers and vote bytes before isolated startup. Other
damage is injected before that baseline so the structural and local-state
checks retain independent negative controls. The positive and earlier
eleven-mode suite pass locally; the changed-vote control also refuses. The
refined twelve-mode suite, exact-source complete suite, CI and Claude review
are open.
This owner-held test baseline does not authenticate latent pre-stop damage or
close the protected production writer/cold-master gates; 1.2 remains [A].

The refined twelve-mode owned negative suite and complete Mac recovery suite
pass at stable source (208 tests, three expected skips). The baseline and
candidate comparison is still an owner-held fixture continuity check; exact
CI, adversarial review, protected live custody, three cold masters, the
production driver and resumption remain open.

D40 follows Claude's exact-head `7d40a3f` review: CI passed 3/3 and the
stopped-Raft-byte claim had no source blocker. A healthy meta-snapshot
catch-up warning caused a false refusal, while latent damaged Raft contents
could still be accepted. The owned fixture now exempts only that warning,
records the actual integrity line on refusal, and includes a latent junk
snapshot control that must reach `Snapshot corrupt`. The fixture retries
transient observations during pre-baseline settling and post-stepdown
election within their deadlines. The focused four-test cluster suite and
complete 208-test Mac recovery suite pass, with three expected skips.
Protected production custody, per-member Raft replay and peer/vote
metadata validation, three healthy cold masters, the full driver and
verified resumption remain open; 1.2 stays `[A]`.

D41 adds a disposable NATS-native replay of each copied owned member against
one fresh empty routing peer before the candidate meets its original peers.
All recorded Raft groups must replay to at least their observed committed and
applied indexes without leader election, and the blank peer must have no
account groups. A source-side hollow-WAL control passes the earlier structural
and local-state checks but refuses at member 1's replay index. The healthy
owned run and focused negative pass locally; complete exact-source suite,
CI and independent review are pending. Peer/vote metadata validation,
protected production custody, all-message baseline, three live cold masters,
the detached controller and verified resumption remain open at 1.2 `[A]`.

The corrected complete Mac recovery suite passes 209 tests with three expected
skips; final-source replay focus passes 2/2. Exact-source CI and Claude review
remain pending. No production preservation window was opened.

D42 settles every owned `$G` group's committed/applied index across the three
members after stepdown, before stop and copy, so the subsequent per-member
replay reaches the same captured cluster threshold. It scans each replay log
before reporting an index timeout. The owned cluster module passes 5/5 with
normal cleanup, followed by five more healthy replays; `35f8a8a` CI passed
3/3 and Claude found no false acceptance
in that preceding head. Exact D42 CI/review, protected production custody,
peer/vote validation, three healthy live cold masters, detached orchestration
and verified resumption remain open. Step 1.2 is still `[A]` at `v1.2-pre`.

D43 correction, 2026-10-01 11:07 EDT: retained Mac evidence shows D42 could
accept equal pre-election stream indexes while no new leader existed. The
owned post-stepdown capture now requires the elected leader, equal
committed/applied/persisted indexes in `$G` and `$SYS/_meta_`, and an advance
to settle for one second. The latent damage control requires its actual
replay-log warning.
Six corrected healthy Mac replays capture and
independently reach stream index `4` on each member, rather than accepting
the old index `2`. The final exact-source cluster module passed 5/5 in
271.532 seconds with normal cleanup. This only establishes the captured
owned reference; exact CI and adversarial review remain pending. The
protected production writer, three cold masters, peer/vote validation and
verified resumption remain open at 1.2 `[A]`/`v1.2-pre`.

D44 checkpoint, 2026-10-01 11:40 EDT: `ad9927a` exact CI passed 3/3.
The D43 election/advance check now has a deterministic regression for
pre-commit leader changes, leaderless mixed terms, incomplete persistence
and in-flight metadata. The final owned cluster module passed 6/6 in
276.778 seconds with normal cleanup. Exact D44 CI/review are pending;
protected live custody, three cold masters and verified resumption remain
open at step 1.2 `[A]`/`v1.2-pre`.
