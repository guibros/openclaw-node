# Node state recovery — decisions

## D1 — Independent preservation (2026-09-28 07:36 EDT)
The operator authorized complete review/repairs with Claude as adversarial collaborator. Viewer 1.6 remains open for production browser acceptance. This supporting silo permits independent preservation while keeping that unfinished outcome explicit. It feeds node-readiness 1.3; no automatic chain is enabled.

## D2 — SQLite snapshots and isolated restoration (2026-09-28 07:36 EDT)
Pin read-only source transactions and use SQLite's backup API, never a raw live DB/WAL copy. Load installed sqlite-vec directly, avoiding application initialization that can migrate/rotate/vacuum state. Compare integrity, schema, user_version, counts and typed content hashes. Keep transcript contents private; publish sanitized acceptance. Private permissions apply before creation.

## D3 — Both bus histories (2026-09-28 07:36 EDT)
Standalone and cluster names overlap but histories differ. Online snapshots miss offline R=1 collaboration/plan data on member 1. Preserve all four physical stores while servers are stopped, then verify on independently routed loopback instances. No union, requeue, deletion or topology change during preservation.

## D4 — Individual snapshots do not prove coordinated recovery (2026-09-28)
Claude identified the coupling between SQLite cursors and JetStream durable acknowledgements. Step 1.1 proves recoverability per store; 1.2 proves the bus histories. New step 1.3 takes their final coordinated set under verified writer quiescence before parent topology repair. Each individual snapshot records its own time window; no globally consistent point is inferred from sequential live copies. Native virtual-table checks run only on declared isolated restores. Source connections load no extension. Self-vector queries accept distance-zero duplicates, since tied results need not choose the probe's identity first.

## D5 — Complete application recovery includes file sources (2026-09-28 08:45 EDT)
Claude accepted child 1.1's SQLite outcome. It does not cover raw session JSONL,
gateway memory-source files, the vault, tokens/configs, notification ledger,
foreman timelines or browser profiles. Step 1.3 must label every store as primary
or derived and include or explicitly exclude these source families in the common
quiet window. Browser vendor state remains excluded from 1.1 only; its coordinated
recovery policy is not silently inherited. ENOENT caused by atomic file churn
currently refuses scans safely; handle it without weakening missing/unknown-store
refusal before the coordinated run. On-disk copies are logical rollback points,
not proof against machine or disk loss.

## D6 — Preserve split bus histories before repair (2026-09-28 08:58 EDT)
Claude Message 70 challenged the sequence. Step 1.2's Needs now requires intact
offline directories, not its own future preservation output. Installed live
units all run the same NATS 2.12.6 binary; the observed member-1 failure is the
monitor bind on 8222, before JetStream recovery. Reconfirm immediately before
operations. After owned fixtures pass, boot out this failing unit and copy its
unopened store first. Persist the non-serving member
hold with `launchctl disable gui/$UID/ai.openclaw.nats-1` and verify it using
`print-disabled`; bootout alone would reload at login and race with standalone.
Keep it disabled until topology 1.4, instead of restarting its failure loop. This reversible
service hold is within the operator's authorized repairs; no stream is deleted
or merged. For the remaining cold copies, drain all clients/timers, stop members
2/3 before standalone, and resume standalone first. Clone routes use fresh
loopback ports, explicit route credentials and no_advertise. Masters are never
server-opened. Replica/TTL overrides affect only isolated recovery, are recorded,
and never become production configuration. File-source coordinated recovery
remains child 1.3; per-stream snapshots are not a common recovery point.

D6 review correction (2026-09-28 09:32 EDT): Claude Message 74 independently
confirmed that deleting an offline stream assignment through survivors causes
its owner to erase the R1 working history on rejoin. Never delete the offline
COLLAB/PLANS assignments. The hold is reversible with enable only after topology
1.4 has independently verified preservation and uncontested listeners.

