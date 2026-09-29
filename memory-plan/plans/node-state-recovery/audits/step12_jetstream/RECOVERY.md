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

`preservation_journal.py` is the single restoration implementation. Before any
forward mutation it records a validated desired-state inventory with immutable
service descriptors, reads the synced baseline back, and stores a second
validated copy beside the node lock. Daemons must be loaded/running; timers
must be loaded/idle at baseline. Known-broken services retain loaded/disabled
state with running unconstrained; their verified callback proves preservation,
not health. Member1 is held, disabled/unloaded and cannot be mutated.

The fixed node-wide lock is `~/.openclaw/run/preservation.lock`; test fixtures
supply an isolated node lock. Its owner-private state file retains the baseline,
holder PID/boot UUID and restoration head. Different roots cannot act at once.
An unresolved recovery blocks a new window, and a restored head must match its
complete record chain before another window starts. The operational driver
must check this inventory against every actual installed unit and its approved
desired state. A caller-provided subset is not a complete node inventory.

Every journal reopen means restore-only, even on the same boot. A chain cannot
prove an absent tail was never written; no reopened window may continue copies
or gain acceptance. Recovery visits every baseline unit in derived dependency
order, re-observes owners before any action, skips matching ready owners, and
never resumes applications after an unverified bus. Identity must match before
and after restoration. The final physical listener/member1 check runs even
when another unit fails. Unknown units are reported without preventing known
units from being restored.

Forward writes remain strict. A failed durable write during recovery permits
only verified baseline restoration under the node lock, with sanitized
undurable diagnostics. `services_verified` is separate from `restored` and
`evidence_durable`; degraded mode never reports durable success. A corrupt or
missing primary record chain can use the validated secondary baseline only in
this degraded mode. The unresolved node still blocks new windows until its
forensic journal is explicitly repaired/resolved and a strict recovery records
fresh observations. If neither baseline is valid, refuse automatic mutation;
do not infer the operator's prior service choices from unit defaults.

Records and the journal directory use fsync plus Darwin F_FULLFSYNC. The owned
APFS probe confirms return codes for a file and directory, not power-loss
survival. Existing Node/CLI snapshot and cold-copy helpers currently provide
OS-level fsync only. The future managed copy driver must add the declared Mac
flush boundary or explicitly retain that limit. Neither primitive promises
host/hypervisor cache durability, independent failure domains or disk-loss
protection.

Normal resume uses the same recovery path in the uninterrupted forward
process. Only a successful durable restoration receipt permits sealing. The
acceptance manifest must pin the returned sealed head; a sealed journal cannot
be changed or reopened for writing. This primitive publishes no manifest and
runs no services itself. Actual launchd/PID argv, loaded ProgramArguments,
WorkingDirectory, plist/binary/entry hashes, dependency realpaths, NATS config
digest and MC BUILD_ID bindings remain the driver's responsibility.

D8 requires bootout-only holds for ordinary clients and serving buses. Member1
remains the sole persistent disable. Timer readiness waits for its load-triggered
run to finish with last exit0 before comparing idle state. The deploy listener
resumes last after current-marker/HEAD checks; an unconnected instance has no
SIGTERM handler, so its stop requires default signal15, no bus client and no
child/socket rather than a fabricated completion line. Real owned launchd
negative cases, descendant exit order, CID-close timestamps, detached driver
lifetime and the three healthy cold masters remain pending.

Expiry classification uses each stream's unchanged originalmax_age rather than
a bucket-name allowlist. Positive max_age permits only monotone expiration
with unchanged last sequence and durable positions. Other retention changes,
new publications or policy changes still refuse the quiet window.
