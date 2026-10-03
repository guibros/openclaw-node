# Stopped-VM cold-master path — candidate, not authorization

Status: design candidate only, 2026-10-03. The current `RECOVERY.md` still
requires a continuous launchd/process watch before a copied history may be
certified. `seal()` and root `begin()` remain closed. No NATS writer, store,
service or VM has been stopped or changed for this candidate.

## Boundary this path would replace

The running guest cannot prove physical writer absence with its current
process census, `eslogger` notifications or file timestamps. A disposable
same-volume APFS probe changed a file through a held writable `MAP_SHARED`
mapping without advancing ctime or mtime until the mapping was torn down,
including after `sync`, `fsync` and `F_FULLFSYNC`. A clean timestamp fence is
therefore a refusal tripwire only. The proposed substitute is a full guest
power-off followed by a host-side copy of the complete VM backing image.
That removes the guest execution substrate for the powered-off copy window,
not the preceding interval between NATS exit and guest power-off. It moves
the host, hypervisor and backing-storage copy into the trusted base; the
guest cannot attest those facts itself.

This sequence is not executable with the current Journal. Before stopping
any writer for a real attempt, an implementation must add a durable
`cold-copy-pending` hold and a startup interlock that parks the saved writer
cohort and application clients after any reboot. The existing restore-only
path restores prior running units; invoking it automatically after master
capture would invalidate those masters. The hold must be read back from
durable storage and exercised in owned reboot fixtures before this route
can be used. A crash or reboot at any transition without that interlock
refuses the route and requires operator handoff.

## Preconditions inside the guest

1. Capture a fresh full-node structural inventory and every transitive
   dependency/process binding required by the existing recovery contract.
   A watcher report or a plist hash alone is insufficient.
2. Hold dispatch and all application clients, including timers, the
   deploy listener, the on-demand worker and their descendants. Require
   zero active task claims, collaboration sessions, child processes and
   consumer ack-pending. Preserve each prior loaded/disabled state.
3. With application publishers and consumers drained but NATS still
   healthy, capture the exact source stream and consumer snapshots through
   the running servers. Pin all three source roles separately, including
   stream holes, consumer positions and the snapshot high-water marks.
   Refuse an absent or ambiguous source before a stop.
4. Persist and read back the `cold-copy-pending` hold for the exact cohort.
   Its startup interlock must precede any launchd restoration after reboot,
   including restore-only recovery. The current Journal cannot do this.
5. Stop NATS through the managed sequence in `RECOVERY.md`: member 1
   remains held, then members 2/3 stop before the standalone. Require
   clean-exit logs, no open store owners, and no forced termination.
   The durable hold keeps the old writer jobs parked after any reboot.
6. Hash each stopped store tree and verify the source identity and captured
   high-water marks. Refuse absent or ambiguous stores, configs, service
   identities or changed inventory. These hashes corroborate the later
   host copy; they do not independently certify writer absence between
   server exit and power-off. A mapped write in that interval could be
   present in both the guest hash and the host copy. The later isolated
   restore must compare the histories to the pre-stop running snapshots;
   any change outside that semantic comparison remains a trust gap until
   the recovery contract defines and accepts its scope.
7. Shut down the guest cleanly, with a recorded OS shutdown transition.
   A forced stop or a suspended guest is not a clean-stop observation.

## Host handoff

The operator must identify the actual hypervisor and complete backing
artifact before any host command is prescribed. The host receipt must
attest a powered-off state, not pause/suspend or saved RAM; disabled
autostart/auto-resume/automatic snapshots for the window; and no second
VM instance opening the same image. It must identify every component of
the disk image, including sparse bands or auxiliary state where relevant,
and demonstrate local materialization if the image resides on a synced,
remote or thin-provisioned store.

Copy the complete powered-off image from a consistent host point. Hash the
source and copy, independently re-read the copy, and retain the original
image unmodified. Record host timestamps, image identity, sizes and hashes
in an operator-attested receipt. The guest may corroborate those values
after boot, but must not fabricate a host observation from guest state.
Host copy completion does not by itself mean the application histories are
healthy or sealed.

## Cold masters and isolated acceptance

Extract each of the three NATS store trees from the copied image without
starting its ordinary jobs. Use a read-only mount where available; if an
isolated clone must boot, disconnect it from the production network and
keep all application/NATS jobs parked. Compare the extracted store trees
to the in-guest stopped-source hashes. Each store becomes its own private,
read-only cold master. A mismatch refuses certification, even when the
image hashes match each other.

Restore from fresh working copies, never a master. Keep the standalone
topology separate from the three-member metadata group; do not start the
standalone as clustered. Check member-1 offline R1 state first, then the
remapped cluster assignments as specified by `RECOVERY.md`. For every
stream, compare sequence range and holes, subjects, nanosecond timestamps,
raw headers and payloads with its own pre-stop snapshot. Compare consumer
configuration, delivered/ack floors, pending ack/redelivery and remaining
pending counts. Verify server and route identities and absence of external
clients. Rehash each master after the tests. Any failed restore or changed
master refuses the path.

## Boot, rollback and acceptance

The original guest may boot only into the durable `cold-copy-pending`
posture: clients and old writers parked before any restore-only action.
Do not run it concurrently with a clone using the same identities or
network. Before durable first-bootstrap-intent, an abandoned migration
may use the original guest or host image for rollback only through an
explicit operator-controlled transition that invalidates the cold masters,
rechecks the complete saved inventory, and then invokes restoration of
the prior jobs. Existing automatic restore-only recovery is not that
transition. After first-bootstrap-intent, returning to the old guest is a
reverse migration with new preservation and verification.

This path addresses the three NATS cold masters only. A full-image copy
does not certify the gateway task SQLite store, viewer plan ticks or other
files as a coordinated quiet point. If the image is to support that later
claim, the gateway and viewer need the explicit stop order, process-group
drain and store-level checks required by `RECOVERY.md`; that is separate
work in recovery 1.3.

An accepted implementation would amend the continuous-watch clause in
`RECOVERY.md` for this path only, add a typed host receipt and root-driver
verification, then permit `seal()` only after all guest/host/image/restore
proofs pass, including an accepted treatment of the pre-power-off trust
gap. The current code has no cold-copy hold, startup interlock, receipt or
host verifier. This candidate does not authorize a cold-copy claim, seal,
root migration or service retirement. Host operator access, the
hypervisor product and the complete backing-image path are still unknown
from inside the guest.