## D7 — Admission-fenced, reboot-resumable preservation (2026-09-28 21:33 EDT)
Claude demonstrated that sampled zero clients misses millisecond writers and
failed logins. Replace the old managed-window script; do not weaken it into
acceptance. Bind each server by ID/start/config digest and physical listeners.
After named observer closure use HTTP only, cumulative admissions, open/closed
CIDs, JetStream API counters, stream policy/state and durable positions through
every stop. Producer-first stops and actual owner/descendant/queue evidence are
required. A private fsynced journal records intent before each mutation and
retains incomplete copies without an acceptance manifest. Preserve persistent
service holds across a reboot and restore their original loaded/running/disabled
state only after truthful readiness checks; member 1 remains held under D6.
A reboot invalidates the quiet window, not permission to restore the prior node.
Crash recovery and independent older stream snapshots are not a common point.
Worker reboot policy and the unready deploy listener feed parent readiness 1.5
and 2.2; they are not silently repaired or called ready in this preservation step.

## D8 — Reboot restoration and deploy-listener ordering (2026-09-28 22:16 EDT)
Claude's35e56ff review refines D7: normal serving/client units use temporary
bootout-only holds. Member1 remains the sole persistent disable. A reboot can
then restore ordinary jobs; it invalidates the copy window and any partial
master, which must never receive acceptance. Durable recovery first observes
each affected unit and records already-restored owners without restarting them.
Only a known mismatched state permits an idempotent restoration; unverified
readiness refuses. The final check requires physical4222/8222 ownership and
the member1 disabled/unloaded hold. The deploy listener resumes last after
current deploy-marker/HEAD checks, because it can restart other owners. Timers
loaded with RunAtLoad must finish their initial run successfully before the
ready callback compares their originally idle state. These remain operational
gates, not proof supplied by a journal or generic callback alone.

## D9 — Full-baseline restoration after any interruption (2026-09-28 22:43 EDT)
Claude reproduced six journal faults on6659ef1. Recovery now observes every
baseline unit, including a RunAtLoad=false worker with no stop intent. Any
reopen is restore-only; a truncated forensic tail never authorizes continuing
its window. One fixed node lock and an unresolved-state fence cover different
journal roots. Baselines are read back and copied beside that lock. Classes
separate daemons, idle timers, preserved known-broken loops and held member1.
Immutable service identities must match before and after restoration; physical
running-process binding still belongs to the managed driver. The final hold/
listener check always runs, including after unit failures. Disk write failure
allows verified baseline restoration with explicit undurable diagnostics and
no success/acceptance claim. Missing/corrupt primary history may use the valid
secondary baseline in that degraded mode; if neither copy is valid, no static
unit-default inference is authorized. Sealing pins one uninterrupted window's
final hash and prohibits later writing. Darwin boot-session UUID replaces
localized boottime text. Fullfsync is requested for journal records/directories,
with host/hypervisor power-loss survival explicitly unproved. The old duplicate
restore_prior path is removed. Managed owner controls and cold-copy completion
remain step1.2 work; this checkpoint does not close it.

## D10 — Recoverable receipts and complete explicit inventory (2026-09-28 23:22 EDT)
Claude's second-round b38933a review reproduced missing/corrupt secondary,
sealing-gap, partial-inventory, busy-timer and serialization faults. Move the
node fence and all journal roots under one persistent parent. Enforce the full
named inventory with explicit absent units and held member1; static descriptors
come from plist/file contents independently of loaded state. Rebuild a lost
secondary from an intact primary after readback, while retaining corrupt bytes;
ambiguous unfinished roots or both invalid baselines refuse. Disk/serialization
faults allow degraded verified restoration without durable success. Busy loaded
timers never call restore. A terminal append/receipt gap reconciles its hashes
without writing the sealed chain; explicit resolve retires interrupted windows
without accepting copies. New roots require a terminal predecessor; hash-linked predecessor records identify the unique lineage tip when the receipt is lost after finalization. These
mechanisms remain separate from the managed driver and its physical owner,
writer-inventory, timer deadline and cold-copy proof. CI36514681814's main-merge
worker fixture got503 at its first task-list RPC: daemon readiness-before-flush
is a separate lifecycle outcome, not a preservation-test failure or permission
to ignore the red suite.

