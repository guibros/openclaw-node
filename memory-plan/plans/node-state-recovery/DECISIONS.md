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

## D18 — Make post-intent kernel failures durable (2026-09-29 02:50 EDT)
Claude Message48 finds no blocker on19243eb; both exact CI runs are green3/3.
Its remaining forensic correction is material: in-memory exception evidence
alone does not survive controller loss. Journal.mutate now accepts an optional
sanitized failure-evidence callback, and StopWatch.mutate supplies its complete
raw-event/lifecycle/exit/bootout snapshot before the durable failed append.
Explicit KQ_FILTER_PROC classification prevents any other filter with a bound
PID from being mistaken for a process event. A real EVFILT_USER control uses
that PID, refuses, and reopens its persisted failure detail. Twenty-one actual
Mac controls pass/one domain skip;56 journal controls pass. Two refused fixture
layouts are retained. Pre-intent preparation failures still require a separate
private durable refusal record in the future driver. No production operations
or step close follow; exact new CI and independent review remain required.

## D19 — Require round-trip-stable journal keys (2026-09-29 03:09:24 EDT)
Claude Message54 accepts2c0b7b6's explicit filter and durable callback, then
reproduces integer-PID key sorting that poisons journal hashes after JSON
reload. Numeric and lexicographic order differ for9998/10001; same-width
20001/20002 is the control. This affects successful evidence too. Export
StopWatch exits/process_contracts with string PID keys, and reject every
non-string dictionary key recursively before encoding/hashing any record.
Do not silently normalize ambiguous keys or retrofit old forensic records.
Owned old-source verified/failed mixed-width records reproduce degraded
baseline-only reopen; the control reopens three records. New records on both
paths verify every hash, restore and resolve.58 journal controls and21 actual
Mac controls/1 domain skip pass. No production journal exists, so no production
repair or source-state migration occurred. Full driver/kernel-trace resource
bounds, timer foreground holds and healthy cold masters remain open at1.2.

## D20 — Land the reviewed tools before execution-hold integration (2026-09-29 07:12:37 EDT)

Integrate current main51a817f into the existing5fabf6e recovery branch and land
PR144 as a bounded code-foundation checkpoint after exact CI and independent
review. The Journal, stop adapter and admission tools stay byte-identical;
the diff against main stays confined to this plan plus its recovery CI step.
No production importer, driver, service/timer wiring or healthy cold-copy
claim accompanies the merge. The private copied Journal is the deployed
consumer at this checkpoint; bus3.5 is the next source consumer.

Claude98 checks inertness, disjoint integration and the explicit remaining
outcome; its exact-head re-review is still required. Retain all prior forensic
records as scoped tool-development history. Recovery1.2 stays[A]/v1.2-pre;
the complete production driver/baseline, three healthy cold masters, isolated
restores and restoration evidence remain open. Bus3.5 imports the single
journal from main without copying it or reaching into an absolute worktree.
Bus3.6 then integrates actual timers. This breaks the source dependency cycle
without declaring the unfinished preservation outcome done.

## D21 — Preserve the idle on-demand worker as its own baseline class (2026-10-01 00:01 EDT)

The live mesh-agent is loaded, idle and enabled after the VM restart. The
existing `daemon` class required it running, while `known-broken` ignored its
running bit. Neither represents that state truthfully. Admit `on-demand` only
for mesh-agent with loaded=true, running=false and disabled=false; its exact
running bit remains part of `matches()` during restoration. Reserve
`known-broken` for the explicitly disabled Discord integration, so it cannot
be used to waive the worker's running-state check. This is a baseline-schema
correction, not a production recovery adapter or an accepted cold-copy window.
The full 20-unit read-only structural capture now validates, but its 54 direct
file pins are not a complete dependency or loaded-process provenance proof.
Claude's independent challenge found that recovery otherwise sent an observed
running worker to `restore()`. The Journal now refuses that case before any
restoration intent; the operator must resolve a live worker. An intact receipt
with an unsupported baseline is refused without being renamed as corrupt.
The original immutable 3.11 controller carried the old parser. All three
invocable old bundles were retired at 2026-10-01 00:21 EDT; the compatible
protected `timer-hold-controller-20261001-4` now verifies in place (see
step12_jetstream/RUNTIME_EVIDENCE.md). Keep that replacement pinned before the
first full-node journal. An absent `timer-transition-active` and
present `timer-entry-installed` only make a rerun harmless while the receipt
still names the resolved timer journal. Once a full-node receipt reads
`restored`, the old `--commission` path can reopen its installed timer window,
rename the new receipt as corrupt and block the next window until the current
journal is reopened with the new parser and its receipt repaired. Do not invoke
old `--commission` or `--recover` once a full-node journal owns the receipt.
Production capture must verify the worker's normal idle exit/provenance and refuse a running
worker, rather than selecting a class from a transient observation. Forward
quiescence must unload this latent writer with spawn-race evidence; restoration
may bootstrap its saved idle job but must never kickstart it.

## D22 — Include live gateway/viewer and fence all launchd entry points (2026-10-01 01:28 EDT)

The viewer can detach an agentic plan tick that can drive `launchctl` and NATS;
the gateway owns a live task SQLite store and can start tool-capable turns.
Neither is excludable because it had no NATS socket at one instant. Extend the
full-node Journal cohort from 20 to 23: stop viewer then gateway before other
clients, restore gateway after its dependencies and viewer last, and represent
the installed federation tick as unloaded with its current persistent disabled
flag. The durable `full-node` scope requires these exact classes and the saved
five-timer hold. A loaded or re-enabled federation tick refuses restore-only
recovery; the controller does not silently boot it out or enable it.

