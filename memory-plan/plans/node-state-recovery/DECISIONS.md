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

## D24 — Unknown jobs refuse; FSEvents alone cannot certify a cold copy (2026-10-01 03:22:38 EDT)

Invert the full-node launchd preflight: every non-system installed or loaded
job is unknown until it belongs to the 23-unit cohort or has an explicit,
reviewed exclusion. A label, `application.*` prefix or Apple-looking path
string does not establish non-writer status. The scanner now resolves the
actual loaded source and executable for root-owned, non-group-writable Apple
system provenance; dynamic app jobs remain visible. It binds approved loaded
program, arguments, working directory and declared environment to the
installed plist, and records the effective loaded configuration in the
journal. This is an admission and restoration guard, not continuous proof
that no process ran between scans. No exclusion is accepted in the current
source; the live preflight remains closed.

Do not use a user-level FSEvents stream as full-node copy certification.
Apple's [FSEvents guide](https://developer.apple.com/library/archive/documentation/Darwin/Conceptual/FSEvents_ProgGuide/UsingtheFSEventsFramework/UsingtheFSEventsFramework.html)
calls the historical list advisory; event delivery can lag a writer holding
an open descriptor or writable mapping. The proposed source-manifest
comparison catches many write-and-revert or swap cases but does not establish
the required absence of a mapped write before timestamp publication. In an
owned Mac control, `UF_IMMUTABLE` refused a new write open but did not stop a
write through a descriptor opened before the flag was set. A future kernel
immutability fence is therefore conditional on a privileged complete
open-handle/mapping check, durable freeze/unfreeze intent and crash recovery,
and an unchanged post-copy manifest. Until those controls are implemented and
tested, the structural full-node `seal()` refusal remains mandatory. The
root-managed legacy agent and remote management job are still unresolved.

## D25 — Bind the complete loaded launchd environment (2026-10-01 03:42 EDT)

Claude's exact-head review of PR #170 found that the initial loaded-job check
accepted extra `NODE_OPTIONS`, declared loaders, variables in launchd's
`inherited environment`, and argument trailing whitespace. Read all three
launchd environment sections, preserve argument bytes after printed
indentation, and apply the same declared-or-ambient and no-code-loader rule
to loaded jobs and running processes. A system-looking symlink must have
protected ownership and permissions along its original path as well as its
resolved target. Unknown or malformed jobs refuse; none are silently
excluded. Because launchd prints literal newlines in environment values,
variable-shaped rows outside a parsed environment block also refuse. The
approved gateway's real launchd output passes this parser.

Four current mesh plist templates and their installed live copies still
declare `NODE_PATH`. The templates drop it; the four entry scripts' `nats`
imports resolve through their own `node_modules` ancestors without that override.
the installed live plists are unchanged and must be replaced and checked
before full-node preflight can pass. This source change does not authorize a
live preservation window or relax the structural seal refusal.

## D26 — Snapshot copy input; do not certify idle jobs from launchctl text (2026-10-01 04:02 EDT)

An owned temporary LaunchAgent confirmed that `launchctl print` emits raw
newlines in argument and environment values. Such a value can impersonate a
section boundary. The scanner rejects unmatched braces, duplicate identity
fields, out-of-section variable rows and reordered environment sections, but
an unescaped text report is not a complete attestation of a loaded job that
has no running process to inspect. A full-node controller must unload and
re-bootstrap approved idle jobs from pinned plists before their restored
state can be trusted, or obtain a structured trusted launchd attestation.
The existing full-node `seal()` refusal remains in place.

Target a single read-only APFS Data-volume snapshot, taken after writer
quiescence, as the three cold NATS stores' copy input instead of setting
`UF_IMMUTABLE` on the live stores. Apple's [snapshot guide](https://support.apple.com/en-ca/guide/disk-utility/dskuf82354dc/mac)
describes a read-only point-in-time volume copy. This removes the long
file-by-file copy interval from the live admission window; it does not prove
that writers were absent at the snapshot instant. The owned proof must show
all three roots are on the same volume, privileged snapshot creation and
read-only mounting work, the snapshot identity is journaled and retained,
the restored masters validate, and pre/post stop, handle, listener and
manifest checks cover the snapshot bracket. No live snapshot was created.

## D27 — Separate restoration observations from idle-job attestation (2026-10-01 04:17 EDT)

