# Protected NATS writer migration — revised review candidate

This is the remaining step 1.2 cutover design, not an execution record or
cutover authorization. No production job, store, account or handoff marker has
been changed by this document. Claude's 2026-10-01 adversarial review found
four blockers in the first draft: an unadopted installer lock, no ownership
transfer from the user preservation journal, an auto-starting system plist
before durable bootstrap intent, and client restart after a reboot during
acceptance. This revision records the corrections as requirements to implement
and test; it does not claim they have been satisfied.

## Sources and admission

The full-node preservation controller must capture and stop every writer and
client, with a durable execution hold. The current 4222 standalone store, live
4223/4224 clustered stores, and separately held member-1 store are four
sources. Three healthy cold masters from one quiet window, byte-matched to the
stopped source stores, and their isolated restores must be accepted before a
migration intent. PR #170's owned replay is fixture evidence, not those live
masters. The held member-1 store remains cold and must never be booted by the
migration.

The user preservation journal must record a durable, same-boot transfer of
`nats`, `nats-2`, `nats-3` and held `nats-1` to a specific future root
transaction. Its baseline and unresolved chain remain intact. After transfer,
its restore path must not re-bootstrap those GUI jobs; it must verify a root
accepted receipt or an explicitly completed pre-bootstrap rollback, then
restore and resolve the non-NATS units. This requires an explicit change to
its entrypoint and final readiness rules; a blanket refusal on marker presence
would strand the full-node hold. The root transaction refuses marker
publication without the matching transfer receipt. It also acquires the user
journal's node lock only after the transferring controller releases it; no
active or unresolved competing window may be silently superseded.

A dedicated `_openclaw_nats` UID/group and protected site must pass the
read-only staging audit. A privileged same-device scan must find no stale file
with the proposed UID/GID on the data volume. The root journal pins the
account, ownership-enforcing volume, ancestors, exact regular binary, system
plists, configuration, included credentials and four distinct store roots by
content and filesystem identity. The current Homebrew `nats-server` is a
user-owned symlink to a 2.12.6 Mach-O binary; the root transaction copies and
pins the resolved regular binary and never launches through that symlink.
After staging, a separate recursive audit must require exactly the expected
files, owners, modes, identities, devices and no ACLs. PR #175's empty-root
check applies only before staging.

## Exclusion and marker publication

Every legacy NATS-changing entrypoint must acquire the same root-owned lock
for its entire mutation, including auth reload and launchd load: installer,
trust-peer sync, auth renderer, cohort initializer, stack-up and preservation
restoration. The lock file must live outside the protected staging root, whose
preflight requires emptiness. On macOS the wrapper uses `fcntl.flock`, not a
nonexistent stock `flock(1)` or an in-process Node assumption. Each operation
checks the marker while holding the lock and validates the lock-file identity.
The root takes it exclusively with a bounded timeout; an inherited lock in a
child can outlive its parent and must make the root refuse, not proceed.

A newly deployed lock cannot cover an old in-flight process. With the lock
held, the root must physically inspect executable paths and arguments for all
NATS-changing tools and preservation controllers, and refuse if any old or
unclassified instance could still mutate. This process check is a necessary
precondition, not a substitute for the lock. Launchd disable, parked GUI
plists, and occupied monitor ports provide further physical fences against
legacy restarts. The protected system jobs must retain the historical monitor
ports 8222–8224: a duplicate monitor port kills an old process before it opens
JetStream; a duplicate client port alone does not prevent it opening and
rewriting its store.

Only then may root write and read-check its durable intent, publish the
root-owned marker, sync the file and protected directory with `F_FULLFSYNC`,
and read back the marker and lock identities. The marker has the schema and
active cohort required by node-watch. Every ambiguity after marker creation
is a recovery case; the journal must observe the physical marker and jobs,
not infer them from its last successful append. A new transaction cannot
accumulate beside an unresolved one.

## Job retirement and protected first start

