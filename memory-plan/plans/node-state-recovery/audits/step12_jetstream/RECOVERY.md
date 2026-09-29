# JetStream preservation runbook

These tools wrap the installed official NATS CLI 0.3.1 and server 2.12.6. They
create no daemon and initialize no OpenClaw application. Use only explicit
loopback URLs and the matching installed server binary. Keep every transcript,
payload, token and original configuration private. Both plan chains stay off.

## Tools

`recovery.mjs` exports private/fsynced writes, official CLI backup/restore,
read-only message/consumer capture, stopped-store copy and content manifests.
`take_snapshots.mjs` backs up every reachable stream and records explicitly
named offline assignments. It clears inherited NATS CLI settings and disables
selected contexts. `test_recovery.mjs` creates and gracefully stops owned servers
on fresh loopback ports outside the production port set. It keeps private
fixture evidence in its reported temporary directory.

Run the driver with an existing token supplied through its process environment,
never argv, URLs, tracing or a public transcript:

```
NATS_TOKEN=<loaded privately> node take_snapshots.mjs \
  nats://127.0.0.1:<port> <new-private-absolute-dir> <installed-nats-cli> \
  [comma-separated-known-offline-streams]
```

The placeholder is explanatory, not an instruction to paste a secret. The
operator's local process reads the existing private configuration and passes the
value directly into the child environment. No shell command substitution or
printout. Unexpected offline streams or changed inventory refuse acceptance.
The manifest records snapshot-time metadata plus before/after observations;
these are separate points and must not be claimed simultaneous.

For an isolated R3 stream restored to a standalone fixture, use the explicit
`--replicas=1` override and record this replica policy delta. CLI 0.3.1's
`--config` is ignored because of upstream variable shadowing; the R3 fixture
reproduced the failure. Do not use that option or change production replicas.
Keep health TTL: an old health entry expires on restore and proves no liveness.

## Production preservation sequence

1. Before each operation reverify PIDs, loaded units, binary hash/version, config
   hashes, distinct real store paths, listeners, route/leaf/gateway lists and
   client ownership/resolved URLs. No non-local server routes are permitted.
2. Verify member 1 still fails at monitor 8222 and serves no clients. Boot out
   `ai.openclaw.nats-1` and persist the hold with
   `launchctl disable gui/$UID/ai.openclaw.nats-1`; verify print-disabled. Confirm absence of process/file owners, then copy
   its intact store and original config/unit into a new private master. Hash
   source before/after, fsync copied files/directories, compare copy hashes.
   Hold it disabled and unloaded until topology 1.4 (D6). Never delete its
   offline COLLAB/PLANS assignments through survivors: catch-up would erase them.
3. Take official reachable snapshots with consumers for standalone and cluster
   into distinct new directories. Account for the two known offline cluster
   streams through the stopped member-1 master. Never union same-named streams.
4. Before the remaining cold copies prove zero active executors, task claims,
   collaboration sessions, child processes and consumer ack-pending. Resolve
   stale MC statuses using their linked worker evidence; do not mark stale rows
   done as part of preservation. Record the MC scheduler scheduled/ready/running/overdue summary and owners;
   require no new trigger or dispatch after its first resumed tick. Inventory and
   temporarily unload all managed clients/timers, including the deploy listener. Confirm every connz is empty. If ownership
   or drain is unproved, leave healthy buses running and track the outstanding
   gate; snapshot verification can continue independently.
5. Stop members 2/3 before standalone. Use managed bootout rather than raw kill.
   Wait for exit and a clean shutdown log, verify no store owners, then copy all
   remaining stores/configs/units. An enforced SIGKILL is crash-consistent and
   must be labelled; do not assert clean shutdown merely because a PID vanished.
6. In finally, start standalone first; require the correct process/config to own
   BOTH 4222/8222 and JetStream health ready. Start members 2/3, wait for metadata
   leader, then restore previously loaded client/timer jobs. Keep member 1 held.
   Confirm original connection sets, streams, consumer positions and health.
   Never let failed standalone recovery cause member 1 to claim its client port.

## Isolated recovery and acceptance

Open working copies only; masters never become server store_dir. Generate fresh
configs rather than editing copied originals. Keep original server/cluster names
and the global account, adequate production storage limits, unique loopback
client/monitor/route ports, route authorization and no_advertise. For routez,
compare peer server IDs and loopback IPs: inbound route ports are ephemeral and
cannot be compared directly to listener-port allowlists. Check leafz/gatewayz
are empty. No OpenClaw client, watcher or task executor connects to recovery.

The owned fixture confirms this server version can read an R1 member's working
store without cluster routing. Use that separate working copy to inspect offline
R1 history before any catch-up. For the remapped cluster start 2/3, verify offline
stream assignments remain, then start 1. If the assignments have been deleted,
stop; never risk the protected master. Snapshot restores use separate empty
servers, never clones that already contain those streams.

