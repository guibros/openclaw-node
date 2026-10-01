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
fixtures pass (root lock 10/10, journal 9/9). The callbacks do not yet have a
production pinned root driver; no marker, service, store or root-owned path
was changed. Durable preservation transfer, physical census implementation,
cold masters and cutover remain open at 1.2[A]/v1.2-pre.