Claude's exact-head PR #170 challenge found no defect in the fail-closed
source checkpoint, but balanced newlines can still forge launchd's printed
arguments or working directory. This limits restoration as well as forward
certification: a `restored` or `resolved` full-node journal based on the
current text checks would describe observed service state, not prove the
loaded configuration of an idle job. Before the first real full-node journal,
the controller must pin an owner-private plist copy or freeze and hash the
installed plist around re-bootstrap, and bind the domain environment or
require a startup self-check. No such attestation exists yet; full-node
sealing remains disabled and no full-node restoration is accepted.

The strict parser also refuses some ordinary Apple and third-party launchd
reports before it can classify them. This is safe refusal but prevents a
complete host scan. The next source change must preserve duplicate identity
field checks for every job while scoping detailed argument/environment
parsing to approved jobs; unknown non-Apple jobs still refuse. D25's
`NODE_PATH` description records the state before PR #170 removed it from
four source templates; the installed live plists still carry it.

For the APFS target, use the volume UUID rather than a reboot-unstable disk
number. A local snapshot can be thinned, so copy promptly from a read-only
mount and recheck its identity afterwards. Privileged owned creation,
mounting and handle evidence remain required before any production snapshot.

## D28 — Classify unapproved jobs from launchd's identity header (2026-10-01 04:29 EDT)

The whole-domain `launchctl print` scan must not fail while decoding an
unapproved Apple job's free-form arguments or environment, because many
honest jobs print text those strict decoders reject. For each loaded job,
inspect only the top-level `path`, `program` and working-directory fields
before the first nested block, and refuse duplicate top-level identity
fields anywhere in the report. This prevents a missing-path job from
injecting one Apple-looking `path` inside an argument. Nested event-trigger
objects may legitimately contain their own `path` keys and are not identity
duplicates. A protected Apple source and program can be omitted from the
entrypoint inventory; every other unapproved job is recorded as unknown
without decoding its free-form values, so the cohort preflight refuses.
Approved jobs retain the strict argument and complete environment checks.

This is an inventory-availability correction, not permission to exclude
Apple jobs as non-writers. Apple jobs can launch user content and inherit
domain variables; an exclusion policy and continuous process/admission
evidence remain required. The live read-only scan now completes and still
refuses 29 extra GUI and 11 extra system jobs plus installed extras. The
raw-newline idle-job attestation limit in D26–D27 is unchanged.

## D29 — Preserve literal launchctl value boundaries (2026-10-01 04:43 EDT)

Claude's exact-head review of D28 found two parser regressions. An approved
job's top-level `working directory` can follow its `arguments` block, so it
must be read from the full service report and bound to the installed plist;
`path` and `program` remain confined to the identity header for every job.
Python's `splitlines()` also treats U+2028 and other separators inside a
launchd value as record boundaries. Split the report only on literal LF and
refuse non-printable identity values. An unapproved job with such a value
remains explicitly unknown rather than becoming an Apple omission. Require
`path` before `program` for that omission, matching the observed launchd
identity header and refusing a forged `path` later in a program value.

These checks correct source classification and approved-job comparison, but
they do not turn launchd's unescaped text into idle-job attestation. D26–D27
still require pinned re-bootstrap and domain binding or a structured trusted
source before full-node sealing or restoration can be accepted. A literal LF
inside `path`, `program` or `working directory` still truncates the printed
value at that boundary; the non-printable check only closes the other line
separators and control characters.

## D30 — Keep verified store copies separate from cold-point certification (2026-10-01 05:32 EDT)

D26's APFS snapshot target is not available on this host as currently
configured: `tmutil destinationinfo` has no destination, the Data volume has
no local snapshots, and the installed `fs_snapshot_create(2)` manual requires
superuser plus an additional entitlement. Do not create a snapshot or treat a
sequential live copy as one. An owner-private candidate copier now inventories
all three store trees, refuses links and special files, hashes source bytes
before and during copying, compares complete source manifests after copying,
hashes the destination, and publishes the candidate only after those checks.
The owned three-member JetStream fixture cleanly stops, copies its stores,
and restores the stream and durable consumer in a separate owned cluster.
This proves usability of those exact copied bytes, not absence of a writer
before the first manifest.