Before a full-node journal, enumerate installed and loaded jobs in the GUI,
user and system launchd domains, including `ai.openclaw.*`, `com.openclaw.*`
and programs resolving into the repository or OpenClaw roots. Record disabled
plist artifacts separately. Unknown entry points refuse; disconnected sockets
do not authorize exclusion. Check detached tick/companion processes and the
launchd inventory repeatedly through the copy window. The viewer's old process
group cannot account for a tick already reparented to launchd.

The current widened read-only scan refuses: 23 approved user LaunchAgents plus
root-managed `com.openclaw.agent` and `com.openclaw.tailscale-up` are installed
and loaded. The former is enabled, KeepAlive, points to a missing legacy
`agent.js`, and is repeatedly exiting 1. Missing code prevents execution now
but not future reappearance after a deploy. The latter is an idle one-shot
network helper, not yet accepted as a pinned exclusion. Neither was changed.
The 11 `.plist.disabled` artifacts are inventoried by hash, not treated as
loaded jobs. No live preservation window may start until the legacy system
agent is durably retired or included with a verified stop/restoration contract,
and the network helper has an explicit exclusion and final-state check.

This supersedes D21's statement that timer controller bundle `-4` is compatible
with a future full-node receipt. It still serves the current timer-only receipt
and safely refuses the new 23-unit `full-node` scope without renaming it. Once
a full-node journal exists, timer restoration belongs to that journal's hold
path; `-4 --commission` and `-4 --recover` cannot service it. The gateway's
startup hook and ephemeral token, companion bridge, detached ticks, complete
dependency pins, healthy cold masters and truthful restoration remain driver
prerequisites. This decision changes source schema only, not live services or
the open 1.2[A] outcome.

## D23 — Bind entrypoint evidence to the full-node journal (2026-10-01 01:55 EDT)

Claude's PR #169 review reproduced two omissions in the draft: a new 23-unit
journal could be created with no scope, and a neutral-label job loaded from a
plist outside the scanned directories could evade the label-only check. New
journals now require an explicit timer or full-node scope. Unscoped journals
can only be reopened for historical restoration; fixture tests simulate their
old creation separately. Full-node creation runs the source-owned GUI/user/system
launchd and plist preflight under the node lock before publishing a baseline,
and the baseline durably saves installed plist paths/hashes, loaded labels by
domain, protected roots and disabled-artifact hashes. The journal rechecks the
installed/artifact pins before each forward mutation. Each verified stop
persists the loaded-label map; subsequent forward work requires exactly that
map, except for the unit being stopped or unloaded. A recovery-time inventory failure is
recorded as an uncertified error while independently verified prior units are
still restored. Final restoration and resolution require the original
loaded-label map again. Full-node sealing is refused until a continuous
launchd/process watch can prove that a stopped writer never restarted between
point-in-time scans; the hold completion receipt likewise reports
`history_certified:false`. Unknown entrypoints refuse before a new window.

Loaded services are inspected by `launchctl print` even when their labels are
neutral or Apple-prefixed and their plists live outside the standard
directories. Installed plist relevance includes `Program`,
`ProgramArguments`, working directory, resolved symlinks, shell HOME and
environment indirection, unclassified interpreters and multiply linked
executables. The pinned roots include the repository, live OpenClaw home,
legacy `~/openclaw`, global OpenClaw npm package locations, companion bridge
and Codex worktrees. Relative arguments resolve against the declared working
directory; versioned interpreters and common process wrappers are classified.
System-library jobs and dynamically registered app-bundle executables are
excluded from the hard-link heuristic unless another path or label binds them
to OpenClaw. This is a conservative inventory test, not proof that arbitrary
shell code cannot synthesize another path.

The deploy listener must stop before the viewer and gateway and resume last.
Its stop watch refuses if the listener already has a child process, before
any signal is sent; a newly forked child also invalidates the process watch.
Its missed-deploy catch-up can rewrite code and reinstall gateway state, so the
driver must separately prove no pending deploy before resuming it. The source
order does not itself prove that condition. The current live scan still refuses
the same two root-managed system jobs; no production preservation window has
started.

If a plist or loaded job drifts during recovery, the journal does not certify
or resolve. It restores each independently verified prior unit where safe and
retains the exact unresolved chain and pins. The operator must restore the
original pinned identity from a trusted copy, or investigate the changed job
and its effects, then rerun restore-only recovery. The journal stores hashes,
not plist contents, and cannot reconstruct a changed plist by itself.

## D24 — Treat protected NATS writer transfer as a separate one-way migration (2026-10-01 12:29 EDT)

The existing same-UID preservation Journal restores its prior GUI jobs after
interruption. It cannot own a transfer to root-pinned system jobs and a separate
service UID: after the first protected server start, the old store is stale even
if no client has connected. A separate root-held migration journal must record
the old-job retirement, copied store/config/auth identities and the first
protected bootstrap before it authorizes any further action. Recovery before
that bootstrap may restore the untouched old bus; recovery afterward may only
finish the protected migration or require an explicit reverse migration.

A root-owned handoff marker under `/private/var/db/openclaw-nats/`, outside
operator-writable ancestors and the operator's HOME, must be published
before retiring any old job and retained after commit. `/Library/Application
Support` is excluded because its live parent is group-writable by `admin` on
this Mac. The root journal creates the directory as `root:wheel` mode `0755`
and publishes a root-owned marker there so non-root guards can observe it but
cannot remove it. If recovery fails before the first protected bootstrap, only
that root journal may remove the marker, as its final step after the untouched
legacy bus has been verified restored. After bootstrap the marker remains;
ordinary rollback must never restart the stale legacy stores. Ordinary
installation, user-owned auth rendering and
`openclaw-trust-peer --sync-nats` refuse while it
exists; the trust command checks before changing the registry. The source
guard is an accidental-resurrection barrier, not authority for the root
migration and not a substitute for disabling and quarantining every old GUI
job. The root path, service UID, ownership-enforcing volume, mount identity,
protected binary/config/auth, exact old/new config equivalence, service-UID
isolated replays, system-domain monitoring, targeted auth reload and revocation
proof remain required before cutover. No source change in this decision starts
or stops the live bus or closes 1.2.
The marker content and active-cohort contract are pinned in D27.

