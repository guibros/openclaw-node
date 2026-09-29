# Scheduled application execution pause — 2026-09-29 03:11:58 EDT

## Micro re-orient

Bus-client drain/readiness steps are closed. Recovery1.2 cannot safely unload
scheduled jobs using empty logs or a transient missing PID. Claude50/52 and
actual exec-lock controls identify a smaller application-quiescence mechanism.
A source prototype was exercised during read-only/owned preflight. Formalize
it here; production integration is a distinct queued step. Both chains stay off.

## Goal and contract

A durable owner-private closed marker precedes an exclusive flock drain.
Runners take a nonblocking shared lock, validate metadata and inspect that
marker before exec. An inherited descriptor keeps the foreground application
locked until normal exit. Closed runs return0 without application work/logs;
invalid/missing/symlink metadata returns78 without application work/logs.
No OS-spawn coverage or arbitrary descendant drain is claimed.

## Locked choices and needs

D15 records the runtime-hold exception to recoveryD8. Python3/fcntl, installed
Node, real macOS launchd and actual vnode watches exist on this node. Node
children may close unknown descriptors; the foreground audit and consolidation
notification completion remain step3.2 needs, not hidden assumptions.

## Deltas

workspace-bin/service_gate.py implements only the owned execution/hold primitive
and explicit recovery API. test/service_gate_test.py runs real Node/shell
processes and an isolated scheduled launchd job; test/service-gate.test.mjs
includes those tests in existing isolated CI. No service template, loaded unit,
production marker or installer behavior changes in this step.

## Verification and remaining work

Eighteen owned tests pass, including actual scheduled starts staying inert
after controller exit, invalid metadata, inode replacement, deadline refusal,
explicit reopen and kernel rewrite detection. Private source pins/logs are
in PRIMITIVE_EVIDENCE.json. New exact CI and independent review remain needed.
Node/shell exec negative controls show lost locks without explicit inheritance.
Linux generic locks run, but continuous inode-watch acceptance is unproved.
The complete installed timer and restoration mechanism remains3.2.

## Mid-implementation correction

Prepare/fsync the marker under a fresh private name, then publish via an
exclusive atomic hard link before draining. A pre-publication sync fault has
no accepted close; a post-publication directory sync fault retains a valid
closed marker. Both faults preserve forensic staging bytes.18 fresh owned
controls pass against private primitive-v2. No production operation occurred.

## Isolated CI fixture correction

CI36535769998 fails the existing task-daemon repeated-signal fixture: its
owned server receives SIGSTOP, but the test requests daemon shutdown before
observing that server suspended. The daemon drains and exits0 in3ms, so the
test's pending-drain premise is false. Keep its assertion and signal checks;
wait for the owned server's actual ps state T before requesting the drain.
This changes only fixture ordering, with no daemon or gate implementation
change. Preserve the failed CI log; rerun the focused owned control and exact
integration CI before accepting3.1.

Controller interruption also gets two real owned crash controls, beyond normal
context exit: SIGKILL after durable publication while foreground drain is
pending, and SIGKILL after verified drain. Both must keep scheduled execution
closed until the exact window is explicitly reopened. These are process-crash
controls, not a power-loss or VM filesystem-durability claim.

## Re-orientation before installation

An actual owned Mac probe replaces the gate's parent directory transiently,
initializes a fresh open gate at the same pathname, runs its application, then
restores the original parent. The old closed guard returns verified with zero
events. Current-path checks do not witness that interval. Pin and watch the
root and every path ancestor before publishing a hold; rename/delete/revoke
must refuse even after mapping restoration. Ordinary ancestor-directory entry
writes must remain allowed. Symlink ancestors are refused for this primitive;
Linux continuous mapping witness remains unproved.

Two further owned malformed-metadata controls reproduce a FIFO open hang and
a deeply nested JSON traceback. Nonblocking opens must reject special files
before reads; parser recursion failures must return the same silent78 as
other invalid metadata. Keep3.1 active and do not begin production integration.
The private ANCESTOR_MAPPING_PROBE.json and INVALID_METADATA_PROBE.json retain
the old-source failures, with no production operations.

## Corrected primitive boundary — 2026-09-29 03:57 EDT

Claude58 adds the independent gate pin and interpreter boundary. Both the
runner and Gate constructor require the installed lock device/inode/ctime pin,
so an internally consistent substitute cannot run or be closed by the controller.
Descriptor-relative path traversal refuses intermediate symlinks; native watches
register before the second name walk and publication. Original descriptors and
EV_EOF are checked. Root/ancestor mapping observations do not protect interpreter
or wrapper replacement; loaded code paths and -I -S are required3.2 work.

Receipt recovery includes full root ctime/mtime, every object identity, marker
and metadata hashes and the original path chain. A pre-publication random watch
session belongs only to ClosedGate. Reattach returns a distinct RestorationGate
with no certifying fields, even after matching receipts and a fresh drain.
Any watch refusal is latched permanently. The saved receipt can recover a
matching timed-out hold after its straggler drains; it never silently reopens.

No-receipt publication crashes, mismatched receipts and broken/missing-marker
repair need the sole journal's durable intent, interruption record and dependency
restoration in3.2. They cannot be claimed by this primitive or hidden inside
reattach. The consolidation timer also races a cycle promise against its cap
without awaiting termination after abort, and the memory daemon imports this
scheduler in process. Track both delegated and foreground work before3.2
installation; do not widen3.1 to change consolidation.

Thirty-eight actual Mac controls pass against source4570d92, including two
real SIGKILL boundaries, pinned substitution without any controller watcher,
ancestor substitution/refusal, intermediate symlinks, silent FIFO/deep JSON
failures, type-separated restoration, stray entry detection and isolated import
shadowing. A real scheduled owned job runs1→3 while application runs remain1
and stdout/stderr stay zero. Private primitive-v4 retains exact copies and log
hashes. Isolated exact CI and independent corrected-SHA review remain pending.

Python3.9 pathlib parent slices were initially unsupported; use an ordinary
tuple of parents, preserving the project's Python3.8 floor. Initial owned
failures were implementation/test errors and no production operation occurred.
The Linux pause fixture now requires every owned NATS task to have stateT,
not merely its leader; daemon source/assertions are unchanged.

## Actual APFS measurements — 2026-09-29 04:01 EDT

Six thousand rapid native checks pass in3.90s on the owned APFS gate: zero
tolerated ATTRIB, refusal or path events in this mount's observed policy.
This is not a23-minute soak or proof of all mounts; tolerated counts are still
separate by design. Marker rename-away/return changes marker ctime and root
ctime/mtime on this APFS path; original receipt recovery refuses. A first
measurement completed its checks but failed filesystem lookup, so its result
was not accepted; the corrected device-derived lookup and new owned root
produce the retained measurement. No production operation occurred.
