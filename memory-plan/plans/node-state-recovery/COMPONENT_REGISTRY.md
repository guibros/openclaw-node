# Node state recovery — registry

## Family 1: persisted application state

### SQLite application stores
| | |
|---|---|
| **Status** | ACCEPTED: twelve per-store snapshots restore correctly; independent review accepted e750e3e; coordinated recovery remains 1.3 |
| **Verified** | 2026-09-28 08:31 EDT: 852,017,152 snapshot bytes, 116 physical tables, matching typed content/rowids/header/FK fingerprints, core integrity; six native FTS checks and eight vector probes pass. Owner-private files; running service PIDs/runs unchanged. Node 24 daemon/knowledge SQLite 3.49.2; Node 22 MC SQLite 3.53.2; gateway node:sqlite 3.50.4/vec 0.1.9. Agent stores have compatibility probes, not owner-engine claims. Header inventory refuses unknown stores/links; explicit browser/historical/source exclusions. |

### JetStream histories
| | |
|---|---|
| **Status** | SPLIT, preservation in flight: standalone 4222 and cluster 4223/4224 serve; failed member 1 persistently held; three healthy cold masters pending |
| **Verified** | 2026-09-28 21:33 EDT: member-1 protected master and its isolated R1 restoration accepted; eleven individual online archives restored with 80,156 non-expiring messages. After the VM crash, nine reachable non-expiring stream states/configs and durable positions match the older archive points; no immediate pre-crash acknowledgement guarantee. Worker explicitly restored under a 65-second idle guard. All three serving bus identities/routes remain unchanged through revised owned recovery tests; member 2 is metadata leader. Fifteen preservation checks, a real account-group election regression, fifty-three journal fault tests and complete owned recovery fixtures pass. Journal is a primitive; managed orchestration remains pending. New managed-window acceptance, three healthy cold copies and coordinated recovery remain open. |

Current mechanism checkpoint 2026-09-28 23:49 EDT: tools-v30 passes53 fresh journal tests; unchanged15 admission/1 election tests inherit identical source hashes. Creation prepares the receipt before mkdir; interrupted setup is restoration-only. bbbc883 CI36516935187 is green, while this newer patch awaits exact CI/review. No new healthy production stop or cold-copy acceptance.

Current mechanism checkpoint 2026-09-29 00:58 EDT: tools-v31 passes55 fresh
journal tests, including initializing-root Finder recovery and fenced invalid
metadata. The unpatched ab7097c control fails as expected. Its exact CI
36518928261 is green and Claude accepted the previous creation fixes; this
new checkpoint requires fresh integration CI/review. PR149 merged55131b8;
installed task-daemon PID82096/runs1 still uses the accepted readiness release.
No production preservation window or healthy cold-copy acceptance exists.

Managed-stop checkpoint 2026-09-29 01:11 EDT: tools-v33 passes six actual owned
macOS launchd/authenticated-NATS controls; crash/surviving-child/timer-race/wrong
argv negatives refuse. Eleven current healthy owners pass read-only binding.
No healthy production stop or preservation window. N3 exact CI36523987643
green3/3 and Claude Message38 accepts it. Adapter exact CI/review pending;
detached orchestrator/static inventory/restoration/cold masters remain open.

Fixture-readiness checkpoint 2026-09-29 01:21 EDT: f3bb44f CI failed before Mac test
collection in old stream placement. Full owned readiness/missing-peer control
and existing recovery checks pass from tools-v36; two refused drafts retained
with normal cleanup. New exact CI/review pending. Production source and service
owners remain unchanged; healthy cold masters and the driver are still open.

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

Kernel-evidence checkpoint2026-09-29 02:33 EDT: tools-v46 passes20 actual Mac
controls/1 skip; all21 owned jobs unloaded. Four owned NATS stops at restored
archive sizes and one idle memory stop with254MB copied databases exit normally
in34–65ms. No production timeout change or healthy cold master. Discord's
disabled/no-token integration is still restarted by its installed unit.
9deef65 CI36530037917 green3/3, Claude Message46 accepts that source; new
revision awaits exact CI/review. All driver gates remain open at1.2-pre.

2026-09-29 02:50 EDT — Owned/read-only recovery adapter only:21 actual
Mac controls/1 explicit domain skip and56 journal controls pass. Kernel
failure details now persist in post-intent failed journal records; foreign
filters refuse even for a bound PID. No healthy production service operation,
quiet window or cold-master acceptance. See DURABLE_KERNEL_EVIDENCE.json.