## D25 — Fence the stack entry and isolate auth fixtures (2026-10-01 12:41 EDT)

`openclaw-stack up` discovers installed `ai.openclaw.*.plist` files and can
bootstrap a leftover NATS GUI job independently of `install.sh`. It must refuse
before any start when an enabled legacy NATS plist and the protected handoff
marker are both present. Disabled plists are discovered for status but skipped
by `up` and must not block other services. The source guard covers that path
and owned child controls check refusal and the disabled-only case. This does not replace the
migration's durable disable and hash-pinned quarantine of those plists.

The auth tests run CLIs against a private HOME. A host handoff marker should
not turn those isolated fixture tests red after migration. Their child-only
preload makes that one marker appear absent in the fixture; a separate test
simulates its presence and proves that live command paths refuse before the
registry or auth file changes. Production code retains the fixed marker check.
`mesh-deploy --include-services` currently reaches a `preInstall` callback
that always returns false, so its service component does not presently write
plists; it remains a deployment contract to revisit before protected cutover.
Neither this source correction nor its tests operate the live bus.

## D26 — Recheck legacy writes at their immediate boundary (2026-10-01 12:43 EDT)

An installer launched before marker publication can reach NATS token, config or
LaunchAgent writes after the initial preflight. Recheck at entry to the
configuration stage, before NATS config generation, and before each NATS
LaunchAgent render/start. An unreadable marker
location is reported as handoff-verification failure, with legacy writer changes
refused. These checks narrow the race but do not serialize a concurrent root
migration; the root journal must exclude in-flight installers before publishing
the marker and retiring old jobs.

## D27 — Observe protected NATS in the system domain (2026-10-01 12:55 EDT)

The protected active jobs on this Mac are `ai.openclaw.nats`,
`ai.openclaw.nats-2` and `ai.openclaw.nats-3` in `system`, after their GUI
predecessors have been retired. The separate historical `ai.openclaw.nats-1`
job remains held. Other nodes may use the documented `nats-1..3` cohort or
the single `nats` job. In the legacy state, an optional 0600
`config/nats-writer-cohort.json` under the OpenClaw home declares
`{"schema":1,"activeLabels":[...]}`. Fresh installs initialize the single
`nats` cohort before rendering NATS config; existing installs without the file
remain UNKNOWN until explicitly declared. A missing declaration never lowers
the required set during a partial bootout. On this Mac the explicit file names
the observed active cohort.
The fixed root handoff marker selects the system domain and pins the same
`activeLabels` alongside `schema:1` and
`kind:"openclaw-nats-writer-handoff"`. It is a root-owned, readable,
non-group-writable regular JSON file. Only the single-node and two known
three-member layouts are accepted; malformed state is UNKNOWN before any
launchd observation. Other core jobs remain in `gui/<uid>`. A protected NATS
PID in `system` is insufficient while any known NATS label is still loaded
in `gui/<uid>` or `user/<uid>`:
that is a duplicate writer risk and reports BROKEN. Without the marker, a
loaded `system` or `user/<uid>` NATS job also reports BROKEN. An unreadable or
malformed marker reports UNKNOWN rather than assuming the legacy domain.
The WORKING verdict proves only required-label PID liveness and absence of
loaded known-label duplicates in the inspected domains; it does not validate the future
system jobs' binary, UID, config, store identity or an installed-but-unloaded
legacy plist, unlisted launchd label or unmanaged `nats-server` process.
Migration acceptance must pin those identities and inspect
persistently enabled jobs before publishing the marker. This is read-only
monitoring, not migration authority or proof of JetStream health; quorum and
replay checks remain separate. No live service is changed by this decision.

## D28 — Bind protected handoff to the observed split source topology (2026-10-01 13:18 EDT)

The live 4222 server has no NATS routes and no JetStream meta-cluster; the
4223/4224 servers route to each other and report `openclaw-cluster`. The
read-only loopback audit classifies this as `standalone-plus-two`, not a
three-member cluster. The three live PIDs and reachable client ports
must not be interpreted as one replicated history. Each distinct store and
its stream/consumer state remains a separate preservation source. A protected
writer handoff must pin the old topology and verify the new jobs reproduce the
same separation before any topology repair or history union is attempted.

`bin/nats-topology-audit.mjs` observes the three fixed local monitor ports,
checks that `/routez` and `/jsz` name the same server at each port, collapses
duplicate route connections by server ID and reports only the resulting
topology. Its `--expect` control exits nonzero on drift; this Mac's observed
split passes and a three-member expectation fails. It does not inspect
credentials, config/store identity, message contents or cold-copy integrity.
`SITE_TOPOLOGY_EVIDENCE.json` contains counts and port relationships without
server IDs or secret-bearing payloads. The root migration journal, protected
service identity, cold masters and resumption still gate step 1.2.

## D29 — Audit protected site prerequisites without authorizing cutover (2026-10-01 13:20 EDT)

The protected writer requires a distinct `_openclaw_nats` UID, an
ownership-enforcing APFS volume, and a root:wheel `0755` directory under the
root-controlled `/private/var/db` parent. Before a new handoff, the marker
must be absent; if already published, only the root migration journal may
decide recovery. `bin/nats-protected-site-audit.mjs` checks these facts
read-only and returns `readyForStaging`, not `readyForCutover`. It neither
creates the account nor directory, and it does not read or publish secrets.