## D11 — Prepare the complete baseline before directory creation (2026-09-28 23:49 EDT)
Claude's third round accepted bbbc883's eight fixes and lineage, then reproduced
crashes during creation that stranded an unindexed root. Write/read-check the
initializing receipt with the complete baseline before mkdir. Reopen that exact
root for restoration only, completing its baseline if possible or restoring in
degraded mode if setup cannot write. No unindexed-directory heuristic or automatic
retirement is introduced. Ignore only owned regular Finder metadata in the
journal parent; other unexpected entries refuse clearly. Static identity now
hashes existing argv files automatically, resolves cwd targets, and defines
dependencies as resolved entry files with explicitly declared package metadata.
The sealed-receipt messages name the recovery action. Fifty-three owned tests
pass both from source and private deployed tools-v30; unchanged admission/election
tests inherit only identical hashes. Exact new CI and independent review are
still required. This remains a restoration primitive, with the driver and actual
healthy cold-copy acceptance open.

## D12 — Finder metadata during initializing recovery (2026-09-29 00:58 EDT)
Claude Message30 accepted ab7097c's creation/crash-boundary fixes but reproduced
owned regular Finder metadata stranding an initializing root. Apply the same
owned-regular-file rule inside that root as in the parent; preserve its bytes.
Links, directories, foreign owners and other entries still refuse and fence
new windows. This changes no terminal or restore-only semantics. The new
regression rejects ab7097c; all55 tests pass from private tools-v31. The unchanged
15 admission/1 account-election tests are inherited by identical file hashes,
not called fresh runs. ab7097c CI36518928261 is green; this checkpoint integrates
main55131b8, including the installed/verified PR149 readiness prerequisite,
before fresh integration CI. The future driver must explicitly include
nats-auth.conf and Mission Control's actual npm-start build entry in identity;
its tools/dependencies stay pinned throughout an unresolved window. General
managed orchestration and three healthy cold masters remain open at1.2-pre.

## D13 — Bind managed stop to kernel owner evidence (2026-09-29 01:11 EDT)
Use one launchd adapter for the future Journal driver: bind actual kernel argv,
executable, cwd and generation; register owner/known-descendant exit status
notifications before durable stop intent; unload through launchd; then require
normal exit, absence of descendants/listeners, normal former CID closure and
the declared completion marker. Timer callbacks recheck idle state/log sizes
at unload and refuse a race. Six real owned macOS controls and eleven read-only
production bindings pass from tools-v33. The old private sampled-window driver
is retired with original forensic bytes preserved. This adapter supplies stop
evidence; it does not supply a complete production orchestrator, later-child
inventory, immutable/static identities or restoration readiness. Keep1.2 active.

## D14 — Require the complete owned placement cohort (2026-09-29 01:21 EDT)
The old fixture's CI placement error exposed a leader-only readiness gap.
Require all three named server identities, a common leader, two current
followers and reciprocal confined routes before any stream placement. A
missing member refuses by a bounded deadline; no placement retry is added.
Followers omit replica detail, so only the leader supplies those fields.
Private tools-v36 passes the complete owned recovery fixture after two retained
refused drafts with normal cleanup. Exact prior request phase was not captured;
this is a tightened fixture gate, not a confirmed production cause or repair.
Keep1.2 active until the detached orchestration and healthy cold-copy proof.