2026-09-29 03:09:24 EDT — Recovery journal/tools only: fixed mixed-width PID key
round-trip poisoning before production use.58 journal tests and21 real Mac
controls/1 explicit domain skip pass. No production window, stores or service
state changed. Exact new CI/review required; PID_KEY_EVIDENCE.json.

### Recovery source foundation — 2026-09-29 07:12:37 EDT

Main51a817f integrates without changing the reviewed5fabf6e Journal/stop/checks
tools. A new private copied Journal consumer passes58 controls; prior actual
managed controls are inherited by unchanged hashes, not called new runs.
PR144 is recast as this bounded tools checkpoint pending exact-head CI/review.
No production importer or controller/hold exists. Existing evidence JSONs and
RUNTIME_EVIDENCE.md remain scoped development history. Recovery1.2[A]/v1.2-pre,
its controller/static baseline, three healthy cold masters and full restoration
acceptance remain unfinished. Bus3.5/3.6 are the next explicit dependencies.

2026-10-01 00:01 EDT — Bus3.5–3.11 are merged; five actual Mac timers are
gated and reopened from a resolved timer-only journal. A separate read-only
full-node baseline captured 20 live launchd states and 54 direct file pins
after D21 admitted the legitimate idle on-demand mesh-agent. This is
structural schema evidence only. Standalone still serves five clients,
cluster members 2/3 serve, and member1 remains disabled/unloaded. No complete
source/provenance closure, full-node controller, healthy cold master or
restoration acceptance exists; 1.2 remains active.

2026-10-01 01:29 EDT — D22's source draft expands the full-node Journal
cohort to 23, adding the live gateway and viewer and the installed disabled
federation tick. The prior 20-state/54-file capture is historical and cannot
authorize a new window. A multi-domain read-only preflight refuses two
additional loaded system jobs: a crash-looping legacy agent and an idle
Tailscale one-shot. The protected timer controller `-4` safely refuses the new
full-node scope; it remains usable only for the current timer-only receipt.
Neither system job was altered. Full-node capture, cold masters and truthful
restoration remain open at 1.2[A].

2026-10-01 01:55 EDT — D23's PR #169 correction requires explicit scope for
new journals and binds the full-node baseline to a source-owned, multi-domain
entrypoint scan. Neutral loaded labels and HOME-derived plist paths are now
included; the deploy listener stops first and resumes last. The tightened live
scan still refuses the two unmanaged system jobs. Owned source tests pass, but
exact CI/review and a production driver remain pending. No live full-node hold
or healthy NATS cold copy exists.

2026-10-01 06:33 EDT — PR #170 is a draft source and owned-fixture checkpoint.
The candidate copier refuses unreadable store subdirectories and missing
directory entries. An owned three-member NATS restore reads the original
message from every restored member; a same-length corruption control fails.
APFS fixture checks effective ownership flags at attach/remount. The complete
Mac recovery suite passes 204 tests with three expected skips; the NATS
fixture reports no production connections. Exact CI and adversarial re-review
of this final head are pending. The live stores remain operator-owned; no
protected cross-uid driver, production cold master or full-node seal exists.

2026-10-01 06:56 EDT — D34 corrects the routed-read limit in that checkpoint:
the owned restore now makes each member stream leader before comparing the
seeded message. Corrupting any one of the three copied members fails when it
leads; the candidate also has a copy-side manifest whose publication digest
detects later changes before restore. The Mac suite passes 207 tests with
three skips, the opt-in copier/APFS/volume set passes 11 tests, and a final
refusal-only sync traversal change passes nine focused copier tests. These
are owned development controls. Exact CI/re-review are pending; live stores
remain same-uid and no production cold-point or full-node seal exists.

2026-10-01 07:08 EDT — D35 limits the leader-rotation claim: a restored
member can become leader *after* peers heal a damaged source store. The
fixture proves recovered-cluster content, not independent health of each
published member copy. The post-publication corruption negatives exercise
the restore-read layer separately from `verify_candidate`; they do not cover
pre-copy source damage. PR #170 head `6868c1f` passes all three CI jobs and
remains draft. Independent per-store recovery, protected publication and live
service migration are still open.