The live site passes APFS ownership and protected-parent checks, but the
service account and protected directory are absent. The audit exits 1 with
those two exact blockers. Root-owned binary/config/auth staging, immutable
identity pins, store transfer, legacy job retirement, first protected
bootstrap, reverse-path constraints and three healthy cold masters are still
open. No privileged mutation occurred.

## D30 — Verify the protected ancestor chain and device (2026-10-01 13:33 EDT)

D29's parent check now covers `/private`, `/private/var`, and
`/private/var/db`: each must be a root:wheel directory without group or world
write permission, and all three must be on the same device. The protected
root must be on that device too, so a mounted handoff directory cannot pass
the site preflight. This remains a read-only staging check, not cutover
authorization. The live chain passes; the dedicated account and protected
root remain absent.

## D31 — Tighten protected-site identity and expose held Raft membership (2026-10-01 13:47 EDT)

Claude's read-only review of PR #175 at `6035e76` found that a positive
non-operator UID could still be a normal, privileged account. The staging
audit now requires `_openclaw_nats` to be a local system-range UID, with a
matching dedicated primary group, no staff/wheel/admin group membership, a
non-login shell and empty home. A root invocation must identify the original
operator via `SUDO_UID` or `--operator-uid`; UID 0 cannot stand in for that
operator. The audit refuses ACL entries on the protected directory or any
ancestor. It derives its marker path from the legacy-writer guard's constant.
These facts qualify only a staging site; the root journal still has to pin
the exact account, binary, configuration, credential and store identities.

The topology audit now binds `/varz` to `/routez` and `/jsz` by server ID and
checks each monitor against its expected client port. Its classification is
the currently routed graph, not the full JetStream Raft membership. The live
8223/8224 peers each report meta-cluster size three; the leader reports one
replica offline. This is consistent with the separately held member-1 store,
whose identity and history still require their own pins and cold-copy proof.
The two routed peers' stream counts differ. Four distinct store directories
remain preservation sources; no same-named stream may be merged on the basis
of routing alone. Refreshed evidence saves only counts and port relationships.

## D32 — Attribute the offline replica to a peer, not a fixed leader (2026-10-01 13:55 EDT)

D31's phrase "the leader reports one replica offline" overstates the saved
evidence. The leader can change between loopback reads, and the saved report
retains the offline replica count by monitor port without a leader binding.
The supported claim is that one of the two routed cluster peers reported one
offline replica while both reported a meta-cluster size of three. The held
member-1 store remains a separate source by its own prior identity evidence;
the loopback snapshot does not certify that identity or a stable leader.

## D33 — Parse ACL entries and directory membership from macOS command output (2026-10-01 14:03 EDT)

The protected-site audit must inspect the numbered ACL entries printed by
`ls -lde`, not just the mode suffix: an extended attribute makes macOS show
`@` even when ACL entries also exist. A `+` suffix without the expected entry
listing is unobservable and refuses. `dseditgroup checkmember` returns status
67 with a valid `no ... NOT a member` answer on this Mac; the audit accepts
that answer, but refuses other nonzero statuses and malformed output. A local
directory with both an xattr and an ACL confirmed the `@`/numbered-entry case.
This changes read-only staging evidence only; the live account and protected
root remain absent.

## D34 — Make the protected account exclusive before staging (2026-10-01 14:09 EDT)

The D31 account check accepted a second user with the same UID, a second group
with the same GID, an explicit member of `_openclaw_nats`, or a service account
in a supplemental privileged group such as `operator` or `_developer`.
Read-only `dscl -search` results must identify exactly one matching user and
group record, and the dedicated group must have no explicit members or nested
groups. Effective `id -G` groups are limited to the dedicated primary group
and the macOS ambient groups observed for system users on this
host: everyone (12), localaccounts (61), `_lpoperator` (100), and the nested
sharepoint group (701). Any other group refuses staging. The dedicated primary
GID must be in the system range. These are staging qualifications, not proof
that a root migration or any live protected writer exists.

## D35 — Keep routed and healthy three-member claims separate (2026-10-01 14:15 EDT)

Claude's second PR #175 review found that three mutually routed servers could
report metadata cluster size five with no leader and still receive the label
`three-member-cluster`. That label now additionally requires size three at
each monitor, one shared leader matching a present server, and the leader's
two other named replicas both current and not offline. This remains a narrow
metadata gate, not proof that every stream group, client credential or store
is healthy. The live split layout remains `standalone-plus-two`.

Saved topology evidence is now emitted by the CLI's `--public-evidence`
projection. An empty replica list is `null` rather than a false count of zero
offline peers. NATS currently labels the held replica with an unresolved peer
ID instead of a server name; public evidence retains a SHA-256 digest of that
ID, not the raw value. The held store still requires independent identity and
history pinning before migration.

## D36 — Exclude operator access through the protected primary group (2026-10-01 14:25 EDT)

An empty `GroupMembership` attribute does not prove the dedicated GID is
private. macOS can record a member by GUID in `GroupMembers`, and a user's
primary group need not appear as an explicit group member. The protected-site
audit now refuses all three membership attributes (`GroupMembership`,
`GroupMembers`, `NestedGroups`) and compares the service GID against every
effective group of the invoking operator, resolved by UID even under sudo.
It also requires a local-directory `PrimaryGroupID` search to find only the
service account for that GID; checking the operator alone would miss another
user with the service group as its primary group. This is a staging identity
check, not proof that protected credentials or a root migration have been
installed.

## D37 — Preserve leader and process-start evidence in topology snapshots (2026-10-01 14:29 EDT)