## D15 — Refuse incomplete managed-stop evidence (2026-09-29 01:44 EDT)
Claude Messages40/42 separate current adapter scope from a production driver.
Read the loaded exit timeout and retain bootout return/stderr plus every kernel
exit, including a forced kill. Watch the union of descendants and process-group
members. Explicit per-PID role contracts do not allow SIGKILL; children must
be observed dead while the owner is still live. Delivery order itself proves
no chronology, so coalesced observations may conservatively refuse. A captured
normal child exit before the stop is allowed. Watch fork/exec without ONESHOT;
any such event refuses because Darwin supplies no forked PID and NOTE_TRACK
is unsupported. Rebind code entry/plist/executable bytes, ctime/start boundary,
text inode and hash-only declared environment before signalling. Bootstrap
checks both gui and user domains, while its actual user-domain negative remains
unproved because this Mac rejected the isolated job. Idle timer/log checks alone
refuse full verification; an independent complete spawn witness is required.
Actual runtime NATS configs use inline authorization and no includes; pin those
full configs. Follow any actual include in future configurations rather than
requiring a nonexistent nats-auth.conf from a template assumption. Private
tools-v40 passes13 actual Mac controls/1 skip, v39 passes recovery plus the
actual two-of-three and four individual-predicate negatives. Refused v37/v38
drafts are retained. Complete orchestration, identities, timer witness and
healthy cold masters remain1.2 work; new exact CI/review is still required.

## D16 — Loaded provenance and prepared stop intent (2026-09-29 02:09 EDT)
Claude Message44 accepts8286c96, then distinguishes remaining driver needs.
Bind the actual loaded plist path and stdout/stderr paths from launchd,
rather than inferring them from equal arguments or caller-selected logs.
Register process/file watches and finish expensive byte/provenance re-binding
before Journal intent. The driver calls ready_for_intent again outside mutate;
the apply callback retains short state/process/lifecycle checks. Vnode mutation
refuses; pure ATTRIB with identical opened/current device/inode/ctime alone
is ignored, including read-atime notifications. No delivery chronology or
automatic forked-child adoption is claimed. Actual completed-tick/child-free
gaps for periodic-fork producers, production-sized NATS/memory stop margins
and Discord crash-loop unload proof remain separate driver prerequisites.
An explicit timeout change must precede the first baseline and be verified
as its own lifecycle prerequisite; this checkpoint changes no production unit.
Private tools-v44 passes17 controls/1 skip, v42 passes full recovery and all
eight single-predicate negatives. The source is deployed only to owned/read-only
consumers; complete production orchestration and healthy cold masters remain
open. The earlier20-unit preparation misparsed enabled/disabled as booleans;
its rejected bytes/correction are retained privately and neither is an approved
preservation baseline. Member1 is still disabled/unloaded. Exact new CI/review
remains required.

## D17 — Retain raw stop failures before classification (2026-09-29 02:33 EDT)
Claude Message46 accepts9deef65 and its provenance/readiness delta, then
identifies missing raw kernel events and the lost pre-watch startup negative.
Record each raw filter/ident/flags/fflags/data before any classification;
EV_ERROR refuses immediately with errno, and context/constructor errors retain
private stop_evidence. Restore the identical-rewrite-after-start negative and
provide one helper for ready-before-journal-intent ordering. Inode watches
cannot pin parent-directory/symlink mappings; restoration must recheck static
paths and dependencies. No dependency build/install during an unresolved window.
Twenty real Mac controls pass/one explicit domain skip; v45's missing-import
draft is retained as refused. Four owned NATS stops with eleven archive restores
measure34–45ms; one idle installed-source memory stop with253,943,808 copied
database bytes measures65ms. These are historical-size idle samples, not worst-
case bounds or active-worker drain proof. Production five-second timeouts are
unchanged. Actual serving NATS configs omit log_file. Discord is configured
disabled with no token, yet its unconditional KeepAlive restarts the missing-
token path; no credential or enabled integration is invented. Timer witness,
that stop prerequisite, detached orchestration and healthy cold masters remain
open. See KERNEL_EVENT_EVIDENCE.json; step1.2 stays active.