2026-10-01 07:16 EDT — D36 adds an owned pre-cluster local inspection of
each member's copied store on a disposable isolated server with closed
routes. The fixture compares local stream counts, bytes, sequence and durable
configuration to the pre-stop observation, then checks the restored cluster
and refuses catch-up logs. Source-side empty/missing-store and same-length
payload negatives run through the candidate verifier. The four-test owned
cluster suite passed; complete Mac suite and exact new CI/review are pending.
This validates the one-message fixture mechanism, not every production
message or a protected production cold master.

2026-10-01 07:32 EDT — D37 closes an owned-fixture Raft-folder false
acceptance found by Claude at `f6021e3`. Each copied member's offline Raft
group names now match its last pre-stop record; its isolated durable cursor
comes from an actually acknowledged message. Missing Raft and consumer
folders injected into stopped source stores refuse after passing the copy
verifier. The four-test cluster suite passes in 141.6 s. Full Mac suite and
new exact CI/review remain pending; no production cold master was accepted.

2026-10-01 07:54 EDT — D38 adds an offline Raft-content sentinel before an
owned candidate member can meet its peers. Empty group contents, removed
log/snapshot files, and a missing saved term now refuse at the damaged
member after source-side copying and manifest verification. All eight focused
source-damage modes pass, and the complete Mac recovery suite passes 208
tests with three expected skips at stable source. Exact-head CI and Claude
re-review remain pending. This is one-message fixture proof; no protected
production cold copy, all-message baseline or live resumption is accepted.

2026-10-01 08:07 EDT — Exact `c9569ea` CI is green 3/3. Claude's deeper
same-length Raft-content probes still passed that head; D39 adds an owned
stopped-state digest baseline before four junk-byte mutations and copying;
structural and local-state negatives remain before the baseline so those
checks are exercised independently. The healthy restore and earlier
eleven-mode negative suite pass locally; a twelfth changed-vote control
refuses at member 1. The refined twelve-mode suite, exact CI and re-review
are pending. The same-uid stopped baseline is not a protected production
publication, nor does it detect content already corrupt before the stop.

At 08:22 EDT, the refined twelve-mode negatives and complete stable-source
Mac recovery suite pass (208 tests, three expected skips, owned-server normal
cleanup, no production connections). New exact CI and Claude code-level
review remain pending; the production boundary is unchanged.

2026-10-01 09:16 EDT — `7d40a3f` CI passed Node 20, Node 22 and Mission
Control; Claude's exact-head read and independent damage probes found no
blocker within the owned stopped-Raft-byte claim. D40 corrects a healthy
meta-snapshot log false refusal and adds a latent snapshot negative that
must reach `Snapshot corrupt`. Stable-source focused cluster tests pass 4/4,
and the complete Mac recovery suite passes 208 with three expected skips.
The first full run was invalidated by a missing worktree-external NATS module
path and timed-out restore fixtures; the rerun used the installed Node binary
and the main checkout's NATS module for owned tests. No production job,
service, store, volume or journal was changed. New exact CI/review and all
live protection/restore gates remain open; full-node `seal()` stays disabled.

2026-10-01 09:49 EDT — D41 runs each owned copied member's Raft state on a
disposable store with one fresh empty routing peer before the three-member
restore. The member must expose its recorded groups and persisted indexes at
least as high as the last committed/applied observations, without a leader;
the blank peer has no account groups. A pre-baseline hollow WAL reaches the
new replay check at index zero and refuses, while the healthy fixture passes.
The copied candidate is reverified after scratch replay. This does not
validate peers/votes or unobserved tails and is not a production cold master.
Complete suite, exact CI and adversarial review are pending; 1.2 remains
`[A]` and full-node `seal()` is disabled.

At 10:02 EDT, the D41 complete Mac recovery suite passed 209 tests with three
expected skips and normal owned cleanup; final-source healthy replay and
hollow-WAL control passed 2/2. Exact-head CI and independent review remain
open. No live NATS process or store was changed.

2026-10-01 10:49 EDT — `35f8a8a` passed all three CI jobs. Claude's exact-head
review found no false acceptance in the owned D41 replay; 12/12 latent
snapshot controls and 4/4 hollow-WAL controls passed their real parent
assertions. D42 closes the fixture's lagging post-stepdown reference by
waiting for all three members' `$G` committed/applied indexes to converge
before the stopped-state copy. Replay checks its damage log even after an
index timeout. The revised owned cluster module passes 5/5 in 261.318 s,
with normal scratch cleanup, followed by five more healthy replays. Exact
D42 CI/review remain pending. The
dedicated protected NATS writer, live baseline and three production cold
masters remain unimplemented; 1.2 stays `[A]` and full-node `seal()` refuses.