The public read-only topology projection retains NATS server names, each
reported metadata leader and each `/varz` start time. These are not secrets;
without them, a saved routed graph cannot distinguish a leader election from
a server restart or re-derive the named-leader part of the classifier. The
fresh snapshot still says `standalone-plus-two`; the opposite expectation
exits 1. All three `/varz` starts remain 2026-10-01 00:29:20 UTC despite
leader changes between snapshots, so that observed shift was an election,
not a process restart. The nearly identical timestamps across three separate
processes are not a precise launch spread on this VM; they establish only no
restart between observations, not survival across a VM state restore. This
does not bind the held store to its Raft peer ID or prove stream-level health.

## D38 — Require a pristine protected root before staging (2026-10-01 14:38 EDT)

The protected-site audit previously checked the root directory's owner, mode,
device and ACL but not its contents. A leftover user-owned store under a root
whose permissions were later corrected could therefore receive
`readyForStaging: true`. The pre-staging audit now reads the directory and
requires it to be empty. The future root migration must separately inventory
and pin all protected assets after staging; this check applies only before
that transaction and is not cutover authorization. The live protected root is
still absent.

## D39 — Root NATS writer migration requires a durable ownership transfer (2026-10-01 15:03 EDT)

Claude's read-only challenge of the proposed protected-writer migration found
four blocking interleavings: an installer already past a marker check can
rewrite and reload a legacy job; the user preservation journal can restore GUI
NATS after root retirement or become permanently unresolved; an enabled
system plist can auto-start after a reboot before first-bootstrap intent; and
bootout-only client holds let clients return at login during post-bootstrap
acceptance. The corrected candidate is in
`audits/step12_jetstream/ROOT_WRITER_MIGRATION_DESIGN.md`. It requires a
durable user-to-root NATS-unit transfer, shared old-writer exclusion plus a
pre-protocol process check, persistent client disable or equivalent physical
hold, no loadable protected plist before durable first-bootstrap intent, and
first boot with only the root acceptance identity. Clustered stores are
single-use copies because startup rewrites `peers.idx`; the standalone store
must never start under cluster config. These are implementation and live
acceptance requirements, not a migration approval. No protected account,
marker, root journal, cold masters or cutover exists yet.

## D40 — Make legacy NATS mutation share a root-owned exclusion lock (2026-10-01 15:17 EDT)

The old-writer source must take a shared `flock` on a root-owned 0644 lock at
`/private/var/db/openclaw-nats-writer.lock` for its entire mutation, including
installer and uninstaller work, auth reload and stack launch. The privileged
transaction will take that same lock exclusively before its process census and handoff marker
publication. The source wrappers validate the lock path and inherited
descriptor, wait for a bounded interval, and refuse a marker observed under
the lock. If the lock is absent they retain the existing marker guard; this
lets the prerequisite source deploy before the privileged transaction creates
the lock. The root migration must still reject old in-flight processes that
started before the lock existed. This is exclusion infrastructure only: the
root-owned lock, ownership transfer, journal and protected writer have not
been staged or exercised live.

## D41 — Root exclusion is an identity-pinned, exclusive lock (2026-10-01 16:02 EDT)

The privileged migration uses the same fixed lock path as D40. Its root-only
entrypoint creates a regular root:wheel 0644 file outside the staging root
only after a durable migration intent. Creation and acquisition are distinct:
acquisition refuses a missing file, so a read-only probe cannot switch the
legacy tools into lock mode. Creation syncs the file and parent directory;
acquisition then takes a bounded exclusive `flock`.
It validates owner, mode, single link, inode, protected ancestors and absence
of granting ACLs before and after acquisition. A current shared holder makes
the root refuse; a replaced lock path after acquisition also refuses. The
file is never deleted or replaced once created: recreating it could leave a
legacy process holding an unlinked old inode. A resumed creation syncs the
existing file and parent before reporting success. The root must retain the
descriptor until the handoff or pre-bootstrap rollback has ended. This is a
source primitive, not a migration driver or proof that deployed legacy copies
honor D40. No live lock file or marker is created by this change.

## D42 — Journal the root lock bootstrap before the live switch (2026-10-01 16:16 EDT)

The root transaction must durably record one lock-create intent under its
protected site before creating the D40 lock file. The intent binds a
transaction UUID, boot identity, user-transfer digest and admission digest.
It also binds the exact protected site, shared lock path and expected owner;
reentry with a different path cannot receipt an unrelated lock.
The lock path cannot lie inside the handoff site, and the source API refuses
the actual D40 production lock until the remaining lifecycle branches are
implemented and reviewed. Both journal begin and private creation refuse
every macOS root caller before writing, so a path alias or direct import
cannot lift this gate or strand the protected site.
Only then may explicit creation run. The pinned root driver must perform a
process census before creation, including unlinked-file holders, then repeat
it and re-observe the same admission under exclusive lock before writing a
lock-created receipt with the inode and change time. Linux can reuse an inode
immediately after deletion, so the durable receipt requires both values. The
in-process descriptor/path identity also checks device; the durable receipt
does not pin a transient device number across reboot. Any metadata change
after the receipt refuses and requires an operator review. A process exit
after a durable intent and before a later record write can reopen that intent
and repeat the admission and census checks; it cannot start a second journal.
A marker already present routes to
the later full recovery path, never this bootstrap.
The source journal stores digests, not the private transfer or cold-master
contents. Claude's exact-head review found that a deleted lock could be
recreated before the receipt, a crash before the first intent or during a
later record write can strand reentry, and reboot has no terminal abandonment
or successor transaction. The production gate must stay until those
lifecycle branches are implemented and tested. The eventual driver must
bind census evidence to transaction, phase and lock identity; copy transfer
evidence to root-owned storage; recompute verified state from fresh physical
observations; and keep volatile fields outside the admission digest. Marker,
retirement, protected bootstrap and live acceptance are also pending.