The missing writer proof is concrete. A writable shared `mmap` on an owned
file changed its bytes while its ctime remained unchanged until `munmap`.
`lsof` exposed the mapping as `txt`, not as a writable descriptor. A direct
`proc_pidinfo(PROC_PIDREGIONPATHINFO)` probe found that mapping in its own
process but returned `EPERM` before enumerating any regions of root
`meshagent` and `syspolicyd` from this user session. `proc_listpidspath`
found the owned mapping, but that positive result does not prove complete
coverage of protected processes or all writable kernel references. Thus a
stop-time ctime anchor plus two hashes cannot certify that a pre-manifest
mapped writer did not change the baseline. The candidate copier returns
`status=candidate`; it cannot append a cold-point receipt or enable
full-node `seal()`.

An opt-in owned APFS sparse-image test supports a different future bracket:
non-forced unmount refused while a descriptor-free writable mapping existed
and while a write descriptor sat unread in a UNIX socket; it succeeded after
those references were released. A read-only remount refused `O_RDWR` with
`EROFS`, and an unwritable bare mountpoint refused store creation. The volume
UUID was stable across remounts. The image was mounted with ownership
enforcement on each mount; its files still belong to the operator account,
so this fixture does not prove isolation from another UID. A separate owned
APFS probe found that a mapped write changed file bytes while ctime stayed
unchanged even after `fsync` on a read-only descriptor; ctime advanced on
`munmap` in that probe.
These are bounded host observations, not a proof against every memory-entry
or pre-unmount writer and not permission to migrate the live stores.

A future certified bracket needs a tested mechanism that excludes or detects
every writer across the stop-to-manifest interval, including writable
mappings and inaccessible processes, plus the already-required pinned
re-bootstrap and truthful resumption. No production service or store was
stopped, copied, or changed for this decision. Step 1.2 remains active.

## D31 — Require service-identity isolation before cold-point certification (2026-10-01 05:55 EDT)

The owned-volume end-to-end fixture ran all three NATS members on an
ownership-enforcing APFS image, cleanly stopped them, unmounted without force,
remounted read-only, and made a second three-store candidate. Its manifest
matched the manifest taken before the first candidate was started for the
isolated restore. The restored cluster had already changed its candidate
files, so comparing to those live restored files would be invalid. This is a
transitive byte-equivalence check of an owned fixture, not a cold-point
certificate.

On the live node, all three NATS servers and their stores are owned by the
operator uid. Moving their stores to an APFS image without changing that
identity would not exclude another operator-uid process from obtaining a write
descriptor before stop or writing through a pre-existing mapping. A dedicated
non-login service uid and ownership-enforcing store volume are the proposed
boundary. The executable, config, credentials, plist, store and any privileged
helper would need protected paths; service-domain jobs would need explicit
`UserName`/`GroupName`. The account and migration are not implemented or
approved as a runtime change. An ordinary unmount, read-only remount and
root-owned evidence remain necessary observations, not substitutes for
ownership or D24's continuous full-node entrypoint watch. Full-node `seal()`
continues to refuse.

The live `system/com.openclaw.agent` launchd job references a missing
operator-writable script, but `launchctl print` reports `username = moltymac`
and its plist declares `UserName=moltymac`. It is therefore a same-user
KeepAlive path, not an observed root execution path. It remains an
unclassified loaded job under D24. Do not claim it can execute as root
without different evidence. No live job was
created, stopped or modified.

An argv-only process dump can omit every environment variable while still
returning an apparently valid argument list. `running_identity()` now refuses
an empty observed environment before comparing declared hashes. This closes
the empty-declaration acceptance case; it does not grant the operator
visibility into a different uid's process. Cross-uid NATS identity and
launchd domain binding remain unimplemented and must refuse until protected
evidence can supply them. Step 1.2 remains `[A]` at `v1.2-pre`.

## D32 — Separate macOS auxiliary strings from observed process environment (2026-10-01 06:08 EDT)

The argv-only refusal in D31 exposed a second decoder boundary. macOS can
place its post-environment auxiliary strings immediately after the last
environment value with zero padding. The old decoder then classified `pfz`,
`stack_guard` and other auxiliary keys as undeclared environment variables,
refusing an honest process. A synthetic probe reproduced that classification,
and an owned eight-length `/bin/sleep` sweep reached the zero-padding layout.
The decoder now strips only a trailing,
ordered known auxiliary sequence beginning with the five observed leading
keys. An auxiliary-looking sequence before `NODE_OPTIONS` remains part of the
environment and refuses as a loader. Unknown or changed kernel layouts still
refuse; the parser does not infer an empty environment as valid. This is a
source correction, not a cross-uid process attestation or a full-node seal.