Compare each snapshot restore to its own backup.json state. Digest exact
sequence/hole, subject, nanosecond timestamp, raw headers and payload bytes.
Capture consumer config, delivered, ack floor, pending ack/redelivery and
remaining pending counts. Check cold clones against snapshots at snapshot
high-water marks; later updates/retention can remove older KV revisions, so a
mismatch must be explained or retaken under quiescence, never called a match.
TTL health expiry is explicit. Remove write permission from masters after copying; on macOS also set uchg.
Hash masters again after all clone tests. Content hashes include empty dirs;
private permission and immutable-flag checks are separate from content equality.

This verifies recovery mechanisms only. Child 1.3 still establishes a common
SQLite/JetStream/file-source quiet point. Same-disk copies offer logical rollback,
not disaster recovery after loss of the machine or disk.

## Installed serializer differences

Actual 2.12.6 source configs include compression:none, allow_msg_ttl:false and
_nats.level:3/_nats.ver:2.12.6 metadata that CLI 0.3.1 backup.json omits. Primary check: compare restored server configs to the complete matching source
before/after configs exactly, except an explicitly recorded isolated replica
override. Secondary check: only the backup.json-to-source comparison may allow
those exact omitted defaults and server metadata; refuse any missing non-default
value or other policy difference. The snapshot
state omits deleted_details: compare equivalent API options, and separately
compare captured source deleted sequences to restored message-get holes. This
server reports a sequence-zero deleted marker for a never-used empty stream;
it is not a message hole. Keep it explicit, never turn it into a payload record.

## Pre-cold-copy review correction — 2026-09-28 21:10 EDT

The prior sampled-zero and stop-order harness is superseded. Before any healthy
server stop, independently challenge the replacement and its owned negative
controls. Stop health-watch, deploy listener and node-watch first; stop timers
(including heartbeat before MC); then MC, bridge, worker, observer, task daemon,
memory daemon and publisher. The worker must exit before its task service.
Only uniquely named harness clients may be used before observer close. From
observer close through server stop, monitoring uses HTTP only and refuses any
unexpected increase in total_connections, new open/closed CID, task-state
change or durable-position change. After all clients stop, record65seconds
with zero clients, unchanged cumulative admissions/API counters, non-expiring
stream state and durable positions; keep checking through each bootout.
Physical listener ownership and subsequent recovered-state equality close the
limits of finite monitoring; do not claim an instantaneous HTTP reading itself
locks out admissions. MESH_NODE_HEALTH and MESH_TOOLS, if present, may expire
under their original120second policy; no new sequence is allowed.

For each stop assert actual process ownership, documented normal completion
where supplied by that program, absence of descendants/listeners and closed
client identity. Client Closed is not proof of clean drain. Memory additionally
requires a new owner-matching empty queue snapshot immediately before signal
and no external/idle extraction or import start between anchor and completion.
One-shot timers must be idle immediately before unload and have unchanged log
length afterwards. A source-level completion line with surviving child/socket
refuses acceptance.

After buses resume, compare pre-stop stream and durable state before any
application clients resume. Require managed PIDs actually own client/monitor
listeners, authenticated MC scheduler status before heartbeat, unchanged
scheduler trigger/dispatch/recur counters, and real worker null-claim/idle
readiness after explicit kickstart. Watchers resume last. Check current deploy
marker versus its actual repository HEAD before allowing listener catch-up;
never treat bootstrap returning0 as readiness or write a false restoration
record. Any failure retains a private journal and restores only verified
original loaded/running/disabled state, with member1 held.

## Durable journal primitive

`preservation_journal.py` is the single restoration implementation, not an
operational service command. The fixed persistent parent is
`~/.openclaw/preservation/`, containing `node.lock`, its owner-private state
receipt and `journals/<window>/`. Roots outside that journals directory refuse.
Owned fixtures substitute a complete isolated parent. Missing/corrupt receipt
plus existing roots blocks a new window. An intact primary can restore its
recorded node after rebuilding/read-checking the receipt; corrupt bytes are
retained. Hash-linked predecessor records identify the unique current root, including after finalization; a sealed tip repairs only its receipt and remains closed. Multiple unfinished roots are ambiguous and refuse. Neither valid
baseline means no automatic state inference.

Creation durably prepares and reads back the complete baseline in the node
receipt before creating its journal directory. The receipt's initializing
phase identifies that root even if creation stopped before mkdir or before
the primary baseline record. Reopening that exact root completes setup for
restoration only; it never resumes the interrupted copy window. A setup write
failure permits degraded restoration from the prepared baseline under the
global node lock, without durable success or acceptance. A different root
remains fenced. Finder's owned regular .DS_Store is ignored in the journals
parent and initializing root; unexpected entries, foreign owners, directories
and metadata links refuse explicitly on a new-window parent scan or an
initializing-root reopen. Invalid parent entries do not block restoring the
known prior root; they prevent a later new window. Ignored metadata is retained.