## D43 — Stage the writer lock from a sibling ledger (2026-10-01 17:30 EDT)

PR #179 supersedes D42's journal location and direct lock-creation step. A
single root-owned ledger lives beside the protected site, keeping the site's
empty-root staging preflight satisfiable. The ledger directory itself carries
the exclusive driver lock; an empty directory and interrupted pending record
are recoverable, while unknown entries or a broken hash chain refuse. Before
the shared lock path can appear, the transaction stages a nonce-bearing lock
under a private name, syncs it, and durably records its inode and nonce. It
then hard-links that same inode at the shared name, syncs, and removes the
staging name. Reentry completes a two-link gap; if both names disappear after
the staged receipt, it refuses rather than creating a different inode. Under
exclusive exclusion, the admission receipt pins inode and change time and
requires census evidence to echo the transaction, boot, phase, inode and
nonce. Claude challenged the exact 0c92cbe head with no blocker; four CI jobs
passed. All macOS-root constructors and publication paths remain gated, so
this is source-only. Reboot abandonment, terminal user-readable outcomes,
successor transactions, physical admission/census, user transfer, marker and
rollback states, and the protected driver are still required before live use.

## D44 — Freeze the user preservation journal during NATS transfer (2026-10-01 18:16 EDT)

The original same-boot full-node owner records a nonce-bearing transfer intent
only after its forward hold remains valid, the three legacy NATS writers have
verified unload receipts and fresh stopped observations, member-1 still matches
the held baseline, the loaded-entrypoint inventory agrees, and the protected
root marker is absent. That record freezes every ordinary user-journal append
and recovery action. A root-return receipt may close the freeze only when its
root-owned public file binds the exact transaction, user journal root, baseline
hash, transfer record hash and durable root ledger head; a marker blocks return.
After closure, the user journal is restore-only. It cannot resume forward
certification and must recover the legacy baseline before resolution.

This first source slice implements only the `returned` outcome. A root `accepted`
outcome requires the new system-service baseline and readiness delta; a
post-marker rollback requires separate root restoration evidence, and a
no-root-intent refusal needs a root-owned `declined` outcome. Until those
branches and the pinned physical root driver are implemented and reviewed,
the root journal's production macOS-root tripwire remains in place. No live
preservation hold or NATS service is changed by this decision.

Claude's exact-head challenge of PR #181 found that a transfer could otherwise
freeze a production journal before any root transaction existed. The user
transfer entrypoint now also refuses on the production macOS marker path until
`declined` and root validation exist. A returned legacy restoration checks the
marker and, when the shared writer lock exists, holds it shared across each
NATS restore and verification. Any transfer record ends same-process
`JournaledHold` forward certification, even after a root return.

## D45 — Root reads the private user transfer under the node lock (2026-10-01 18:46 EDT)

The root must take the operator's nonblocking node lock and journal lock,
retain their descriptors, and read the journal through a pinned directory
descriptor. It verifies owner-private modes and ACLs, the complete hash chain,
the full-node baseline and entrypoint cohort, the current boot, the unresolved
node receipt, the transfer as the exact final record, and the absence of
pending or failed work. The root also proves that the original execution hold
was published and verified before the NATS unload receipts, and that the
transfer-time native observer still reports the same watch session. The user
intent therefore carries both the transfer-time hold evidence and its hash;
the root does not compare volatile observer fields byte-for-byte with the
earlier close receipt. Reentry must read back the same chain while retaining
the node lock. Caller-supplied `verified` fields cannot replace this read.
Root transaction begin must bind to that still-open terminal transfer under
the held node lock. This excludes a concurrent legacy restore in the interval
before a new writer lock exists, as raised in the PR #181 adversarial review.

This is a read-only source validator. Root-owned durable copies of the two
records, its integration into the privileged transaction, production physical
admission, `declined`/marker outcomes, and the cold-master cutover are still
required before the production tripwire can be lifted.

Claude's PR #182 challenge found that the real hold-close verifier writes its
native certificate at the top level of `verified.evidence`; only subsequent
`JournaledHold.mutate` receipts nest `execution_hold`. The validator now reads
that producer shape, and a macOS control builds the transfer with the actual
gate and hold. Root admission accepts owner-owned Finder `.DS_Store` metadata
without treating arbitrary files as journal records, rejects events outside
the uninterrupted forward window, and revalidates the open lock descriptors
against their named inode/ctime identities. The production gate remains
closed until root-owned physical admission and the outcome lifecycle exist.

## D46 — Bind root bootstrap to the still-open user transfer (2026-10-01 19:10 EDT)

The privileged transaction must acquire the owner node and journal locks before
its root ledger intent, derive the user-transfer observation from the locked
validator, and retain those locks until the root transaction is closed. Reentry
reopens both journals and refuses if the saved root descriptor no longer binds
the current terminal user transfer, baseline hash, root path, or boot. Root
lock acquisition rechecks the binding both before and under writer exclusion.
This keeps a second root bootstrap out of the interval in which the legacy
restorer has already closed a prior transfer but the writer lock is absent.

The source wrapper proves this binding with a supplied physical-admission
callback only for isolated tests. It is not the production root driver: the
caller-supplied physical verdict remains untrusted, direct low-level bootstrap
is still available behind the macOS-root tripwire, and the root ledger has not
yet durably copied the user baseline and transfer records. The tripwire stays
closed until those interfaces are replaced by pinned root-owned observations
and the declined/accepted/rollback lifecycle is complete.

## D47 — Copy transfer evidence into the root intent (2026-10-01 19:29 EDT)