Under the exclusion lock, first disable each exact legacy GUI label, then
bootout, then park its exact pinned plist as `.plist.disabled`. All four
legacy plists use `KeepAlive`; bootout alone is insufficient. Verify disabled
labels cannot load on this Mac, all former PIDs/listeners/store handles are
gone, and the GUI domain needed for possible rollback is available before
retiring anything. Copy each stopped store into its own protected root, verify
source = cold master = copy, and keep masters immutable. A copy is single-use:
clustered NATS startup rewrites `peers.idx`, so any retry starts from a new
verified copy of a master.

The three intended protected roles retain the split topology. Port 4222's
seven-stream/two-consumer standalone source must never start clustered: NATS
can delete loaded streams with no cluster assignment. The 4223 and 4224
stores retain their exact server names and three-member metadata peer set.
Decode each store's `$SYS/_js_/_meta_/peers.idx` and require the configured
name's hash and expected peer set before bootstrap. Bind each server name to
one source store, protected copy, config and listener. NATS routes do not
reject every cross-server duplicate name, so a route edge is not identity
proof. Never boot a `-1` protected job or use the held store. Isolated restores
use throwaway copies, removed routes and distinct ports; verify the live route
graph is unchanged before and after each.

Keep protected plists outside `/Library/LaunchDaemons`, or prove their system
labels persistently disabled, until `first-bootstrap-intent` is durable. A
staged enabled plist may auto-start on VM boot without that intent. Record the
intent before the first protected bootstrap; it is the no-ordinary-rollback
boundary even if launch outcome becomes ambiguous, because a store may have
advanced. Recovery after it may only finish the protected migration or demand
an explicit reverse migration with new preservation. The root journal must
handle reboot and boot-time launch as a forward recovery state, never guess
that the old writer can restart.

The first protected boot admits only a root acceptance identity, not client
credentials. That keeps a rebooted user client from writing while the root
compares live metadata, stream contents and consumers with the cold masters.
The full-node hold must additionally persistently disable client jobs until
their recorded restoration, since today's bootout-only hold lets them return
at login. Accept that every master message is present before publishing client
credentials as a separate journaled step. A root-side credential rotation and
revocation path must exist before cutover; user-owned `--sync-nats` refuses
after the marker. Only then may the user journal restore non-NATS services and
resolve its transferred window. Root acceptance also requires the service UID
on all nine expected ports, exact system-domain jobs, the split topology and
stream/consumer counts, member 1 still offline, client reconnection,
node-watch WORKING with the marker, and a reboot acceptance check.

## Pre-bootstrap rollback

Rollback exists only before `first-bootstrap-intent` and needs its own
write-then-act states, including `rollback-failed`. It restores recorded bytes
of old plists/config/auth rather than calling renderers that refuse under the
marker. Before starting an old job, prove its store still matches its cold
master; if a failed rollback already started it, stop and restore from the
master before retry. Re-enable/bootstrap only the exact prior GUI jobs under
the exclusive old-writer lock, verify physical bus and service readiness,
record marker-removal intent, unlink and `F_FULLFSYNC` the marker directory,
then record completion. A crash between any two actions resumes this rollback
journal; it never opens a second transaction. After first-bootstrap intent,
this path is forbidden.

## Evidence and current refusal

Fixtures with real NATS 2.12.6 must kill the root transaction at every journal
and physical boundary, including marker rename/sync, rollback, lock-file
replacement and reboot-state reconstruction. They must prove the standalone
orphan-deletion and duplicate-name negatives, single-use copy behavior,
`peers.idx` mapping, monitored-port fence, isolated restores, restricted
first-boot auth and user-journal transfer. Live acceptance must prove launchd
disable/bootout/parking across reboot and login, exact masters/copies, service
UID/ports, restored clients, watcher and one post-acceptance reboot. A green
source suite is not a live cold-copy or restoration receipt.

This Mac has no `_openclaw_nats` account or protected root. The standalone
writer and two routed peers remain live, one Raft replica is reported offline,
and the held member-1 store is separate. The full-node transfer, persistent
client disable, old-writer exclusion, root journal, protected assets, three
healthy cold masters, isolated restores and live acceptance are all open. No
cutover command may run from this candidate design.