The baseline must contain exactly RESUME_ORDER plus nats-1. Each uninstalled
unit has explicit class absent, false loaded/running/disabled and identity
{installed:false}; it is observed, never installed or mutated. An installed
member1 alone may be held, disabled/unloaded. Daemons are loaded/running;
timers loaded/idle; known-broken loops preserve loaded/disabled with running
unconstrained. Classes come from approved desired state, never from observing
a stopped daemon. Actual installed-unit completeness and extra writers still
require driver inspection; the fixed names alone do not prove that inventory.

`static_identity` hashes the plist bytes, binary, every argv element resolving
to an existing file, declared additional files and actual dependency targets.
Relative argv files resolve against the plist's working directory; that
directory is resolved too, so replacing its symlink target changes identity.
Dependencies are resolved entry-file paths, not package directories. The driver
includes their package.json files as additional files. The helper reads ProgramArguments/WorkingDirectory
from that plist. It needs no loaded job or PID. Its schema is enforced for
installed baseline units. Identical byte rewrites preserve identity; changed
content or dependency targets do not. The driver must enumerate all required
entry/config/build/dependency files (the actual NATS configs and any includes
they declare, plus Mission Control's actual npm-start build entry) and separately bind the running PID argv,
loaded ProgramArguments, cwd and physical listeners. A static descriptor alone
is not proof that the running process uses it.

Each baseline is synced/read back and copied beside the global lock, also
read back exactly. All reopened windows are restore-only. Recovery visits the
entire baseline in dependency order, checks static identity before any action,
skips matching ready owners and blocks applications after unverified buses.
A loaded running timer is reported busy without calling restore; the driver
must re-observe beyond its declared run deadline (heartbeat30s,
consolidation300s) and verify exit0, never restart an active timer to force idle.
The final physical listener/member1 check runs even after other failures.

Forward writes use a strict deterministic JSON encoder. Disk or serialization
failure during recovery preserves baseline restoration under the lock with
sanitized undurable diagnostics. A set, bytes, NaN or Path in observations does
not bypass actual state checks or prevent subsequent service restoration.
`services_verified`, `evidence_durable` and `restored` are separate. The journal
records verified service state, not a premature restored:true before the state
receipt is saved. Receipt-write failure is explicitly diagnosed and cannot
seal a window. Missing/corrupt primary records with a valid secondary allow
only degraded restoration. Damaged history still requires explicit forensic
resolution before new windows; that operational procedure remains pending.

A strict fresh restoration receipt permits explicit terminal finalization.
`seal()` belongs only to the uninterrupted successful forward window and pins
its immutable hash for a future acceptance manifest. `resolve()` retires an
interrupted/restored window without accepting its copies. New windows require
a terminal predecessor. If interruption follows the terminal append but
precedes receipt update, a verified final terminal record whose previous hash
matches the restored receipt repairs that receipt; the terminal chain is never
appended to. Before the append, reopen/recover/resolve remains available. No
terminal journal reopens for writing, and no reopened window becomes accepted.
This primitive publishes no acceptance manifest.

Records/directories use fsync plus Darwin F_FULLFSYNC. Return codes do not
prove host/hypervisor power-loss survival. Existing Node/CLI copy helpers have
OS-level fsync; the future managed driver must add its declared Mac flush
boundary or preserve this limit. Same-disk copies provide no disk-loss safety.

D8 requires temporary bootout-only holds for ordinary clients/serving buses;
member1 is the sole persistent disable. The deploy listener resumes last after
marker/HEAD verification. A never-connected instance stops by default signal15
with no CID/children/socket, not a fabricated Ready/completion line. One real
owned macOS launchd probe verified NOTE_EXITSTATUS normal exit0 and its marker,
using a uniquely named test service; it did not test child exit ordering or
production services. Real negative controls, CID closure, detached driver,
three healthy cold masters and isolated restores remain step1.2 work.

Expiry classification uses each stream's unchanged originalmax_age rather than
a bucket-name allowlist. Positive max_age permits only monotone expiration
with unchanged last sequence and durable positions. Other retention changes,
new publications or policy changes still refuse the quiet window.

## Managed macOS stop adapter

`managed_launchd.py` supplies process binding, managed bootstrap/kickstart,
exit watches and timer unload callbacks. Construct `StopWatch` before writing
Journal stop intent: expensive process/code/environment rebinding happens
during construction, with process and identity-file watches already active.
Use `watch.mutate(journal, unit, connection_check, listener_check)` to call
`ready_for_intent()` immediately before `Journal.mutate`, outside its durable
mutation intent. The apply callback
rechecks generation, tree and queued events, without repeating file hashing
or executable/cwd inspection after intent. This does not establish a completed
producer tick: the driver must separately select a fresh child-free gap after
the producer's tick completes. Pass the prepared apply/verify callbacks to
that helper only after those gates. The journal still performs its own
admission and durable-write checks; the helper is not an atomic filesystem
or producer lock.
Verification requires separately supplied physical listener and former-CID
checks; the callback's true result must come from the actual managed driver.
Do not substitute a generic lambda:true in production. Approved executable/
argv/cwd and generation must come from the pinned service inventory. Binding
also checks the actual loaded plist path, arguments, stdout/stderr paths,
the executable text inode, start time versus
file ctime, hashes of explicitly declared code files and hashes of the declared
exec-time environment. No environment values enter its returned evidence. npm
changes its process title; bind its approved title, Node executable/cwd and
actual Next server child/build rather than inferring argv-file identity.
Caller-supplied completion logs must match the loaded job's resolved paths;
an identical copied plist or a different log cannot substitute for provenance.

Every declared identity file has an open vnode watch through stop. Write,
replacement, deletion and permission changes refuse. Only a pure ATTRIB
notification with unchanged opened and current path device/inode/ctime is
ignored, since inspecting files can update atime. This is a watch on the
declared files, not a complete dependency inventory or a global filesystem
lock. The v43 refused draft did not retain its exact event detail; its cause
is unproved. v44 passes the real replacement and chmod negatives. Watches
follow opened inodes, so changing a parent directory or symlink can change
what a path resolves to without notifying those inodes. Callers use resolved
identity paths and must recheck the full static path/dependency mapping before
restoration. Dependency installation or rebuild in a linked checkout is
forbidden through an unresolved window; no global path lock is claimed.

Raw kernel events are retained before classification or refusal, including
filter, ident, flags, fflags and data. EV_ERROR refuses immediately with its
kernel errno. Constructor/context refusals attach `stop_evidence` to their
exception; successful verification includes `kernel_events`. The driver must
persist that private error evidence even when preparation fails before an
intent. StopWatch.mutate passes its sanitized failure snapshot to the journal
for post-intent failures; these are durably appended before re-raising. The
optional Journal failure_evidence callback must return serializable private
detail. A failed durable append keeps the existing restore-only fence and
makes no evidence-survival claim. Non-vnode events explicitly require the
process filter; a bound PID alone cannot classify them. A plain generic
error type is insufficient forensic retention.

Owned tests use explicit RECOVERY_NODE/NATS_SERVER/RECOVERY_NATS_MODULE and a
private OPENCLAW_OWNED_TEST_ROOT. All jobs are uniquely named and all sockets
use an isolated authenticated server. These are actual Mac controls; Linux
collects them as visible skips. They do not complete the production driver.
The initial watch includes descendants and the owner's entire process group.
Fork/exec flags remain enabled through stop; any such event refuses complete
verification. Darwin's NOTE_FORK does not supply a new PID and NOTE_TRACK is
unsupported, so this is a refusal mechanism rather than automatic child adoption.
Normal bound children observed dead while the owner is still live can disappear
before signal without aborting. Coalesced exit observations conservatively refuse
children; delivery order is not claimed as kernel exit chronology. Each PID has
its own role/signal contract, and SIGKILL always refuses. Bootout return/stderr and
all captured exits are retained, including beyond the loaded exit timeout. The
adapter waits that timeout plus a margin instead of fixed10/15second deadlines.

Bootstrap refuses an existing label in either gui or user domain. The owned
cross-domain negative is an explicit unavailable test on this Mac, not a pass.
Timer callbacks require independent complete spawn evidence covering unload;
the actual loaded plist/log provenance, while idle status and unchanged logs
alone refuse verification. A generic true callback
or the absence of retained unified logs is not such evidence. The detached driver
must still retain physical process/file/listener and cumulative admission checks
through the entire quiet window. No healthy bus stop is authorized by these
callbacks alone. Full static identities, memory queue, timer spawn witness,
scheduler/worker readiness and healthy cold masters remain1.2 work. Before
any production baseline, measure normal stop time on production-sized owned
NATS and memory copies against each loaded exit timeout. A needed timeout
change is a separately verified prerequisite. The Discord crash loop requires
a verified stop path or independently witnessed idle unload; no stable PID
or an empty unified-log query is not proof of safe quiescence. Four owned NATS
stops with all eleven archive restores and original replica policies measured
34–45ms; one idle memory stop with253,943,808 copied database bytes measured
65ms. These historical-size samples are not worst-case bounds and do not cover
active extraction, worker or subprocess shutdown. Production's five-second
timeout remains unchanged. All three pinned serving NATS configs omit log_file,
so their completion marker uses the loaded stdout/stderr paths.