The bound root bootstrap writes the exact validated user baseline and terminal
transfer records into its root-owned `lock-create-intent`, in the same durable
append as the descriptor. The root ledger validates each record's content hash
and its linkage to the descriptor; bound reentry requires the copies to equal
the records reread under the owner node and journal locks. No separate copy
write follows intent, so a crash cannot leave an intent that assumes evidence
was pinned when it was not. The low-level journal still permits fixture intents
without these copies, but the bound path rejects them on reentry and the
production macOS-root tripwire remains closed.

This anchors the owner-trusted transfer in root-owned storage. It does not
turn a caller-supplied physical verdict into a trusted observation or supply
the declined/accepted/rollback outcomes and protected NATS cutover. Step 1.2
remains active.

## D48 — Permit prior-boot reentry only for pre-marker return (2026-10-01 19:33 EDT)

A root intent may survive a VM reboot before marker publication. The bound
reentry reader may then load the owner journal from its prior boot under the
node and journal locks, but it must match that boot and the exact root-owned
copies in the existing root intent. It cannot resume writer admission or
recompute the old physical admission verdict on the new boot. It can only
record a verified pre-marker return using fresh release evidence, after which
the existing user journal remains restore-only. A new root begin still
requires a current-boot user transfer. This is a source control; production
root execution remains gated and fresh physical release verification is not
yet implemented.

## D49 — Decline a transfer only under the root ledger lock (2026-10-01 19:56 EDT)

When an owner has durably frozen a NATS transfer but no root intent was
published, the root can return it with a `declined` outcome. The decline takes
the owner node lock, owner journal lock, and root ledger lock in that order.
It creates the empty root ledger directory if needed, settles pending appends
with the ledger's own reader under that lock, and refuses any active root
intent. A one-link pending intent has no effect; a final or two-link intent
blocks decline. The same root ledger receives a terminal, nonce-bearing
`transfer-declined` record with exact user baseline/transfer copies, the prior
ledger head and carried writer lock, old transfer boot, current decline boot,
and a digest of fresh physical absence evidence. The public root-owned receipt
can be republished after interruption and binds that record's hash. A later
root begin rejects reuse of the transaction and inherits the terminal lock
from a decline belonging to an earlier transaction.

The user consumes only the matching root-owned receipt, closes the transfer
with outcome `declined`, and restores the legacy NATS state restore-only. The
receipt reader rejects ACLs on the outcome directory and file. This source
slice still uses a supplied physical-absence callback in owned tests; the
production macOS-root decline and transfer gates remain closed until a pinned
root command, process/service census, protected outcome lifecycle, and live
restoration checks are implemented. A decline never substitutes for a root
return if any root intent already exists.

## D50 — Refuse stale root outcomes before recording a decline (2026-10-01 20:09 EDT)

An existing outcome file for the proposed transaction is evidence of a
root-side inconsistency. The no-intent decline checks the protected outcome
directory and its transaction slot while holding the root ledger lock, before
appending `transfer-declined`. It refuses an occupied slot without creating a
durable decline record, so a stale `returned` receipt cannot strand a newly
recorded decline whose receipt can never be published. Idempotent reentry of
an already recorded decline instead verifies the saved user and physical
identity and republishes the same receipt. This closes Claude's PR #185
exact-head E4 reproducer; production gates remain closed.

## D51 — Hold the carried writer lock and retain decline observation (2026-10-01 20:27 EDT)

An exact carried writer lock is opened without following symlinks and held
shared while a no-intent decline checks physical absence and commits its
ledger record. A concurrent exclusive holder refuses before the append, and
an exclusive writer cannot enter during the observation-to-commit bracket.
The order remains owner node lock, owner journal lock, root ledger lock,
then shared writer lock. With no carried lock, the existing ledger exclusion
remains the protocol fence. The record stores a size-bounded copy of the
physical absence evidence alongside its digest, and replay validates the
evidence, transaction, boot, carried lock and transfer hash. This is a
source-only strengthening. It does not authorize a production decline until
the observer is fixed-path root-owned code with launchd, process and store
census, and the production tripwire is reviewed separately.

## D52 — Recheck decline gates at the durable commit (2026-10-01 20:37 EDT)

Claude's exact-head review of PR #186 found that a lock substituted after
physical observation but during user-journal recheck could be detected only
after `transfer-declined` became durable. The decline now rechecks user state,
marker, stages, the outcome slot, and the named lock against the held file
after observation and immediately before hard-link publication. The original
post-append check remains. Physical evidence must be canonical JSON before
it is recorded, so tuple values, non-string keys and NaN cannot produce an
unreadable durable record. Protocol-compliant root actors are excluded by
the held root ledger lock; an out-of-protocol privileged writer remains
outside that fence and is not claimed to be atomically excluded. Decline
records produced by the earlier source-only PR #185 lack the new evidence
field and cannot be replayed by this format. No production records exist:
the macOS-root decline tripwire has stayed closed throughout both slices.

## D53 — Separate read-only root inspection from recovery (2026-10-01 20:47 EDT)

The eventual physical observer needs the root ledger head without taking an
action. The ordinary journal constructor takes exclusive ownership and its
reader settles pending files, so it cannot serve an observe-only command.
`inspect_readonly` opens an existing ledger directory without creating it,
takes a nonblocking shared lock, validates a complete chain, and reports only
the site/ledger presence, head, count, terminal event and transaction. Any
pending record refuses and remains untouched, including a published
two-link pending record. An exclusive active driver also refuses. A missing
site and ledger are observable as absent, not fabricated as an empty
transaction. This provides one non-mutating input to the future fixed-path
observer; it does not perform launchd/process/store census or authorize
production decline.

