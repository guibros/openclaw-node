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
| Protected NATS root-lock lifecycle | Open | Before the production tripwire may be lifted: pin pre-receipt lock identity; recover empty and pending journal states; provide durable pre-marker abandonment, rollback and successor after reboot; bind root census to transaction, phase and lock identity; verify pinned transfer and fresh physical admission. After lifting it, compare site and lock by filesystem identity, including case and firmlink aliases. PR #178 is source-only. |
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

Checkpoint 2026-10-01 13:40 EDT, amending the 00:01 capture above (foreman
PR #174, operator-approved): `ai.openclaw.mesh-agent` was re-pointed to the
layered release `~/.openclaw/releases/worker-drain-69b7f37-foreman-5cb71b7-e57f89b`,
which is worker-drain-69b7f37-e57f89b plus `lib/foreman/supervisor.mjs` (see
its LIFECYCLE_PROVENANCE.json). Only `ProgramArguments[1]` changed. The plist
sha256 went from bb28366cfa6abde712e89dd84c5d0e725a1557cc2eec6ad024f321375d535de5
to c9209b9b66ffde255061c790d3c9fa62fffa46fbe7e60357f6472258af578d0c. Unchanged:
entry SHA 1304cb31…, environment, KeepAlive/RunAtLoad false, the `node_modules`
link and bare-module resolutions. The unit is still loaded, not running and not
disabled (D21 on-demand). The 00:01 capture's mesh-agent pins are stale:
recapture the full-node baseline before the first full-node journal. Rollback:
restore `~/.openclaw/backups/foreman/ai.openclaw.mesh-agent.plist.20261001T134005.bak`,
then bootout and bootstrap; the old release is untouched.

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

Checkpoint 2026-10-01 12:29 EDT: D24 defines the separate protected-writer
migration boundary. A source-only guard refuses ordinary install/auth-sync
paths once the future root-owned handoff marker exists. It has no effect on the
current live bus, where no marker has been created. Root migration journal,
old GUI job retirement, protected service UID/volume, credential lifecycle,
system-domain probes and healthy cold masters remain open; 1.2 stays [A].

Checkpoint 2026-10-01 12:41 EDT: D25 adds the reachable `openclaw-stack up`
refusal and keeps auth fixture tests runnable after a host marker is published.
The separate root migration, protected credential publisher, system-domain
monitoring and production recovery evidence remain open at 1.2[A].

Checkpoint 2026-10-01 12:43 EDT: D26 defines the marker directory mode,
pre-commit rollback removal order, and installer rechecks at NATS write
boundaries. The future root migration must also exclude installers already in
flight; the source rechecks alone are not a cross-process lock.

Checkpoint 2026-10-01 12:55 EDT: D27 adds a system-domain NATS watcher path
under the fixed handoff marker. This Mac's active labels are `nats`, `nats-2`,
`nats-3`; historical `nats-1` must remain unloaded. A 0600 node-local cohort
file records that layout; fresh installs create the singleton declaration,
while missing declarations report UNKNOWN. The future root marker must pin
its active cohort. GUI
and user-domain known-label duplicates refuse. Owned tests cover both
layouts, legacy/protected domains and invalid markers. A read-only live probe
of the no-marker branch observed all five core PIDs with no loaded known
duplicates. This does not exercise a protected system job. Claude's review of
e9b17e6 found no source blocker within PID-liveness scope and identified the
portable-layout correction. Claude's a96251c delta review then reproduced a
missing-file false WORKING during partial bootout; the declaration is now
mandatory, initialized only for fresh singleton installs. Focused owned tests
pass; exact new CI and review are pending. Root
migration and three healthy cold masters remain open at 1.2[A].

Checkpoint 2026-10-01 13:18 EDT: D28's read-only `/routez` + `/jsz` audit
confirms standalone 4222 and a separate two-member 4223/4224 cluster.
The owned topology classifier passes four fixture controls; the live
`--expect standalone-plus-two` control passes and
`--expect three-member-cluster` exits 1. The protected handoff must preserve these
distinct histories before any repair. No service, store or marker changed;
root migration, three healthy cold masters and complete restoration remain
open at 1.2[A]/v1.2-pre.

Checkpoint 2026-10-01 13:20 EDT: D29's read-only protected-site audit
passes its owned controls and refuses staging on the live host because
`_openclaw_nats` and `/private/var/db/openclaw-nats` are absent. APFS ownership
and the root-controlled parent pass. The audit is not cutover authorization;
no account, directory, service or store changed. Privileged staging and the
root migration journal remain required before a protected writer can start.

Checkpoint 2026-10-01 13:33 EDT: D30 extends that audit to every protected
ancestor and refuses a handoff root on a different device. The refreshed
`SITE_STATIC_EVIDENCE.json` passes the ancestor-chain check; the account and
root remain absent. Focused controls pass 69/69. No privileged mutation or
writer cutover occurred.

Checkpoint 2026-10-01 13:47 EDT: D31 closes Claude's PR #175 staging-account
blocker in source and retains the offline third Raft peer in the topology
evidence. The audit now checks the account's dedicated identity, ACL absence,
the monitor-to-client port binding and the shared marker path. The live site
still refuses: `_openclaw_nats` and the protected root are absent. Root
migration, account creation, the three healthy cold masters and restoration proof
remain open at 1.2[A]/v1.2-pre.

Checkpoint 2026-10-01 13:55 EDT: D32 narrows the offline-replica claim to
one live peer's observation; the leader is not pinned by the saved snapshot.
The separately held member-1 store and three healthy cold masters retain
their independent preservation requirements.

Checkpoint 2026-10-01 14:03 EDT: D33 hardens the read-only site audit's
macOS parsing after adversarial review. ACL entries are read even when `ls`
shows `@`, and a valid `dseditgroup` non-membership result is accepted despite
exit 67. The live protected site is still not staged; no writer changed.

Checkpoint 2026-10-01 14:09 EDT: D34 requires exclusive service UID/GID
directory records, an empty dedicated group and a narrow supplemental-group
set before staging. The root account/directory, migration journal and cold
masters remain absent; no production writer changed.

Checkpoint 2026-10-01 14:15 EDT: D35 requires converged three-member
metadata before the audit can label a fully routed graph a three-member
cluster. The saved evidence is now a reproducible CLI projection with a
hashed unresolved peer ID. The live split topology is unchanged; this is
read-only observation, not a cold-master or cutover acceptance.

Checkpoint 2026-10-01 14:25 EDT: D36 closes two more protected-account
false-ready cases: an operator whose primary or supplemental group is the
service GID, and GUID-only `GroupMembers` membership. A follow-up search
requires no other user's primary GID to match the service group, including a
space-bearing directory record name. The live account and protected root
remain absent; no writer cutover occurred.

Checkpoint 2026-10-01 14:29 EDT: D37 records server names, metadata leaders
and `/varz` start times in reproducible public evidence. The current read-only
`standalone-plus-two` control passes, the three-member expectation exits 1,
and the three live process start times are unchanged. This is an election
observation, not cold-master or restoration acceptance. Exact CI and Claude
delta review remain pending for this head.

Checkpoint 2026-10-01 14:38 EDT: D38 makes the read-only staging audit refuse
a protected root with any leftover entry. This closes an older false-ready
case without touching the live node; its root and dedicated account remain
absent. Focused tests and exact-head CI/review must pass before merging the
preflight source. UID/GID stale-file search across the data volume remains a
separate account-provisioning requirement, not evidence from this audit.

Checkpoint 2026-10-01 15:03 EDT: PR #175's read-only preflight merged with
exact-head CI green on rerun and Claude's no-blocker review. The active watcher
was separately switched to the already-merged PR #173 cohort code and reports
the actual `nats`, `nats-2`, `nats-3` layout as WORKING. D39 records four
root-migration design blockers and a revised review candidate. No root
transaction, protected account/marker, cold masters, isolated restores or
cutover exists; step 1.2 remains [A] at v1.2-pre.

Checkpoint 2026-10-01 15:17 EDT: D40 adds the shared-lock prerequisite to
legacy installer, uninstaller, auth-render, trust-peer sync, cohort init and
stack control source. Private lock fixtures prove shared child lifetime,
exclusive contention, marker refusal and invalid-file refusal. The macOS CI
job exercises the descriptor handoff and background-child release; relevant
source tests pass. The root-owned lock has not been created, and the existing production
entrypoints have not been redeployed from this candidate. Root journal,
durable user-to-root transfer, client hold and cutover remain open at 1.2[A].

Checkpoint 2026-10-01 16:02 EDT: PR #177 merged with four green CI jobs and
Claude's no-blocker review. The new root-side exclusion primitive and macOS
fixtures are being prepared separately. No live lock file exists yet; merged
legacy source is not evidence that installed old copies have been replaced.
The root journal, preservation transfer, client disable, cold masters and
protected bootstrap remain open at 1.2[A]/v1.2-pre.

Checkpoint 2026-10-01 16:16 EDT: draft PR #178 now includes a source-only root
lock bootstrap journal: intent-before-create, exclusive lock, old-writer
census callback, and admission readback under exclusion. Local private
fixtures pass (root lock 14/14, journal 17/17). The callbacks do not yet have a
production pinned root driver; no marker, service, store or root-owned path
was changed. Claude's exact-head review requires pre-receipt lock identity
pinning, empty/pending-record reentry and a terminal reboot/abandonment path
before this journal can control a live migration. The production path now
refuses in code until those are implemented. Durable preservation transfer,
physical census implementation, cold masters and cutover remain open at
1.2[A]/v1.2-pre.

Checkpoint 2026-10-01 17:11 EDT: a source-only follow-up to PR #178 now
prototypes a single locked ledger outside the protected site and stages the
shared lock under a transaction-specific name before linking it into view.
Private tests cover an empty ledger, interrupted pending records, concurrent
drivers, a two-link interruption, same-inode restart, deletion before the
admission receipt, and replacement after it. The production root path remains
gated. This does not yet implement terminal abandonment, reboot successors,
user-journal transfer, marker/rollback states, physical census or the
protected NATS driver. No live root path or NATS process was changed; step
1.2 remains [A] at v1.2-pre.

Checkpoint 2026-10-01 17:44 EDT: after PR #179 merged, a new source-only
branch adds a durable pre-marker `returned` outcome, a public readback receipt
and successor transactions. A successor inherits the same lock inode, nonce
and change time; once `lock-staged` was recorded, return relinks the recorded
inode instead of dropping its last name. Intent-only unpublished stage may be
discarded. Returning takes exclusive exclusion, so a live shared holder
refuses. Private Mac fixtures passed 49/49 across journal and root-lock tests,
including marker refusal, tampered outcome, reboot return and repeated
successors. The real macOS-root path remains gated. Physical release/admission
checks, durable user transfer, marker/rollback states, the protected driver,
cold masters and live deployment remain open at 1.2[A]/v1.2-pre.

Checkpoint 2026-10-01 17:55 EDT: Claude's exact-head review of draft PR #180
at 970ab8c confirmed same-inode relink and all four CI jobs, and found two
fail-closed ledger wedges: a reused transaction ID, and an empty intent-only
stage after interrupted creation. A local revision refuses reuse before
append, permits only a one-link nonce-prefix unpublished stage to be removed,
binds forward admission to the current boot, matches the user journal's boot
hash format, and creates the public outcome directory at its fixed mode under
a restrictive umask. Focused Mac tests pass 59/59. The revision needs a new
exact-head CI and Claude review; live state is unchanged and 1.2 remains [A].

Checkpoint 2026-10-01 18:16 EDT: PR #180 merged at e918a3e with 4/4 CI,
Claude's no-blocker exact-head review, and 59/59 local Mac root-lock fixtures.
The new user-transfer source branch records a full-node NATS transfer intent
and freezes its journal until an owner-checked, exact-binding root `returned`
receipt closes it. Returned windows remain restore-only. Local tests pass
112/112 for the user journal and hold, 59/59 for the root journal and lock.
This is source-only: root `declined`, post-marker `rolled-back`, and `accepted`
outcomes, physical user-journal validation in the root driver, root service
admission/census, protected marker/rollback, cold masters and live cutover are
still open. The production macOS-root path remains gated; no live service or
protected store was changed. Step 1.2 remains [A] at v1.2-pre.

Checkpoint 2026-10-01 18:30 EDT: Claude's exact-head read-only review of
PR #181 at d0eafbc reproduced the user (112 tests) and root (45 tests)
suites and found a blocking unclosable transfer when no root transaction ever
began. The branch now gates the production transfer entrypoint until `declined`
and root validation exist. Returned legacy NATS restoration additionally checks
the marker and shares the root writer lock around each mutation, while any
transfer ends the original hold's same-process forward certification. New
focused controls cover the production gate, shared-lock exclusion and hold
certification. Exact-head CI/review remain pending for this revision; no live
root or NATS state was changed. Step 1.2 remains [A] at v1.2-pre.

Checkpoint 2026-10-01 18:46 EDT: a dependent source branch adds a read-only
root validator for the owner-private user transfer. It holds the node and
journal locks, pins the journal directory descriptor, verifies the chain,
full-node baseline, current boot, node receipt, original native hold and NATS
unload lineage, then rechecks the same transfer head. The user intent now
includes transfer-time hold evidence so the root can bind its hash and compare
the watch session to the original close without requiring volatile fields to
stay byte-identical. Five root-reader fixtures and 115 user/hold tests pass
locally. The root journal does not yet invoke this validator or durably pin
the two records. All production gates remain in place; 1.2 stays [A].

Checkpoint 2026-10-01 18:57 EDT: the next dependent source slice binds root
bootstrap and reentry to a locked, still-open user transfer. The wrapper holds
the owner node/journal locks across root intent and writer-lock admission;
five local controls pass, including a closed-transfer negative before writer
lock creation and rejection of a root descriptor for another user head. It
still accepts an isolated-test physical callback and does
not durably pin the two user records or lift the macOS-root gate. Step 1.2
remains [A].

Checkpoint 2026-10-01 19:01 EDT: adversarial review of PR #182 found that
the real `close_and_drain` verifier records native hold evidence at the top
level; the first validator fixture incorrectly nested it. The validator and
fixture now use the producer's shape. Root recheck also detects replacement
of a held owner lock by comparing open and named inode/ctime identities. The
production root and transfer gates remain closed pending exact-head review.

Checkpoint 2026-10-01 19:07 EDT: PR #182's adversarial review reproduced the
receipt-shape blocker with a real gate/hold chain. The revision now includes
that real macOS positive control, allows owner-owned Finder metadata, refuses
unknown forward-window events, and detects replacement of either held owner
lock. Local root/transfer suites pass 68/68 and user journal/hold 115/115.
The branch remains draft until revised-head CI and review pass.

Checkpoint 2026-10-01 19:15 EDT: Claude's exact-head review of 0006d8b
reported no blocker. Its two minor refusal cases are now closed: owner-owned
regular Finder metadata is allowed regardless of mode under the 0700 journal
directory, and deeply nested malformed JSON returns `Refused`. macOS CI now
runs the existing user journal and hold suites as well as the real-gate
validator test. Local focused tests remain 68/68; user/hold tests 115/115.
Revised CI is pending. Production gates remain closed.

Checkpoint 2026-10-01 19:29 EDT: a dependent source slice now includes the
exact validated user baseline and transfer records in the root-owned intent
and checks their content hashes, descriptor binding, and equality on bound
reentry. Root journal and bound admission controls pass 51/51 locally.
PR #183's independent adversarial review is still probing reboot reentry;
neither slice authorizes production root bootstrap. The physical driver,
outcome lifecycle, protected staging, cold masters, isolated restores, and
live acceptance remain open at 1.2 [A].

Checkpoint 2026-10-01 19:33 EDT: bound root reentry now distinguishes a
prior-boot intent from a current-boot one. A prior-boot transfer must match
the root-owned copies and may only take the pre-marker return path; it cannot
readmit the writer. The new reboot fixture passes with the user-transfer
checks. Production release observations and the full outcome lifecycle remain
open; the root tripwire stays closed.

Checkpoint 2026-10-01 19:56 EDT: a source-only `declined` outcome is now
recorded in the existing root ledger under owner and ledger locks when no
root intent survived. A one-link pending root intent is settled; a published
intent refuses decline. The root receipt can be republished after a crash,
and the user closure accepts `declined` for restore-only recovery. Twelve
focused decline controls, 87 root-side controls, 78 user-journal controls,
and 17 preservation checks pass locally; adversarial review and CI are pending.
The physical absence callback remains test-supplied and the
production transfer/root gates remain closed. Step 1.2 stays [A].

Checkpoint 2026-10-01 20:09 EDT: Claude's exact-head PR #185 review found no
reachable safety blocker and CI passed 4/4, but its E4 probe exposed a stale
outcome collision detected after the decline record. D50 moves the protected
transaction-slot check before the durable decline append. The new regression
passes in the focused 13/13 suite; revised-head CI and review remain pending.
The production physical driver and step 1.2 runtime acceptance remain open.

Checkpoint 2026-10-01 20:27 EDT: the next source slice now holds a carried
writer lock shared through the decline append and stores bounded, replay-
validated physical absence evidence in the root ledger (D51). Owned probes
cover an exclusive lock holder, a competing writer during observation and
append, oversized evidence, and rehashed evidence tampering; the root and
user-journal suites pass 92/92 and 78/78 locally. The protected
root-owned observer, fixed production paths, launchd/process/store census,
root installation, three healthy cold masters and live restoration remain
open. The production macOS-root gate stays closed; 1.2 remains [A].

Checkpoint 2026-10-01 20:37 EDT: Claude's exact-head PR #186 review found no
protocol-reachable blocker and green 4/4 CI, but reproduced a lock change
detected only after a durable decline. D52 adds commit-boundary rechecks and
canonical evidence validation. Three new commit-window controls and the
malformed-evidence control pass; the root journal, bound admission, decline
and user-transfer suites pass 82/82 locally. Revised-head CI and adversarial
review are pending. The protected observer, root-owned installation, cold
masters and live acceptance remain open at 1.2 [A].

Checkpoint 2026-10-01 20:47 EDT: PR #186 merged with Claude's revised-head
no-blocker review and green 4/4 CI. D53 adds non-mutating root ledger
inspection for the future observe-only driver: absent state is reported
without creation, a valid chain is summarized, pending records stay in place
and refuse, and an active driver refuses. The focused root-journal suite
passes 49/49 on macOS. Exact CI/review of this new source slice are pending;
the fixed-path physical observer, protected installation and live recovery
remain open at 1.2 [A].

Checkpoint 2026-10-01 20:53 EDT: Claude's PR #187 probe showed a same-site
stale ledger directory could be substituted during a path-based read. D54
pins record enumeration and open to the held directory descriptor, rechecks
the named site/ledger identities, and marks the output `ledger-only` with
`last_event` rather than suggesting physical safety or a terminal state.
The focused Mac root-journal suite passes 51/51, including before- and
after-read swaps. Revised-head CI and review remain pending; production
physical census and root installation are still unbuilt.

Checkpoint 2026-10-01 22:01 EDT: Claude's 0cb808c review found no blocker and
green 4/4 CI, but exposed a FIFO hang, a directory-record descriptor leak,
and path/permission race reports. D55 adds nonblocking typed record opens,
descriptor cleanup, opened-directory validation, final record rechecks and
uniform refusal. Focused regressions pass after the VM restart; full suites
and revised-head review remain pending. The production observer and root
installation remain unbuilt; 1.2 stays [A] at v1.2-pre.

Checkpoint 2026-10-01 22:20 EDT: PR #187 merged at cdd7d680 after green
4/4 CI and Claude's revised-head no-blocker review. D56 adds a read-only
macOS live census on a new branch: exact four GUI/system labels, disabled
overrides, plist identities, NATS kernel process identity/arguments and open
vnode identities, and four store trees. Eight focused tests pass, and the
command reports the current three running GUI jobs plus disabled/unloaded
member 1 without changing them. The report is diagnostic only. Protected
fixed-path deployment, complete mutator/store-holder absence, writer-lock
bracketing, cold masters, isolated restores and live acceptance remain open.
The macOS-root tripwire stays closed; 1.2 remains [A] at v1.2-pre.

Checkpoint 2026-10-01 22:39 EDT: Claude's first-head PR #188 review found no
blocker for the diagnostic source slice, but reproduced misleading empty
process/store-holder reports and an unchecked waiting-job argument change.
The revised census states its incomplete coverage, compares loaded arguments
for waiting and running GUI/system jobs, and keeps argument values out of the
report. The new tests run in CI at 595f0df (4/4 green); revised-head CI and
adversarial review are pending. This does not certify absence or authorize
the production migration. Step 1.2 stays [A] at v1.2-pre.
Claude's second pass also reproduced a control-character parsing ambiguity;
the next revision refuses such arguments and keys the report digests per
scan. Exact-head CI and review remain pending.

Checkpoint 2026-10-01 22:33 EDT: D57 tightens the future observer's root
ledger input boundary. Observe-only reads precheck record type before open
and map malformed JSON/schema exceptions to `Refused`. Three new controls
cover an unopened FIFO, deeply nested JSON, and a rehashed invalid returned
lock; the focused macOS root-journal suite passes 60/60. This does not add
the protected physical observer, change NATS state, or lift the root gate.

Checkpoint 2026-10-01 22:57 EDT: PR #188 merged at d5b5c13 after 4/4 green
CI and Claude's exact-head no-blocker review of its diagnostic scope. D57 was
rebased onto that source and its related root-journal, decline, admission and
user-transfer suites pass 97/97 locally. D57 still needs exact CI and review;
the protected physical absence observer and production cutover gates remain
open at 1.2 [A]/v1.2-pre.

Checkpoint 2026-10-01 22:59 EDT: PR #190's first Ubuntu CI run exposed a
Python parser-depth difference: 1,200 nested arrays return a list on that
runner and are refused by schema validation, while macOS raises recursion.
The test now accepts either clean refusal for that real input and separately
forces RecursionError and TypeError to verify uniform boundary mapping. The
source behavior is unchanged; revised CI and Claude review are pending.

Checkpoint 2026-10-01 23:08 EDT: Claude's PR #190 fuzzing found a non-string
transaction escaping as `AttributeError` after a record was rehashed. D57 now
requires string UUIDs in intent and decline validation and maps residual
attribute errors at the read-only boundary. Both new malformed-transaction
regressions pass; journal and decline suites pass 83/83 locally. Exact-head
CI and follow-up adversarial review are pending; root production gates remain
closed.

Checkpoint 2026-10-01 23:04 EDT: D58 adds an independent read-only holder
command that scans vnode descriptors across readable processes of every name,
including retained paths for unlinked store files. Seven focused Mac tests
pass. A live user-level scan found PID 842 holding one linked 4222 entry,
with 145 unreadable PIDs and 41 unattributed unlinked handles on store
devices; it explicitly does not certify absence. Exact CI/review are pending.
The protected root observer, cold masters and cutover remain open at 1.2 [A].

Checkpoint 2026-10-01 23:16 EDT: PR #190 merged after exact-head 4/4 CI and
Claude's no-blocker review. D59 closes the previously reproduced raw root-
driver `TypeError` for a rehashed returned record with a non-dictionary lock.
A direct driver control also pins the non-string intent transaction refusal.
The root journal and decline suites pass 85/85 locally, including both new
driver controls. The protected physical observer,
three healthy cold masters and production cutover remain open; 1.2 stays [A]
at v1.2-pre.

Checkpoint 2026-10-01 23:20 EDT: Claude's PR #191 review found no blocker for
its diagnostic scope but reproduced false deleted-file attribution through a
replaced symlink and identified unlabelled process-snapshot churn. D58 now
matches retained paths lexically and verifies the current device/inode for a
linked file created after the store walk. It retries once, reports exited
versus unreadable PIDs, and declares its open-FD coverage. The related local
suites pass 20/20 and a read-only live scan still observes one
linked 4222 holder with 141 unreadable and two exited PIDs. Revised-head CI
and adversarial review are pending; no absence verdict or cutover is allowed.

Checkpoint 2026-10-01 23:40 EDT: PR #191 merged with exact-head 4/4 CI and
Claude's no-blocker diagnostic review. Its D58 holder census remains read-only
and does not certify physical absence. PR #192 now includes D59's direct-driver
refusal for non-finite JSON and recursive raw records, after incorporating
#191's merged base. The root journal and decline suites pass 88/88 locally,
including a two-link pending-record refusal that preserves both names.
Exact-head CI and adversarial review of the revised #192 are pending; the
protected physical observer, three healthy cold masters and production
cutover remain open at 1.2 [A]/v1.2-pre.

Checkpoint 2026-10-02 06:20 EDT: a read-only 23-unit provisional recapture
includes the operator-approved host Ollama target `http://192.168.64.1:11434`.
The mesh-agent and memory-daemon plists now hash to `d0d01ead…` and
`a3fb84ea…`; the former hashes are present in Foreman backups. Memory-daemon
PID 37477 started at 2026-10-01 22:34:32 EDT and its argv and LLM setting
match its plist. The env file and Foreman backup remain 0600; no env-file
digest is published. All 23 structural states match and 59 direct pins over
29 distinct files were hashed, but the entrypoint preflight still refuses the
two loaded unapproved system jobs. See the sanitized diagnostic and
RUNTIME_EVIDENCE.md. The previous 20-unit capture and the 13:40 mesh-agent
pin are stale. No full-node journal or cold master exists; 1.2 stays [A] at
v1.2-pre. The source memory-daemon plist template and separate
`workspace-bin/install-daemon` renderer lack `LLM_BASE_URL`, so a future
reinstall would undo the live setting until those source gaps are fixed.

Checkpoint 2026-10-02 06:50 EDT: a source-only correction now threads the
configured `LLM_BASE_URL` through the memory-daemon launchd and systemd
templates and the separate direct installer (macOS, systemd and pm2). The
direct installer reads only that key from `~/.openclaw/openclaw.env` with the
same precedence as the normal installer;
an isolated HOME with stub service commands exercised all three render paths.
The normal launchd template rendered and parsed with the host URL. This has not been
installed or restarted on the live node. The 23-unit diagnostic remains
provisional, the two system jobs still refuse preflight, and 1.2 stays [A] at
v1.2-pre pending exact CI and adversarial review.

Checkpoint 2026-10-02 07:10 EDT: PR #196 merged at 0d3237f after exact-head
4/4 CI and Claude's no-blocker review. The source memory-daemon installers now
preserve the saved host-Ollama URL across normal launchd/systemd installs and
the separate macOS/systemd/pm2 path. No live service was changed. Node-init's
mesh-agent renderer still read only the process environment, so a plain-shell
rerun could drop that service's saved URL; a source-only correction is under
test. The diagnostic baseline remains provisional and 1.2 stays [A].

Checkpoint 2026-10-02 07:27 EDT: PR #197 merged at 5caf0b6 after exact-head
4/4 CI and Claude's no-blocker review. Node-init now renders the mesh-agent's
saved host-Ollama URL even when a stale localhost value is present in the
shell. The shared env reader no longer consumes the next line after an empty
key, while retaining its original first-duplicate rule for NATS. The live
plists and services are unchanged; this source repair does not certify the
23-unit diagnostic, remove the two unapproved system jobs, or close 1.2.

Checkpoint 2026-10-02 08:00 EDT: the D60 source draft admits only the exact
idle `com.openclaw.tailscale-up` system one-shot as an explicit, rechecked
exclusion. Its launch count, plist, wrapper, signed app and boot identity are
saved in the full-node inventory; a later run or drift refuses. The focused
preservation suites pass 103/103 and the root transfer suite passes 10/10;
read-only validation of the installed
helper passes. The live preflight still refuses `com.openclaw.agent`, so the
23-unit baseline remains provisional. No system job or node service was
changed, and 1.2 remains [A] at v1.2-pre.

Checkpoint 2026-10-02 08:30 EDT: Claude's bc99aac challenge confirmed the
reboot/update recovery wedge is fixed but found an unreported helper run after
NATS transfer intent. Recovery now records a durable boolean comparing the
fresh exclusion with the original baseline, without blocking restore-only
resolution. A run during one recovery attempt fails that attempt; retry records
the changed baseline comparison. Source tests include the returned-transfer
case. The root-held transfer still needs its own live observer before cold
master acceptance. The focused preservation suites now pass 104/104. This
record does not authorize cutover or close 1.2.

Checkpoint 2026-10-02 08:54 EDT: PR #199 merged at 8b451da after its exact-head
4/4 CI rerun. Claude's no-blocker review was at 4435211; follow-up 0c6c30f
addressed its test and wording notes without changing production code. It admits the exact idle
Tailscale system helper as an explicit exclusion and durably reports changes
observed when recovery starts; it does not certify the root-held transfer. A
narrow retirement runbook for the obsolete root-managed `com.openclaw.agent`
has been prepared and the live plist hash, owner, absent entry file and
repeated exit 1 were rechecked. Noninteractive administrator access is
unavailable, so no root action occurred. The live full-node preflight still
refuses that job; the protected observer, three cold masters and cutover remain
open at 1.2 [A]/v1.2-pre.

Checkpoint 2026-10-02 09:06 EDT: the legacy root-owned
`/etc/sudoers.d/openclaw-mesh` also remains installed (root:wheel 0440).
Effective `sudo -n -l` output still grants passwordless wildcard
`launchctl load/unload` and `killall -9 node`. Those grants can reload the
obsolete root job or stop Node services, so they also defeat the proposed
root boundary. PR #200's runbook requires inspection, protected backup and
removal of those exact legacy rules before retiring the daemon in one locked
local administrator session, with no action if its contents differ. Claude found
no safety blocker in the original daemon sequence and asked for explicit
preflight, collision, disabled-state and post-action checks. No administrator
or NATS action occurred.

Checkpoint 2026-10-02 09:17 EDT: the retirement preflight is now required to
hold the existing owner-private `node.lock` with macOS `lockf -kn -t 0` for the
whole administrator session. A private temporary-file control confirmed
`lockf` and the journal's Python `fcntl.flock` contend; the real node lock was
also acquired and released with no action. This closes the check-to-retire
race in the written procedure. Live retirement remains unexecuted.

Checkpoint 2026-10-02 09:27 EDT: PR #200's ordered procedure now keeps a
root recovery shell open while the legacy sudoers file is moved, syntax and
fresh password authentication are checked, and only then the pinned daemon
is disabled, booted out and archived. The node lock remains held until the
23-unit preflight and before/after census finish. CI passed 4/4 at the prior
draft head `8558076`; this ordering revision still needs exact-head CI and
adversarial review. The administrator action is still unexecuted, and 1.2
remains [A] at v1.2-pre.

Checkpoint 2026-10-02 09:39 EDT: Claude's exact-head review of PR #200 at
`1c3e8ee` confirmed the revised lock/sudoers/daemon order and all four CI
checks, then found procedural gaps in pasted-block failure handling, sudoers
hash recording and policy restoration. The next source-only follow-up makes
each command an individually checked step, prints the inspected sudoers hash,
provides a pinned restore branch, uses absolute sudo/Python paths, and adds
checkout, private-output and lock-continuity checks. Exact-head CI and review
of that follow-up remain pending. No administrator or NATS action has run;
the protected observer, cold masters and cutover remain open at 1.2 [A].

Checkpoint 2026-10-02 09:45 EDT: Claude found no blocker in the `a985298`
procedure after its three prior gaps were fixed. Its remaining notes led to
a final instruction that every node-user and root command be checked
individually, the checkout must have no changes, and the second-terminal
lock proof precedes any retirement report. CI and review at this final head
remain pending. No root action has occurred.

Checkpoint 2026-10-02 09:52 EDT: PR #200 merged at `a629e9a` after exact-head
CI 4/4 and Claude's no-blocker review of `d181549`. It supplies the guarded
local retirement procedure only. A Codex terminal is waiting for the operator
to authenticate locally; no administrator action or node lock is active.
The 23-unit live preflight still refuses the installed legacy root job.
Step 1.2 stays [A]/v1.2-pre; protected root observation, healthy cold masters,
and production cutover remain unbuilt or unaccepted.

Checkpoint 2026-10-02 10:13 EDT: the D56/D58 node-user diagnostics now open
plists nonblocking without following a final symlink and traverse store
directories through pinned descriptors. Owned regressions cover a plist
replaced by a FIFO and root or nested store directories replaced by symlinks
between checks. This narrows diagnostic read races; neither command is a
protected root observer or an absence certificate. The live retirement and
full-node preservation gates remain open work at 1.2 [A].

Checkpoint 2026-10-02 10:33 EDT: PR #201 merged at `0b74e32` with CI 4/4
and Claude's no-blocker review of `44d5bb3`. The next source slice extends
the same read-only process snapshots to kernel working-directory and mapped
file vnode identities, including mappings whose original descriptor closed.
An owned macOS test covers cwd identity, a fixture covers cwd inside a store,
and another native test covers an unlinked mapping. This
does not make the user-run censuses single-instant or authorize physical
absence; PID reuse, unreadable processes and in-flight descriptors remain
explicit limits. The guarded legacy retirement is still awaiting local
administrator authentication, and step 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-02 11:09 EDT: PR #202 merged at `bfe997e8` after exact-head
CI 4/4 and Claude's no-blocker review of `f7238e3`. Cwd and mapped-vnode
observations remain diagnostic only. Claude's next read-only driver challenge
found that the full-node user journal guarded NATS restoration only after a
returned transfer. D61's source correction applies marker and shared-lock
checks to every full-node NATS recovery, including no-transfer windows. Owned
marker and exclusive-lock controls pass with the 85-test journal suite. Exact
CI and adversarial review of this change are pending. The production driver,
protected observer, healthy cold masters, and live retirement remain open;
step 1.2 stays [A]/v1.2-pre.

Checkpoint 2026-10-02 11:29 EDT: Claude found no blocker in PR #203's first
head and its quick delta probe confirmed the held member and final check. The
follow-up now also brackets hold preparation, final readiness/gate reopen and
resolution; old unscoped NATS journals use the same exclusion, and a lock
appearing during an initially lock-free action refuses. Owned regressions pass;
the full exact-head suite, CI and adversarial delta verdict remain pending.
No production NATS service was changed, and 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-02 11:53 EDT: Claude's PR #203 review found that the
original unscoped-journal regression could pass after its callbacks were
swallowed, and that tests still touched the live root marker paths. The
regression now asserts that no NATS callback ran, and both parent and child
hold tests use private marker and lock fixtures. A proposed mandatory root
lock check passed 154/154 local tests but conflicts with recovery after a
crash before the durable user transfer: root lock bootstrap itself requires
that transfer. The no-lock checked branch is retained, with an added test
that recovers an old unscoped journal before bootstrap. Targeted controls
pass 3/3 after this correction; the revised full suite, exact-head CI and
Claude delta review are pending. The live root lock remains absent. No
production NATS service or root path was changed; 1.2 stays [A]/v1.2-pre.

Checkpoint 2026-10-02 12:18 EDT: Claude's scratch probe confirmed the
mandatory-lock deadlock and validated the checked absent-lock recovery. The
user guard now rechecks immediately before NATS restart, gate unlink and
terminal row; a detection after a restart or observed gate opening is labelled
`after_commit`, and a terminal row followed by a receipt/guard failure raises
`CommittedRefusal` with its hash. Private fixtures replace all real root-path
reads in the hold suite. The revised journal/hold suites pass 134/134 on this
Mac, and the separate owned restore-only suite passes 27/27; an earlier
combined run had two load-sensitive owned readiness failures, with no NATS
guard involved. The revised PR head, CI and Claude exact-delta review remain
pending. No live root or NATS state changed; 1.2 stays [A]/v1.2-pre.

Checkpoint 2026-10-02 12:32 EDT: Claude found no blocker in PR #203 at
`c9acbbe` with exact-head CI 4/4, but its mutation pass exposed two missing
journal-level guards and a test that bypassed the sticky journal write flag.
The revised tests now assert a new lock before NATS restart refuses, the
recovery facade passes the NATS check into the gate's last before-open step,
and a restart that raises is still reported as possibly committed. A real
sticky `hold-opened` failure now raises `CommittedRefusal` naming the observed
open gate without attempting another journal append. The revised local
journal/hold suites pass 138/138; exact-head CI and Claude delta review for
this final follow-up remain pending. The earlier owned restore-only suite
passed 27/27. No live root or NATS state changed; 1.2 stays [A]/v1.2-pre.

Checkpoint 2026-10-02 12:45 EDT: PR #203 merged at `4d6e2c9` after
exact-head CI 4/4, Claude's no-blocker delta review, and a fresh macOS
restore-only run passing 27/27 at `93e1e84`. The macOS CI job is being
extended to run that owned restore-only suite on every source change. This
does not establish a full-node preservation window, protected root physical
admission, cold masters, or live NATS restoration; 1.2 stays [A]/v1.2-pre.

Checkpoint 2026-10-02 12:51 EDT: the new macOS CI run exposed a fixture
assumption hidden by the node's local layout: its owned service plist named
`/usr/local/bin/node`, absent on the hosted arm64 runner. The fixture now
pins the installed Node executable selected by the job's PATH. This changes
only owned test setup; exact CI rerun is required before PR #204 can merge.

Checkpoint 2026-10-02 12:55 EDT: the first local rerun after fixing the
fixture path exposed the owned recovery adapter's matching hardcoded Node
path. It now accepts the canonical absolute Node executable already saved
and content-pinned in the journal, then binds the running process to that
same path. The previously failing ambiguous-open readiness case passes in
isolation. Full local and exact-head CI runs remain pending.

Checkpoint 2026-10-02 13:03 EDT: the adapter's saved Node path now also
requires a regular, single-link executable before any content read. An owned
FIFO-path control refuses before the read; this guards a malformed saved
baseline from hanging recovery. The earlier exact-head CI at `002dfca` passed
4/4 and the owned suite passed 27/27 locally. The new 28-case suite and
corresponding CI run are pending. Protected root admission and live cutover
remain open at 1.2[A]/v1.2-pre.

Checkpoint 2026-10-02 13:12 EDT: PR #204 merged at `734c06a` after its
exact-head CI passed 4/4 and the owned restore-only suite passed 28/28 on
the hosted macOS runner. Claude found no blocker in the saved-executable
fix or the special-file refusal; the regression test is now bounded by an
alarm. A separate source slice makes the shared `static_identity` capture
read only bounded regular files through non-blocking, no-follow descriptors,
with a FIFO control. Its journal and hold suites pass 96/96 and 43/43
locally; owned restore-only and exact-head CI are pending. This is source
hardening, not a live full-node admission or cutover.

Checkpoint 2026-10-02 13:26 EDT: PR #205's exact-head CI rerun passed
4/4; the first attempt failed in an unrelated NATS test teardown race.
Claude found no blocker in the bounded static-identity read and verified
existing saved identities remain comparable. Its review prompted an
`O_NOCTTY` open flag and a stricter FIFO timeout assertion, plus symlinked
and oversized plist controls; final exact-head CI for that delta is pending.
Draft PR #206 separately fixes the NATS test teardown by waiting for its
private server to exit before removing its store. Root admission and live
cutover remain open at 1.2[A]/v1.2-pre.

Checkpoint 2026-10-02 13:56 EDT: PR #205 merged at `894dca6` after its
final exact-head CI passed 4/4 and local journal, hold and owned restore-only
suites passed 97/97, 43/43 and 28/28. Claude found no blocker in the final
bounded-read delta. PR #206 merged at `aa5ff69` after exact-head CI passed
4/4 and Claude's adversarial checks showed that the NATS test server exits
before its private store is removed, including startup failures; its final
file-level cleanup hook also makes an injected teardown failure exit nonzero
under the CI Node 20 and 22 commands. Neither PR changed live services.
The 2026-10-02 provisional full-node baseline includes the approved host
Ollama endpoint changes, but still refuses the obsolete system-domain
`com.openclaw.agent` job. Its guarded retirement runbook is prepared; local
administrator authentication has not yet been supplied. Protected root
observer/admission, three healthy cold masters, isolated restores and live
cutover remain open at 1.2[A]/v1.2-pre.

Checkpoint 2026-10-02 22:21 EDT: the operator-attested legacy root-agent and
sudoers retirement was observed at 22:09 in private evidence; a separate
public preflight observed the job absent at 22:21 on the same boot. Private
root copies and postflight evidence are retained, and the preservation lock
is released. A fresh read-only diagnostic
from main `b6e8874` accepts exactly 23 approved installed jobs, 21 GUI-loaded
jobs and the pinned idle Tailscale exclusion; no cohort job is loaded in the
user or system domain. The 23 plist hashes and 59 direct file pins match the
earlier provisional capture, and both operator-approved host-Ollama plist
values still match the private env file, whose mode was checked as 0600. This
is a point-in-time preflight,
not a Journal baseline or continuous hold. Reboot persistence, complete
provenance and readiness, the production controller/root observer, three
healthy cold masters, isolated restores and live resumption remain open at
1.2 [A]/v1.2-pre. See the runbook execution record and
`POST_RETIREMENT_BASELINE_RECAPTURE_20261002.json`.
The merged PR #195 templates for node-watch, health-watch, consolidation-
scheduler and memory-daemon differ from these installed plists; a re-render
will change at least four pinned plist hashes and require another capture.

Checkpoint 2026-10-02 23:23 EDT: authenticated read-only JetStream observation
found only `local-events-daedalus` on the standalone bus. It owns `local.>`
and holds 24,286 messages; its newest retained message is from 2026-07-14.
The current `moltymacs-virtual-machine` stream is absent from that standalone
bus. All four inspected current
service plists use `OPENCLAW_NODE_ID=moltymacs-virtual-machine`, and the
memory-daemon logs reject creation of its local stream because subjects
overlap. Changing node-watch alone to `daedalus` would falsely mark historical
data as current. Preserve and restore the legacy stream before any subject
repartition or replacement. Protocol step 4.1 observed the current-node stream
working in August on an R=3 topology. A 23:40 read-only check found that exact
`local-events-moltymacs-virtual-machine` stream visible through both
still-running cluster members' JetStream APIs at 4223/4224, with 55,173
retained messages through 2026-09-23. Its only replica is led by nats-3.
The existing private 2026-09-28 cluster-online archive records the same
55,173 messages and last sequence; its separate standalone-online archive
records the older 24,286-message stream. These online points are not the
three healthy cold masters or the isolated restores required by step 1.2.
Preserve and restore that newer history as well as the older standalone stream
before subject migration; prove current-node event emission afterward. The
cluster stream's last retained message is 2026-09-23T18:11:02Z; the daemon now
targets the standalone bus. The cause and date of that switch are not yet
established. This publication failure does not reopen the dotted-name source
fix.
No bus, plist or service changed. See step12_jetstream/RUNTIME_EVIDENCE.md.

Checkpoint 2026-10-03 08:47 EDT: a read-only review of retained NATS and
memory-daemon logs identifies a repeated 4222/8222 collision between
standalone and cluster member 1. Member 1 won on August 24 and August 30;
standalone won on August 26 and September 6. Member 1 restarted under the
same ownership on September 5. The September 6 daemon overlap refusal
followed standalone's successful bind by ten seconds. The daemon's currently
loaded endpoint and an October 1 backup with July 14 modification time name
port 4222, though
intermediate renders are not fully proven. This explains the listener
ownership transition without treating later cluster decay events as daemon
publications. See `audits/step12_jetstream/PORT_4222_FORENSIC_20261003.md`.
Step 1.2 remains [A]/v1.2-pre: the full-node quiet-window controller, three
healthy cold masters, their isolated restores, protected writer and truthful
service restoration remain open. No live state changed.

Checkpoint 2026-10-03 08:58 EDT: follow-up retained logs show member 1
serving 4222 on September 22 while standalone failed its monitor bind, then
standalone serving 4222 on September 25 while member 1 failed. The member-1
interval provides a possible path for the cluster's last observed message at
14:11 EDT on September 23. It does not explain earlier post-September-6
messages or identify their publisher. See the same forensic note. Step 1.2
remains open.

Checkpoint 2026-10-03 09:47 EDT: the read-only legacy NATS census now binds
all four installed GUI plists to their current private config files and
refuses undeclared include or substitution tokens. The live node accepts four config pins;
35 focused tests pass. This does not establish running-process config bytes,
physical absence, cold masters or a quiet window. Step 1.2 remains [A] at
v1.2-pre; see step12_jetstream/NATS_CONFIG_CENSUS_20261003.md.
