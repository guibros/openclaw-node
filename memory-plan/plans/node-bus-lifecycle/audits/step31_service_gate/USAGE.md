# Scheduled application execution hold primitive

This prototype ships only to owned test consumers. Production installation
and the sole preservation controller/journal are still pending. It covers
scheduled timer jobs with audited foreground completion; never put a general
KeepAlive daemon behind a wrapper that exits0 when closed.

Use an absolute real Python interpreter with -I -S, then service_gate.py run
<normalized-absolute-root> --lock <device>:<inode>:<ctime_ns> --root-pin <device>:<inode> -- <absolute
executable> <args>. The installed arguments supply the independent lock and root pins;
metadata inside a substitute directory cannot authorize that substitute.
Gate(root, {lock: pin, root: pin}) requires both pins for the controller. initialize(root)
returns both freshly created pins. CLI init creates or validates an open root,
never reopens a closed one and is not a source of replacement installed pins.

The wrapper walks every path component through O_NOFOLLOW directory descriptors,
registers native Mac rename/delete/revoke watches, and walks again to bind the
same mapping before reading the gate files. Symlink ancestors and non-normalized
paths refuse. Shared locking precedes final validation, marker inspection and
exec. Missing/invalid/special/symlink metadata refuses78 without output. Closed
or exclusively locked runs exit0 silently before application execution.
The inherited lock descriptor is read-only. Its lifetime covers the exec'd
process; Node child_process may close it in descendants. Detached/unawaited
work, other invokers and delegated daemon work require separate inventory
and completion proof before installation.

After durable intent, close_and_drain(window, reason, seconds) prepares/fsyncs
an owner-private marker, publishes it by exclusive hard link, fsyncs the directory,
then waits for an exclusive drain. Gate.closed_receipt is available after
publication, including on a drain timeout. Post-publication faults retain the
marker/staging bytes and expose a receipt if its published inode remains valid.
Nothing automatically reopens. Before publication a fault means no accepted
hold; no dependent service may be stopped or store copied.

The saved receipt binds all four objects' complete identities, root ctime and
mtime, marker/metadata hashes, external lock/root pins, window and ancestor chain.
A ClosedGate is created only after a fresh exclusive drain in the original
watch session, registered before publication. Its checks emit verified and
watch_session_id only while that session has never refused. Native file/root
watches reject changes after publication; all watched descriptors are checked
against their registered identities. Pure ATTRIB events are tolerated only
with unchanged identity and counted separately, with a last-event sample.
Raw refusal evidence is bounded at4096; a refusal is permanent for the session.

ClosedGate.close() ends observation while retaining the hold. Reattach(receipt,
seconds) requires an exact receipt and fresh bounded drain, and returns the
separate RestorationGate type. It emits restoration_only, never verified or
watch_session_id. Matching bytes never certify an observer-loss interval.
Reopen(receipt, seconds), under durable restoration intent and only after
all dependencies are ready, requires exact identities and an exclusive drain
before unlink/fsync. A straggler timeout retains the hold. This is explicit
restoration, not acceptance of interrupted preservation.

Step3.2 must implement the no-receipt publication/crash gap, mismatched-receipt
interrupted recovery and broken/missing-marker repair in the sole durable
controller/journal. In those cases dependencies cannot be stopped on the basis
of this prototype. The future controller must close/drain a broken open hold,
record the interrupted window and restore dependency readiness before reopening;
it must never certify across the gap. Bracket every dependency stop and store copy with clean checks carrying the
same original watch_session_id; never consume an old point check as interval
proof. Pin actual loaded arguments, interpreter,
wrapper/import graph and their path mappings before any production baseline.
-I -S prevents adjacent Python modules and site .pth loading; it does not protect
replaceable interpreter/wrapper code. Keep the gate/code paths outside deploy copy/chmod/prune targets, or hold the
deploy and explicitly recapture installed pins after any applicable reinstall.
Protect or continuously watch that code
and its ancestors separately. No same-user code or mount protection is claimed.

Mac checks report native file/path watches. Linux has pinned wrapper, lock and
current component identities, but continuous watcher certification remains
unproved there. A gate receipt is not global OS-spawn evidence. Scheduled starts
that do no application work are deliberately allowed during a hold. Consolidation
foreground/cancellation paths, the five installed entrypoints and durable
restoration remain required integration work; the prototype is not a completed
preservation controller.