## D54 — Bind observe-only reads to the locked directory (2026-10-01 20:53 EDT)

Claude's PR #187 probe replaced the ledger pathname with a valid older copy
after `inspect_readonly` had locked the original directory. A path-based read
could then report the old `returned` event while the held directory contained
an active intent. The read-only path now lists and opens records relative to
the held directory descriptor, compares each opened record with its named
identity, and rechecks the site and ledger directory identities before
returning. The report calls the final record `last_event`, since an active
intent is not a terminal outcome. It declares `scope: ledger-only` and uses
`site_directory`/`ledger_directory` names: directory presence is not marker,
stage, lock or process absence. Owned before-read and after-read swaps
refuse. A privileged actor writing outside the ledger protocol could still
swap a name transiently between syscall checks; this is not a claim of
atomic exclusion from out-of-protocol root activity. The production physical
observer must bracket the complete launchd/process/store census under its
own pinned inputs before a decline is authorized.

## D55 — Bound read-only inspection to opened file types and identities (2026-10-01 22:01 EDT)

Claude's revised-head review of PR #187 found no blocker, but a FIFO named as
a ledger record could block the read-only inspector while it held the shared
ledger lock. An opened directory record could leak a descriptor. The reader
now opens each name nonblocking without a controlling terminal, rejects a
non-regular descriptor before wrapping it as a stream, and closes that
descriptor on every refusal. It checks record identity again after reading
and after chain validation. Site and ledger mode, owner, ACL and named
identity are checked against opened directories; disappearing paths become
`Refused`. A concurrent driver or inspector now reports a busy ledger rather
than claiming the other participant is an active driver. These are
observe-only source checks, not a physical NATS census or a production
cutover authorization. The protected macOS-root tripwire remains closed.

## D56 — Separate the live NATS census from cutover authorization (2026-10-01 22:20 EDT)

The first macOS physical-observation slice is a read-only census. It reads
the exact four legacy GUI and system launchd labels, the GUI disabled
overrides, the loaded plists, kernel NATS process identities and arguments,
open vnode identities, and the four distinct JetStream store trees. A
running GUI job must match the arguments of its loaded plist. The report
contains hashes of argument vectors rather than their values and declares
`scope: live-census-only`; inaccessible PIDs are counted, not silently
treated as absent. On the live node after reboot it observes three running
legacy jobs, a disabled and unloaded member 1, and no system-domain jobs.

This census is not a root-owned installation, a stable cold-master receipt,
or a physical-absence verdict. It has no callback into `decline` and cannot
lift the macOS-root gate. The remaining observer must run from protected
pinned code and inputs, cover all legacy mutators and unlinked store holders,
bracket launchd/process/store checks under the writer lock, and refuse any
unobservable or ambiguous state. It must also verify the protected jobs and
marker before any cutover action. The current user-owned GUI topology stays
unchanged.

Claude's first-head review found that an empty process or vnode list could
look like proof of absence despite unreadable processes, other launchd
domains, unlinked files and observation churn. The revised report explicitly
names the checked domains and holder subset, states that unloaded plists and
other domains are unchecked, and says physical absence is not certified.
Loaded launchd arguments are compared with the plist even for waiting jobs;
the raw arguments are removed before output. Both older boolean and newer
named disabled-override values are accepted, while unknown values refuse.
Plist arguments containing control or Unicode line-separator characters
refuse; loaded arguments are checked as launchctl renders them, but an
embedded newline can be indistinguishable from two arguments for a waiting
job. The report declares that limit. Reported
argument and plist-content digests use a fresh private HMAC key per scan so
they do not expose an offline guess oracle for future low-entropy secrets.

## D57 — Refuse malformed observe-only ledger input uniformly (2026-10-01 22:33 EDT)

The read-only root ledger inspector must return `Refused` for malformed
records rather than let JSON recursion or a schema type error escape into a
future physical observer. It maps only the parsing and schema exception
classes; existing specific `Refused` reasons remain intact. Before opening a
record from the held directory, it also checks the named entry's type, so a
pre-existing device or FIFO is rejected without invoking that entry's open
behavior. The descriptor type and identity checks still decide any race
after this preliminary check. This changes no root write or recovery path,
and it does not authorize production decline.

Claude's review also found a rehashed non-string transaction escaping through
`uuid.UUID` as `AttributeError`. Both intent and decline validators now
require a string before parsing, and the observe-only boundary maps any
remaining `AttributeError` to `Refused`. This leaves the driver path with an
explicit schema refusal and the diagnostic inspector with a uniform failure.

## D58 — Report readable store holders without an absence verdict (2026-10-01 23:04 EDT)

The next diagnostic slice scans vnode descriptors for every process name it
can read, not only `nats-server`. It matches linked store entries by device
and inode and can identify an unlinked handle when the kernel retains a path
under one of the four store roots. Unlinked handles on a store device with no
attributable path are counted separately. Inaccessible PIDs and a changed PID
list remain visible in the report. The scan does not establish a single
instant or physical absence, and has no path into the root decline callback.
Root-run protected observation and writer-lock bracketing are still required
before any migration decision.

Claude's exact-head challenge found that resolving a retained kernel path
against the current filesystem could turn an unrelated deleted file into a
false store holder if its former directory became a symlink. Path fallback is
now lexical and applies only to unlinked descriptors; linked entries require
device/inode membership. This also avoids filesystem traversal for every
observed process path. A failed process snapshot is retried once, then
separated into exited or still-unreadable PIDs. The report states that it
covers open vnode file descriptors, not closed-descriptor mappings, cwd/root
references, or in-flight descriptors. Alternate firmlink or case spellings
can remain unattributed. None of these diagnostic observations certifies
physical absence.
